function PPRO_startBackend() {
  try {
    var extPath = _extensionRoot();
    var serverPath = extPath + "/server/src/server.js";
    var serverFile = new File(serverPath);
    if (!serverFile.exists) {
      return _respond({ ok: false, error: "Server file not found: " + serverPath });
    }

    // Resolve node path robustly (macOS)
    function fileExists(p) { try { return new File(p).exists; } catch(e) { return false; } }
    var candidates = [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
      "/usr/local/opt/node/bin/node"
    ];
    var nodePath = null;
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

    // Launch server in background with nohup
    var launchCmd = "/bin/bash -lc \"cd '" + extPath + "/server' && nohup '" + nodePath + "' '" + serverPath + "' > /tmp/sync_extension_server.log 2>&1 & echo OK\"";
    var out = system.callSystem(launchCmd);
    return _respond({ ok: true, message: "launched", details: out });
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
}

function PPRO_showFileDialog(payloadJson) {
  try {
    var p = {};
    try { p = JSON.parse(payloadJson); } catch(e) {}
    var kind = p.kind || 'video';
    var allow = (kind === 'audio')
      ? { wav:1, mp3:1, aac:1, aif:1, aiff:1, m4a:1 }
      : { mov:1, mp4:1, mxf:1, mkv:1, avi:1, m4v:1, mpg:1, mpeg:1 };
    var fn = function(f){
      try {
        if (f instanceof Folder) return true;
        var n = (f && f.name) ? String(f.name).toLowerCase() : '';
        var i = n.lastIndexOf('.');
        if (i < 0) return true; // allow seeing files without ext, selection validated after
        var ext = n.substring(i+1);
        return allow[ext] === 1;
      } catch (e) { return true; }
    };
    var file = File.openDialog('Select ' + kind + ' file', fn);
    if (file && file.exists) {
      return _respond({ ok: true, path: file.fsName });
    }
    return _respond({ ok: false, error: 'No file selected' });
  } catch(e) {
    return _respond({ ok: false, error: String(e) });
  }
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

function PPRO_insertFileAtPlayhead(fsPath) {
  try {
    var file = new File(fsPath);
    if (!file.exists) return _respond({ ok:false, error:'File not found' });
    var project = app.project;
    if (!project) return _respond({ ok:false, error:'No project' });
    var sequence = project.activeSequence;
    if (!sequence) return _respond({ ok:false, error:'No active sequence' });
    var imported = project.importFiles([file.fsName], true, project.getInsertionBin(), false);
    if (imported && imported.length > 0) {
      sequence.videoTracks[0].clips.insert(imported[0], sequence.getPlayerPosition().seconds);
      return _respond({ ok:true });
    }
    return _respond({ ok:false, error:'Import failed' });
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

function PPRO_importFileToBin(fsPath, binName) {
  try {
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
    var results = project.importFiles([fsPath], true, targetBin, false);
    if (results && results.length > 0) {
      return _respond({ ok:true });
    }
    return _respond({ ok:false, error:'Import failed' });
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function PPRO_revealFile(fsPath) {
  try {
    var f = new File(fsPath);
    if (!f.exists) return _respond({ ok:false, error:'File not found' });
    // macOS: reveal in Finder
    var cmd = "/usr/bin/osascript -e 'tell application " + '"Finder"' + " to reveal POSIX file \"" + f.fsName + "\"' -e 'tell application " + '"Finder"' + " to activate'";
    system.callSystem(cmd);
    return _respond({ ok:true });
  } catch (e) {
    return _respond({ ok:false, error:String(e) });
  }
}

function _extensionRoot() {
  try {
    // Try to get extension path from CEP
    var extPath = $.eval('cs.getSystemPath(cs.SystemPath.EXTENSION)');
    if (extPath) return extPath;
  } catch(e) {}
  
  // Fallback: construct path manually
  var userHome = Folder.userDocuments.parent.fsName;
  var extPath = userHome + "/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.panel";
  return extPath;
}

function _respond(data) {
  return JSON.stringify(data);
}