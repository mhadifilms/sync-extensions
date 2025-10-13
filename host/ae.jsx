// Minimal JSON polyfill for ExtendScript environments lacking JSON
try {
  if (typeof JSON === 'undefined') { JSON = {}; }
  if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function(value){
      function escStr(s){ return String(s).replace(/[\\"\n\r\t\b\f]/g, function(ch){
        if (ch === '"') return '\\"';
        if (ch === '\\') return '\\\\';
        if (ch === '\n') return '\\n';
        if (ch === '\r') return '\\r';
        if (ch === '\t') return '\\t';
        if (ch === '\b') return '\\b';
        if (ch === '\f') return '\\f';
        return ch;
      }); }
      function ser(v){
        if (v === null) return 'null';
        var t = typeof v;
        if (t === 'string') return '"' + escStr(v) + '"';
        if (t === 'number' || t === 'boolean') return String(v);
        if (t === 'undefined') return 'null';
        if (v instanceof Array) {
          var arr = [];
          for (var i=0;i<v.length;i++){ arr.push(ser(v[i])); }
          return '[' + arr.join(',') + ']';
        }
        var props = [];
        for (var k in v) {
          if (!v.hasOwnProperty) continue;
          props.push('"' + escStr(k) + '":' + ser(v[k]));
        }
        return '{' + props.join(',') + '}';
      }
      return ser(value);
    };
  }
  if (typeof JSON.parse !== 'function') {
    JSON.parse = function(text){
      // Constrained eval for trusted UI payloads - add length check for safety
      var s = String(text || '');
      if (s.length > 1048576) { // 1MB limit
        try { var log = _syncDebugLogFile(); log.open('a'); log.writeln('[JSON.parse] rejected oversized input: ' + s.length + ' bytes'); log.close(); } catch(_){}
        throw new Error('JSON input too large');
      }
      try {
        return eval('(' + s + ')');
      } catch(e) {
        try { var log = _syncDebugLogFile(); log.open('a'); log.writeln('[JSON.parse] parse error: ' + String(e)); log.close(); } catch(_){}
        throw e;
      }
    };
  }
} catch(e) { /* ignore */ }

function _respond(data) {
  try { return JSON.stringify(data); } catch (e) { return String(data); }
}

