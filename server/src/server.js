import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { exec as _exec, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createServer } from 'net';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { convertAudio } = require('./audio.cjs');

dotenv.config();

const app = express();
app.disable('x-powered-by');
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = 3000;
const PORT_RANGE = [3000]; // Hardcode to 3000 for panel

const exec = promisify(_exec);

// Better Windows PowerShell execution with spawn
function execPowerShell(command, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      // Use spawn for better control on Windows
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command];
      console.log('Spawning PowerShell with args:', args);
      console.log('Working directory:', options.cwd || process.cwd());
      
      const child = spawn('powershell.exe', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        console.log('PowerShell stdout:', output.trim());
      });
      
      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        console.log('PowerShell stderr:', output.trim());
      });
      
      child.on('close', (code) => {
        console.log(`PowerShell process exited with code: ${code}`);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
        }
      });
      
      child.on('error', (error) => {
        console.error('PowerShell spawn error:', error);
        reject(error);
      });
    } else {
      // Use regular exec for non-Windows
      exec(command, options).then(resolve).catch(reject);
    }
  });
}

// Windows-only helper to run robocopy with correct success codes (<8)
async function runRobocopy(src, dest, filePattern){
  if (process.platform !== 'win32') { throw new Error('runRobocopy is Windows-only'); }
  try { if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true }); } catch(_){ }
  const args = [`"${src}"`, `"${dest}"`];
  if (filePattern) args.push(`"${filePattern}"`);
  const baseCmd = `robocopy ${args.join(' ')} /E /NFL /NDL /NJH /NJS`;
  const psCmd = `$ErrorActionPreference='Stop'; ${baseCmd}; if ($LASTEXITCODE -lt 8) { exit 0 } else { exit $LASTEXITCODE }`;
  try { tlog('robocopy start', baseCmd); } catch(_){ }
  await execPowerShell(psCmd);
  try { tlog('robocopy ok', baseCmd); } catch(_){ }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXT_ROOT = path.resolve(__dirname, '..', '..');
const EXT_FOLDER = path.basename(EXT_ROOT);
const APP_ID = EXT_FOLDER.indexOf('.ae.') !== -1 ? 'ae' : (EXT_FOLDER.indexOf('.ppro.') !== -1 ? 'premiere' : 'unknown');
const MANIFEST_PATH = path.join(EXT_ROOT, 'CSXS', 'manifest.xml');
const UPDATES_REPO = process.env.UPDATES_REPO || process.env.GITHUB_REPO || 'mhadifilms/sync-extensions';
const UPDATES_CHANNEL = process.env.UPDATES_CHANNEL || 'releases'; // 'releases' or 'tags'
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GH_UA = process.env.GITHUB_USER_AGENT || 'sync-extension-updater/1.0';

// Central app-data directory resolver and subfolders
function platformAppData(appName){
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', appName);
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', appName);
  return path.join(home, '.config', appName);
}
const BASE_DIR = process.env.SYNC_EXTENSIONS_DIR || platformAppData('sync. extensions');
const DIRS = {
  logs: path.join(BASE_DIR, 'logs'),
  cache: path.join(BASE_DIR, 'cache'),
  state: path.join(BASE_DIR, 'state'),
  outputs: path.join(BASE_DIR, 'outputs'),
  updates: path.join(BASE_DIR, 'updates')
};
try { fs.mkdirSync(DIRS.logs, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.cache, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.state, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.outputs, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.updates, { recursive: true }); } catch(_){ }

