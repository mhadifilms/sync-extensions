import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(cors());

let jobs = [];
let jobCounter = 0;
const jobsFile = path.join(os.homedir(), 'Documents', 'SyncExtension', 'jobs.json');

function loadJobs(){
  // Cloud-first: do not load persisted jobs
  jobs = jobs || [];
  jobCounter = jobs.length ? Math.max(...jobs.map(j=>Number(j.id)||0)) + 1 : 1;
}
function saveJobs(){
  // Cloud-first: disable writing jobs.json
  return;
}
loadJobs();

const SUPA_URL = process.env.SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPA_BUCKET = process.env.SUPABASE_BUCKET || '';
const SUPA_PREFIX = 'sync. extension/';

function guessMime(p){
  const ext = String(p||'').toLowerCase().split('.').pop();
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mxf') return 'application/octet-stream';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'avi') return 'video/x-msvideo';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'aac' || ext==='m4a') return 'audio/aac';
  return 'application/octet-stream';
}

async function supabaseUpload(localPath, job){
  const U = getSupabaseUrl(job);
  const K = getSupabaseKey(job);
  const B = getSupabaseBucket(job);
  if (!U || !K || !B) throw new Error('Supabase not configured');
  const base = path.basename(localPath);
  const dest = `${SUPA_PREFIX}uploads/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${base}`;
  const url = `${U}/storage/v1/object/${encodeURIComponent(B)}/${dest}`;
  const stream = fs.createReadStream(localPath);
  slog('[upload] start', localPath, '→', dest);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${K}`,
      'Content-Type': guessMime(localPath),
      'x-upsert': 'true'
    },
    body: stream
  });
  if (!resp.ok){
    let t = ''; try { t = await resp.text(); } catch(_){ }
    throw new Error(`supabase upload failed ${resp.status} ${t}`);
  }
  const publicUrl = `${U}/storage/v1/object/public/${B}/${dest}`;
  // Allow brief propagation time
  await new Promise(r=>setTimeout(r, 300));
  slog('[upload] ok', publicUrl);
  return publicUrl;
}

const SYNC_API_BASE = 'https://api.sync.so/v2';

app.get('/health', (req,res)=> res.json({ status:'ok', ts: Date.now() }));

// Proxy models
app.get('/models', async (req, res) => {
  try{
    const { apiKey } = req.query;
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    const r = await fetch(`${SYNC_API_BASE}/models`, { headers: { 'x-api-key': String(apiKey) }});
    const j = await r.json().catch(()=>({}));
    if (!r.ok) return res.status(r.status).json(j);
    res.json(j);
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// Proxy list generations
app.get('/generations', async (req, res) => {
  try{
    const { apiKey, status } = req.query;
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    const url = new URL(`${SYNC_API_BASE}/generations`);
    if (status) url.searchParams.set('status', String(status));
    const r = await fetch(url.toString(), { headers: { 'x-api-key': String(apiKey) }});
    const j = await r.json().catch(()=>({}));
    if (!r.ok) return res.status(r.status).json(j);
    res.json(j);
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/jobs', (req,res)=> res.json(jobs));
app.get('/jobs/:id', (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  res.json(job);
});

function normalizePaths(obj){
  if (!obj) return obj;
  if (obj.videoPath) obj.videoPath = resolveSafeLocalPath(obj.videoPath);
  if (obj.audioPath) obj.audioPath = resolveSafeLocalPath(obj.audioPath);
  return obj;
}

app.post('/jobs', async (req, res) => {
  try{
    let { videoPath, audioPath, videoUrl, audioUrl, isTempVideo, isTempAudio, model, temperature, activeSpeakerOnly, detectObstructions, options = {}, apiKey, outputDir, supabaseUrl, supabaseKey, supabaseBucket } = req.body || {};
    ({ videoPath, audioPath } = normalizePaths({ videoPath, audioPath }));
    const vStat = safeStat(videoPath); const aStat = safeStat(audioPath);
    const overLimit = ((vStat && vStat.size > 20*1024*1024) || (aStat && aStat.size > 20*1024*1024));
    slog('[jobs:create]', 'model=', model||'lipsync-2-pro', 'overLimit=', overLimit, 'v=', vStat&&vStat.size, 'a=', aStat&&aStat.size, 'supaUrl=', Boolean(supabaseUrl||SUPA_URL), 'bucket=', (supabaseBucket||SUPA_BUCKET));
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }
    if (!videoUrl || !audioUrl){
      if (!videoPath || !audioPath) return res.status(400).json({ error: 'Video and audio required' });
      if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) return res.status(400).json({ error: 'Video or audio file not found' });
    }
    if (overLimit && (!((supabaseUrl||SUPA_URL) && (supabaseKey||SUPA_KEY) && (supabaseBucket||SUPA_BUCKET)))){
      return res.status(400).json({ error: 'Large file upload requires Supabase url/key/bucket in settings' });
    }

    const limit1GB = 1024*1024*1024;
    if ((vStat && vStat.size > limit1GB) || (aStat && aStat.size > limit1GB)){
      return res.status(400).json({ error: 'Files over 1GB are not allowed. Please use smaller files.' });
    }

    const job = {
      id: ++jobCounter,
      videoPath,
      audioPath,
      videoUrl: videoUrl || '',
      audioUrl: audioUrl || '',
      isTempVideo: !!isTempVideo,
      isTempAudio: !!isTempAudio,
      model: model || 'lipsync-2-pro',
      temperature: temperature || 0.7,
      activeSpeakerOnly: !!activeSpeakerOnly,
      detectObstructions: !!detectObstructions,
      options: (options && typeof options === 'object') ? options : {},
      status: 'processing',
      createdAt: new Date().toISOString(),
      syncJobId: null,
      outputPath: null,
      outputDir: outputDir || null,
      apiKey,
      supabaseUrl: supabaseUrl || '',
      supabaseKey: supabaseKey || '',
      supabaseBucket: supabaseBucket || ''
    };
    jobs.push(job);
    saveJobs();

    try{
      await createGeneration(job);
      // Cleanup temp inputs if present and uploaded
      try {
        if (job.isTempVideo && job.videoPath && fs.existsSync(job.videoPath)) { fs.unlinkSync(job.videoPath); job.videoPath = ''; }
      } catch(_){ }
      try {
        if (job.isTempAudio && job.audioPath && fs.existsSync(job.audioPath)) { fs.unlinkSync(job.audioPath); job.audioPath = ''; }
      } catch(_){ }
      saveJobs();
      res.json(job);
      pollSyncJob(job);
    }catch(e){
      slog('[jobs:create] generation error', e && e.message ? e.message : String(e));
      job.status = 'failed';
      job.error = String(e?.message||e);
      saveJobs();
      res.status(500).json({ error: job.error });
    }
  }catch(e){ slog('[jobs:create] error', e && e.message ? e.message : String(e)); res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/jobs/:id/download', (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  if (!job.outputPath || !fs.existsSync(job.outputPath)) return res.status(404).json({ error:'Output not ready' });
  res.download(job.outputPath);
});

app.post('/jobs/:id/save', async (req,res)=>{
  try{
    const { location = 'project', targetDir = '', apiKey: keyOverride } = req.body || {};
    let job = jobs.find(j => String(j.id) === String(req.params.id));
    // If not local, construct a cloud-only placeholder with sync id and apiKey
    if (!job) {
      if (!keyOverride) return res.status(404).json({ error:'Job not found and apiKey missing' });
      job = { id: String(req.params.id), syncJobId: String(req.params.id), status: 'completed', outputDir: '', apiKey: keyOverride };
    }

    const defaultDir = path.join(os.homedir(), 'Documents', 'sync. outputs');
    const outDir = (location === 'documents') ? defaultDir : (targetDir || job.outputDir || defaultDir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    if (job.outputPath && fs.existsSync(job.outputPath) && path.dirname(job.outputPath) === outDir){
      return res.json({ ok:true, outputPath: job.outputPath });
    }

    if (job.outputPath && fs.existsSync(job.outputPath)){
      const newPath = path.join(outDir, `${job.id}_output.mp4`);
      try { fs.copyFileSync(job.outputPath, newPath); } catch(_){ }
      try { if (path.dirname(job.outputPath) !== outDir) fs.unlinkSync(job.outputPath); } catch(_){ }
      job.outputPath = newPath;
      saveJobs();
      return res.json({ ok:true, outputPath: job.outputPath });
    }

    // Cloud download using sync id
    const meta = await fetchGeneration(job);
    if (meta && meta.outputUrl){
      const response = await fetch(meta.outputUrl);
      if (response.ok && response.body){
        const dest = path.join(outDir, `${job.id}_output.mp4`);
        await pipeToFile(response.body, dest);
        job.outputPath = dest;
        if (!jobs.find(j => String(j.id) === String(job.id))) { jobs.unshift(job); saveJobs(); }
        return res.json({ ok:true, outputPath: job.outputPath });
      }
    }
    res.status(400).json({ error:'Output not available yet' });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// Simple GET endpoint for quick checks
app.get('/costs', (_req, res)=>{
  res.json({ ok:true, note:'POST this endpoint to estimate costs', ts: Date.now() });
});

app.post('/costs', async (req, res) => {
  try{
    slog('[costs] received POST');
    let { videoPath, audioPath, videoUrl, audioUrl, model = 'lipsync-2-pro', apiKey, supabaseUrl, supabaseKey, supabaseBucket, options = {} } = req.body || {};
    ({ videoPath, audioPath } = normalizePaths({ videoPath, audioPath }));
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    if (!videoUrl || !audioUrl){
      if (!videoPath || !audioPath) return res.status(400).json({ error: 'Video and audio required' });
      if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) return res.status(400).json({ error: 'Video or audio file not found' });
      const U = supabaseUrl || SUPA_URL; const K = supabaseKey || SUPA_KEY; const B = supabaseBucket || SUPA_BUCKET;
      if (!U || !K || !B) return res.status(400).json({ error: 'Supabase url/key/bucket required to estimate cost' });

      slog('[costs] uploading sources for cost estimate');
      videoUrl = await supabaseUpload(resolveSafeLocalPath(videoPath), { supabaseUrl: U, supabaseKey: K, supabaseBucket: B });
      audioUrl = await supabaseUpload(resolveSafeLocalPath(audioPath), { supabaseUrl: U, supabaseKey: K, supabaseBucket: B });
    }

    const opts = (options && typeof options === 'object') ? options : {};
    if (!opts.sync_mode) opts.sync_mode = 'loop';
    const body = {
      model: String(model||'lipsync-2-pro'),
      input: [ { type: 'video', url: videoUrl }, { type: 'audio', url: audioUrl } ],
      options: opts
    };
    try { slog('[costs] request', 'model=', body.model, 'video=', videoUrl, 'audio=', audioUrl, 'options=', JSON.stringify(opts)); } catch(_){ }
    const resp = await fetch(`${SYNC_API_BASE}/analyze/cost`, { method:'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(body) });
    const text = await safeText(resp);
    try { slog('[costs] response', resp.status, (text||'').slice(0,200)); } catch(_){ }
    if (!resp.ok) { slog('[costs] error', resp.status, text); return res.status(resp.status).json({ error: text || 'cost failed' }); }
    let raw = null; let estimate = [];
    try { raw = JSON.parse(text || '[]'); } catch(_) { raw = null; }
    if (Array.isArray(raw)) estimate = raw;
    else if (raw && typeof raw === 'object') estimate = [raw];
    else estimate = [];
    try { slog('[costs] ok estimate', JSON.stringify(estimate)); } catch(_){ }
    res.json({ ok:true, estimate });
  }catch(e){ slog('[costs] exception', String(e)); res.status(500).json({ error: String(e?.message||e) }); }
});

function pipeToFile(stream, dest){
  return new Promise((resolve, reject)=>{
    const ws = fs.createWriteStream(dest);
    stream.pipe(ws);
    stream.on('error', reject);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

async function createGeneration(job){
  const vStat = safeStat(job.videoPath);
  const aStat = safeStat(job.audioPath);
  const overLimit = ((vStat && vStat.size > 20*1024*1024) || (aStat && aStat.size > 20*1024*1024));
  try{
    // Preferred: if panel provided URLs, use them directly
    if (job.videoUrl && job.audioUrl){
      const body = {
        model: job.model,
        input: [ { type:'video', url: job.videoUrl }, { type:'audio', url: job.audioUrl } ],
        options: (job.options && typeof job.options === 'object') ? job.options : {}
      };
      const resp = await fetch(`${SYNC_API_BASE}/generate`, {
        method: 'POST', headers: { 'x-api-key': job.apiKey, 'accept':'application/json', 'content-type':'application/json' }, body: JSON.stringify(body)
      });
      if (!resp.ok){ const t = await safeText(resp); slog('[create:url:direct] error', resp.status, t); throw new Error(`create(url) failed ${resp.status} ${t}`); }
      const data = await resp.json();
      job.syncJobId = data.id;
      return;
    }
    if (overLimit && (getSupabaseUrl(job) && getSupabaseKey(job) && getSupabaseBucket(job))) {
      slog('[upload] using supabase url mode');
      const videoUrl = await supabaseUpload(resolveSafeLocalPath(job.videoPath), job);
      const audioUrl = await supabaseUpload(resolveSafeLocalPath(job.audioPath), job);
      // Cleanup temp sources if flagged
      try { if (job.isTempVideo && job.videoPath && fs.existsSync(job.videoPath)) { fs.unlinkSync(job.videoPath); job.videoPath = ''; } } catch(_){ }
      try { if (job.isTempAudio && job.audioPath && fs.existsSync(job.audioPath)) { fs.unlinkSync(job.audioPath); job.audioPath = ''; } } catch(_){ }
      const body = {
        model: job.model,
        input: [ { type:'video', url: videoUrl }, { type:'audio', url: audioUrl } ],
        options: (job.options && typeof job.options === 'object') ? job.options : {}
        // in/out to be added when UI passes them
      };
      const resp = await fetch(`${SYNC_API_BASE}/generate`, {
        method: 'POST',
        headers: { 'x-api-key': job.apiKey, 'accept':'application/json', 'content-type':'application/json' },
        body: JSON.stringify(body)
      });
      if (!resp.ok){ const t = await safeText(resp); slog('[create:url] error', resp.status, t); throw new Error(`create(url) failed ${resp.status} ${t}`); }
      const data = await resp.json();
      job.syncJobId = data.id;
      return;
    }
  }catch(e){ console.error('URL mode failed, falling back:', e); }
  // fallback file mode below...

  // Fallback to file upload mode
  const form = new FormData();
  form.append('video', fs.createReadStream(resolveSafeLocalPath(job.videoPath)));
  form.append('audio', fs.createReadStream(resolveSafeLocalPath(job.audioPath)));
  form.append('model', job.model);
  try { if (job.options && typeof job.options === 'object') form.append('options', JSON.stringify(job.options)); } catch(_){ }
  const resp = await fetch(`${SYNC_API_BASE}/generate`, {
    method:'POST',
    headers: { 'x-api-key': job.apiKey, 'accept':'application/json', ...form.getHeaders() },
    body: form
  });
  if (!resp.ok){ const t = await safeText(resp); slog('[create:file] error', resp.status, t); throw new Error(`create(file) failed ${resp.status} ${t}`); }
  const data = await resp.json();
  job.syncJobId = data.id;
}

async function fetchGeneration(job){
  let resp = await fetch(`${SYNC_API_BASE}/generate/${job.syncJobId}`, { headers: { 'x-api-key': job.apiKey }});
  if (!resp.ok && resp.status === 404){
    resp = await fetch(`${SYNC_API_BASE}/generations/${job.syncJobId}`, { headers: { 'x-api-key': job.apiKey }});
  }
  if (!resp.ok) return null;
  return await resp.json();
}

async function downloadIfReady(job){
  const meta = await fetchGeneration(job);
  if (!meta || !meta.outputUrl) return false;
  const response = await fetch(meta.outputUrl);
  if (!response.ok || !response.body) return false;
  const defaultDir = path.join(os.homedir(), 'Documents', 'sync. outputs');
  const outDir = job.outputDir && typeof job.outputDir === 'string' ? job.outputDir : defaultDir;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${job.id}_output.mp4`);
  await pipeToFile(response.body, outputPath);
  job.outputPath = outputPath;
  return true;
}

