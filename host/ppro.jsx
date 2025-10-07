function PPRO_startBackend() {
  try {
    var extPath = _extensionRoot();
    var serverPath = extPath + "/server/src/server.js";
    var serverFile = new File(serverPath);
    if (!serverFile.exists) {
      return _respond({ ok: false, error: "Server file not found: " + serverPath });
    }

    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }

    // Kill any existing server processes to ensure we run updated code (macOS only)
    if (!isWindows) {
      try {
        system.callSystem("/bin/bash -lc 'pkill -f \"/server/src/server.js\" || true; lsof -tiTCP:3000 | xargs -r kill -9 || true; sleep 0.5'");
      } catch(e) {}
    }

    // Resolve node path robustly per-OS
    var nodePath = null;
    if (isWindows) {
      try {
        var whereOut = system.callSystem('cmd.exe /c where node');
        if (whereOut) {
          var lines = String(whereOut).replace(/\r/g,'').split("\n");
          for (var wi=0; wi<lines.length; wi++) {
            var cand = lines[wi] && lines[wi].trim();
            if (cand && new File(cand).exists) { nodePath = cand; break; }
          }
        }
      } catch(_){}
      if (!nodePath) { return _respond({ ok:false, error:'Node not found (Windows)' }); }
    } else {
      function fileExists(p) { try { return new File(p).exists; } catch(e) { return false; } }
      var candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/usr/local/opt/node/bin/node"
      ];
      for (var i=0;i<candidates.length;i++) { if (fileExists(candidates[i])) { nodePath = candidates[i]; break; } }
      if (!nodePath) {
        var whichOut = system.callSystem("/bin/bash -lc 'command -v node'");
        if (whichOut) {
          var guess = whichOut.replace(/\n/g, '').replace(/\r/g, '');
          if (fileExists(guess)) { nodePath = guess; }
        }
      }
      if (!nodePath) {
        return _respond({ ok: false, error: "Node not found in common paths" });
      }
    }

    if (isWindows) {
      // Launch server detached on Windows
      var srvDirWin = extPath + "\\server";
      var cmd = 'cmd.exe /c start "sync-extension-server" /b cmd /c "cd /d ' + srvDirWin.replace(/"/g,'\"') + ' && ' + nodePath.replace(/"/g,'\"') + ' src\\server.js > NUL 2>&1"';
      var outW = system.callSystem(cmd);
      return _respond({ ok:true, message:'launched', details: outW });
    } else {
      // Launch server in background with nohup (safely quoted)
      var cdPath = _shq(extPath + "/server");
      var nodeQ = _shq(nodePath);
      var serverQ = _shq(serverPath);
      var bash = "cd " + cdPath + " && nohup " + nodeQ + " " + serverQ + " > /tmp/sync_extension_server.log 2>&1 & echo OK";
      var launchCmd = "/bin/bash -lc " + _shq(bash);
      var out = system.callSystem(launchCmd);
      return _respond({ ok: true, message: "launched", details: out });
    }
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

var __showDialogBusy = false;

// Minimal JSON polyfill for ExtendScript environments lacking JSON
try {
  if (typeof JSON === 'undefined') { JSON = {}; }
  if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function(value){
      function escStr(s){ return String(s).replace(/[\\\"\n\r\t\b\f]/g, function(ch){
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
          if (!v.hasOwnProperty(k)) continue;
          props.push('"' + escStr(k) + '":' + ser(v[k]));
        }
        return '{' + props.join(',') + '}';
      }
      return ser(value);
    };
  }
  if (typeof JSON.parse !== 'function') {
    JSON.parse = function(text){
      // Unsafe but acceptable for trusted payload from our own UI
      return eval('(' + String(text) + ')');
    };
  }
} catch(e) { /* ignore */ }