// Debug flag and log helper to logs directory (flag file only)
const DEBUG_FLAG_FILE = path.join(DIRS.logs, 'debug.enabled');
let DEBUG = false;
try { DEBUG = fs.existsSync(DEBUG_FLAG_FILE); } catch(_){ DEBUG = false; }
const DEBUG_LOG = path.join(DIRS.logs, (APP_ID === 'premiere') ? 'sync_ppro_debug.log' : (APP_ID === 'ae') ? 'sync_ae_debug.log' : 'sync_server_debug.log');
function tlog(){
  if (!DEBUG) return;
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [server] ` + Array.from(arguments).map(a=>String(a)).join(' ') + "\n"); } catch(_){ }
}

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
    
    // Look for platform+app-specific release asset (ZXP preferred, ZIP fallback)
    const isWindows = process.platform === 'win32';
    const osName = isWindows ? 'windows' : 'mac';
    const appName = (APP_ID === 'ae' || APP_ID === 'premiere') ? APP_ID : 'premiere';
    const preferredPatterns = [
      // New naming (signed ZXP per app/os)
      new RegExp(`^sync-extension-${appName}-${osName}-signed\\.zxp$`, 'i'),
      // Fallbacks: any zxp for our os
      new RegExp(`^sync-extension-([a-z]+)-${osName}-signed\\.zxp$`, 'i'),
      // Older naming (single asset per os)
      new RegExp(`^sync-extensions-${osName}-${tag}\\.zxp$`, 'i'),
      new RegExp(`^sync-extensions-${osName}-${tag}\\.zip$`, 'i')
    ];

    let asset = null;
    if (Array.isArray(j.assets)){
      for (const pat of preferredPatterns){
        asset = j.assets.find(a => pat.test(String(a.name||'')));
        if (asset) break;
      }
      // Final fallback: any .zxp for our os
      if (!asset) asset = j.assets.find(a => new RegExp(`${osName}.*\\.zxp$`, 'i').test(String(a.name||'')));
      // Last resort: any asset
      if (!asset) asset = j.assets[0];
    }
    
    if (asset) {
      return {
        tag,
        version: normalizeVersion(tag),
        html_url: j.html_url || `https://github.com/${repo}/releases/tag/${tag}`,
        zip_url: asset.browser_download_url,
        is_zxp: String(asset.name||'').toLowerCase().endsWith('.zxp')
      };
    }
    
    // Fallback to zipball if no platform-specific asset found
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
// Store state in per-user app-data
const STATE_DIR = DIRS.state;
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
const COPY_DIR = DIRS.cache;
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

// Public: allow localhost-only shutdown for version handover
app.post('/admin/exit', (req,res)=>{
  try{
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')){
      return res.status(403).json({ error:'forbidden' });
    }
  }catch(_){ }
  try { tlog('admin:exit:requested'); } catch(_){ }
  res.json({ ok:true });
  setTimeout(()=>{ try { tlog('admin:exit:now'); } catch(_){ } process.exit(0); }, 300);
});

