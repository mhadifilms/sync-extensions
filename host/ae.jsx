function _respond(data) {
  try { return JSON.stringify(data); } catch (e) { return String(data); }
}

function _hostLog(msg){
  try{
    var s = String(msg||'');
    var timestamp = new Date().toISOString();
    var logLine = '[' + timestamp + '] ' + s + '\n';
    
    // Write to temp file for debugging
    try {
      var logFile = new File(Folder.temp.fsName + '/sync_ae_debug.log');
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

function _extensionRoot() {
  try {
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
    var userHome = Folder.userDocuments.parent.fsName;
    var fallback = userHome + "/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel";
    return fallback;
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
    // Prefer extension-local temp directory
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

// Locate ffmpeg if available (Homebrew or system paths)
function _ffmpegPath(){
  function exists(p){ try { return new File(p).exists; } catch(e){ return false; } }
  var candidates = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg'
  ];
  for (var i=0;i<candidates.length;i++){ if (exists(candidates[i])) return candidates[i]; }
  try{ var out = system.callSystem("/bin/bash -lc " + _shq('command -v ffmpeg || true')); if (out){ var p = String(out).replace(/\r|\n/g,''); if (exists(p)) return p; } }catch(e){}
  return '';
}

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
    try { info.ffmpeg = _ffmpegPath() ? true : false; } catch(_){ info.ffmpeg = false; }
    return _respond(info);
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_showFileDialog(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    var kind = String(p.kind || 'video');
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
    } catch(_){ }
    if (file && file.exists) { return _respond({ ok:true, path: file.fsName }); }
    return _respond({ ok:false, error:'No file selected' });
  } catch (e) { return _respond({ ok:false, error:String(e) }); }
}

function AEFT_exportInOutVideo(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    
    // Log to temp file for debugging
    try {
      var logFile = new File("/tmp/sync_ae_debug.log");
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutVideo called");
      logFile.writeln("[" + new Date().toString() + "] Payload: " + String(payloadJson));
      logFile.close();
    } catch(e) {}
    
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
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
      var mp4 = new File(Folder.temp.fsName + '/sync_inout_' + (new Date().getTime()) + '.mp4');
      try { om.file = mp4; } catch(_){ }
      try { rq.render(); } catch (eRender) { return _respond({ ok:false, error:'Render failed: '+String(eRender) }); }
      var waited=0; while(waited<180000){ try{ if(mp4 && mp4.exists) break; }catch(_){ } $.sleep(200); waited+=200; }
      if (!mp4 || !mp4.exists) return _respond({ ok:false, error:'Render timeout' });
      return _respond({ ok:true, path: mp4.fsName, note: 'AE H.264 direct' });
    }

    // Otherwise render ProRes 4444 (High Quality with Alpha) and transcode via ffmpeg to requested ProRes flavor
    var appliedHQ = '';
    try { om.applyTemplate('High Quality with Alpha'); appliedHQ = 'High Quality with Alpha'; } catch(_){ }
    if (!appliedHQ) { try { om.applyTemplate('Lossless'); appliedHQ = 'Lossless'; } catch(_){ } }
    var srcMov = new File(Folder.temp.fsName + '/sync_inout_src_' + (new Date().getTime()) + '.mov');
    try { om.file = srcMov; } catch(_){ }
    try { rq.render(); } catch (eRender2) { return _respond({ ok:false, error:'Render failed: '+String(eRender2) }); }
    var waited2=0; while(waited2<180000){ try{ if(srcMov && srcMov.exists) break; }catch(_){ } $.sleep(200); waited2+=200; }
    if (!srcMov || !srcMov.exists) return _respond({ ok:false, error:'Render timeout (src)' });

    var ff = _ffmpegPath();
    var dest = new File(Folder.temp.fsName + '/sync_inout_' + (new Date().getTime()) + '.mov');
    var profile = 2; // default ProRes 422
    if (want === 'prores_422_proxy') profile = 0;
    else if (want === 'prores_422_lt') profile = 1;
    else if (want === 'prores_422') profile = 2;
    else if (want === 'prores_422_hq') profile = 3;

    if (ff){
      var cmd = "/bin/bash -lc " + _shq((_shq(ff).slice(1,-1)) + " -y -loglevel error -i " + _shq(srcMov.fsName) + " -c:v prores_ks -profile:v " + profile + " -pix_fmt yuv422p10le -c:a copy " + _shq(dest.fsName));
      var out = system.callSystem(cmd);
      // Verify output
      try { if (dest && dest.exists) { try{ srcMov.remove(); }catch(_){ } return _respond({ ok:true, path: dest.fsName, note:'ffmpeg transcode prores profile '+profile }); } } catch(_){ }
      // Fallback: return source
      return _respond({ ok:true, path: srcMov.fsName, note:'ffmpeg failed; returning source' });
    } else {
      // ffmpeg missing, return source HQ file
      return _respond({ ok:true, path: srcMov.fsName, note:'ffmpeg missing; returning source' });
    }
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_exportInOutAudio(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    
    // Log to temp file for debugging
    try {
      var logFile = new File("/tmp/sync_ae_debug.log");
      logFile.open("a");
      logFile.writeln("[" + new Date().toString() + "] AEFT_exportInOutAudio called");
      logFile.writeln("[" + new Date().toString() + "] Payload: " + String(payloadJson));
      logFile.close();
    } catch(e) {}
    
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return _respond({ ok: false, error: 'No active composition' });
    }

    var rq = app.project.renderQueue;
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

    try { rq.render(); } catch (eRender) { return _respond({ ok:false, error:'Render failed: '+String(eRender) }); }
    var waited=0; while(waited<180000){ try{ if(aif && aif.exists) break; }catch(_){ } $.sleep(200); waited+=200; }
    if (!aif || !aif.exists) return _respond({ ok:false, error:'Render timeout (audio)' });

    var want = String(p.format||'wav').toLowerCase();
    var ff = _ffmpegPath();
    if (!ff){
      // ffmpeg not found: return AIFF directly
      return _respond({ ok:true, path: aif.fsName, note:'ffmpeg missing; returning AIFF' });
    }

    var outPath = new File(outDir + '/sync_inout_audio_' + (new Date().getTime()) + (want==='mp3'?'.mp3':'.wav'));
    var cmd = '';
    if (want === 'mp3') {
      cmd = "/bin/bash -lc " + _shq((_shq(ff).slice(1,-1)) + " -y -loglevel error -i " + _shq(aif.fsName) + " -codec:a libmp3lame -b:a 320k " + _shq(outPath.fsName));
    } else {
      cmd = "/bin/bash -lc " + _shq((_shq(ff).slice(1,-1)) + " -y -loglevel error -i " + _shq(aif.fsName) + " -c:a pcm_s16le " + _shq(outPath.fsName));
    }
    var out = system.callSystem(cmd);
    try { if (outPath && outPath.exists) { try{ aif.remove(); }catch(_){ } return _respond({ ok:true, path: outPath.fsName, note:'ffmpeg audio transcode '+want }); } } catch(_){ }
    return _respond({ ok:true, path: aif.fsName, note:'ffmpeg failed; returning AIFF' });
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_insertAtPlayhead(jobId) {
  try {
    var extPath = _extensionRoot();
    var outputPath = extPath + "/outputs/" + jobId + "_output.mp4";
    var outputFile = new File(outputPath);
    
    // Log to temp file for debugging
    try {
      var logFile = new File("/tmp/sync_ae_debug.log");
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
      var logFile = new File("/tmp/sync_ae_debug.log");
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