async function pollSyncJob(job){
  const pollInterval = 5000;
  const maxAttempts = 120;
  let attempts = 0;
  const tick = async ()=>{
    attempts++;
    try{
      if (await downloadIfReady(job)){
        job.status = 'completed';
        saveJobs();
        return;
      }
      if (attempts < maxAttempts){ setTimeout(tick, pollInterval); }
      else { job.status='failed'; job.error='Timeout'; saveJobs(); }
    }catch(e){ job.status='failed'; job.error=String(e?.message||e); saveJobs(); }
  };
  setTimeout(tick, pollInterval);
}

async function safeText(resp){ try{ return await resp.text(); }catch(_){ return ''; } }

function safeStat(p){ try{ return fs.statSync(p); }catch(_){ return null; } }

function log(){ try{ console.log.apply(console, arguments);}catch(_){}}

// Simple in-memory log buffer for panel debugging
const LOGS = [];
function slog(){ const msg = Array.from(arguments).map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' '); LOGS.push(new Date().toISOString()+" "+msg); if (LOGS.length>500) LOGS.shift(); try{ console.log.apply(console, arguments);}catch(_){}}
app.get('/logs', (_req,res)=>{ res.json({ ok:true, logs: LOGS.slice(-200) }); });

// Accept logs from host/panel
app.post('/hostlog', (req, res)=>{
  try{
    const body = req.body || {};
    const msg = (typeof body === 'string') ? body : (body.msg || JSON.stringify(body));
    slog('[host]', msg);
    res.json({ ok:true });
  }catch(e){ res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// GET beacon fallback for constrained environments
app.get('/hostlog', (req, res)=>{
  const msg = String(req.query.msg||'');
  slog('[host]', msg);
  res.json({ ok:true });
});

app.listen(PORT, ()=>{
  console.log(`Sync Extension server running on port ${PORT}`);
  console.log(`Jobs file: ${jobsFile}`);
});

// override helpers
function getSupabaseUrl(job){ return (job && job.supabaseUrl) || SUPA_URL; }
function getSupabaseKey(job){ return (job && job.supabaseKey) || SUPA_KEY; }
function getSupabaseBucket(job){ return (job && job.supabaseBucket) || SUPA_BUCKET; }

function resolveSafeLocalPath(p){
  try{
    if (!p || typeof p !== 'string') return p;
    const isTempItems = p.indexOf('/TemporaryItems/') !== -1;
    if (!isTempItems) return p;
    const docs = path.join(os.homedir(), 'Documents', 'sync_extension_temp');
    if (!fs.existsSync(docs)) fs.mkdirSync(docs, { recursive: true });
    const target = path.join(docs, path.basename(p));
    try { fs.copyFileSync(p, target); return target; } catch(_){ return p; }
  }catch(_){ return p; }
}