// Public: AIFF -> WAV conversion (pure Node) - MP3 now handled directly in ExtendScript
app.post('/audio/convert', async (req, res) => {
  try{
    const { srcPath, format } = req.body || {};
    tlog('POST /audio/convert', 'format=', format, 'srcPath=', srcPath);
    if (!srcPath || typeof srcPath !== 'string' || !path.isAbsolute(srcPath)){
      tlog('convert invalid path');
      return res.status(400).json({ error:'invalid srcPath' });
    }
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error:'source not found' });
    const fmt = String(format||'wav').toLowerCase();
    if (fmt === 'mp3') {
      try {
        const out = await convertAudio(srcPath, fmt);
        if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
        try { const sz = fs.statSync(out).size; tlog('convert mp3 ok', 'out=', out, 'bytes=', sz); } catch(_){ }
        res.json({ ok:true, path: out });
        return;
      } catch(e) {
        tlog('convert mp3 error:', e.message);
        return res.status(500).json({ error: String(e?.message||e) });
      }
    }
    const out = await convertAudio(srcPath, fmt);
    if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
    try { const sz = fs.statSync(out).size; tlog('convert ok', 'out=', out, 'bytes=', sz); } catch(_){ }
    res.json({ ok:true, path: out });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// Also support a simple GET form to avoid body quoting issues:
// /audio/convert?srcPath=/abs/path/file.aif&format=wav
app.get('/audio/convert', async (req, res) => {
  try{
    const srcPath = String(req.query.srcPath||'');
    const format = String(req.query.format||'wav');
    tlog('GET /audio/convert', 'format=', format, 'srcPath=', srcPath);
    if (!srcPath || !path.isAbsolute(srcPath)){
      tlog('convert invalid path (GET)');
      return res.status(400).json({ error:'invalid srcPath' });
    }
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error:'source not found' });
    const fmt = String(format||'wav').toLowerCase();
    if (fmt === 'mp3') {
      try {
        const out = await convertAudio(srcPath, fmt);
        if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
        try { const sz = fs.statSync(out).size; tlog('convert mp3 ok', 'out=', out, 'bytes=', sz); } catch(_){ }
        res.json({ ok:true, path: out });
        return;
      } catch(e) {
        tlog('convert mp3 error:', e.message);
        return res.status(500).json({ error: String(e?.message||e) });
      }
    }
    const out = await convertAudio(srcPath, fmt);
    if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
    try { const sz = fs.statSync(out).size; tlog('convert ok (GET)', 'out=', out, 'bytes=', sz); } catch(_){ }
    res.json({ ok:true, path: out });
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
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
const TEMP_DEFAULT_DIR = DIRS.outputs;

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
    
    // Log update start for debugging
    console.log(`Starting update process: ${current} -> ${latestVersion}`);
    console.log(`Platform: ${process.platform}, Architecture: ${process.arch}`);
    try { tlog('update:start', `${current} -> ${latestVersion}`, 'platform=', process.platform, 'arch=', process.arch); } catch(_){ }
    
    // Download and extract update
    const tempDir = path.join(DIRS.updates, 'sync_extension_update_' + Date.now());
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch(_){}
    
    const zipPath = path.join(tempDir, 'update.zip');
    const zipResp = await fetch(latest.zip_url);
    if (!zipResp.ok) throw new Error('Failed to download update');
    
    const zipBuffer = await zipResp.buffer();
    fs.writeFileSync(zipPath, zipBuffer);
    try { tlog('update:downloaded', zipPath, 'bytes=', String(zipBuffer && zipBuffer.length || 0)); } catch(_){ }
    
    // Extract zip/zxp (ZXP is just a ZIP with extension folders)
    const isWindows = process.platform === 'win32';
    const isZxp = latest.is_zxp;
    
    if (isWindows) {
      // Windows: Use PowerShell to extract zip/zxp
      const extractCmd = `Expand-Archive -Path "${zipPath}" -DestinationPath "${tempDir}" -Force`;
      try { tlog('update:extract:win', extractCmd); } catch(_){ }
      console.log('Windows extract command:', extractCmd);
      try {
        await execPowerShell(extractCmd);
        try { tlog('update:extract:win:ok'); } catch(_){ }
        console.log('PowerShell extraction completed');
      } catch(e) {
        try { tlog('update:extract:win:fail', e.message); } catch(_){ }
        console.log('PowerShell extraction failed:', e.message);
        throw new Error('Failed to extract zip/zxp with PowerShell: ' + e.message);
      }
    } else {
      // macOS/Linux: Use unzip
      const extractCmd = `cd "${tempDir}" && unzip -q "${zipPath}"`;
      try { tlog('update:extract:unix', extractCmd); } catch(_){ }
      console.log('Unix extract command:', extractCmd);
      try {
        await exec(extractCmd);
        try { tlog('update:extract:unix:ok'); } catch(_){ }
        console.log('Unix extraction completed');
      } catch(e) {
        try { tlog('update:extract:unix:fail', e.message); } catch(_){ }
        console.log('Unix extraction failed:', e.message);
        throw new Error('Failed to extract zip/zxp with unzip: ' + e.message);
      }
    }
    
    // Find the extracted directory (ZXP: extension folders, ZIP: sync-extensions/, zipball: repo-name-tag/)
    const allItems = fs.readdirSync(tempDir);
    try { tlog('update:extracted:items', JSON.stringify(allItems||[])); } catch(_){ }
    console.log('Extracted items:', allItems);
    
    const extractedDirs = allItems.filter(name => {
      const fullPath = path.join(tempDir, name);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch(e) {
        try { tlog('update:extracted:check:error', name, e.message); } catch(_){ }
        console.log('Error checking item:', name, e.message);
        return false;
      }
    });
    
    try { tlog('update:extracted:dirs', JSON.stringify(extractedDirs||[])); } catch(_){ }
    console.log('Extracted directories:', extractedDirs);
    
    let extractedDir;
    
    if (isZxp) {
      // ZXP format: extension folders are directly in tempDir
      extractedDir = tempDir;
      try { tlog('update:format:zxp'); } catch(_){ }
      console.log('Using ZXP format - extension folders directly in temp dir');
    } else if (extractedDirs.includes('sync-extensions')) {
      // ZIP format: sync-extensions directory
      extractedDir = path.join(tempDir, 'sync-extensions');
      try { tlog('update:format:zip:sync-extensions'); } catch(_){ }
      console.log('Using sync-extensions directory from ZIP release asset');
    } else if (extractedDirs.length > 0) {
      // Fallback to GitHub zipball format (repo-name-tag/)
      extractedDir = path.join(tempDir, extractedDirs[0]);
      try { tlog('update:format:zipball', extractedDirs[0]); } catch(_){ }
      console.log('Using GitHub zipball directory:', extractedDirs[0]);
    } else {
      // Try to find any directory that might contain the source code
      const possibleDirs = allItems.filter(name => {
        const fullPath = path.join(tempDir, name);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            // Check if this directory contains source files
            const contents = fs.readdirSync(fullPath);
            return contents.includes('package.json') || contents.includes('scripts') || contents.includes('extensions');
          }
        } catch(e) {
          return false;
        }
        return false;
      });
      
      try { tlog('update:format:guess:dirs', JSON.stringify(possibleDirs||[])); } catch(_){ }
      console.log('Possible source directories:', possibleDirs);
      
      if (possibleDirs.length === 0) {
        throw new Error('No extracted directory found in zipball. Contents: ' + allItems.join(', '));
      }
      
      extractedDir = path.join(tempDir, possibleDirs[0]);
      try { tlog('update:format:guess:chosen', possibleDirs[0]); } catch(_){ }
      console.log('Using fallback directory:', possibleDirs[0]);
    }
    try { tlog('update:extracted:dir', extractedDir); } catch(_){ }
    console.log('Using extracted directory:', extractedDir);
    
    // Look for install script in the extracted directory (disabled; always use manual copy)
    const updateScript = path.join(extractedDir, 'scripts', isWindows ? 'install.ps1' : 'install.sh');
    if (false && fs.existsSync(updateScript)) {
      // Detect which extensions are currently installed
      let aeDestDir, pproDestDir;
      
      if (isWindows) {
        aeDestDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', 'com.sync.extension.ae.panel');
        pproDestDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', 'com.sync.extension.ppro.panel');
      } else {
        aeDestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'com.sync.extension.ae.panel');
        pproDestDir = path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'com.sync.extension.ppro.panel');
      }
      
      // If a previous installer created folders without the .panel suffix, migrate them to the correct names
      try {
        const aeWrong = path.join(path.dirname(aeDestDir), 'com.sync.extension.ae');
        const pproWrong = path.join(path.dirname(pproDestDir), 'com.sync.extension.ppro');
        async function migrateIfMisnamed(wrong, correct){
          try{
            if (!fs.existsSync(wrong)) return;
            const wrongHas = (fs.readdirSync(wrong).filter(n=>n!=='.DS_Store').length > 0);
            const correctExists = fs.existsSync(correct);
            const correctHas = correctExists ? (fs.readdirSync(correct).filter(n=>n!=='.DS_Store').length > 0) : false;
            if (!correctExists && wrongHas){
              try { fs.renameSync(wrong, correct); try { tlog('update:migrate:rename', wrong, '->', correct); } catch(_){ } return; } catch(_){ }
            }
            if (wrongHas){
              if (process.platform === 'win32') { await runRobocopy(wrong, correct); }
              else { await exec(`mkdir -p "${correct}" && cp -R "${wrong}/." "${correct}/"`); }
              try { fs.rmSync(wrong, { recursive: true, force: true }); } catch(_){ }
              try { tlog('update:migrate:copy', wrong, '->', correct); } catch(_){ }
            }
          }catch(e){ try { tlog('update:migrate:error', wrong, '->', correct, e && e.message ? e.message : String(e)); } catch(_){ } }
        }
        await migrateIfMisnamed(aeWrong, aeDestDir);
        await migrateIfMisnamed(pproWrong, pproDestDir);
      } catch(_){ }
      
      // Do not remove existing extensions; copy over into destination to avoid locking issues
      try { tlog('update:dest', 'ae=', aeDestDir, 'ppro=', pproDestDir); } catch(_){ }
      try { fs.mkdirSync(aeDestDir, { recursive: true }); } catch(_){ }
      try { fs.mkdirSync(pproDestDir, { recursive: true }); } catch(_){ }
      
      // Copy extensions (handle both ZXP and ZIP formats)
      if (isZxp) {
        // ZXP format: extracted root contains extension content (CSXS, ui, server, etc.)
        const targetApp = (APP_ID === 'ae' || APP_ID === 'premiere') ? APP_ID : 'premiere';
        const destRoot = targetApp === 'ae' ? aeDestDir : pproDestDir;
        try { tlog('update:copy:zxp:target', targetApp, 'dest=', destRoot); } catch(_){ }
        try { if (!fs.existsSync(destRoot)) fs.mkdirSync(destRoot, { recursive: true }); } catch(_){ }
        const items = fs.readdirSync(extractedDir).filter(name => name !== 'META-INF' && name !== 'update.zip');
        for (const name of items){
          const srcPath = path.join(extractedDir, name);
          if (isWindows) {
            await runRobocopy(extractedDir, destRoot, name);
          } else {
            await exec(`cp -R "${srcPath}" "${destRoot}/"`);
          }
        }
        try { tlog('update:copy:zxp:ok', 'items=', String(items.length)); } catch(_){ }
      } else {
        // ZIP format: extensions are in extensions/ subdirectory
        const aeSrcDir = path.join(extractedDir, 'extensions', 'ae-extension');
        if (fs.existsSync(aeSrcDir)) {
          if (isWindows) {
            // Windows: Use robust robocopy wrapper
            await runRobocopy(aeSrcDir, aeDestDir);
            await runRobocopy(path.join(extractedDir, 'ui'), path.join(aeDestDir, 'ui'));
            await runRobocopy(path.join(extractedDir, 'server'), path.join(aeDestDir, 'server'));
            await runRobocopy(path.join(extractedDir, 'icons'), path.join(aeDestDir, 'icons'));
            await runRobocopy(extractedDir, aeDestDir, 'index.html');
            await runRobocopy(path.join(extractedDir, 'lib'), path.join(aeDestDir, 'lib'));
          } else {
            // macOS/Linux: Use cp
            await exec(`cp -R "${aeSrcDir}"/* "${aeDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/ui "${aeDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/server "${aeDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/icons "${aeDestDir}/"`);
            await exec(`cp "${extractedDir}"/index.html "${aeDestDir}/"`);
            await exec(`cp "${extractedDir}"/lib "${aeDestDir}/" -R`);
          }
          // EPR files are Premiere-only, skip for AE
        }
        
        // Copy Premiere extension
        const pproSrcDir = path.join(extractedDir, 'extensions', 'premiere-extension');
        if (fs.existsSync(pproSrcDir)) {
          if (isWindows) {
            await runRobocopy(pproSrcDir, pproDestDir);
            await runRobocopy(path.join(extractedDir, 'ui'), path.join(pproDestDir, 'ui'));
            await runRobocopy(path.join(extractedDir, 'server'), path.join(pproDestDir, 'server'));
            await runRobocopy(path.join(extractedDir, 'icons'), path.join(pproDestDir, 'icons'));
            await runRobocopy(extractedDir, pproDestDir, 'index.html');
            await runRobocopy(path.join(extractedDir, 'lib'), path.join(pproDestDir, 'lib'));
            await runRobocopy(path.join(extractedDir, 'extensions', 'premiere-extension', 'epr'), path.join(pproDestDir, 'epr'));
          } else {
            // macOS/Linux: Use cp
            await exec(`cp -R "${pproSrcDir}"/* "${pproDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/ui "${pproDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/server "${pproDestDir}/"`);
            await exec(`cp -R "${extractedDir}"/icons "${pproDestDir}/"`);
            await exec(`cp "${extractedDir}"/index.html "${pproDestDir}/"`);
            await exec(`cp "${extractedDir}"/lib "${pproDestDir}/" -R`);
            await exec(`cp "${extractedDir}"/extensions/premiere-extension/epr "${pproDestDir}/" -R`);
          }
        }
      }
      
      // Node modules are now bundled in the package; no runtime installation
    }
    
    // Cleanup
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(_){}
    
    console.log(`Update completed successfully: ${current} -> ${latestVersion}`);
    res.json({ ok:true, updated:true, message:'Update applied successfully', current, latest: latestVersion });
    // After confirming response was sent, exit the server so a fresh instance loads the new code on next panel start
    try {
      setTimeout(()=>{ try { tlog('update:post:exit'); } catch(_){ } console.log('Exiting server after successful update'); process.exit(0); }, 800);
    } catch(_){ }
  }catch(e){ 
    console.error('Update failed:', e.message);
    console.error('Update error stack:', e.stack);
    res.status(500).json({ error:String(e?.message||e) }); 
  }
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
  if (ext === 'aif' || ext === 'aiff') return 'audio/aiff';
  return 'application/octet-stream';
}