function PPRO_showFileDialog(payloadJson) {
  try {
    if (__showDialogBusy) { try{ _hostLog('PPRO_showFileDialog busy'); }catch(_){} return _respond({ ok:false, error:'busy' }); }
    __showDialogBusy = true;
    _hostLog('PPRO_showFileDialog invoked');
    var p = {};
    try { p = JSON.parse(payloadJson); } catch(e) {}
    var kind = p.kind || 'video';
    var allow = (kind === 'audio')
      ? { wav:1, mp3:1, aac:1, aif:1, aiff:1, m4a:1 }
      : { mov:1, mp4:1, mxf:1, mkv:1, avi:1, m4v:1, mpg:1, mpeg:1 };

    var file = null;
    try {
      if ($.os && $.os.toString().indexOf('Windows') !== -1) {
        // Windows can honor filter strings
        var filterStr = (kind === 'audio')
          ? 'Audio files:*.wav;*.mp3;*.aac;*.aif;*.aiff;*.m4a'
          : 'Video files:*.mov;*.mp4;*.mxf;*.mkv;*.avi;*.m4v;*.mpg;*.mpeg';
        file = File.openDialog('Select ' + kind + ' file', filterStr);
      } else {
        // macOS: use function filter to hide non-matching files
        var fn = function(f){
          try {
            if (f instanceof Folder) return true;
            var n = (f && f.name) ? String(f.name).toLowerCase() : '';
            var i = n.lastIndexOf('.');
            if (i < 0) return false;
            var ext = n.substring(i+1);
            return allow[ext] === 1;
          } catch (e) { return true; }
        };
        file = File.openDialog('Select ' + kind + ' file', fn);
      }
    } catch (_) {}

    if (file && file.exists) {
      try {
        var n = String(file.name || '').toLowerCase();
        var i = n.lastIndexOf('.');
        var ext = (i >= 0) ? n.substring(i+1) : '';
        if (allow[ext] !== 1) { return _respond({ ok:false, error:'Invalid file type' }); }
      } catch(e) {}
      try { _hostLog('PPRO_showFileDialog selected: ' + file.fsName); } catch(_){ }
      return _respond({ ok: true, path: file.fsName });
    }
    try { _hostLog('PPRO_showFileDialog canceled'); } catch(_){ }
    return _respond({ ok: false, error: 'No file selected' });
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  } finally {
    __showDialogBusy = false;
  }
}

