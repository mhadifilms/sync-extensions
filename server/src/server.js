import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer } from 'net';

dotenv.config();

const app = express();
app.disable('x-powered-by');
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = 3000;
const PORT_RANGE = [3000]; // Hardcode to 3000 for panel

const exec = promisify(_exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXT_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(EXT_ROOT, 'CSXS', 'manifest.xml');
const UPDATES_REPO = process.env.UPDATES_REPO || process.env.GITHUB_REPO || 'mhadifilms/sync-extensions';
const UPDATES_CHANNEL = process.env.UPDATES_CHANNEL || 'releases'; // 'releases' or 'tags'
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GH_UA = process.env.GITHUB_USER_AGENT || 'sync-extension-updater/1.0';

function ghHeaders(extra){
  const h = Object.assign({ 'Accept': 'application/vnd.github+json', 'User-Agent': GH_UA }, extra||{});
  if (GH_TOKEN) h['Authorization'] = `Bearer ${GH_TOKEN}`;
  return h;
}

async function ghFetch(url, opts){
  return await fetch(url, Object.assign({ headers: ghHeaders() }, opts||{}));
}

function parseBundleVersion(xmlText){
  try{
    const m = /ExtensionBundleVersion\s*=\s*"([^"]+)"/i.exec(String(xmlText||''));
    if (m && m[1]) return m[1].trim();
  }catch(_){ }
  return '';
}

function normalizeVersion(v){
  try{ return String(v||'').trim().replace(/^v/i, ''); }catch(_){ return ''; }
}

function compareSemver(a, b){
  const pa = normalizeVersion(a).split('.').map(x=>parseInt(x,10)||0);
  const pb = normalizeVersion(b).split('.').map(x=>parseInt(x,10)||0);
  for (let i=0; i<Math.max(pa.length, pb.length); i++){
    const ai = pa[i]||0; const bi = pb[i]||0;
    if (ai > bi) return 1; if (ai < bi) return -1;
  }
  return 0;
}

async function getCurrentVersion(){
  try{
    const xml = fs.readFileSync(MANIFEST_PATH, 'utf8');
    return parseBundleVersion(xml) || '';
  }catch(_){ return ''; }
}

async function getLatestReleaseInfo(){
  const repo = UPDATES_REPO;
  const base = `https://api.github.com/repos/${repo}`;
  // Try releases first (preferred), then fallback to tags if no releases
  async function tryReleases(){
    const r = await ghFetch(`${base}/releases/latest`);
    if (!r.ok) return null;
    const j = await r.json();
    const tag = j.tag_name || j.name || '';
    if (!tag) return null;
    return { tag, version: normalizeVersion(tag), html_url: j.html_url || `https://github.com/${repo}/releases/tag/${tag}`, zip_url: j.zipball_url || `${base}/zipball/${tag}` };
  }
  async function tryTags(){
    const r = await ghFetch(`${base}/tags`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return null;
    const tag = j[0].name || j[0].tag_name || '';
    return { tag, version: normalizeVersion(tag), html_url: `https://github.com/${repo}/releases/tag/${tag}`, zip_url: `${base}/zipball/${tag}` };
  }
  async function tryRedirectLatest(){
    try{
      const resp = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: 'follow', headers: { 'User-Agent': GH_UA } });
      if (!resp.ok) return null;
      const finalUrl = String(resp.url || '');
      const m = /\/releases\/tag\/([^/?#]+)/.exec(finalUrl);
      const tag = m && m[1] ? decodeURIComponent(m[1]) : '';
      if (!tag) return null;
      return { tag, version: normalizeVersion(tag), html_url: finalUrl, zip_url: `https://codeload.github.com/${repo}/zip/refs/tags/${encodeURIComponent(tag)}` };
    }catch(_){ return null; }
  }
  if (UPDATES_CHANNEL === 'tags') {
    return await tryTags();
  }
  const fromReleases = await tryReleases();
  if (fromReleases) return fromReleases;
  const fromTags = await tryTags();
  if (fromTags) return fromTags;
  return await tryRedirectLatest();
}

app.use(express.json({ limit: '50mb' }));
// Restrict CORS to local panel (file:// → Origin null) and localhost
// Relaxed CORS: allow any origin on localhost-only service
app.use(cors({
  origin: function(_origin, cb){ cb(null, true); },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-api-key','Authorization'],
  maxAge: 86400
}));

let jobs = [];
let jobCounter = 0;
// Store state in OS temp, not visible in Documents
const STATE_DIR = path.join(os.tmpdir(), 'sync_extension_state');
if (!fs.existsSync(STATE_DIR)) { try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch(_) {} }
const jobsFile = path.join(STATE_DIR, 'jobs.json');
const tokenFile = path.join(STATE_DIR, 'auth_token');
function getOrCreateToken(){
  try{
    if (fs.existsSync(tokenFile)){
      const t = fs.readFileSync(tokenFile, 'utf8').trim();
      if (t.length > 0) return t;
    }
  }catch(_){ }
  const token = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(tokenFile, token, { mode: 0o600 }); } catch(_) {}
  return token;
}
const AUTH_TOKEN = getOrCreateToken();

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
// Helper to make a temp-readable copy when macOS places file in TemporaryItems (EPERM)
const COPY_DIR = path.join(os.tmpdir(), 'sync_extension_cache');
function toReadableLocalPath(p){
  try{
    if (!p || typeof p !== 'string') return '';
    const abs = path.resolve(p);
    if (abs.indexOf('/TemporaryItems/') === -1) return abs;
    try { if (!fs.existsSync(COPY_DIR)) fs.mkdirSync(COPY_DIR, { recursive: true }); } catch(_){ }
    const dest = path.join(COPY_DIR, path.basename(abs));
    try { fs.copyFileSync(abs, dest); return dest; } catch(_){ return abs; }
  }catch(_){ return String(p||''); }
}

