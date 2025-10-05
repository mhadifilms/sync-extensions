function _respond(data) {
  try { return JSON.stringify(data); } catch (e) { return String(data); }
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

function AEFT_startBackend() {
  try {
    var extPath = _extensionRoot();
    if (!extPath) return _respond({ ok: false, error: 'No extension root' });

    // Kill any existing server processes
    try {
      system.callSystem("/bin/bash -lc " + _shq("pkill -f \"/server/src/server.js\" || true; lsof -tiTCP:3000 | xargs -r kill -9 || true; sleep 0.5"));
    } catch (e) {}

    // Resolve node path (macOS typical locations)
    function exists(p) { try { return new File(p).exists; } catch (e) { return false; } }
    var candidates = [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      "/usr/local/opt/node/bin/node"
    ];
    var nodePath = null;
    for (var i = 0; i < candidates.length; i++) { if (exists(candidates[i])) { nodePath = candidates[i]; break; } }
    if (!nodePath) {
      var whichOut = system.callSystem("/bin/bash -lc 'command -v node'");
      if (whichOut) {
        var guess = String(whichOut).replace(/\n/g, '').replace(/\r/g, '');
        if (exists(guess)) { nodePath = guess; }
      }
    }
    if (!nodePath) { return _respond({ ok: false, error: 'Node not found' }); }

    // Launch server
    var bash = "cd " + _shq(extPath + "/server") + " && nohup " + _shq(nodePath) + " " + _shq(extPath + "/server/src/server.js") + " > /tmp/sync_extension_server.log 2>&1 & echo OK";
    var launchCmd = "/bin/bash -lc " + _shq(bash);
    var out = system.callSystem(launchCmd);
    return _respond({ ok: true, message: 'launched', details: out });
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

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
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return _respond({ ok: false, error: 'No active composition' });
    }

    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    try { item.applyTemplate('Best Settings'); } catch(_){ }
    try { item.timeSpanStart = comp.workAreaStart; } catch(_){ }
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
    var comp = (app && app.project) ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      return _respond({ ok: false, error: 'No active composition' });
    }

    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    try { item.applyTemplate('Best Settings'); } catch(_){ }
    try { item.timeSpanStart = comp.workAreaStart; } catch(_){ }
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

function AEFT_insertFileAtPlayhead(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    var path = String(p.path || '');
    if (!path) return _respond({ ok: false, error: 'No path' });
    var f = new File(path);
    if (!f.exists) return _respond({ ok: false, error: 'File not found' });
    try {
      app.beginUndoGroup('sync. import');
      var imported = app.project && app.project.importFile ? app.project.importFile(new ImportOptions(f)) : null;
      app.endUndoGroup();
      if (imported) return _respond({ ok: true, mode: 'import' });
      return _respond({ ok: false, error: 'Import failed' });
    } catch (e) {
      try { app.endUndoGroup(); } catch (_) {}
      return _respond({ ok: false, error: String(e) });
    }
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function AEFT_importFileToBin(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson || '{}'); } catch (e) {}
    var path = String(p.path || '');
    if (!path) return _respond({ ok: false, error: 'No path' });
    var f = new File(path);
    if (!f.exists) return _respond({ ok: false, error: 'File not found' });
    try {
      app.beginUndoGroup('sync. import');
      var imported = app.project && app.project.importFile ? app.project.importFile(new ImportOptions(f)) : null;
      app.endUndoGroup();
      if (imported) return _respond({ ok: true });
      return _respond({ ok: false, error: 'Import failed' });
    } catch (e) {
      try { app.endUndoGroup(); } catch (_) {}
      return _respond({ ok: false, error: String(e) });
    }
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}