function _hostLog(msg){
  try{
    var s = String(msg||'');
    // Use curl to send JSON to local server; ignore output
    var payload = '{"msg": ' + JSON.stringify(s) + '}';
    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    if (isWindows) {
      var url = "http://127.0.0.1:3000/hostlog?msg=" + encodeURIComponent(s).replace(/\"/g,'\\"');
      var wcmd = 'cmd.exe /c curl -s -m 1 ' + '"' + url.replace(/"/g,'\\"') + '"' + ' >NUL 2>&1';
      system.callSystem(wcmd);
    } else {
      var cmd = "/bin/bash -lc " + _shq("(curl -s -m 1 -X POST -H 'Content-Type: application/json' --data " + _shq(payload) + " http://127.0.0.1:3000/hostlog || curl -s -m 1 \"http://127.0.0.1:3000/hostlog?msg=" + encodeURIComponent(s).replace(/"/g,'\\"') + "\") >/dev/null 2>&1");
      system.callSystem(cmd);
    }
  }catch(e){ /* ignore */ }
}

function PPRO_insertAtPlayhead(jobId) {
  try {
    var extPath = _extensionRoot();
    var outputPath = extPath + "/outputs/" + jobId + "_output.mp4";
    var outputFile = new File(outputPath);
    
    if (outputFile.exists) {
      var project = app.project;
      if (project) {
        var sequence = project.activeSequence;
        if (sequence) {
          var projectItem = project.importFiles([outputFile.fsName], true, project.getInsertionBin(), false);
          if (projectItem && projectItem.length > 0) {
            sequence.videoTracks[0].clips.insert(projectItem[0], sequence.getPlayerPosition().seconds);
            return _respond({ ok: true, message: "Inserted at playhead" });
          }
        }
      }
      return _respond({ ok: false, error: "No active sequence" });
    } else {
      return _respond({ ok: false, error: "Output file not found" });
    }
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function PPRO_insertFileAtPlayhead(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson||'{}'); } catch(e){}
    var fsPath = String((p && (p.path||p)) || '');
    var file = new File(fsPath);
    if (!file.exists) return _respond({ ok:false, error:'File not found' });

    var project = app.project;
    if (!project) return _respond({ ok:false, error:'No project' });
    var sequence = project.activeSequence;
    if (!sequence) return _respond({ ok:false, error:'No active sequence' });

    // Ensure destination bin exists
    var root = project.rootItem;
    var targetBin = null;
    for (var i=0; i<root.children.numItems; i++) {
      var it = root.children[i];
      if (it && it.type === 2 && it.name === 'sync. outputs') { targetBin = it; break; }
    }
    if (!targetBin) {
      try { targetBin = root.createBin('sync. outputs'); } catch(e) { /* ignore */ }
    }
    if (!targetBin) return _respond({ ok:false, error:'Bin not found' });

    // Find or import project item
    var projItem = null;
    for (var j=targetBin.children.numItems-1; j>=0; j--) {
      var child = targetBin.children[j];
      try {
        if (child && typeof child.getMediaPath === 'function') {
          var mp = child.getMediaPath();
          if (mp && mp === file.fsName) { projItem = child; break; }
        }
      } catch(e) { /* ignore */ }
      if (!projItem && child && child.name === file.name) { projItem = child; break; }
    }
    if (!projItem) {
      try {
        project.importFiles([file.fsName], true, targetBin, false);
        for (var k=targetBin.children.numItems-1; k>=0; k--) {
          var c = targetBin.children[k];
          try { if (c && typeof c.getMediaPath === 'function' && c.getMediaPath() === file.fsName) { projItem = c; break; } } catch(e) { }
          if (!projItem && c && c.name === file.name) { projItem = c; break; }
        }
      } catch(e) { /* ignore */ }
    }
    if (!projItem) return _respond({ ok:false, error:'Import failed' });

    var pos = sequence.getPlayerPosition();

    // Choose targeted video track if available
    var vIndex = 0;
    try {
      var vCount = sequence.videoTracks ? sequence.videoTracks.numTracks : 0;
      for (var vi=0; vi<vCount; vi++) {
        try { if (sequence.videoTracks[vi] && typeof sequence.videoTracks[vi].isTargeted === 'function' && sequence.videoTracks[vi].isTargeted()) { vIndex = vi; break; } } catch(e) {}
      }
    } catch(e) {}

    // Overwrite at playhead rather than ripple insert
    try {
      var t = sequence.videoTracks[vIndex];
      var beforeCount = (t && t.clips) ? t.clips.numItems : 0;
      t.overwriteClip(projItem, pos.ticks);
      // Some APIs may throw despite success; verify visually by checking overlap
      var success = false;
      try{
        if (t && t.clips && t.clips.numItems >= beforeCount){
          for (var ix=0; ix<t.clips.numItems; ix++){
            var cc = t.clips[ix];
            var st = cc.start.ticks; var en = cc.end.ticks;
            if (st <= pos.ticks && en > pos.ticks) { success = true; break; }
          }
        }
      }catch(e){}
      if (success) return _respond({ ok:true, videoTrack:vIndex, mode:'overwrite' });
    } catch (e1) {
      // ignore and try fallback
    }
    // Do not use ripple insert fallback to avoid duplicate placements
    return _respond({ ok:false, error:'overwrite failed' });
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function PPRO_importIntoBin(jobId) {
  try {
    var extPath = _extensionRoot();
    var outputPath = extPath + "/outputs/" + jobId + "_output.mp4";
    var outputFile = new File(outputPath);
    
    if (outputFile.exists) {
      var project = app.project;
      if (project) {
        var projectItem = project.importFiles([outputFile.fsName], true, project.getInsertionBin(), false);
        if (projectItem && projectItem.length > 0) {
          return _respond({ ok: true, message: "Added to project bin" });
        }
      }
      return _respond({ ok: false, error: "Failed to import file" });
    } else {
      return _respond({ ok: false, error: "Output file not found" });
    }
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function PPRO_getProjectDir() {
  try {
    if (app && app.project && app.project.path) {
      var projPath = app.project.path;
      if (projPath) {
        var f = new File(projPath);
        var parent = f.parent; // project folder
        if (parent && parent.exists) {
          var outFolder = new Folder(parent.fsName + "/sync. outputs");
          if (!outFolder.exists) { outFolder.create(); }
          return _respond({ ok: true, projectDir: parent.fsName, outputDir: outFolder.fsName });
        }
      }
    }
    return _respond({ ok: false, error: 'No project open' });
  } catch (e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function PPRO_importFileToBin(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson||'{}'); } catch(e){}
    var fsPath = String(p.path||'');
    var binName = String(p.binName||'');
    var project = app.project;
    if (!project) return _respond({ ok:false, error:'No project' });
    var targetBin = project.getInsertionBin();
    if (binName) {
      // Try to find/create bin with given name at root
      var root = project.rootItem;
      var found = null;
      for (var i=0; i<root.children.numItems; i++) {
        var item = root.children[i];
        if (item && item.name === binName && item.type === 2) { found = item; break; }
      }
      if (!found) {
        found = root.createBin(binName);
      }
      if (found) { targetBin = found; }
    }
    var results = null;
    try { results = project.importFiles([fsPath], true, targetBin, false); } catch(e) { results = null; }
    // Some Premiere versions do not return an array even when import succeeds; verify by scanning target bin
    if (!results || !results.length) {
      try {
        var name = '';
        try { var f = new File(fsPath); name = f && f.name ? f.name : ''; } catch(_){ }
        for (var k = targetBin.children.numItems - 1; k >= 0; k--) {
          var c = targetBin.children[k];
          try {
            if (c && typeof c.getMediaPath === 'function') {
              var mp = c.getMediaPath();
              if (mp && mp === fsPath) { return _respond({ ok:true, reused:true }); }
            }
            if (c && name && c.name === name) { return _respond({ ok:true, byName:true }); }
          } catch(_){ }
        }
      } catch(_){ }
    } else {
      // Array returned and non-empty
      return _respond({ ok:true });
    }
    return _respond({ ok:false, error:'Import verification failed' });
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function PPRO_revealFile(payloadJson) {
  try {
    var p = {}; try { p = JSON.parse(payloadJson||'{}'); } catch(e){}
    var fsPath = String((p && (p.path||p)) || '');
    var f = new File(fsPath);
    if (!f.exists) return _respond({ ok:false, error:'File not found' });
    var isWindows = false; try { isWindows = ($.os && $.os.toString().indexOf('Windows') !== -1); } catch(_){ isWindows = false; }
    if (isWindows) {
      var cmd = 'cmd.exe /c explorer.exe /select,"' + String(f.fsName||'').replace(/"/g,'\"') + '"';
      system.callSystem(cmd);
      return _respond({ ok:true });
    } else {
      // macOS: reveal in Finder
      var esc = String(f.fsName||'').replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/"/g, "\\\"");
      var cmd2 = "/usr/bin/osascript -e 'tell application " + '"Finder"' + " to reveal POSIX file \"" + esc + "\"' -e 'tell application " + '"Finder"' + " to activate'";
      system.callSystem(cmd2);
      return _respond({ ok:true });
    }
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function _extensionRoot() {
  try {
    // Derive from this script path: <ext>/host/ppro.jsx → <ext>
    var here = new File($.fileName);
    if (here && here.exists) {
      var hostDir = here.parent; // /host
      if (hostDir) {
        var extDir = hostDir.parent; // extension root
        if (extDir && extDir.exists) { return extDir.fsName; }
      }
    }
  } catch(e) {}
  try {
    var extPath = $.eval('cs.getSystemPath(cs.SystemPath.EXTENSION)');
    if (extPath) return extPath;
  } catch(e) {}
  var userHome = Folder.userDocuments.parent.fsName;
  var fallback = userHome + "/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel";
  return fallback;
}

function _respond(data) {
  return JSON.stringify(data);
}

// _diagSequenceState removed (unused)

function _listFilesRec(folder, depth){
  var out = [];
  try{
    if (!folder || !(folder instanceof Folder) || !folder.exists) return out;
    var items = folder.getFiles();
    for (var i=0; i<items.length; i++){
      var it = items[i];
      try{
        if (it instanceof File) { out.push(it); }
        else if (it instanceof Folder && depth > 0) { var sub = _listFilesRec(it, depth-1); for (var j=0;j<sub.length;j++){ out.push(sub[j]); } }
      }catch(e){}
    }
  }catch(e){}
  return out;
}

function _findPresetByName(namePart){
  var want = String(namePart||'').toLowerCase();
  var dirs = [];
  try{
    // Adobe Media Encoder system/user preset locations (macOS)
    dirs.push(new Folder('/Library/Application Support/Adobe/Adobe Media Encoder')); // will recurse versions
    dirs.push(new Folder('~/Library/Application Support/Adobe/Adobe Media Encoder'));
    dirs.push(new Folder('~/Documents/Adobe/Adobe Media Encoder'));
    // Premiere app bundle presets (some installs include EPRs here)
    var candidates = ['2025','2024','2023','2022'];
    for (var ci=0; ci<candidates.length; ci++){
      var base = new Folder('/Applications/Adobe Media Encoder ' + candidates[ci] + '/Adobe Media Encoder ' + candidates[ci] + '.app/Contents/EncoderPresets');
      dirs.push(base);
      var base2 = new Folder('/Applications/Adobe Premiere Pro ' + candidates[ci] + '/Adobe Premiere Pro ' + candidates[ci] + '.app/Contents/Settings/EncoderPresets');
      dirs.push(base2);
    }
    // Extension-bundled presets (if any)
    try{
      var extPath = _extensionRoot();
      dirs.push(new Folder(extPath + '/presets'));
    }catch(e){}
  }catch(e){}

  for (var di=0; di<dirs.length; di++){
    var d = dirs[di];
    try{
      var files = _listFilesRec(d, 3);
      for (var fi=0; fi<files.length; fi++){
        var f = files[fi];
        try{
          if (!(f instanceof File)) continue;
          var nm = String(f.name||'').toLowerCase();
          if (nm.indexOf('.epr') === -1) continue;
          if (nm.indexOf(want) !== -1) { return f.fsName; }
        }catch(e){}
      }
    }catch(e){}
  }
  return '';
}

function _findPresetForCodec(codec){
  var c = String(codec||'h264').toLowerCase();
  var aliases = [];
  if (c === 'h264') aliases = ['match source - high bitrate', 'match source – high bitrate', 'adaptive high bitrate', 'h.264'];
  else if (c === 'prores_422') aliases = ['apple prores 422', 'prores 422'];
  else aliases = [c];
  for (var i=0;i<aliases.length;i++){ var p = _findPresetByName(aliases[i]); if (p) return p; }
  return '';
}

function _findPresetForAudio(format){
  var f = String(format||'wav').toLowerCase();
  var aliases = [];
  if (f === 'wav') aliases = ['waveform audio', 'wav'];
  else if (f === 'mp3') aliases = ['mp3'];
  else aliases = [f];
  for (var i=0;i<aliases.length;i++){ var p = _findPresetByName(aliases[i]); if (p) return p; }
  return '';
}

function _tempOutPath(ext){
  try{
    var baseFolder = null;
    try { baseFolder = Folder.userDocuments; } catch(_) {}
    if (!baseFolder || !baseFolder.exists) {
      try { baseFolder = Folder.temp; } catch(_) {}
    }
    if (!baseFolder || !baseFolder.exists) return '';
    var dir = new Folder(baseFolder.fsName + '/sync_extension_temp');
    if (!dir.exists) { try { if (!dir.create()) { return ''; } } catch(e){ return ''; } }
    var f = new File(dir.fsName + '/inout_' + (new Date().getTime()) + '_' + Math.floor(Math.random()*10000) + '.' + ext);
    return f && f.fsName ? f.fsName : '';
  }catch(e){ return ''; }
}

function _projectTempPath(ext){
  try{
    if (app && app.project && app.project.path){
      var projFile = new File(app.project.path);
      var parent = projFile && projFile.parent ? projFile.parent : null;
      if (parent && parent.exists){
        var dir = new Folder(parent.fsName + '/sync_extension_temp');
        if (!dir.exists) dir.create();
        var f = new File(dir.fsName + '/inout_' + (new Date().getTime()) + '_' + Math.floor(Math.random()*10000) + '.' + ext);
        return f && f.fsName ? f.fsName : '';
      }
    }
  }catch(e){}
  return '';
}

function _chooseOutPath(ext){
  var p = _projectTempPath(ext);
  if (p) return p;
  p = _tempOutPath(ext);
  return p;
}

function _waitForFile(path, ms){
  var start = (new Date()).getTime();
  var lastSize = -1; var stableCount = 0;
  while (((new Date()).getTime() - start) < (ms||120000)){
    try {
      var f = new File(path);
      if (f.exists){
        try{ f.open('r'); f.seek(0,2); var sz = f.length; f.close(); }catch(e){ var sz = f.length; }
        if (sz > 0){
          if (sz === lastSize){ stableCount++; if (stableCount > 3) return true; }
          else { lastSize = sz; stableCount = 0; }
        }
      }
    } catch(e) {}
    $.sleep(500);
  }
  return false;
}

function PPRO_pickPreset(payloadJson){
  try{
    var p = {}; try{ p = JSON.parse(payloadJson||'{}'); }catch(e){}
    var file = File.openDialog('Select AME preset (.epr)', function(f){ try{ return (f instanceof File) && String(f.name||'').toLowerCase().indexOf('.epr') !== -1; }catch(e){ return true; } });
    if (file && file.exists) return _respond({ ok:true, path: file.fsName });
    return _respond({ ok:false, error:'No preset selected' });
  }catch(e){ return _respond({ ok:false, error:String(e) }); }
}

function _eprRoot(){ try{ return _extensionRoot() + '/epr'; }catch(e){ return ''; } }
function _listEprRec(folder, depth){ var out=[]; try{ var f=new Folder(folder); if(!f.exists) return out; var items=f.getFiles(); for(var i=0;i<items.length;i++){ var it=items[i]; try{ if(it instanceof File && String(it.name||'').toLowerCase().indexOf('.epr')!==-1){ out.push(it); } else if (it instanceof Folder && depth>0){ var sub=_listEprRec(it.fsName, depth-1); for(var j=0;j<sub.length;j++){ out.push(sub[j]); } } }catch(e){} } }catch(e){} return out; }
function _findEprByKeywords(kind, prefers){
  try{
    var root=_eprRoot(); if(!root) return '';
    var files=_listEprRec(root, 3);
    if(!files.length) return '';
    // Score files by keyword hits in name
    function score(name){ var s=0; var nm=String(name||'').toLowerCase(); for(var i=0;i<prefers.length;i++){ if(nm.indexOf(prefers[i])!==-1) s+=10; } return s; }
    var best=null; var bestScore=-1;
    for(var i=0;i<files.length;i++){ var f=files[i]; var sc=score(f.name); if(sc>bestScore){ best=f; bestScore=sc; } }
    return best ? best.fsName : '';
  }catch(e){ return ''; }
}
function _pickVideoPresetPath(codec){
  var c=String(codec||'h264').toLowerCase();
  var root=_eprRoot(); if(!root) return '';
  function join(name){ return _normPath(root + '/' + name); }
  // Prefer exact filenames we ship; fallback to keyword search
  if(c==='h264'){
    var p1=join('Match Source - Adaptive High Bitrate.epr'); if (File(p1).exists) return p1;
    var p2=join('Match Source - High Bitrate.epr'); if (File(p2).exists) return p2;
    var kw=_findEprByKeywords('video', ['match source','adaptive','high bitrate','h.264','h264']); if(kw) return kw;
  }
  if(c==='prores_422'){
    var p=join('ProRes 422.epr'); if (File(p).exists) return p;
    var kw2=_findEprByKeywords('video', ['prores 422','prores','422']); if(kw2) return kw2;
  }
  if(c==='prores_422_proxy'){
    var p3=join('ProRes 422 Proxy.epr'); if (File(p3).exists) return p3;
    var kw3=_findEprByKeywords('video', ['prores 422 proxy','proxy']); if(kw3) return kw3;
  }
  if(c==='prores_422_lt'){
    var p4=join('ProRes 422 LT.epr'); if (File(p4).exists) return p4;
    var kw4=_findEprByKeywords('video', ['prores 422 lt','lt']); if(kw4) return kw4;
  }
  if(c==='prores_422_hq'){
    var p5=join('ProRes 422 HQ.epr'); if (File(p5).exists) return p5;
    var kw5=_findEprByKeywords('video', ['prores 422 hq','hq']); if(kw5) return kw5;
  }
  return '';
}
function _pickAudioPresetPath(format){
  var f=String(format||'wav').toLowerCase();
  if(f==='wav'){
    var p=_findEprByKeywords('audio', ['wav','waveform']); if(p) return p;
  }
  if(f==='mp3'){
    var p2=_findEprByKeywords('audio', ['mp3','320']); if(p2) return p2;
  }
  return '';
}

function PPRO_exportInOutVideo(payloadJson){
  try{
    var p={}; try{ p=JSON.parse(payloadJson||'{}'); }catch(e){}
    var seq=app.project.activeSequence; if(!seq) return _respond({ ok:false, error:'No active sequence' });
    var codec=String(p.codec||'h264');
    var presetPath = _pickVideoPresetPath(codec);
    if(!presetPath) return _respond({ ok:false, error:'Preset not found in /epr for '+codec, eprRoot:_eprRoot() });
    try { var pf = new File(presetPath); if (!pf || !pf.exists) { return _respond({ ok:false, error:'Preset path missing', preset:presetPath }); } } catch(e) { return _respond({ ok:false, error:'Preset path invalid: '+String(e), preset:presetPath }); }
    var ext=''; try{ ext = String(seq.getExportFileExtension(presetPath)||''); }catch(e){}
    if(!ext) ext = (codec==='h264')?'.mp4':'.mov';
    var out = _chooseOutPath(ext.replace(/^\./,'')); if(!out) return _respond({ ok:false, error:'Temp path failed' });
    if (String(out).toLowerCase().indexOf(ext.toLowerCase()) === -1) { out = out.replace(/\.[^\.]+$/, '') + ext; }

    var ok=false; try{ ok = seq.exportAsMediaDirect(out, presetPath, 1); }catch(e){ return _respond({ ok:false, error:'exportAsMediaDirect failed: '+String(e), out: out }); }
    if(!ok) return _respond({ ok:false, error:'exportAsMediaDirect returned false', out: out });
    var done = _waitForFile(out, 180000);
    if(!done) return _respond({ ok:false, error:'Export timeout', out: out });
    return _respond({ ok:true, path: out, preset: presetPath });
  }catch(e){ return _respond({ ok:false, error:String(e) }); }
}

function PPRO_exportInOutAudio(payloadJson){
  try{
    var p={}; try{ p=JSON.parse(payloadJson||'{}'); }catch(e){}
    var seq=app.project.activeSequence; if(!seq) return _respond({ ok:false, error:'No active sequence' });
    var format=String(p.format||'wav');
    var presetPath = _pickAudioPresetPath(format);
    if(!presetPath) return _respond({ ok:false, error:'Preset not found in /epr for '+format, eprRoot:_eprRoot() });
    try { var pf = new File(presetPath); if (!pf || !pf.exists) { return _respond({ ok:false, error:'Preset path missing', preset:presetPath }); } } catch(e) { return _respond({ ok:false, error:'Preset path invalid: '+String(e), preset:presetPath }); }
    var ext=''; try{ ext = String(seq.getExportFileExtension(presetPath)||''); }catch(e){}
    if(!ext) ext = (format==='mp3')?'.mp3':'.wav';
    var out = _chooseOutPath(ext.replace(/^\./,'')); if(!out) return _respond({ ok:false, error:'Temp path failed' });
    if (String(out).toLowerCase().indexOf(ext.toLowerCase()) === -1) { out = out.replace(/\.[^\.]+$/, '') + ext; }

    var ok=false; try{ ok = seq.exportAsMediaDirect(out, presetPath, 1); }catch(e){ return _respond({ ok:false, error:'exportAsMediaDirect failed: '+String(e), out: out }); }
    if(!ok) return _respond({ ok:false, error:'exportAsMediaDirect returned false', out: out });
    var done = _waitForFile(out, 180000);
    if(!done) return _respond({ ok:false, error:'Export timeout', out: out });
    return _respond({ ok:true, path: out, preset: presetPath });
  }catch(e){ return _respond({ ok:false, error:String(e) }); }
}

function PPRO_diagInOut(payloadJson){
  try{
    var info = { ok:true };
    try { info.extRoot = _extensionRoot(); } catch(e) { info.extRootError = String(e); }
    try { info.eprRoot = _eprRoot(); } catch(e) { info.eprRootError = String(e); }
    var seq = null;
    try { seq = app.project.activeSequence; } catch(e){ info.activeSequenceError = String(e); }
    info.hasActiveSequence = !!seq;
    info.hasExportAsMediaDirect = !!(seq && typeof seq.exportAsMediaDirect === 'function');
    try {
      app.enableQE();
      info.qeActive = !!(qe && qe.project && qe.project.getActiveSequence());
    } catch(e) { info.qeError = String(e); }
    try {
      if (seq && typeof seq.getInPoint === 'function') { var ip = seq.getInPoint(); info.inTicks = ip ? ip.ticks : 0; }
    } catch(e) { info.inError = String(e); }
    try {
      if (seq && typeof seq.getOutPoint === 'function') { var op = seq.getOutPoint(); info.outTicks = op ? op.ticks : 0; }
    } catch(e) { info.outError = String(e); }
    try {
      var root = info.eprRoot || '';
      var files = root ? _listEprRec(root, 1) : [];
      info.eprCount = files.length;
      info.firstEpr = (files.length && files[0] && files[0].fsName) ? files[0].fsName : '';
    } catch(e){ info.eprListError = String(e); }
    return _respond(info);
  }catch(e){ return _respond({ ok:false, error:String(e) }); }
}

function _normPath(p){
  try {
    var f = new File(p);
    return f && f.fsName ? f.fsName : String(p||'');
  } catch(e) {
    return String(p||'');
  }
}

// Safely single-quote a string for bash -lc
function _shq(s){
  try { return "'" + String(s||'').replace(/'/g, "'\\''") + "'"; } catch(e){ return "''"; }
}