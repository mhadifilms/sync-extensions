import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

let jobs = [];
let jobCounter = 0;
const jobsFile = path.join(os.homedir(), 'Documents', 'SyncExtension', 'jobs.json');

function loadJobs(){
  try{
    if (fs.existsSync(jobsFile)){
      const raw = fs.readFileSync(jobsFile, 'utf-8');
      if (raw.trim()) jobs = JSON.parse(raw);
      const ids = jobs.map(j => Number(j.id) || 0);
      jobCounter = ids.length ? Math.max(...ids) + 1 : 1;
    }
  }catch(_){ jobs = []; jobCounter = 1; }
}
function saveJobs(){
  try{
    const dir = path.dirname(jobsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2));
  }catch(_){ }
}
loadJobs();

const SYNC_API_BASE = 'https://api.sync.so/v2';

app.get('/health', (req,res)=> res.json({ status:'ok', ts: Date.now() }));

app.get('/jobs', (req,res)=> res.json(jobs));
app.get('/jobs/:id', (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  res.json(job);
});

app.post('/jobs', async (req,res)=>{
  try{
    const { videoPath, audioPath, model, temperature, activeSpeakerOnly, detectObstructions, apiKey, outputDir } = req.body || {};
    if (!apiKey) return res.status(400).json({ error:'API key required' });
    if (!videoPath || !audioPath) return res.status(400).json({ error:'Video and audio paths required' });
    if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) return res.status(400).json({ error:'Video or audio file not found' });

    const job = {
      id: ++jobCounter,
      videoPath,
      audioPath,
      model: model || 'lipsync-2-pro',
      temperature: temperature || 0.7,
      activeSpeakerOnly: !!activeSpeakerOnly,
      detectObstructions: !!detectObstructions,
      status: 'processing',
      createdAt: new Date().toISOString(),
      syncJobId: null,
      outputPath: null,
      outputDir: outputDir || null,
      apiKey
    };
    jobs.push(job);
    saveJobs();

    try{
      await createGeneration(job);
      saveJobs();
      res.json(job);
      pollSyncJob(job);
    }catch(e){
      job.status = 'failed';
      job.error = String(e?.message||e);
      saveJobs();
      res.status(500).json({ error: job.error });
    }
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/jobs/:id/download', (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  if (!job.outputPath || !fs.existsSync(job.outputPath)) return res.status(404).json({ error:'Output not ready' });
  res.download(job.outputPath);
});

app.post('/jobs/:id/save', async (req,res)=>{
  try{
    const { location = 'project', targetDir = '' } = req.body || {};
    const job = jobs.find(j => String(j.id) === String(req.params.id));
    if (!job) return res.status(404).json({ error:'Job not found' });

    const defaultDir = path.join(os.homedir(), 'Documents', 'SyncExtension', 'outputs');
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

    if (job.syncJobId && job.status === 'completed'){
      const meta = await fetchGeneration(job);
      if (meta && meta.outputUrl){
        const response = await fetch(meta.outputUrl);
        if (response.ok && response.body){
          const dest = path.join(outDir, `${job.id}_output.mp4`);
          await pipeToFile(response.body, dest);
          job.outputPath = dest;
          saveJobs();
          return res.json({ ok:true, outputPath: job.outputPath });
        }
      }
    }
    res.status(400).json({ error:'Output not available yet' });
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
  const form = new FormData();
  form.append('video', fs.createReadStream(job.videoPath));
  form.append('audio', fs.createReadStream(job.audioPath));
  form.append('model', job.model);
  const resp = await fetch(`${SYNC_API_BASE}/generate`, {
    method:'POST',
    headers: { 'x-api-key': job.apiKey, 'accept':'application/json', ...form.getHeaders() },
    body: form
  });
  if (!resp.ok){
    const t = await safeText(resp);
    throw new Error(`create failed ${resp.status} ${t}`);
  }
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
  const defaultDir = path.join(os.homedir(), 'Documents', 'SyncExtension', 'outputs');
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

app.listen(PORT, ()=>{
  console.log(`Sync Extension server running on port ${PORT}`);
  console.log(`Jobs file: ${jobsFile}`);
});