async function convertIfAiff(p){
  try{
    if (!p || typeof p !== 'string') return p;
    const lower = p.toLowerCase();
    if (!(lower.endsWith('.aif') || lower.endsWith('.aiff'))) return p;
    tlog('convertIfAiff', p);
    const out = await convertAudio(p, 'wav');
    if (out && fs.existsSync(out)) { tlog('convertIfAiff ok', out); return out; }
    tlog('convertIfAiff failed');
    return p;
  }catch(e){ tlog('convertIfAiff error', e && e.message ? e.message : String(e)); return p; }
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
    // Auto-convert AIFF from AE to WAV so the rest of the pipeline can read it
    try { if (audioPath) { audioPath = await convertIfAiff(audioPath); } } catch(_){}
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
// Duplicate route removed; the public unauthenticated version above is the source of truth

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

function log(){ try{ console.log.apply(console, arguments);}catch(_){} }

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
      // Try to determine version drift; if drift, request exit of old server
      try {
        const currentManifestVersion = await getCurrentVersion();
        const vResp = await fetch(`http://${HOST}:${PORT}/update/version`, { method: 'GET' }).catch(()=>null);
        const vJson = vResp ? await vResp.json().catch(()=>null) : null;
        const otherVersion = vJson && vJson.version ? String(vJson.version) : '';
        if (currentManifestVersion && otherVersion && compareSemver(currentManifestVersion, otherVersion) > 0){
          console.log(`Existing server version ${otherVersion} older than manifest ${currentManifestVersion}, requesting shutdown...`);
          await fetch(`http://${HOST}:${PORT}/admin/exit`, { method:'POST' }).catch(()=>{});
          await new Promise(r2=>setTimeout(r2, 600));
        } else {
          console.log(`Port ${PORT} in use by healthy server; exiting child`);
          process.exit(0);
        }
      } catch(_){
        console.log(`Port ${PORT} in use by healthy server; exiting child`);
        process.exit(0);
      }
    }
  } catch(_) { /* ignore */ }
  const srv = app.listen(PORT, HOST, () => {
    console.log(`Sync Extension server running on http://${HOST}:${PORT}`);
    console.log(`Jobs file: ${jobsFile}`);
    try { tlog('server started on', `${HOST}:${PORT}`); } catch(_){ }
  });
  srv.on('error', async (err) => {
    if (err && err.code === 'EADDRINUSE') {
      try {
        const r = await fetch(`http://${HOST}:${PORT}/health`, { method: 'GET' });
        if (r && r.ok) {
          console.log(`Port ${PORT} in use by healthy server; exiting child`);
          // Another healthy instance is already serving requests on this port.
          // Exit cleanly so any spawner (e.g., the CEP panel) doesn't leave a zombie process.
          process.exit(0);
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