function _hostLog(msg){
  try{
    var s = String(msg||'');
    var timestamp = new Date().toISOString();
    var logLine = '[' + timestamp + '] ' + s + '\n';
    
    // Write to central debug log
    try {
      var logFile = _syncDebugLogFile();
      logFile.open('a');
      logFile.write(logLine);
      logFile.close();
    } catch(_){ }
    
    // Also try to send to server
    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    if (isWindows) {
      var url = "http://127.0.0.1:3000/hostlog?msg=" + encodeURIComponent(s).replace(/\"/g,'\\"');
      var wcmd = 'cmd.exe /c curl -s -m 1 ' + '"' + url.replace(/"/g,'\"') + '"' + ' >NUL 2>&1';
      system.callSystem(wcmd);
    } else {
      var payload = '{"msg": ' + JSON.stringify(s) + '}';
      var cmd = "/bin/bash -lc " + _shq("(curl -s -m 1 -X POST -H 'Content-Type: application/json' --data " + _shq(payload) + " http://127.0.0.1:3000/hostlog || true) >/dev/null 2>&1");
      system.callSystem(cmd);
    }
  }catch(e){ }
}

function _shq(s) {
  try { return "'" + String(s || '').replace(/'/g, "'\\''") + "'"; } catch (e) { return "''"; }
}

// Central app-data directory resolver for ExtendScript
// NOTE: This function is duplicated in host/ppro.jsx and server/src/audio.cjs
// ExtendScript does not support imports, so duplication is necessary
// Future: Consider extracting to shared .jsxinc file that both hosts can $.evalFile()
function SYNC_getBaseDirs(){
  try{
    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    var root = Folder.userData.fsName; // %APPDATA% on Windows, ~/Library/Application Support on macOS
    var base = new Folder(root + (isWindows ? "\\sync. extensions" : "/sync. extensions"));
    if (!base.exists) { try{ base.create(); }catch(_){ } }
    function ensure(name){
      var f = new Folder(base.fsName + (isWindows ? ("\\" + name) : ("/" + name)));
      if (!f.exists) { try{ f.create(); }catch(_){ } }
      return f.fsName;
    }
    return {
      base: base.fsName,
      logs: ensure('logs'),
      cache: ensure('cache'),
      state: ensure('state'),
      uploads: ensure('uploads'),
      updates: ensure('updates')
    };
  }catch(e){
    try { return { base: Folder.userData.fsName, logs: Folder.userData.fsName, cache: Folder.userData.fsName, state: Folder.userData.fsName, uploads: Folder.userData.fsName, updates: Folder.userData.fsName }; } catch(_){ return { base:'', logs:'', cache:'', state:'', uploads:'', updates:'' }; }
  }
}
function SYNC_getLogDir(){ try{ return SYNC_getBaseDirs().logs; }catch(_){ return ''; } }
function SYNC_getUploadsDir(){ try{ return SYNC_getBaseDirs().uploads; }catch(_){ return ''; } }
function _syncDebugLogPath(){
  try{
    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    var dir = SYNC_getLogDir(); if (!dir) { dir = Folder.temp.fsName; }
    // Respect debug flag file in logs (no UI toggle / env required)
    try{
      var flag = new File(dir + (isWindows?'\\':'/') + 'debug.enabled');
      var enabled = false;
      try{ enabled = flag && flag.exists; }catch(_){ enabled = false; }
      if (!enabled) { return ''; }
    }catch(_){ }
    return dir + (isWindows ? '\\' : '/') + 'sync_ae_debug.log';
  }catch(e){ try { return Folder.temp.fsName + '/sync_ae_debug.log'; } catch(_){ return 'sync_ae_debug.log'; } }
}
function _syncDebugLogFile(){ try { return new File(_syncDebugLogPath()); } catch(e){ try { return new File(Folder.temp.fsName + '/sync_ae_debug.log'); } catch(_){ return new File('sync_ae_debug.log'); } } }

function _extensionRoot() {
  try {
    // Method 1: Derive from this script path: <ext>/host/ae.jsx → <ext>
    var here = new File($.fileName);
    if (here && here.exists) {
      var hostDir = here.parent; // /host
      if (hostDir) {
        var extDir = hostDir.parent; // extension root
        if (extDir && extDir.exists) { return extDir.fsName; }
      }
    }
  } catch (e) {}
  
  try {
    // Method 2: Use CEP API to get extension path
    var extPath = $.eval('cs.getSystemPath(cs.SystemPath.EXTENSION)');
    if (extPath) return extPath;
  } catch(e) {}
  
  try {
    // Method 3: Check both user and system-wide locations
    var userHome = Folder.userDocuments.parent.fsName;
    var isWindows = false; 
    try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    
    var userPath, systemPath;
    if (isWindows) {
      userPath = userHome + "\\AppData\\Roaming\\Adobe\\CEP\\extensions\\com.sync.extension.ae";
      systemPath = "C:\\Program Files\\Adobe\\CEP\\extensions\\com.sync.extension.ae";
    } else {
      userPath = userHome + "/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.ae";
      systemPath = "/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.ae";
    }
    
    // Check user location first
    var userExt = new File(userPath);
    if (userExt && userExt.exists) return userPath;
    
    // Check system location
    var systemExt = new File(systemPath);
    if (systemExt && systemExt.exists) return systemPath;
    
    // Fallback to user location (for development)
    return userPath;
  } catch (e2) {}
  return '';
}

// Wait until a file exists and its size is stable (helps AE import after downloads)
function _waitForFileReady(file, timeoutMs){
  try {
    var start = (new Date()).getTime();
    var lastSize = -1; var stable = 0;
    while (((new Date()).getTime() - start) < (timeoutMs||20000)){
      try{
        if (file && file.exists){
          var sz = 0; try { file.open('r'); file.seek(0,2); sz = file.length; file.close(); } catch(e){ sz = file.length; }
          if (sz > 0){ if (sz === lastSize) { stable++; if (stable > 2) return true; } else { lastSize = sz; stable = 0; } }
        }
      }catch(e){}
      $.sleep(200);
    }
    try{ return file && file.exists; }catch(e){ return false; }
  } catch(e){ return false; }
}

// Prefer a stable, readable output directory (avoids TemporaryItems EPERM)
function _safeOutDir(){
  try {
    var d = SYNC_getBaseDirs();
    if (d && d.uploads) return d.uploads;
  } catch(_){ }
  try {
    var ext = _extensionRoot();
    if (ext) {
      var dir1 = new Folder(ext + '/server/.cache');
      if (!dir1.exists) { try { dir1.create(); } catch(_){ } }
      return dir1.fsName;
    }
  } catch(_){ }
  try { return Folder.temp.fsName; } catch(_){ }
  return '';
}

// Note: ffmpeg dependency removed - using pure Node.js audio conversion

// Auto-start is now handled by ui/nle.js

function AEFT_getProjectDir() {
  try {
    var proj = (app && app.project) ? app.project : null;
    var base = null;
    try { if (proj && proj.file) { base = proj.file.parent; } } catch (e) {}
    if (!base || !base.exists) {
      try { base = Folder('~/Documents'); } catch (e2) { base = null; }
    }
    if (!base || !base.exists) return _respond({ ok: false, error: 'No project folder' });
    var outFolder = new Folder(base.fsName + '/sync. outputs');
    if (!outFolder.exists) { try { outFolder.create(); } catch (e3) {} }
    return _respond({ ok: true, projectDir: base.fsName, outputDir: outFolder.fsName });
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_diagInOut() {
  try {
    var info = { ok: true, host: 'AEFT' };
    try { info.projectOpen = !!(app && app.project); } catch (e) { info.projectOpen = false; info.error = String(e); }
    try { info.ffmpeg = false; } catch(_){ info.ffmpeg = false; } // ffmpeg no longer required
    
    // Debug logging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_diagInOut called");
      logFile.writeln("[" + new Date().toString() + "] projectOpen: " + String(info.projectOpen));
      logFile.writeln("[" + new Date().toString() + "] app exists: " + String(!!app));
      logFile.writeln("[" + new Date().toString() + "] app.project exists: " + String(!!(app && app.project)));
      logFile.close();
    } catch(e) {}
    
    return _respond(info);
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_showFileDialog(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    var kind = String(p.kind || 'video');
    
    // Debug logging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_showFileDialog called");
      logFile.writeln("[" + new Date().toString() + "] kind: " + String(kind));
      logFile.writeln("[" + new Date().toString() + "] payload: " + String(payloadJson));
      logFile.close();
    } catch(e) {}
    
    var allow = (kind === 'audio')
      ? { wav:1, mp3:1, aac:1, aif:1, aiff:1, m4a:1 }
      : { mov:1, mp4:1, mxf:1, mkv:1, avi:1, m4v:1, mpg:1, mpeg:1 };
    var file = null;
    try {
      if ($.os && $.os.toString().indexOf('Windows') !== -1) {
        var filterStr = (kind === 'audio')
          ? 'Audio files:*.wav;*.mp3;*.aac;*.aif;*.aiff;*.m4a'
          : 'Video files:*.mov;*.mp4;*.mxf;*.mkv;*.avi;*.m4v;*.mpg;*.mpeg';
        file = File.openDialog('Select ' + kind + ' file', filterStr);
      } else {
        var fn = function(f){ try { if (f instanceof Folder) return true; var n = (f && f.name) ? String(f.name).toLowerCase() : ''; var i = n.lastIndexOf('.'); if (i < 0) return false; var ext = n.substring(i+1); return allow[ext] === 1; } catch (e) { return true; } };
        file = File.openDialog('Select ' + kind + ' file', fn);
      }
    } catch(e){ 
      try {
        var logFile = _syncDebugLogFile();
        logFile.open("a");
        logFile.writeln("[" + new Date().toString() + "] File.openDialog error: " + String(e));
        logFile.close();
      } catch(_){ }
    }
    
    if (file && file.exists) { 
      try {
        var logFile = _syncDebugLogFile();
        logFile.open("a");
        logFile.writeln("[" + new Date().toString() + "] File selected: " + String(file.fsName));
        logFile.close();
      } catch(_){ }
      
      try {
        var response = _respond({ ok:true, path: file.fsName });
        try {
          var logFile2 = _syncDebugLogFile();
          logFile2.open("a");
          logFile2.writeln("[" + new Date().toString() + "] Returning response: " + String(response));
          logFile2.close();
        } catch(_){ }
        return response;
      } catch(e) {
        try {
          var logFile3 = _syncDebugLogFile();
          logFile3.open("a");
          logFile3.writeln("[" + new Date().toString() + "] _respond error: " + String(e));
          logFile3.close();
        } catch(_){ }
        return String({ ok:true, path: file.fsName });
      }
    }
    
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] No file selected or file doesn't exist");
      logFile.close();
    } catch(_){ }
    
    return _respond({ ok:false, error:'No file selected' });
  } catch (e) { 
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_showFileDialog error: " + String(e));
      logFile.close();
    } catch(_){ }
    return _respond({ ok:false, error:String(e) }); 
  }
}

function AEFT_exportInOutVideo(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    
    // Log to temp file for debugging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutVideo called");
      logFile.writeln("[" + new Date().toString() + "] Payload: " + String(payloadJson));
      logFile.close();
    } catch(e){ try { var log = _syncDebugLogFile(); log.open("a"); log.writeln("[" + new Date().toString() + "] catch: " + String(e)); log.close(); } catch(_){} }
    
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      try {
        var logFile = _syncDebugLogFile();
        logFile.open("a");
        logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutVideo: No active composition");
        logFile.close();
      } catch(_){ }
      return _respond({ ok: false, error: 'No active composition' });
    }

    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    try { item.applyTemplate('Best Settings'); } catch(_){ }
    // timeSpanStart is evaluated in the comp's display time domain.
    // If a comp uses a non-zero displayStartTime (e.g. sequence timecode),
    // setting workAreaStart alone can fall outside the allowed range and
    // trigger AE's warning dialog. Offset by displayStartTime to keep it in-range.
    var __start = 0; 
    try { __start = (comp.displayStartTime || 0) + (comp.workAreaStart || 0); } catch(_){ __start = comp.workAreaStart || 0; }
    try { item.timeSpanStart = __start; } catch(_){ }
    try { item.timeSpanDuration = comp.workAreaDuration; } catch(_){ }

    var want = String(p.codec||'h264').toLowerCase();
    var om = item.outputModule(1);

    // If H.264 selected, render directly to mp4 using built-in template
    if (want === 'h264'){
      var h264T = ['H.264 - Match Render Settings - 15 Mbps','H.264 - Match Render Settings - 5 Mbps','H.264 - Match Render Settings - 40 Mbps','H.264'];
      var applied = '';
      for (var i=0;i<h264T.length;i++){ try { om.applyTemplate(h264T[i]); applied = h264T[i]; break; } catch(_){ } }
      if (!applied) { try { om.applyTemplate('Lossless'); } catch(_){ } }
      var mp4 = new File(SYNC_getUploadsDir() + '/sync_inout_' + (new Date().getTime()) + '.mp4');
      try { om.file = mp4; } catch(_){ }
      try { rq.render(); } catch (eRender) { return _respond({ ok:false, error:'Render failed: '+String(eRender) }); }
      var waited=0; while(waited<180000){ try{ if(mp4 && mp4.exists) break; }catch(_){ } $.sleep(200); waited+=200; }
      if (!mp4 || !mp4.exists) return _respond({ ok:false, error:'Render timeout' });
      return _respond({ ok:true, path: mp4.fsName, note: 'AE H.264 direct' });
    }

    // Otherwise render ProRes 4444 (High Quality with Alpha) - no transcoding needed
    var appliedHQ = '';
    try { om.applyTemplate('High Quality with Alpha'); appliedHQ = 'High Quality with Alpha'; } catch(_){ }
    if (!appliedHQ) { try { om.applyTemplate('Lossless'); appliedHQ = 'Lossless'; } catch(_){ } }
    var srcMov = new File(SYNC_getUploadsDir() + '/sync_inout_' + (new Date().getTime()) + '.mov');
    try { om.file = srcMov; } catch(_){ }
    try { rq.render(); } catch (eRender2) { return _respond({ ok:false, error:'Render failed: '+String(eRender2) }); }
    var waited2=0; while(waited2<180000){ try{ if(srcMov && srcMov.exists) break; }catch(_){ } $.sleep(200); waited2+=200; }
    if (!srcMov || !srcMov.exists) return _respond({ ok:false, error:'Render timeout (src)' });

    return _respond({ ok:true, path: srcMov.fsName, note:'prores render completed' });
  } catch (e) {
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutVideo error: " + String(e));
      logFile.close();
    } catch(_){ }
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_exportInOutAudio(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    
    // Log to temp file for debugging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutAudio called");
      logFile.writeln("[" + new Date().toString() + "] Payload: " + String(payloadJson));
      logFile.close();
    } catch(e){ try { var log = _syncDebugLogFile(); log.open("a"); log.writeln("[" + new Date().toString() + "] catch: " + String(e)); log.close(); } catch(_){} }
    
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      try {
        var logFile = _syncDebugLogFile();
        logFile.open("a");
        logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutAudio: No active composition");
        logFile.close();
      } catch(_){ }
      return _respond({ ok: false, error: 'No active composition' });
    }

    var rq = app.project.renderQueue;
    try { rq.items.clear(); } catch(_){ }
    var item = rq.items.add(comp);
    try { item.applyTemplate('Best Settings'); } catch(_){ }
    // See note above in AEFT_exportInOutVideo about displayStartTime offset
    var __astart = 0;
    try { __astart = (comp.displayStartTime || 0) + (comp.workAreaStart || 0); } catch(_){ __astart = comp.workAreaStart || 0; }
    try { item.timeSpanStart = __astart; } catch(_){ }
    try { item.timeSpanDuration = comp.workAreaDuration; } catch(_){ }

    var om = item.outputModule(1);
    var applied = '';
    try { om.applyTemplate('AIFF 48kHz'); applied = 'AIFF 48kHz'; } catch(_){ }
    if (!applied) { try { om.applyTemplate('Sound Only'); applied = 'Sound Only'; } catch(_){ } }
    var outDir = _safeOutDir();
    var aif = new File(outDir + '/sync_inout_audio_src_' + (new Date().getTime()) + '.aif');
    try { om.file = aif; } catch(_){ }

    try {
      var dbg_render = _syncDebugLogFile();
      dbg_render.open('a');
      dbg_render.writeln('[' + new Date().toString() + '] starting audio render to: ' + String(aif.fsName));
      dbg_render.close();
    } catch(_){ }
    
    try { 
      rq.render(); 
      try {
        var dbg_render_done = _syncDebugLogFile();
        dbg_render_done.open('a');
        dbg_render_done.writeln('[' + new Date().toString() + '] render() call completed');
        dbg_render_done.close();
      } catch(_){ }
    } catch (eRender) { 
      try {
        var dbg_error = _syncDebugLogFile();
        dbg_error.open('a');
        dbg_error.writeln('[' + new Date().toString() + '] render error: ' + String(eRender));
        dbg_error.close();
      } catch(_){ }
      return _respond({ ok:false, error:'Render failed: '+String(eRender) }); 
    }
    
    // Wait for render to complete with timeout
    var waited=0; 
    while(waited<180000){ 
      try{ 
        if(aif && aif.exists && aif.length>0) break; 
        if(rq && rq.numItems > 0 && rq.item(1) && rq.item(1).status === RQItemStatus.DONE) break;
        if(rq && rq.numItems > 0 && rq.item(1) && rq.item(1).status === RQItemStatus.FAILED) {
          try {
            var dbg_failed = _syncDebugLogFile();
            dbg_failed.open('a');
            dbg_failed.writeln('[' + new Date().toString() + '] render failed');
            dbg_failed.close();
          } catch(_){ }
          return _respond({ ok:false, error:'Render failed' });
        }
      }catch(_){ } 
      $.sleep(500); 
      waited+=500; 
    }
    
    try {
      var dbg_wait = _syncDebugLogFile();
      dbg_wait.open('a');
      dbg_wait.writeln('[' + new Date().toString() + '] after wait - aif exists: ' + String(aif&&aif.exists) + ' len: ' + String(aif&&aif.length) + ' waited: ' + String(waited));
      dbg_wait.close();
    } catch(_){ }
    
    if (!aif || !aif.exists) return _respond({ ok:false, error:'Render timeout (audio)' });

    // Convert AIFF to WAV using server endpoint
    var want = String(p.format||'wav').toLowerCase();
    
    try {
      var dbg1 = _syncDebugLogFile();
      dbg1.open('a');
      dbg1.writeln('[' + new Date().toString() + '] aif=' + String(aif && aif.fsName) + ' len=' + String(aif && aif.length));
      dbg1.close();
    } catch(_){ }
    
    if (want === 'mp3' && aif && aif.exists && aif.length > 0) {
      try {
        var outputFile = new File(outDir + '/sync_inout_audio_' + (new Date().getTime()) + '.mp3');
        var extPath = _extensionRoot();
        var nodePath = '';
        var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
        
        // Prefer bundled Node inside extension /bin
        try {
          var extRoot = _extensionRoot();
          if (extRoot) {
            var cand = isWindows ? (extRoot + '\\bin\\win32-x64\\node.exe') : (extRoot + '/bin/darwin-arm64/node');
            var f = new File(cand);
            if (f && f.exists) { nodePath = f.fsName; }
          }
        } catch(_){ }
        // No fallbacks - require bundled Node.js
        if (!nodePath) {
          return _respond({ ok:false, error:'Bundled Node.js not found - extension requires bundled Node.js' });
        }
        
        // Use server-side MP3 conversion via HTTP request
        var url = 'http://127.0.0.1:3000/audio/convert?format=mp3&srcPath=' + encodeURIComponent(aif.fsName);
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg3 = new File(debugLogPath);
          dbg3.open('a');
          dbg3.writeln('[' + new Date().toString() + '] calling server for mp3: ' + String(url));
          dbg3.close();
        } catch(_){ }
        
        // Use curl to call the server and get JSON response
        var cmd = '';
        if (isWindows) {
          // Use curl instead of PowerShell to avoid Defender issues
          cmd = 'cmd.exe /c curl -s "' + url + '"';
        } else {
          cmd = 'curl -s "' + url + '"';
        }
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg4 = new File(debugLogPath);
          dbg4.open('a');
          dbg4.writeln('[' + new Date().toString() + '] curl mp3 cmd: ' + String(cmd));
          dbg4.close();
        } catch(_){ }
        
        var result = system.callSystem(cmd);
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg5 = new File(debugLogPath);
          dbg5.open('a');
          dbg5.writeln('[' + new Date().toString() + '] curl mp3 result: ' + String(result));
          dbg5.close();
        } catch(_){ }
        
        // Parse JSON response to get the MP3 file path
        var mp3Path = '';
        try {
          var jsonResponse = JSON.parse(result);
          if (jsonResponse && jsonResponse.ok && jsonResponse.path) {
            mp3Path = jsonResponse.path;
          }
        } catch(e) {
          try {
            var debugLogPath = _syncDebugLogPath();
            var dbg6 = new File(debugLogPath);
            dbg6.open('a');
            dbg6.writeln('[' + new Date().toString() + '] JSON parse error: ' + String(e));
            dbg6.close();
          } catch(_){ }
        }
        
        // Copy the MP3 file from server path to our output path
        if (mp3Path && mp3Path.length > 0) {
          try {
            var serverMp3File = new File(mp3Path);
            if (serverMp3File && serverMp3File.exists) {
              serverMp3File.copy(outputFile);
              try {
                var debugLogPath = _syncDebugLogPath();
                var dbg7 = new File(debugLogPath);
                dbg7.open('a');
                dbg7.writeln('[' + new Date().toString() + '] copied mp3 from server: ' + String(mp3Path) + ' to: ' + String(outputFile.fsName));
                dbg7.close();
              } catch(_){ }
            }
          } catch(e) {
            try {
              var debugLogPath = _syncDebugLogPath();
              var dbg8 = new File(debugLogPath);
              dbg8.open('a');
              dbg8.writeln('[' + new Date().toString() + '] copy mp3 error: ' + String(e));
              dbg8.close();
            } catch(_){ }
          }
        }
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg5 = new File(debugLogPath);
          dbg5.open('a');
          dbg5.writeln('[' + new Date().toString() + '] curl mp3 result: ' + String(result));
          dbg5.close();
        } catch(_){ }
        
        // Wait for file to be created
        var waited = 0;
        while (waited < 10000) {
          try { if (outputFile && outputFile.exists && outputFile.length > 0) break; } catch(_){ }
          $.sleep(200);
          waited += 200;
        }
        
        // Check if MP3 file was successfully copied
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg9 = new File(debugLogPath);
          dbg9.open('a');
          dbg9.writeln('[' + new Date().toString() + '] mp3 output exists: ' + String(outputFile&&outputFile.exists) + ' len: ' + String(outputFile&&outputFile.length));
          dbg9.close();
        } catch(_){ }
        
        if (outputFile && outputFile.exists && outputFile.length > 0) { 
          try { aif.remove(); } catch(_){ } 
          return _respond({ ok:true, path: outputFile.fsName, note:'server convert mp3' }); 
        }
      } catch(e){ 
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg6 = new File(debugLogPath);
          dbg6.open('a');
          dbg6.writeln('[' + new Date().toString() + '] node mp3 convert error: ' + String(e));
          dbg6.close();
        } catch(_){ }
      }
    }
    
    if (want === 'wav' && aif && aif.exists && aif.length > 0) {
      try {
        var outputFile = new File(outDir + '/sync_inout_audio_' + (new Date().getTime()) + '.wav');
        var extPath = _extensionRoot();
        var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
        
        // Use server-side WAV conversion via HTTP request (same as MP3)
        var url = 'http://127.0.0.1:3000/audio/convert?format=wav&srcPath=' + encodeURIComponent(aif.fsName);
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg3 = new File(debugLogPath);
          dbg3.open('a');
          dbg3.writeln('[' + new Date().toString() + '] calling server for wav: ' + String(url));
          dbg3.close();
        } catch(_){ }
        
        // Use curl to call the server and get JSON response
        var cmd = '';
        if (isWindows) {
          // Use curl instead of PowerShell to avoid Defender issues
          cmd = 'cmd.exe /c curl -s "' + url + '"';
        } else {
          cmd = 'curl -s "' + url + '"';
        }
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg4 = new File(debugLogPath);
          dbg4.open('a');
          dbg4.writeln('[' + new Date().toString() + '] curl wav cmd: ' + String(cmd));
          dbg4.close();
        } catch(_){ }
        
        var result = system.callSystem(cmd);
        
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg5 = new File(debugLogPath);
          dbg5.open('a');
          dbg5.writeln('[' + new Date().toString() + '] curl wav result: ' + String(result));
          dbg5.close();
        } catch(_){ }
        
        // Parse JSON response to get the WAV file path
        var wavPath = '';
        try {
          var jsonResponse = JSON.parse(result);
          if (jsonResponse && jsonResponse.ok && jsonResponse.path) {
            wavPath = jsonResponse.path;
          }
        } catch(e) {
          try {
            var debugLogPath = _syncDebugLogPath();
            var dbg6 = new File(debugLogPath);
            dbg6.open('a');
            dbg6.writeln('[' + new Date().toString() + '] JSON parse error: ' + String(e));
            dbg6.close();
          } catch(_){ }
        }
        
        // Copy the WAV file from server path to our output path
        if (wavPath && wavPath.length > 0) {
          try {
            var serverWavFile = new File(wavPath);
            if (serverWavFile && serverWavFile.exists) {
              serverWavFile.copy(outputFile);
              try {
                var debugLogPath = _syncDebugLogPath();
                var dbg7 = new File(debugLogPath);
                dbg7.open('a');
                dbg7.writeln('[' + new Date().toString() + '] copied wav from server: ' + String(wavPath) + ' to: ' + String(outputFile.fsName));
                dbg7.close();
              } catch(_){ }
            }
          } catch(e) {
            try {
              var debugLogPath = _syncDebugLogPath();
              var dbg8 = new File(debugLogPath);
              dbg8.open('a');
              dbg8.writeln('[' + new Date().toString() + '] copy wav error: ' + String(e));
              dbg8.close();
            } catch(_){ }
          }
        }
        
        // Wait for file to be created
        var waited = 0;
        while (waited < 10000) {
          try { if (outputFile && outputFile.exists && outputFile.length > 0) break; } catch(_){ }
          $.sleep(200);
          waited += 200;
        }
        
        // Check if WAV file was successfully copied
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg9 = new File(debugLogPath);
          dbg9.open('a');
          dbg9.writeln('[' + new Date().toString() + '] wav output exists: ' + String(outputFile&&outputFile.exists) + ' len: ' + String(outputFile&&outputFile.length));
          dbg9.close();
        } catch(_){ }
        
        if (outputFile && outputFile.exists && outputFile.length > 0) { 
          try { aif.remove(); } catch(_){ } 
          return _respond({ ok:true, path: outputFile.fsName, note:'server convert wav' }); 
        }
      } catch(e){ 
        try {
          var debugLogPath = _syncDebugLogPath();
          var dbg6 = new File(debugLogPath);
          dbg6.open('a');
          dbg6.writeln('[' + new Date().toString() + '] node wav convert error: ' + String(e));
          dbg6.close();
        } catch(_){ }
      }
    }
    
    // Fallback: return AIFF directly
    // Convert AIFF to MP3 using server endpoint
    var want = String(p.format||'mp3').toLowerCase();
    
    if (want === 'mp3' && aif && aif.exists && aif.length > 0) {
      try {
        var outputFile = new File(outDir + '/sync_inout_audio_' + (new Date().getTime()) + '.mp3');
        
        // Use server-side MP3 conversion via HTTP request
        var url = 'http://127.0.0.1:3000/audio/convert?format=mp3&srcPath=' + encodeURIComponent(aif.fsName);
        
        try {
          var dbg3 = _syncDebugLogFile();
          dbg3.open('a');
          dbg3.writeln('[' + new Date().toString() + '] calling server for mp3: ' + String(url));
          dbg3.close();
        } catch(_){ }
        
        // Use curl to call the server and get JSON response
        var cmd = '';
        var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
        if (isWindows) {
          // Use curl instead of PowerShell to avoid Defender issues
          cmd = 'cmd.exe /c curl -s "' + url + '"';
        } else {
          cmd = 'curl -s "' + url + '"';
        }
        
        try {
          var dbg4 = _syncDebugLogFile();
          dbg4.open('a');
          dbg4.writeln('[' + new Date().toString() + '] curl mp3 cmd: ' + String(cmd));
          dbg4.close();
        } catch(_){ }
        
        var result = system.callSystem(cmd);
        
        try {
          var dbg5 = _syncDebugLogFile();
          dbg5.open('a');
          dbg5.writeln('[' + new Date().toString() + '] curl mp3 result: ' + String(result));
          dbg5.close();
        } catch(_){ }
        
        // Parse JSON response to get the MP3 file path
        var mp3Path = '';
        try {
          var jsonResponse = JSON.parse(result);
          if (jsonResponse && jsonResponse.ok && jsonResponse.path) {
            mp3Path = jsonResponse.path;
          }
        } catch(e) {
          try {
            var dbg6 = _syncDebugLogFile();
            dbg6.open('a');
            dbg6.writeln('[' + new Date().toString() + '] JSON parse error: ' + String(e));
            dbg6.close();
          } catch(_){ }
        }
        
        // Copy the MP3 file from server path to our output path
        if (mp3Path && mp3Path.length > 0) {
          try {
            var serverMp3File = new File(mp3Path);
            if (serverMp3File && serverMp3File.exists) {
              serverMp3File.copy(outputFile);
              try {
                var dbg7 = _syncDebugLogFile();
                dbg7.open('a');
                dbg7.writeln('[' + new Date().toString() + '] copied mp3 from server: ' + String(mp3Path) + ' to: ' + String(outputFile.fsName));
                dbg7.close();
              } catch(_){ }
            }
          } catch(e) {
            try {
              var dbg8 = _syncDebugLogFile();
              dbg8.open('a');
              dbg8.writeln('[' + new Date().toString() + '] copy mp3 error: ' + String(e));
              dbg8.close();
            } catch(_){ }
          }
        }
        
        // Wait for file to be created
        var waited = 0;
        while (waited < 10000) {
          try { if (outputFile && outputFile.exists && outputFile.length > 0) break; } catch(_){ }
          $.sleep(200);
          waited += 200;
        }
        
        // Check if MP3 file was successfully copied
        try {
          var dbg9 = _syncDebugLogFile();
          dbg9.open('a');
          dbg9.writeln('[' + new Date().toString() + '] mp3 output exists: ' + String(outputFile&&outputFile.exists) + ' len: ' + String(outputFile&&outputFile.length));
          dbg9.close();
        } catch(_){ }
        
        if (outputFile && outputFile.exists && outputFile.length > 0) { 
          try { aif.remove(); } catch(_){ } 
          return _respond({ ok:true, path: outputFile.fsName, note:'server convert mp3' }); 
        }
      } catch(e){ 
        try {
          var dbg6 = _syncDebugLogFile();
          dbg6.open('a');
          dbg6.writeln('[' + new Date().toString() + '] node mp3 convert error: ' + String(e));
          dbg6.close();
        } catch(_){ }
      }
    }
    
    // Fallback to AIFF if MP3 conversion failed
    try {
      var debugLogPath = _syncDebugLogPath();
      var dbg6 = new File(debugLogPath);
      dbg6.open('a');
      dbg6.writeln('[' + new Date().toString() + '] returning AIFF path to UI: ' + String(aif && aif.fsName) + ' len=' + String(aif && aif.length));
      dbg6.close();
    } catch(_){ }
    return _respond({ ok:true, path: aif.fsName, note:'aiff direct' });
  } catch (e) {
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutAudio error: " + String(e));
      logFile.close();
    } catch(_){ }
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_insertAtPlayhead(jobId) {
  try {
    var extPath = _extensionRoot();
    var outputPath = SYNC_getUploadsDir() + "/" + jobId + "_output.mp4";
    var outputFile = new File(outputPath);
    
    // Log to temp file for debugging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_insertAtPlayhead called with jobId: " + jobId);
      logFile.writeln("[" + new Date().toString() + "] Output path: " + outputPath);
      logFile.writeln("[" + new Date().toString() + "] File exists: " + outputFile.exists);
      logFile.close();
    } catch(e) {}
    
    if (!outputFile.exists) {
      return _respond({ ok: false, error: "Output file not found: " + outputPath });
    }
    
    // Use the same robust approach as the working version
    _waitForFileReady(outputFile, 20000);
    try {
      app.beginUndoGroup('sync. import');
      
      // Find existing or import the file with ImportOptions
      var imported = null;
      try {
        var items = app.project.items; 
        var n = items ? items.length : 0;
        for (var i=1;i<=n;i++){
          var it = items[i];
          try { 
            if (it && it instanceof FootageItem && it.file && it.file.fsName === outputFile.fsName) { 
              imported = it; 
              break; 
            } 
          } catch(_){ }
        }
      } catch(_){ }
      
      if (!imported) {
        var io = new ImportOptions(outputFile);
        try { 
          if (io && io.canImportAs && io.canImportAs(ImportAsType.FOOTAGE)) { 
            io.importAs = ImportAsType.FOOTAGE; 
          } 
        } catch(_){ }
        imported = (app.project && app.project.importFile) ? app.project.importFile(io) : null;
      }
      
      if (!imported) { 
        try { app.endUndoGroup(); } catch(_){} 
        return _respond({ ok: false, error: 'Import failed' }); 
      }
      
      // Ensure/locate "sync. outputs" folder in project bin and move item there
      var outputsFolder = null;
      try {
        var items = app.project.items;
        var n = items ? items.length : 0;
        for (var i = 1; i <= n; i++) {
          var it = items[i];
          if (it && (it instanceof FolderItem) && String(it.name) === 'sync. outputs') { 
            outputsFolder = it; 
            break; 
          }
        }
        if (!outputsFolder) { 
          outputsFolder = app.project.items.addFolder('sync. outputs'); 
        }
      } catch(_){ }
      
      try { 
        if (outputsFolder && imported && imported.parentFolder !== outputsFolder) { 
          imported.parentFolder = outputsFolder; 
        } 
      } catch(_){ }
      
      // Insert as a new layer in the active comp at playhead
      var comp = app.project.activeItem;
      if (!comp || !(comp instanceof CompItem)) { 
        try { app.endUndoGroup(); } catch(_){ } 
        return _respond({ ok:false, error:'No active composition' }); 
      }
      
      var before = 0; 
      try { before = comp.layers ? comp.layers.length : 0; } catch(_){ }
      var layer = null;
      try { layer = comp.layers.add(imported); } catch(eAdd) { layer = null; }
      
      if (!layer) { 
        try { app.endUndoGroup(); } catch(_){ } 
        return _respond({ ok:false, error:'Layer add failed' }); 
      }
      
      try { layer.startTime = comp.time; } catch(_){ }
      var after = 0; 
      try { after = comp.layers ? comp.layers.length : 0; } catch(_){ }
      try { app.endUndoGroup(); } catch(_){ }
      
      if (after > before) { 
        return _respond({ ok:true, mode:'insert', layerName: (layer && layer.name) || '' }); 
      }
      return _respond({ ok:false, error:'Insert verification failed' });
      
    } catch (e) {
      try { app.endUndoGroup(); } catch (_) {}
      return _respond({ ok: false, error: String(e) });
    }
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_insertFileAtPlayhead(payloadOrJson) {
  try {
    var p = {};
    var path = '';
    try {
      if (payloadOrJson && typeof payloadOrJson === 'string' && (payloadOrJson.charAt(0) === '{' || payloadOrJson.charAt(0) === '"')) {
        p = JSON.parse(payloadOrJson || '{}');
        path = String(p.path || '');
      }
    } catch (_) { }
    if (!path) { path = String(payloadOrJson || ''); }
    if (!path) return _respond({ ok: false, error: 'No path' });
    var f = new File(path);
    
    // Log to temp file for debugging
    try {
      var logFile = _syncDebugLogFile();
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_insertFileAtPlayhead called");
      logFile.writeln("[" + new Date().toString() + "] Payload: " + String(payloadOrJson));
      logFile.writeln("[" + new Date().toString() + "] Parsed path: " + path);
      logFile.writeln("[" + new Date().toString() + "] File exists: " + f.exists);
      logFile.close();
    } catch(e) {}
    
    if (!f.exists) return _respond({ ok: false, error: 'File not found' });
    // Ensure file is fully written
    _waitForFileReady(f, 20000);
    try {
      app.beginUndoGroup('sync. import');
      // Find existing or import the file with ImportOptions
      var imported = null;
      try {
        var items = app.project.items; var n = items ? items.length : 0;
        for (var i=1;i<=n;i++){
          var it = items[i];
          try { if (it && it instanceof FootageItem && it.file && it.file.fsName === f.fsName) { imported = it; break; } } catch(_){ }
        }
      } catch(_){ }
      if (!imported) {
        var io = new ImportOptions(f);
        try { if (io && io.canImportAs && io.canImportAs(ImportAsType.FOOTAGE)) { io.importAs = ImportAsType.FOOTAGE; } } catch(_){ }
        imported = (app.project && app.project.importFile) ? app.project.importFile(io) : null;
      }
      if (!imported) { try { app.endUndoGroup(); } catch(_){} return _respond({ ok: false, error: 'Import failed' }); }
      // Ensure/locate "sync. outputs" folder in project bin and move item there
      var outputsFolder = null;
      try {
        var items = app.project.items;
        var n = items ? items.length : 0;
        for (var i = 1; i <= n; i++) {
          var it = items[i];
          if (it && (it instanceof FolderItem) && String(it.name) === 'sync. outputs') { outputsFolder = it; break; }
        }
        if (!outputsFolder) { outputsFolder = app.project.items.addFolder('sync. outputs'); }
      } catch(_){ }
      try { if (outputsFolder && imported && imported.parentFolder !== outputsFolder) { imported.parentFolder = outputsFolder; } } catch(_){ }
      // Insert as a new layer in the active comp at playhead (robust)
      var comp = app.project.activeItem;
      if (!comp || !(comp instanceof CompItem)) { try { app.endUndoGroup(); } catch(_){ } return _respond({ ok:false, error:'No active composition' }); }
      var before = 0; try { before = comp.layers ? comp.layers.length : 0; } catch(_){ }
      var layer = null;
      try { layer = comp.layers.add(imported); } catch(eAdd) { layer = null; }
      if (!layer) { try { app.endUndoGroup(); } catch(_){ } return _respond({ ok:false, error:'Layer add failed' }); }
      try { layer.startTime = comp.time; } catch(_){ }
      var after = 0; try { after = comp.layers ? comp.layers.length : 0; } catch(_){ }
      try { app.endUndoGroup(); } catch(_){ }
      if (after > before) { return _respond({ ok:true, mode:'insert', layerName: (layer && layer.name) || '' }); }
      return _respond({ ok:false, error:'Insert verification failed' });
    } catch (e) {
      try { app.endUndoGroup(); } catch (_) {}
      return _respond({ ok: false, error: String(e) });
    }
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_importFileToBin(payloadOrJson) {
  try {
    _hostLog('AEFT_importFileToBin: START with payload=' + String(payloadOrJson));
    
    // Guard: Check if app and project exist
    if (!app || !app.project) {
      _hostLog('AEFT_importFileToBin: No project open');
      return _respond({ ok:false, error:'No project open' });
    }
    if (!app.project.items) {
      _hostLog('AEFT_importFileToBin: No project items');
      return _respond({ ok:false, error:'No project items' });
    }
    
    // Normalize inputs
    var p = {}; var path = ''; var binName = 'sync. outputs';
    try {
      if (payloadOrJson && typeof payloadOrJson === 'string' && (payloadOrJson.charAt(0) === '{' || payloadOrJson.charAt(0) === '"')) {
        p = JSON.parse(payloadOrJson || '{}');
        path = String(p.path || '');
        if (p && p.binName) { binName = String(p.binName); }
      }
    } catch (_){ }
    if (!path) { path = String(payloadOrJson || ''); }
    if (!path) {
      _hostLog('AEFT_importFileToBin: No path provided');
      return _respond({ ok:false, error:'No path' });
    }

    var f = new File(path);
    if (!f.exists) {
      _hostLog('AEFT_importFileToBin: File not found at ' + path);
      return _respond({ ok:false, error:'File not found' });
    }
    _hostLog('AEFT_importFileToBin: File exists at ' + f.fsName);

    // Wait for file to be ready
    _waitForFileReady(f, 20000);
    
    // Extended file readiness check
    var extendedWait = 0;
    while (extendedWait < 2000) {
      try {
        if (f.exists && f.length > 0) break;
      } catch(_) { }
      $.sleep(200);
      extendedWait += 200;
    }
    
    if (!f.exists) {
      _hostLog('AEFT_importFileToBin: File disappeared after wait');
      return _respond({ ok:false, error:'File disappeared after wait' });
    }
    
    try {
      app.beginUndoGroup('sync. import');
      var imported = null;
      var reusedExisting = false;
      
      // Check if file is already imported
      try {
        var items = app.project.items; 
        var n = items ? items.length : 0;
        for (var i=1;i<=n;i++){
          var it = items[i];
          try { 
            if (it && it instanceof FootageItem && it.file && it.file.fsName === f.fsName) { 
              imported = it; 
              reusedExisting = true;
              _hostLog('AEFT_importFileToBin: Reused existing item: ' + it.name);
              break; 
            } 
          } catch(_){ }
        }
      } catch(_){ }
      
      // Import if not already in project
      if (!imported) {
        _hostLog('AEFT_importFileToBin: Attempting import for ' + f.fsName);
        // Try ImportOptions method first
        try {
          var io = new ImportOptions(f);
          try { 
            if (io && io.canImportAs && io.canImportAs(ImportAsType.FOOTAGE)) { 
              io.importAs = ImportAsType.FOOTAGE; 
            } 
          } catch(_){ }
          imported = app.project.importFile(io);
          _hostLog('AEFT_importFileToBin: importFile returned ' + (imported ? 'item' : 'null'));
        } catch(importErr) {
          _hostLog('AEFT_importFileToBin: importFile error: ' + String(importErr));
          imported = null;
        }
        
        // Fallback: try importFiles method if importFile returned null or failed
        if (!imported) {
          _hostLog('AEFT_importFileToBin: Trying importFiles fallback');
          try {
            var itemsBefore = app.project.items ? app.project.items.length : 0;
            app.project.importFiles([f.fsName], false, false, false);
            _hostLog('AEFT_importFileToBin: importFiles completed, searching for item');
            $.sleep(200);
            
            var items3 = app.project.items;
            var n3 = items3 ? items3.length : 0;
            for (var k=1; k<=n3; k++) {
              var it3 = items3[k];
              try {
                if (it3 && it3 instanceof FootageItem && it3.file && it3.file.fsName === f.fsName) {
                  imported = it3;
                  _hostLog('AEFT_importFileToBin: Found imported item by path: ' + it3.name);
                  break;
                }
              } catch(_) { }
            }
            
            if (!imported && n3 > itemsBefore) {
              _hostLog('AEFT_importFileToBin: Searching for newest item');
              for (var m=n3; m>itemsBefore; m--) {
                var newItem = items3[m];
                try {
                  if (newItem && newItem instanceof FootageItem) {
                    imported = newItem;
                    _hostLog('AEFT_importFileToBin: Found new item: ' + newItem.name);
                    break;
                  }
                } catch(_) { }
              }
            }
            
            if (!imported) {
              _hostLog('AEFT_importFileToBin: Could not find imported item after importFiles');
            }
          } catch(importFilesErr) {
            _hostLog('AEFT_importFileToBin: importFiles error: ' + String(importFilesErr));
            imported = null;
          }
        }
      }
      
      if (!imported) { 
        try { app.endUndoGroup(); } catch(_){ } 
        _hostLog('AEFT_importFileToBin: Import failed - both methods');
        return _respond({ ok:false, error:'Import failed' }); 
      }
      
      // Find or create target bin
      var target = null;
      try {
        var items2 = app.project.items; 
        var n2 = items2 ? items2.length : 0;
        for (var j=1;j<=n2;j++){
          var it2 = items2[j];
          if (it2 && (it2 instanceof FolderItem) && String(it2.name) === binName) { 
            target = it2; 
            _hostLog('AEFT_importFileToBin: Found existing bin: ' + binName);
            break; 
          }
        }
        if (!target) { 
          target = app.project.items.addFolder(binName);
          _hostLog('AEFT_importFileToBin: Created new bin: ' + binName);
        }
      } catch(binErr){ 
        _hostLog('AEFT_importFileToBin: Bin error: ' + String(binErr));
        target = null;
      }
      
      // Always reassign parent folder, even if it appears equal, and verify move
      var moved = false;
      if (target && imported) {
        _hostLog('AEFT_importFileToBin: Attempting to move ' + imported.name + ' to ' + target.name);
        for (var mv=0; mv<10; mv++) {
          try { 
            imported.parentFolder = target;
            _hostLog('AEFT_importFileToBin: Set parentFolder on attempt ' + (mv+1));
          } catch(moveErr){ 
            _hostLog('AEFT_importFileToBin: Move error on attempt ' + (mv+1) + ': ' + String(moveErr));
          }
          $.sleep(100);
          try { 
            if (imported && imported.parentFolder === target) { 
              moved = true;
              _hostLog('AEFT_importFileToBin: Move verified on attempt ' + (mv+1));
              break; 
            } 
          } catch(_){ }
        }
        if (!moved) {
          _hostLog('AEFT_importFileToBin: Failed to verify move after 10 attempts');
        }
      }
      
      try { app.endUndoGroup(); } catch(_){ }
      
      // Return detailed success info
      var result = { 
        ok: true, 
        imported: true, 
        reused: reusedExisting,
        binName: binName,
        itemName: (imported && imported.name) || '',
        moved: moved
      };
      _hostLog('AEFT_importFileToBin: SUCCESS - ' + JSON.stringify(result));
      return _respond(result);
      
    } catch (e) {
      try { app.endUndoGroup(); } catch (_) {}
      _hostLog('AEFT_importFileToBin: Exception - ' + String(e));
      return _respond({ ok: false, error: String(e) });
    }
  } catch (e) {
    _hostLog('AEFT_importFileToBin: Outer exception - ' + String(e));
    return _respond({ ok: false, error: String(e) });
  }
}


function AEFT_revealFile(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    var path = String(p.path || p || '');
    if (!path) return _respond({ ok:false, error:'No path' });
    var f = new File(path);
    if (!f || !f.exists) return _respond({ ok:false, error:'File not found' });
    // macOS: reveal in Finder
    try {
      var esc = String(f.fsName||'').replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/"/g, "\\\"");
      var cmd = "/usr/bin/osascript -e 'tell application " + '"Finder"' + " to reveal POSIX file \"" + esc + "\"' -e 'tell application " + '"Finder"' + " to activate'";
      system.callSystem(cmd);
      return _respond({ ok:true });
    } catch(e) {
      return _respond({ ok:false, error:String(e) });
    }
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function AEFT_startBackend() {
  try {
    var isWindows = false; 
    try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }

    // Check if server is already running
    try {
      var url = "http://127.0.0.1:3000/health";
      var cmd;
      if (isWindows) {
        cmd = 'cmd.exe /c curl -s -m 1 "' + url + '" >NUL 2>&1';
      } else {
        cmd = "/bin/bash -lc 'curl -s -m 1 \"" + url + "\" >/dev/null 2>&1'";
      }
      var result = system.callSystem(cmd);
      // If curl succeeds, server is already running
      if (result === 0) {
        return _respond({ ok: true, message: "Backend already running on port 3000" });
      }
    } catch(e) {}

    // Server not running, but auto-start is handled by ui/nle.js
    // This function just confirms the status
    return _respond({ ok: true, message: "Backend auto-start handled by UI" });
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_stopBackend() {
  try {
    var isWindows = false; 
    try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }

    if (isWindows) {
      // Windows: kill processes on port 3000
      try {
        system.callSystem('cmd.exe /c "for /f \"tokens=5\" %a in (\'netstat -aon ^| findstr :3000\') do taskkill /f /pid %a"');
      } catch(e) {}
    } else {
      // macOS: kill processes on port 3000
      try {
        system.callSystem("/bin/bash -lc 'lsof -tiTCP:3000 | xargs -r kill -9 || true'");
      } catch(e) {}
    }
    
    return _respond({ ok: true, message: "Backend stopped" });
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