// Public endpoints (no auth): health and token fetch
app.get('/health', (req,res)=> res.json({ status:'ok', ts: Date.now() }));
// Friendly root
app.get('/', (_req,res)=> res.json({ ok:true, service:'sync-extension-server' }));
app.get('/auth/token', (req,res)=>{
  // Only serve to localhost clients
  try{
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')){
      return res.status(403).json({ error:'forbidden' });
    }
  }catch(_){ }
  res.json({ token: AUTH_TOKEN });
});

// Public waveform file reader (before auth middleware)
app.get('/waveform/file', async (req, res) => {
  try{
    const p = String(req.query.path||'');
    if (!p || !path.isAbsolute(p)) return res.status(400).json({ error:'invalid path' });
    let real = '';
    try { real = fs.realpathSync(p); } catch(_){ real = p; }
    const wasTemp = real.indexOf('/TemporaryItems/') !== -1;
    real = toReadableLocalPath(real);
    if (!fs.existsSync(real)) return res.status(404).json({ error:'not found' });
    const stat = fs.statSync(real);
    if (!stat.isFile()) return res.status(400).json({ error:'not a file' });
    res.setHeader('Content-Type', 'application/octet-stream');
    const s = fs.createReadStream(real);
    s.pipe(res);
    res.on('close', ()=>{
      try {
        // If we created a copy under COPY_DIR for TemporaryItems, delete it after serving
        if (wasTemp && real.indexOf(COPY_DIR) === 0) { fs.unlink(real, ()=>{}); }
      } catch(_){ }
    });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// Updates: version and check (PUBLIC)
app.get('/update/version', async (_req,res)=>{
  try{
    const current = await getCurrentVersion();
    res.json({ ok:true, version: current });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/update/check', async (_req,res)=>{
  try{
    const current = await getCurrentVersion();
    const latest = await getLatestReleaseInfo();
    if (!latest){
      return res.json({ ok:true, current, latest: null, tag: null, html_url: `https://github.com/${UPDATES_REPO}/releases`, canUpdate: false, repo: UPDATES_REPO, message: 'no releases/tags found' });
    }
    const cmp = (current && latest.version) ? compareSemver(latest.version, current) : 0;
    res.json({ ok:true, current, latest: latest.version, tag: latest.tag, html_url: latest.html_url, canUpdate: cmp > 0, repo: UPDATES_REPO });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// Auth middleware
function requireAuth(req, res, next){
  try{
    const h = String(req.headers['authorization']||'');
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m || m[1] !== AUTH_TOKEN) return res.status(401).json({ error:'unauthorized' });
    next();
  }catch(_){ return res.status(401).json({ error:'unauthorized' }); }
}

// Apply auth to all routes below this line, but keep /logs public
app.use((req,res,next)=>{
  // Keep logs, health/token, and any /update/* endpoints public for bootstrap/UI
  if (
    req.path === '/logs' ||
    req.path === '/health' ||
    req.path === '/auth/token' ||
    (typeof req.path === 'string' && req.path.indexOf('/update/') === 0)
  ) {
    return next();
  }
  return requireAuth(req,res,next);
});
const SUPA_URL = process.env.SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPA_BUCKET = process.env.SUPABASE_BUCKET || '';
const SUPA_PREFIX = 'sync. extension/';
const DOCS_DEFAULT_DIR = path.join(os.homedir(), 'Documents', 'sync. outputs');
const TEMP_DEFAULT_DIR = path.join(os.tmpdir(), 'sync_extension_outputs');

// Simple settings persistence for the panel (to help AE retain keys between reloads)
let PANEL_SETTINGS = null;
app.get('/settings', (req,res)=>{
  res.json({ ok:true, settings: PANEL_SETTINGS });
});
app.post('/settings', (req,res)=>{
  try{ PANEL_SETTINGS = (req.body && req.body.settings) ? req.body.settings : null; res.json({ ok:true }); }catch(e){ res.status(400).json({ error:String(e?.message||e) }); }
});

// Updates: apply (AUTH)
app.post('/update/apply', async (req,res)=>{
  try{
    const { tag: desiredTag } = req.body || {};
    const current = await getCurrentVersion();
    const latest = await getLatestReleaseInfo();
    if (!latest) return res.status(400).json({ error:'no releases/tags found for updates' });
    const tag = desiredTag || latest.tag;
    const latestVersion = normalizeVersion(latest.version || tag || '');
    if (current && latestVersion && compareSemver(latestVersion, current) <= 0){
      return res.json({ ok:true, updated:false, message:'Already up to date', current, latest: latestVersion });
    }
    
    // Download and extract update
    const tempDir = path.join(os.tmpdir(), 'sync_extension_update_' + Date.now());
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch(_){}
    
    const zipPath = path.join(tempDir, 'update.zip');
    const zipResp = await fetch(latest.zip_url);
    if (!zipResp.ok) throw new Error('Failed to download update');
    
    const zipBuffer = await zipResp.buffer();
    fs.writeFileSync(zipPath, zipBuffer);
    
    // Extract zip (simple approach for GitHub zipball format)
    await exec(`cd "${tempDir}" && unzip -q "${zipPath}" && mv */sync-extensions* . 2>/dev/null || true`);
    
    // Run the install script from the extracted update
    const updateScript = path.join(tempDir, 'scripts', 'install.sh');
    if (fs.existsSync(updateScript)) {
      await exec(`chmod +x "${updateScript}" && "${updateScript}" --both`);
    } else {
      throw new Error('Update script not found in downloaded package');
    }
    
    // Cleanup
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(_){}
    
    res.json({ ok:true, updated:true, message:'Update applied successfully', current, latest: latestVersion });
  }catch(e){ res.status(500).json({ error:String(e?.message||e) }); }
});

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

function normalizeOutputDir(p){
  try{
    if (!p || typeof p !== 'string') return '';
    const abs = path.resolve(p);
    return abs;
  }catch(_){ return ''; }
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
      outputDir: normalizeOutputDir(outputDir || '') || null,
      apiKey,
      supabaseUrl: supabaseUrl || '',
      supabaseKey: supabaseKey || '',
      supabaseBucket: supabaseBucket || ''
    };
    jobs.push(job);
    if (jobs.length > 500) { jobs = jobs.slice(-500); }
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
  try{
    const allowed = [DOCS_DEFAULT_DIR, TEMP_DEFAULT_DIR];
    if (job.outputDir && typeof job.outputDir === 'string') allowed.push(job.outputDir);
    const realOut = fs.realpathSync(job.outputPath);
    const ok = allowed.some(root => {
      try { return realOut.startsWith(fs.realpathSync(root) + path.sep); } catch(_) { return false; }
    });
    if (!ok) return res.status(403).json({ error:'forbidden path' });
  }catch(_){ return res.status(500).json({ error:'download error' }); }
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

    // Enforce per-project when selected: if 'project', require targetDir; otherwise fallback to temp, not Documents
    const outDir = (location === 'documents') ? DOCS_DEFAULT_DIR : (targetDir || job.outputDir || TEMP_DEFAULT_DIR);
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

// Waveform helper: securely read local file bytes for the panel (same auth)
app.get('/waveform/file', async (req, res) => {
  try{
    const p = String(req.query.path||'');
    if (!p || !path.isAbsolute(p)) return res.status(400).json({ error:'invalid path' });
    let real = '';
    try { real = fs.realpathSync(p); } catch(_){ return res.status(404).json({ error:'not found' }); }
    if (!fs.existsSync(real)) return res.status(404).json({ error:'not found' });
    const stat = fs.statSync(real);
    if (!stat.isFile()) return res.status(400).json({ error:'not a file' });
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(real).pipe(res);
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
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
  const outDir = (job.outputDir && typeof job.outputDir === 'string' ? normalizeOutputDir(job.outputDir) : '') || TEMP_DEFAULT_DIR;
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
function slog(){ const msg = Array.from(arguments).map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(' '); LOGS.push(new Date().toISOString()+" "+msg); if (LOGS.length>500) LOGS.shift(); try{ console.log.apply(console, arguments);}catch(_){} }
app.get('/logs', (_req,res)=>{ res.json({ ok:true, logs: LOGS.slice(-200) }); });
// Keep only the slog + LOGS; public /logs is declared above

// Function to check if a port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, HOST, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    server.on('error', () => resolve(false));
  });
}

// Function to find an available port (pinned to 3000)
async function findAvailablePort() {
  return 3000;
}

// Start server on fixed port 3000 (best‑effort)
async function startServer() {
  const PORT = 3000;
  // If an instance is already healthy on 3000, exit quickly without error
  try {
    const r = await fetch(`http://${HOST}:${PORT}/health`, { method: 'GET' });
    if (r && r.ok) {
      console.log(`Existing Sync Extension server detected on http://${HOST}:${PORT}`);
      return PORT;
    }
  } catch(_) { /* ignore */ }
  const srv = app.listen(PORT, HOST, () => {
    console.log(`Sync Extension server running on http://${HOST}:${PORT}`);
    console.log(`Jobs file: ${jobsFile}`);
  });
  srv.on('error', async (err) => {
    if (err && err.code === 'EADDRINUSE') {
      try {
        const r = await fetch(`http://${HOST}:${PORT}/health`, { method: 'GET' });
        if (r && r.ok) {
          console.log(`Port ${PORT} in use by healthy server; continuing`);
          return;
        }
      } catch(_) {}
      console.error(`Port ${PORT} in use and health check failed`);
      process.exit(1);
    } else {
      console.error('Server error', err && err.message ? err.message : String(err));
      process.exit(1);
    }
  });
  return PORT;
}

startServer();

// override helpers
function getSupabaseUrl(job){ return (job && job.supabaseUrl) || SUPA_URL; }
function getSupabaseKey(job){ return (job && job.supabaseKey) || SUPA_KEY; }
function getSupabaseBucket(job){ return (job && job.supabaseBucket) || SUPA_BUCKET; }

function resolveSafeLocalPath(p){
  try{
    if (!p || typeof p !== 'string') return p;
    // Ensure absolute path to prevent traversal from relative inputs
    if (!path.isAbsolute(p)) return p;
    const isTempItems = p.indexOf('/TemporaryItems/') !== -1;
    if (!isTempItems) return p;
    const docs = path.join(os.homedir(), 'Documents', 'sync_extension_temp');
    if (!fs.existsSync(docs)) fs.mkdirSync(docs, { recursive: true });
    const target = path.join(docs, path.basename(p));
    try { fs.copyFileSync(p, target); return target; } catch(_){ return p; }
  }catch(_){ return p; }
}

// Crash safety
process.on('uncaughtException', (err)=>{ try { console.error('uncaughtException', err && err.stack || err); } catch(_) {} });
process.on('unhandledRejection', (reason)=>{ try { console.error('unhandledRejection', reason); } catch(_) {} });
