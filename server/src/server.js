import express from 'express';
import fetch from 'node-fetch';
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

// R2 client
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Load .env from project root (one level up from server directory)
const envPath = path.join(process.cwd(), '..', '.env');
console.log('Looking for .env at:', envPath);
console.log('Current working directory:', process.cwd());
console.log('.env file exists:', require('fs').existsSync(envPath));
dotenv.config({ path: envPath });

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
  try { if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true }); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
  const args = [`"${src}"`, `"${dest}"`];
  if (filePattern) args.push(`"${filePattern}"`);
  const baseCmd = `robocopy ${args.join(' ')} /E /NFL /NDL /NJH /NJS`;
  const psCmd = `$ErrorActionPreference='Stop'; ${baseCmd}; if ($LASTEXITCODE -lt 8) { exit 0 } else { exit $LASTEXITCODE }`;
  try { tlog('robocopy start', baseCmd); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
  await execPowerShell(psCmd);
  try { tlog('robocopy ok', baseCmd); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXT_ROOT = path.resolve(__dirname, '..', '..');
const EXT_FOLDER = path.basename(EXT_ROOT);
const APP_ID = EXT_FOLDER.indexOf('.ae.') !== -1 ? 'ae' : (EXT_FOLDER.indexOf('.ppro.') !== -1 ? 'premiere' : 'unknown');
const MANIFEST_PATH = path.join(EXT_ROOT, 'CSXS', 'manifest.xml');

// Detect extension installation location (user vs system-wide)
function detectExtensionLocation() {
  try {
    // Method 1: Check if we're in a system-wide location
    if (process.platform === 'darwin') {
      if (EXT_ROOT.startsWith('/Library/Application Support/Adobe/CEP/extensions/')) {
        return 'system';
      }
    } else if (process.platform === 'win32') {
      if (EXT_ROOT.includes('Program Files') && EXT_ROOT.includes('Adobe\\CEP\\extensions')) {
        return 'system';
      }
    }
    
    // Method 2: Check if we're in a user location
    const home = os.homedir();
    if (process.platform === 'darwin') {
      if (EXT_ROOT.startsWith(path.join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions'))) {
        return 'user';
      }
    } else if (process.platform === 'win32') {
      if (EXT_ROOT.includes(path.join(home, 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions'))) {
        return 'user';
      }
    }
    
    // Method 3: Check if extension exists in both locations to determine which one is active
    let userPath, systemPath;
    
    if (process.platform === 'darwin') {
      userPath = path.join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', EXT_FOLDER);
      systemPath = path.join('/Library', 'Application Support', 'Adobe', 'CEP', 'extensions', EXT_FOLDER);
    } else if (process.platform === 'win32') {
      userPath = path.join(home, 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', EXT_FOLDER);
      systemPath = path.join('C:', 'Program Files', 'Adobe', 'CEP', 'extensions', EXT_FOLDER);
    }
    
    const userExists = fs.existsSync(userPath);
    const systemExists = fs.existsSync(systemPath);
    
    if (userExists && !systemExists) return 'user';
    if (systemExists && !userExists) return 'system';
    if (userExists && systemExists) {
      // Both exist, prefer user installation
      return 'user';
    }
    
    // Default to user location
    return 'user';
  } catch (e) {
    // Default to user location on error
    return 'user';
  }
}

const EXTENSION_LOCATION = detectExtensionLocation();
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
  uploads: path.join(BASE_DIR, 'uploads'),
  updates: path.join(BASE_DIR, 'updates')
};
try { fs.mkdirSync(DIRS.logs, { recursive: true }); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
try { fs.mkdirSync(DIRS.cache, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.state, { recursive: true }); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
try { fs.mkdirSync(DIRS.uploads, { recursive: true }); } catch(_){ }
try { fs.mkdirSync(DIRS.updates, { recursive: true }); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }

// Debug flag and log helper to logs directory (flag file only)
const DEBUG_FLAG_FILE = path.join(DIRS.logs, 'debug.enabled');
let DEBUG = false;
try { DEBUG = fs.existsSync(DEBUG_FLAG_FILE); } catch(_){ DEBUG = false; }
const DEBUG_LOG = path.join(DIRS.logs, (APP_ID === 'premiere') ? 'sync_ppro_debug.log' : (APP_ID === 'ae') ? 'sync_ae_debug.log' : 'sync_server_debug.log');
// Async logging to prevent blocking the event loop
async function tlog(){
  if (!DEBUG) return;
  try { 
    const logLine = `[${new Date().toISOString()}] [server] ` + Array.from(arguments).map(a=>String(a)).join(' ') + "\n";
    await fs.promises.appendFile(DEBUG_LOG, logLine).catch(() => {}); // Silent fail to prevent recursion
  } catch(e){ 
    // Silent catch to prevent infinite recursion on logging errors
  }
}

// Synchronous version for critical startup operations only
function tlogSync(){
  if (!DEBUG) return;
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [server] ` + Array.from(arguments).map(a=>String(a)).join(' ') + "\n"); } catch(e){}
}

// Detect if we're being spawned by UI auto-start (stdout/stderr captured)
const isSpawnedByUI = process.stdout.isTTY === false && process.stderr.isTTY === false;

// Async cleanup functions to prevent blocking the event loop
async function cleanupOldFiles(dirPath, maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    // Check if directory exists asynchronously
    try {
      await fs.promises.access(dirPath);
    } catch {
      return; // Directory doesn't exist
    }
    
    const files = await fs.promises.readdir(dirPath);
    const now = Date.now();
    let cleanedCount = 0;
    
    // Process files in batches to avoid blocking
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (file) => {
        const filePath = path.join(dirPath, file);
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.isFile() && (now - stats.mtime.getTime()) > maxAgeMs) {
            await fs.promises.unlink(filePath);
            cleanedCount++;
            await tlog('cleanup:removed', filePath, 'age=', Math.round((now - stats.mtime.getTime()) / 1000 / 60), 'min');
          }
        } catch(e) {
          await tlog('cleanup:error', filePath, e && e.message ? e.message : String(e));
        }
      }));
      
      // Yield control between batches
      if (i + batchSize < files.length) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    if (cleanedCount > 0) {
      await tlog('cleanup:completed', dirPath, 'removed=', cleanedCount, 'files');
    }
  } catch(e) {
    await tlog('cleanup:failed', dirPath, e && e.message ? e.message : String(e));
  }
}

// Schedule cleanup tasks
function scheduleCleanup() {
  // Cleanup uploads directory every 24 hours (remove files older than 24 hours)
  setInterval(async () => {
    await cleanupOldFiles(DIRS.uploads, 24 * 60 * 60 * 1000); // 24 hours
  }, 24 * 60 * 60 * 1000); // Run every 24 hours
  
  // Cleanup cache directory every 6 hours (remove files older than 6 hours)
  setInterval(async () => {
    await cleanupOldFiles(DIRS.cache, 6 * 60 * 60 * 1000); // 6 hours
  }, 6 * 60 * 60 * 1000); // Run every 6 hours
  
  // Run initial cleanup after 1 minute
  setTimeout(async () => {
    await cleanupOldFiles(DIRS.uploads, 24 * 60 * 60 * 1000);
    await cleanupOldFiles(DIRS.cache, 6 * 60 * 60 * 1000);
  }, 60 * 1000);
  
  tlogSync('cleanup:scheduled', 'uploads=24h', 'cache=6h');
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
    // Try the original path first (for installed extensions)
    try {
      const xml = fs.readFileSync(MANIFEST_PATH, 'utf8');
      const version = parseBundleVersion(xml);
      if (version) return version;
    } catch(_) {}
    
    // Fallback: try to find manifest in extensions subdirectories (for local development)
    const extensionsDir = path.join(EXT_ROOT, 'extensions');
    if (fs.existsSync(extensionsDir)) {
      const subdirs = fs.readdirSync(extensionsDir);
      for (const subdir of subdirs) {
        const manifestPath = path.join(extensionsDir, subdir, 'CSXS', 'manifest.xml');
        try {
          const xml = fs.readFileSync(manifestPath, 'utf8');
          const version = parseBundleVersion(xml);
          if (version) return version;
        } catch(_) {}
      }
    }
    
    return '';
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

// Request timeout middleware to prevent hanging requests
app.use((req, res, next) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      try { tlog('request:timeout', req.method, req.path); } catch(_){}
      res.status(408).json({ error: 'Request timeout' });
    }
  }, 30000); // 30 second timeout
  
  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
});

// Restrict CORS to local panel (file:// → Origin null) and localhost
// Relaxed CORS: allow any origin on localhost-only service
app.use(cors({
  origin: function(origin, cb){
    // CEP panels load from file:// (origin=null) - always allow
    if (!origin) return cb(null, true);
    // For non-null origins, CORS is allowed but requireCEPHeader middleware enforces header
    cb(null, true);
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-api-key','Authorization','X-CEP-Panel'],
  maxAge: 86400
}));

let jobs = [];
let jobCounter = 0;
// Store state in per-user app-data
const STATE_DIR = DIRS.state;
if (!fs.existsSync(STATE_DIR)) { try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch(_) {} }
const jobsFile = path.join(STATE_DIR, 'jobs.json');
const tokenFile = path.join(STATE_DIR, 'auth_token');
async function getOrCreateToken(){
  try{
    try {
      const t = await fs.promises.readFile(tokenFile, 'utf8');
      const trimmed = t.trim();
      if (trimmed.length > 0) return trimmed;
    } catch {
      // File doesn't exist or can't be read
    }
  }catch(_){ }
  const token = crypto.randomBytes(24).toString('hex');
  try { await fs.promises.writeFile(tokenFile, token, { mode: 0o600 }); } catch(_) {}
  return token;
}

// Initialize token asynchronously
let AUTH_TOKEN = '';
getOrCreateToken().then(token => {
  AUTH_TOKEN = token;
}).catch(() => {
  // Fallback to random token if file operations fail
  AUTH_TOKEN = crypto.randomBytes(24).toString('hex');
});

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
    if (abs.indexOf('/TemporaryItems/') === -1) return path.normalize(abs);
    try { if (!fs.existsSync(COPY_DIR)) fs.mkdirSync(COPY_DIR, { recursive: true }); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    const dest = path.join(COPY_DIR, path.basename(abs));
    try { fs.copyFileSync(abs, dest); return dest; } catch(_){ return abs; }
  }catch(_){ return String(p||''); }
}

// Rate limiting for /auth/token (1 req/sec per IP)
const tokenRateLimit = new Map();
function checkTokenRateLimit(ip){
  const now = Date.now();
  const last = tokenRateLimit.get(ip) || 0;
  if (now - last < 1000) return false;
  tokenRateLimit.set(ip, now);
  // Cleanup old entries every 100 requests
  if (tokenRateLimit.size > 100){
    for (const [k, v] of tokenRateLimit.entries()){
      if (now - v > 60000) tokenRateLimit.delete(k);
    }
  }
  return true;
}

// Middleware to require X-CEP-Panel header for non-null origins
function requireCEPHeader(req, res, next){
  const origin = req.headers.origin || req.headers.referer || null;
  // CEP panels have no origin (null) or file:// origin - always allow
  if (!origin || origin === 'file://') return next();
  // Non-CEP requests must include custom header
  const cepHeader = req.headers['x-cep-panel'];
  if (cepHeader === 'sync') return next();
  try { tlog('requireCEPHeader: rejected request from', origin, 'missing X-CEP-Panel header'); } catch(_){}
  return res.status(403).json({ error: 'forbidden' });
}

// Public endpoints (no auth): health and token fetch
app.get('/health', (req,res)=> res.json({ status:'ok', ts: Date.now() }));
// Friendly root
app.get('/', (_req,res)=> res.json({ ok:true, service:'sync-extension-server' }));
app.get('/auth/token', requireCEPHeader, (req,res)=>{
  // Only serve to localhost clients with rate limiting
  try{
    const ip = (req.socket && req.socket.remoteAddress) || '';
    if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')){
      tlog('/auth/token: rejected non-localhost IP', ip);
      return res.status(403).json({ error:'forbidden' });
    }
    if (!checkTokenRateLimit(ip)){
      tlog('/auth/token: rate limit exceeded for', ip);
      return res.status(429).json({ error:'rate limit exceeded' });
    }
  }catch(e){ tlog('/auth/token: error', e.message); }
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
        try { const sz = fs.statSync(out).size; tlog('convert mp3 ok', 'out=', out, 'bytes=', sz); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        res.json({ ok:true, path: out });
        return;
      } catch(e) {
        tlog('convert mp3 error:', e.message);
        return res.status(500).json({ error: String(e?.message||e) });
      }
    }
    const out = await convertAudio(srcPath, fmt);
    if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
    try { const sz = fs.statSync(out).size; tlog('convert ok', 'out=', out, 'bytes=', sz); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    res.json({ ok:true, path: out });
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
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
        try { const sz = fs.statSync(out).size; tlog('convert mp3 ok', 'out=', out, 'bytes=', sz); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        res.json({ ok:true, path: out });
        return;
      } catch(e) {
        tlog('convert mp3 error:', e.message);
        return res.status(500).json({ error: String(e?.message||e) });
      }
    }
    const out = await convertAudio(srcPath, fmt);
    if (!out || !fs.existsSync(out)) return res.status(500).json({ error:'conversion failed' });
    try { const sz = fs.statSync(out).size; tlog('convert ok (GET)', 'out=', out, 'bytes=', sz); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    res.json({ ok:true, path: out });
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
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
      } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    });
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
});

// Updates: version and check (PUBLIC)
app.get('/update/version', async (_req,res)=>{
  try{
    const current = await getCurrentVersion();
    res.json({ ok:true, version: current });
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
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
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
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

// Debug endpoint (PUBLIC - for UI debugging)
app.post('/debug', async (req, res) => {
  try {
    const body = req.body || {};
    const timestamp = new Date().toISOString();
    
    // Determine which log file to write to based on the debug message type
    let logFile = DEBUG_LOG; // Default to server log
    
    // If this is UI debug from AE, write to AE log
    if (body.hostConfig && body.hostConfig.isAE) {
      logFile = path.join(DIRS.logs, 'sync_ae_debug.log');
    }
    // If this is UI debug from Premiere, write to Premiere log  
    else if (body.hostConfig && body.hostConfig.hostId === 'PPRO') {
      logFile = path.join(DIRS.logs, 'sync_ppro_debug.log');
    }
    
    const logMessage = `[${timestamp}] [debug] ${JSON.stringify(body)}`;
    
    // Write to appropriate log file (don't log to console to avoid duplication in server log)
    try { fs.appendFileSync(logFile, logMessage + "\n"); } catch(_){ }
    
    res.json({ ok: true });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  }
});

// Upload endpoint (PUBLIC - needed for file picker)
app.post('/upload', async (req, res) => {
  try {
    const { path: filePath, apiKey } = req.body || {};
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path required' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Upload to R2 and return the cloud URL
    const fileUrl = await r2Upload(filePath);
    
    res.json({ ok: true, url: fileUrl });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  }
});

// Apply auth to all routes below this line
// Public routes: /logs, /health, /auth/token, /update/check, /update/version, /upload
app.use((req,res,next)=>{
  const publicPaths = [
    '/logs',
    '/health',
    '/auth/token',
    '/update/check',
    '/update/version',
    '/upload',
    '/debug',
    '/costs'
  ];
  if (publicPaths.includes(req.path)) {
    return next();
  }
  // All other routes require authentication
  return requireAuth(req,res,next);
});
// ---------- R2 (S3 compatible) config ----------
const R2_ENDPOINT_URL = process.env.R2_ENDPOINT_URL || 'https://a0282f2dad0cdecf5de20e2219e77809.r2.cloudflarestorage.com';
const R2_ACCESS_KEY  = process.env.R2_ACCESS_KEY || '';
const R2_SECRET_KEY  = process.env.R2_SECRET_KEY || '';
const R2_BUCKET      = process.env.R2_BUCKET || 'service-based-business';
const R2_PREFIX      = process.env.R2_PREFIX || 'sync-extension/';

// Validate R2 credentials
console.log('R2 configuration check:');
console.log('R2_ENDPOINT_URL:', R2_ENDPOINT_URL ? 'SET' : 'NOT SET');
console.log('R2_ACCESS_KEY:', R2_ACCESS_KEY ? 'SET' : 'NOT SET');
console.log('R2_SECRET_KEY:', R2_SECRET_KEY ? 'SET' : 'NOT SET');
console.log('R2_BUCKET:', R2_BUCKET);
console.log('R2_PREFIX:', R2_PREFIX);

if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('R2 credentials not configured. R2 uploads will be disabled.');
  console.error('Set R2_ACCESS_KEY and R2_SECRET_KEY environment variables.');
}

const r2Client = (R2_ACCESS_KEY && R2_SECRET_KEY) ? new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT_URL,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  forcePathStyle: true
}) : null;
const DOCS_DEFAULT_DIR = path.join(os.homedir(), 'Documents', 'sync. outputs');
const TEMP_DEFAULT_DIR = DIRS.uploads;

// Simple settings persistence for the panel (to help AE retain keys between reloads)
let PANEL_SETTINGS = null;
app.get('/settings', (req,res)=>{
  res.json({ ok:true, settings: PANEL_SETTINGS });
});
app.post('/settings', (req,res)=>{
  try{ PANEL_SETTINGS = (req.body && req.body.settings) ? req.body.settings : null; res.json({ ok:true }); }catch(e){ if (!res.headersSent) res.status(400).json({ error:String(e?.message||e) }); }
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
    if (!isSpawnedByUI) {
      console.log(`Starting update process: ${current} -> ${latestVersion}`);
      console.log(`Platform: ${process.platform}, Architecture: ${process.arch}`);
    }
    try { tlog('update:start', `${current} -> ${latestVersion}`, 'platform=', process.platform, 'arch=', process.arch); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    
    // Download and extract update
    const tempDir = path.join(DIRS.updates, 'sync_extension_update_' + Date.now());
    try { fs.mkdirSync(tempDir, { recursive: true }); } catch(_){}
    
    const zipPath = path.join(tempDir, 'update.zip');
    const zipResp = await fetch(latest.zip_url);
    if (!zipResp.ok) throw new Error('Failed to download update');
    
    const zipBuffer = await zipResp.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(zipBuffer));
    try { tlog('update:downloaded', zipPath, 'bytes=', String(zipBuffer && zipBuffer.byteLength || 0)); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    
    // Extract zip/zxp (ZXP is just a ZIP with extension folders)
    const isWindows = process.platform === 'win32';
    const isZxp = latest.is_zxp;
    
    if (isWindows) {
      // Windows: Use PowerShell to extract zip/zxp
      const extractCmd = `Expand-Archive -Path "${zipPath}" -DestinationPath "${tempDir}" -Force`;
      try { tlog('update:extract:win', extractCmd); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Windows extract command:', extractCmd);
      try {
        await execPowerShell(extractCmd);
        try { tlog('update:extract:win:ok'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        if (!isSpawnedByUI) console.log('PowerShell extraction completed');
      } catch(e) {
        try { tlog('update:extract:win:fail', e.message); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        if (!isSpawnedByUI) console.log('PowerShell extraction failed:', e.message);
        throw new Error('Failed to extract zip/zxp with PowerShell: ' + e.message);
      }
    } else {
      // macOS/Linux: Use unzip
      const extractCmd = `cd "${tempDir}" && unzip -q "${zipPath}"`;
      try { tlog('update:extract:unix', extractCmd); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Unix extract command:', extractCmd);
      try {
        await exec(extractCmd);
        try { tlog('update:extract:unix:ok'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        if (!isSpawnedByUI) console.log('Unix extraction completed');
      } catch(e) {
        try { tlog('update:extract:unix:fail', e.message); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        if (!isSpawnedByUI) console.log('Unix extraction failed:', e.message);
        throw new Error('Failed to extract zip/zxp with unzip: ' + e.message);
      }
    }
    
    // Find the extracted directory (ZXP: extension folders, ZIP: sync-extensions/, zipball: repo-name-tag/)
    let allItems;
    try {
      allItems = fs.readdirSync(tempDir);
    } catch(e) {
      throw new Error('Failed to read extracted directory: ' + e.message);
    }
    try { tlog('update:extracted:items', JSON.stringify(allItems||[])); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    if (!isSpawnedByUI) console.log('Extracted items:', allItems);
    
    const extractedDirs = allItems.filter(name => {
      const fullPath = path.join(tempDir, name);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch(e) {
        try { tlog('update:extracted:check:error', name, e.message); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
        console.log('Error checking item:', name, e.message);
        return false;
      }
    });
    
    try { tlog('update:extracted:dirs', JSON.stringify(extractedDirs||[])); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    if (!isSpawnedByUI) console.log('Extracted directories:', extractedDirs);
    
    let extractedDir;
    
    if (isZxp) {
      // ZXP format: extension folders are directly in tempDir
      extractedDir = tempDir;
      try { tlog('update:format:zxp'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Using ZXP format - extension folders directly in temp dir');
    } else if (extractedDirs.includes('sync-extensions')) {
      // ZIP format: sync-extensions directory
      extractedDir = path.join(tempDir, 'sync-extensions');
      try { tlog('update:format:zip:sync-extensions'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Using sync-extensions directory from ZIP release asset');
    } else if (extractedDirs.length > 0) {
      // Fallback to GitHub zipball format (repo-name-tag/)
      extractedDir = path.join(tempDir, extractedDirs[0]);
      try { tlog('update:format:zipball', extractedDirs[0]); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Using GitHub zipball directory:', extractedDirs[0]);
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
      if (!isSpawnedByUI) console.log('Possible source directories:', possibleDirs);
      
      if (possibleDirs.length === 0) {
        throw new Error('No extracted directory found in zipball. Contents: ' + allItems.join(', '));
      }
      
      extractedDir = path.join(tempDir, possibleDirs[0]);
      try { tlog('update:format:guess:chosen', possibleDirs[0]); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      if (!isSpawnedByUI) console.log('Using fallback directory:', possibleDirs[0]);
    }
    try { tlog('update:extracted:dir', extractedDir); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    if (!isSpawnedByUI) console.log('Using extracted directory:', extractedDir);
    
    // Manual copy: copy extension files directly to current installation location
    // This works for both user and system-wide installations by copying over the running extension
    try { tlog('update:manual:copy:start', 'target=', EXT_ROOT); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    
    // Copy extensions (handle both ZXP and ZIP formats)
    if (isZxp) {
      // ZXP format: extracted root contains extension content (CSXS, ui, server, etc.)
      try { tlog('update:copy:zxp:target', 'dest=', EXT_ROOT); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
      let items;
      try {
        items = fs.readdirSync(extractedDir).filter(name => name !== 'META-INF' && name !== 'update.zip');
      } catch(e) {
        throw new Error('Failed to read ZXP extracted directory: ' + e.message);
      }
      for (const name of items){
        const srcPath = path.join(extractedDir, name);
        const destPath = path.join(EXT_ROOT, name);
        if (isWindows) {
          await runRobocopy(srcPath, destPath);
        } else {
          await exec(`cp -R "${srcPath}" "${destPath}"`);
        }
      }
      try { tlog('update:copy:zxp:ok', 'items=', String(items.length)); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    } else {
      // ZIP format: extensions are in extensions/ subdirectory
      const aeSrcDir = path.join(extractedDir, 'extensions', 'ae-extension');
      const pproSrcDir = path.join(extractedDir, 'extensions', 'premiere-extension');
      
      // Copy the appropriate extension based on current APP_ID
      if (APP_ID === 'ae' && fs.existsSync(aeSrcDir)) {
        if (isWindows) {
          await runRobocopy(aeSrcDir, EXT_ROOT);
          await runRobocopy(path.join(extractedDir, 'ui'), path.join(EXT_ROOT, 'ui'));
          await runRobocopy(path.join(extractedDir, 'server'), path.join(EXT_ROOT, 'server'));
          await runRobocopy(path.join(extractedDir, 'icons'), path.join(EXT_ROOT, 'icons'));
          await runRobocopy(extractedDir, EXT_ROOT, 'index.html');
          await runRobocopy(path.join(extractedDir, 'lib'), path.join(EXT_ROOT, 'lib'));
        } else {
          await exec(`cp -R "${aeSrcDir}"/* "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/ui "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/server "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/icons "${EXT_ROOT}/"`);
          await exec(`cp "${extractedDir}"/index.html "${EXT_ROOT}/"`);
          await exec(`cp "${extractedDir}"/lib "${EXT_ROOT}/" -R`);
        }
      } else if (APP_ID === 'premiere' && fs.existsSync(pproSrcDir)) {
        if (isWindows) {
          await runRobocopy(pproSrcDir, EXT_ROOT);
          await runRobocopy(path.join(extractedDir, 'ui'), path.join(EXT_ROOT, 'ui'));
          await runRobocopy(path.join(extractedDir, 'server'), path.join(EXT_ROOT, 'server'));
          await runRobocopy(path.join(extractedDir, 'icons'), path.join(EXT_ROOT, 'icons'));
          await runRobocopy(extractedDir, EXT_ROOT, 'index.html');
          await runRobocopy(path.join(extractedDir, 'lib'), path.join(EXT_ROOT, 'lib'));
          await runRobocopy(path.join(extractedDir, 'extensions', 'premiere-extension', 'epr'), path.join(EXT_ROOT, 'epr'));
        } else {
          await exec(`cp -R "${pproSrcDir}"/* "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/ui "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/server "${EXT_ROOT}/"`);
          await exec(`cp -R "${extractedDir}"/icons "${EXT_ROOT}/"`);
          await exec(`cp "${extractedDir}"/index.html "${EXT_ROOT}/"`);
          await exec(`cp "${extractedDir}"/lib "${EXT_ROOT}/" -R`);
          await exec(`cp "${extractedDir}"/extensions/premiere-extension/epr "${EXT_ROOT}/" -R`);
        }
      }
    }
    
    try { tlog('update:manual:copy:complete'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} }
    
    // Cleanup
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(_){}
    
    if (!isSpawnedByUI) console.log(`Update completed successfully: ${current} -> ${latestVersion}`);
    res.json({ ok:true, updated:true, message:'Update applied successfully', current, latest: latestVersion });
    // After confirming response was sent, exit the server so a fresh instance loads the new code on next panel start
    try {
      setTimeout(()=>{ try { tlog('update:post:exit'); } catch(e){ try { tlog("silent catch:", e.message); } catch(_){} } if (!isSpawnedByUI) console.log('Exiting server after successful update'); process.exit(0); }, 800);
    } catch(_){ }
  }catch(e){ 
    if (!isSpawnedByUI) {
      console.error('Update failed:', e.message);
      console.error('Update error stack:', e.stack);
    }
    if (!res.headersSent) res.status(500).json({ error:String(e?.message||e) }); 
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

async function r2Upload(localPath){
  if (!r2Client) {
    throw new Error('R2 client not configured. Missing R2_ACCESS_KEY or R2_SECRET_KEY environment variables.');
  }
  if (!(await safeExists(localPath))) throw new Error('file not found: ' + localPath);
  
  // Add timeout protection to prevent hanging on network issues
  const timeoutMs = 120000; // 2 minute timeout for uploads
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('R2 upload timeout')), timeoutMs)
  );
  
  try {
    return await Promise.race([
      r2UploadInternal(localPath),
      timeoutPromise
    ]);
  } catch(e) {
    try { tlog('r2Upload:error', e && e.message ? e.message : String(e)); } catch(_){}
    throw e;
  }
}

async function r2UploadInternal(localPath){
  const base = path.basename(localPath);
  const key  = `${R2_PREFIX}uploads/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${base}`;
  slog('[r2] put start', localPath, '→', `${R2_BUCKET}/${key}`);
  
  try {
    const body = fs.createReadStream(localPath);
    const contentType = guessMime(localPath);
    
    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    }));
    
    // Generate signed URL for external access
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key
    });
    
    const signedUrl = await getSignedUrl(r2Client, command, { 
      expiresIn: 3600,
      signableHeaders: new Set(['host']),
      unsignableHeaders: new Set(['host'])
    }); // 1 hour expiry
    
    slog('[r2] put ok', signedUrl);
    return signedUrl;
  } catch (error) {
    slog('[r2] put error', error.message);
    throw error;
  }
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
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
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
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/jobs', (req,res)=> res.json(jobs));
app.get('/jobs/:id', (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  res.json(job);
});

async function normalizePaths(obj){
  if (!obj) return obj;
  if (obj.videoPath) obj.videoPath = await resolveSafeLocalPath(obj.videoPath);
  if (obj.audioPath) obj.audioPath = await resolveSafeLocalPath(obj.audioPath);
  return obj;
}

function normalizeOutputDir(p){
  try{
    if (!p || typeof p !== 'string') return '';
    const abs = path.resolve(p);
    return path.normalize(abs);
  }catch(_){ return ''; }
}

app.post('/jobs', async (req, res) => {
  try{
    let { videoPath, audioPath, videoUrl, audioUrl, isTempVideo, isTempAudio, model, temperature, activeSpeakerOnly, detectObstructions, options = {}, apiKey, outputDir } = req.body || {};
    ({ videoPath, audioPath } = await normalizePaths({ videoPath, audioPath }));
    // Auto-convert AIFF from AE to WAV so the rest of the pipeline can read it
    try { if (audioPath) { audioPath = await convertIfAiff(audioPath); } } catch(_){}
    const vStat = await safeStat(videoPath); const aStat = await safeStat(audioPath);
    const overLimit = ((vStat && vStat.size > 20*1024*1024) || (aStat && aStat.size > 20*1024*1024));
    slog('[jobs:create]', 'model=', model||'lipsync-2-pro', 'overLimit=', overLimit, 'v=', vStat&&vStat.size, 'a=', aStat&&aStat.size, 'r2=', true, 'bucket=', R2_BUCKET);
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key required' });
    }
    if (!videoUrl || !audioUrl){
      if (!videoPath || !audioPath) return res.status(400).json({ error: 'Video and audio required' });
      const videoExists = await safeExists(videoPath);
      const audioExists = await safeExists(audioPath);
      if (!videoExists || !audioExists) return res.status(400).json({ error: 'Video or audio file not found' });
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
    };
    jobs.push(job);
    if (jobs.length > 500) { jobs = jobs.slice(-500); }
    saveJobs();

    try{
      await createGeneration(job);
      // Cleanup temp inputs if present and uploaded
      try {
        if (job.isTempVideo && job.videoPath && await safeExists(job.videoPath)) { 
          await fs.promises.unlink(job.videoPath); 
          job.videoPath = ''; 
        }
      } catch(e){ await tlog("silent catch:", e.message); }
      try {
        if (job.isTempAudio && job.audioPath && await safeExists(job.audioPath)) { 
          await fs.promises.unlink(job.audioPath); 
          job.audioPath = ''; 
        }
      } catch(e){ await tlog("silent catch:", e.message); }
      saveJobs();
      res.json(job);
      pollSyncJob(job);
    }catch(e){
      slog('[jobs:create] generation error', e && e.message ? e.message : String(e));
      job.status = 'failed';
      job.error = String(e?.message||e);
      saveJobs();
      if (!res.headersSent) res.status(500).json({ error: job.error });
    }
  }catch(e){ slog('[jobs:create] error', e && e.message ? e.message : String(e)); if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
});

app.get('/jobs/:id/download', async (req,res)=>{
  const job = jobs.find(j => String(j.id) === String(req.params.id));
  if (!job) return res.status(404).json({ error:'Job not found' });
  if (!job.outputPath || !(await safeExists(job.outputPath))) return res.status(404).json({ error:'Output not ready' });
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
    try {
      await fs.promises.access(outDir);
    } catch {
      await fs.promises.mkdir(outDir, { recursive: true });
    }

    if (job.outputPath && await safeExists(job.outputPath) && path.dirname(job.outputPath) === outDir){
      return res.json({ ok:true, outputPath: job.outputPath });
    }

    if (job.outputPath && await safeExists(job.outputPath)){
      const newPath = path.join(outDir, `${job.id}_output.mp4`);
      try { await fs.promises.copyFile(job.outputPath, newPath); } catch(_){ }
      try { if (path.dirname(job.outputPath) !== outDir) await fs.promises.unlink(job.outputPath); } catch(e){ await tlog("silent catch:", e.message); }
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
  }catch(e){ if (!res.headersSent) res.status(500).json({ error: String(e?.message||e) }); }
});

// Simple GET endpoint for quick checks
app.get('/costs', (_req, res)=>{
  res.json({ ok:true, note:'POST this endpoint to estimate costs', ts: Date.now() });
});

app.post('/costs', async (req, res) => {
  try{
    slog('[costs] received POST');
    let { videoPath, audioPath, videoUrl, audioUrl, model = 'lipsync-2-pro', apiKey, options = {} } = req.body || {};
    ({ videoPath, audioPath } = await normalizePaths({ videoPath, audioPath }));
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    // If URLs aren't provided, use local paths and upload to R2
    if (!videoUrl || !audioUrl){
      if (!videoPath || !audioPath) return res.status(400).json({ error: 'Video and audio required' });
      const videoExists = await safeExists(videoPath);
      const audioExists = await safeExists(audioPath);
      if (!videoExists || !audioExists) return res.status(400).json({ error: 'Video or audio file not found' });

      slog('[costs] uploading sources to R2 for cost estimate');
      videoUrl = await r2Upload(await resolveSafeLocalPath(videoPath));
      audioUrl = await r2Upload(await resolveSafeLocalPath(audioPath));
    } else {
      slog('[costs] using provided URLs', 'videoUrl=', videoUrl, 'audioUrl=', audioUrl);
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
    if (!resp.ok) { slog('[costs] sync api error', resp.status, text); return res.status(resp.status).json({ error: text || 'cost failed' }); }
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
  const vStat = await safeStat(job.videoPath);
  const aStat = await safeStat(job.audioPath);
  const overLimit = ((vStat && vStat.size > 20*1024*1024) || (aStat && aStat.size > 20*1024*1024));
  
  // Add timeout protection to prevent hanging
  const timeoutMs = 180000; // 3 minute timeout (increased for Premiere Pro)
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Generation timeout')), timeoutMs)
  );
  
  try{
    return await Promise.race([
      createGenerationInternal(job, vStat, aStat, overLimit),
      timeoutPromise
    ]);
  } catch(e) {
    try { tlog('createGeneration:error', e && e.message ? e.message : String(e)); } catch(_){}
    throw e;
  }
}

async function createGenerationInternal(job, vStat, aStat, overLimit){
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
    if (overLimit) {
      slog('[upload] using r2 url mode');
      const videoUrl = await r2Upload(await resolveSafeLocalPath(job.videoPath));
      const audioUrl = await r2Upload(await resolveSafeLocalPath(job.audioPath));
      // Cleanup temp sources if flagged
      try { if (job.isTempVideo && job.videoPath && await safeExists(job.videoPath)) { await fs.promises.unlink(job.videoPath); job.videoPath = ''; } } catch(e){ await tlog("silent catch:", e.message); }
      try { if (job.isTempAudio && job.audioPath && await safeExists(job.audioPath)) { await fs.promises.unlink(job.audioPath); job.audioPath = ''; } } catch(_){ }
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
  }catch(e){ console.error('URL mode failed:', e); }
  
  // Always use R2 - no direct file uploads
  slog('[upload] using r2 url mode (forced)');
  const videoUrl = await r2Upload(await resolveSafeLocalPath(job.videoPath));
  const audioUrl = await r2Upload(await resolveSafeLocalPath(job.audioPath));
  // Cleanup temp sources if flagged
  try { if (job.isTempVideo && job.videoPath && await safeExists(job.videoPath)) { await fs.promises.unlink(job.videoPath); job.videoPath = ''; } } catch(e){ await tlog("silent catch:", e.message); }
  try { if (job.isTempAudio && job.audioPath && await safeExists(job.audioPath)) { await fs.promises.unlink(job.audioPath); job.audioPath = ''; } } catch(_){ }
  const body = {
    model: job.model,
    input: [ { type:'video', url: videoUrl }, { type:'audio', url: audioUrl } ],
    options: (job.options && typeof job.options === 'object') ? job.options : {}
  };
  const resp = await fetch(`${SYNC_API_BASE}/generate`, {
    method: 'POST',
    headers: { 'x-api-key': job.apiKey, 'accept':'application/json', 'content-type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok){ const t = await safeText(resp); slog('[create:url] error', resp.status, t); throw new Error(`create(url) failed ${resp.status} ${t}`); }
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
  try {
    await fs.promises.access(outDir);
  } catch {
    await fs.promises.mkdir(outDir, { recursive: true });
  }
  const outputPath = path.join(outDir, `${job.id}_output.mp4`);
  await pipeToFile(response.body, outputPath);
  job.outputPath = outputPath;
  return true;
}

async function pollSyncJob(job){
  const pollInterval = 5000;
  const maxAttempts = 120;
  let attempts = 0;
  let pollTimeout = null;
  
  const tick = async ()=>{
    attempts++;
    try{
      if (await downloadIfReady(job)){
        job.status = 'completed';
        saveJobs();
        if (pollTimeout) clearTimeout(pollTimeout);
        return;
      }
      if (attempts < maxAttempts){ 
        pollTimeout = setTimeout(tick, pollInterval);
      } else { 
        job.status='failed'; 
        job.error='Timeout'; 
        saveJobs(); 
        if (pollTimeout) clearTimeout(pollTimeout);
      }
    }catch(e){ 
      job.status='failed'; 
      job.error=String(e?.message||e); 
      saveJobs(); 
      if (pollTimeout) clearTimeout(pollTimeout);
    }
  };
  
  // Start polling with initial timeout
  pollTimeout = setTimeout(tick, pollInterval);
  
  // Safety timeout to prevent infinite polling
  setTimeout(() => {
    if (pollTimeout) {
      clearTimeout(pollTimeout);
      pollTimeout = null;
      if (job.status === 'processing') {
        job.status = 'failed';
        job.error = 'Polling timeout';
        saveJobs();
      }
    }
  }, maxAttempts * pollInterval + 30000); // Extra 30 seconds buffer
}

async function safeText(resp){ try{ return await resp.text(); }catch(_){ return ''; } }

// Async version to prevent blocking with timeout protection
async function safeStat(p){ 
  try{ 
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('File stat timeout')), 5000)
    );
    return await Promise.race([
      fs.promises.stat(p),
      timeoutPromise
    ]);
  }catch(_){ 
    return null; 
  } 
}

// Synchronous version for critical operations only
function safeStatSync(p){ try{ return fs.statSync(p); }catch(_){ return null; } }

// Async file existence check with timeout
async function safeExists(p){
  try{
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('File exists timeout')), 5000)
    );
    await Promise.race([
      fs.promises.access(p),
      timeoutPromise
    ]);
    return true;
  }catch{
    return false;
  }
}

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
let startupLock = false;
async function startServer() {
  if (startupLock) {
    console.log('Server startup already in progress, skipping...');
    return;
  }
  startupLock = true;
  
  try {
    const PORT = 3000;
    // If an instance is already healthy on 3000, exit quickly without error
    try {
      const r = await fetch(`http://${HOST}:${PORT}/health`, { 
        method: 'GET',
        timeout: 5000 // 5 second timeout for health check
      });
      if (r && r.ok) {
        console.log(`Existing Sync Extension server detected on http://${HOST}:${PORT}`);
        // Try to determine version drift; if drift, request exit of old server
        try {
          const currentManifestVersion = await getCurrentVersion();
          const vResp = await fetch(`http://${HOST}:${PORT}/update/version`, { 
            method: 'GET',
            timeout: 5000
          }).catch(()=>null);
          const vJson = vResp ? await vResp.json().catch(()=>null) : null;
          const otherVersion = vJson && vJson.version ? String(vJson.version) : '';
          if (currentManifestVersion && otherVersion && compareSemver(currentManifestVersion, otherVersion) > 0){
            console.log(`Existing server version ${otherVersion} older than manifest ${currentManifestVersion}, requesting shutdown...`);
            await fetch(`http://${HOST}:${PORT}/admin/exit`, { 
              method:'POST',
              timeout: 5000
            }).catch(()=>{});
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
      // Start cleanup scheduling
      scheduleCleanup();
    });
    srv.on('error', async (err) => {
      if (err && err.code === 'EADDRINUSE') {
        try {
          const r = await fetch(`http://${HOST}:${PORT}/health`, { 
            method: 'GET',
            timeout: 5000
          });
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
  } finally {
    startupLock = false;
  }
}

startServer();


async function resolveSafeLocalPath(p){
  try{
    if (!p || typeof p !== 'string') {
      tlog('resolveSafeLocalPath: invalid input', typeof p);
      return p;
    }
    // SECURITY: Reject non-absolute paths to prevent traversal attacks
    if (!path.isAbsolute(p)) {
      tlog('resolveSafeLocalPath: rejected non-absolute path', p);
      throw new Error('Only absolute paths allowed');
    }
    const isTempItems = p.indexOf('/TemporaryItems/') !== -1;
    if (!isTempItems) return p;
    // macOS workaround: copy from TemporaryItems to readable location
    const docs = path.join(os.homedir(), 'Documents', 'sync_extension_temp');
    try {
      await fs.promises.access(docs);
    } catch {
      await fs.promises.mkdir(docs, { recursive: true });
    }
    const target = path.join(docs, path.basename(p));
    try { 
      await fs.promises.copyFile(p, target); 
      await tlog('resolveSafeLocalPath: copied from TemporaryItems', p, '→', target);
      return target; 
    } catch(e){ 
      await tlog('resolveSafeLocalPath: copy failed', e.message);
      return p; 
    }
  }catch(e){ 
    tlog('resolveSafeLocalPath: exception', e.message);
    throw e;
  }
}

// Crash safety
process.on('uncaughtException', (err)=>{ try { console.error('uncaughtException', err && err.stack || err); tlog('uncaughtException', err && err.stack || err); } catch(_) {} });
process.on('unhandledRejection', (reason)=>{ try { console.error('unhandledRejection', reason); tlog('unhandledRejection', String(reason)); } catch(_) {} });
