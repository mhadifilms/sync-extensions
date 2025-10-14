      (function(){
        // Hide debug banner
        var debugEl = document.getElementById('debugBanner');
        if (debugEl) {
          debugEl.style.display = 'none';
        }
        
        // Prefer Node-based app-data logs directory
        var logFilePath = (function(){
          try{
            if (typeof require !== 'undefined'){
              var fs = require('fs');
              var os = require('os');
              var path = require('path');
              var home = os.homedir();
              var base = (process.platform === 'win32') ? path.join(home, 'AppData', 'Roaming', 'sync. extensions') : (process.platform === 'darwin') ? path.join(home, 'Library', 'Application Support', 'sync. extensions') : path.join(home, '.config', 'sync. extensions');
              var logs = path.join(base, 'logs');
              try { fs.mkdirSync(logs, { recursive: true }); } catch(_){ }
              return path.join(logs, 'sync_server_debug.log');
            }
          }catch(_){ }
          if (process && process.platform === 'win32') return (process.env.TEMP||'C:\\temp') + '\\sync_server_debug.log';
          try{ if (typeof require !== 'undefined'){ var os2=require('os'); return os2.tmpdir()+ '/sync_server_debug.log'; } }catch(_){ }
          return '/tmp/sync_server_debug.log';
        })();
        
        // Debug: Log the actual log file path (only when SYNC_DEBUG enabled)
        try {
          if (typeof require !== 'undefined') {
            var fs = require('fs');
            var on = false;
            try { var path2=require('path'); var flagPath = path2.join(path2.dirname(logFilePath), 'debug.enabled'); on = fs.existsSync(flagPath); } catch(_){ }
            if (!on) { throw new Error('debug disabled'); }
            fs.writeFileSync(logFilePath, '=== AUTO-START DEBUG LOG ===\n');
            fs.appendFileSync(logFilePath, 'Log file: ' + logFilePath + '\n');
            fs.appendFileSync(logFilePath, 'Platform: ' + (process.platform || 'unknown') + '\n');
            fs.appendFileSync(logFilePath, 'Node.js available: ' + (typeof require !== 'undefined') + '\n');
            fs.appendFileSync(logFilePath, 'CSInterface available: ' + (typeof window.CSInterface !== 'undefined') + '\n');
          }
        } catch(e) {
          console.log('Initial log setup error:', e.message);
        }
        
        function log(message) {
          try {
            if (typeof require !== 'undefined') {
              var fs = require('fs');
              fs.appendFileSync(logFilePath, new Date().toISOString() + ' ' + message + '\n');
            }
          } catch(e) {
            // Fallback to console if fs not available
            console.log('LOG:', message);
          }
        }
        
        // Log is already initialized above with debug info
        
        log('nle.js loaded');
        
        // Reliable auto-start using Node.js child_process (with --enable-nodejs)
        try {
          if (!window.CSInterface) {
            log('CSInterface not available');
            return;
          }
          var cs = new CSInterface();
          var serverStarted = false;

          // Detect OS early
          var isWindows = false;
          try {
            isWindows = (process.platform === 'win32');
          } catch(e) {}

          function updateDebugStatus(message) {
            log(message);
          }
          
          // Debug Node.js availability
          try {
            updateDebugStatus('Testing Node.js availability...');
            updateDebugStatus('require available: ' + (typeof require !== 'undefined'));
            updateDebugStatus('process available: ' + (typeof process !== 'undefined'));
            if (typeof process !== 'undefined') {
              updateDebugStatus('process.execPath: ' + (process.execPath || 'undefined'));
            }
            try {
              var childProcess = require('child_process');
              updateDebugStatus('child_process available: ' + (typeof childProcess !== 'undefined'));
              updateDebugStatus('spawn available: ' + (typeof childProcess.spawn === 'function'));
            } catch(e) {
              updateDebugStatus('child_process error: ' + e.message);
            }
          } catch(e) {
            updateDebugStatus('Node.js test error: ' + e.message);
          }
          
          function startServer() {
            if (serverStarted) {
              updateDebugStatus('Server already started (cached)');
              return;
            }
            
            try {
              updateDebugStatus('Checking server status...');
              
              // Health check first (use 127.0.0.1 to avoid IPv6/host alias issues)
              fetch('http://127.0.0.1:3000/health')
                .then(function(response) {
                  if (response.ok) {
                    serverStarted = true;
                    updateDebugStatus('Server already running on port 3000');
                    try { window.__syncServerPort = 3000; } catch(_) {}
                    try { window.dispatchEvent(new CustomEvent('sync-backend-ready', { detail: { port: 3000, source: 'nle-health' } })); } catch(_) {}
                    return;
                  }
                  throw new Error('Server not responding');
                })
                .catch(function() {
                  // Server not running, start with Node.js spawn
                  updateDebugStatus('Starting server with Node.js spawn...');
                  
                  try {
                    var spawn = require('child_process').spawn;
                    var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
                    updateDebugStatus('Raw extension path: ' + extPath);
                    
                    // Convert file:// URL to filesystem path
                    if (extPath.startsWith('file://')) {
                      extPath = extPath.replace('file://', '');
                    }
                    
                    // Decode URL-encoded characters
                    extPath = decodeURIComponent(extPath);
                    updateDebugStatus('Decoded extension path: ' + extPath);
                    
                    // Fix Windows path format: /C:/ -> C:\
                    if (isWindows && extPath.startsWith('/') && extPath.charAt(2) === ':') {
                      extPath = extPath.charAt(1) + extPath.substring(2);
                    }
                    
                    var serverPath;
                    try {
                      var fs = require('fs');
                      if (isWindows) {
                        var distWin = extPath.replace(/\//g, '\\') + '\\server\\dist\\server.js';
                        var srcWin = extPath.replace(/\//g, '\\') + '\\server\\src\\server.js';
                        serverPath = (fs.existsSync(distWin) ? distWin : srcWin);
                      } else {
                        var distMac = extPath + '/server/dist/server.js';
                        var srcMac = extPath + '/server/src/server.js';
                        serverPath = (fs.existsSync(distMac) ? distMac : srcMac);
                      }
                    } catch(_) {
                      if (isWindows) {
                        serverPath = extPath.replace(/\//g, '\\') + '\\server\\src\\server.js';
                      } else {
                        serverPath = extPath + '/server/src/server.js';
                      }
                    }
                    updateDebugStatus('Server path: ' + serverPath);
                    
                    // Check if server file exists
                    try {
                      var fs = require('fs');
                      if (fs.existsSync(serverPath)) {
                        updateDebugStatus('Server file exists: true');
                        
                        // Check if node_modules exists
                        var nodeModulesPath;
                        if (isWindows) {
                          nodeModulesPath = extPath.replace(/\//g, '\\') + '\\server\\node_modules';
                        } else {
                          nodeModulesPath = extPath + '/server/node_modules';
                        }
                        if (fs.existsSync(nodeModulesPath)) {
                          updateDebugStatus('Node modules directory exists: true');
                          
                          // Check for critical dependencies
                          var expressPath = nodeModulesPath + (isWindows ? '\\express' : '/express');
                          if (fs.existsSync(expressPath)) {
                            updateDebugStatus('Express dependency found: true');
                          } else {
                            updateDebugStatus('Express dependency found: false - server will fail to start');
                            if (isWindows) {
                              updateDebugStatus('Run: cd /d "' + extPath.replace(/\//g, '\\') + '\\server" && npm install');
                            } else {
                              updateDebugStatus('Run: cd "' + extPath + '/server" && npm install');
                            }
                          }
                        } else {
                          updateDebugStatus('Node modules directory exists: false - server will fail to start');
                          if (isWindows) {
                            updateDebugStatus('Run: cd /d "' + extPath.replace(/\//g, '\\') + '\\server" && npm install');
                          } else {
                            updateDebugStatus('Run: cd "' + extPath + '/server" && npm install');
                          }
                        }
                      } else {
                        updateDebugStatus('Server file exists: false - this will cause startup failure');
                      }
                    } catch(e) {
                      updateDebugStatus('Error checking server file: ' + e.message);
                    }
                    
                    // Use bundled Node.js executable
                    var nodePath = null;
                    var fs = require('fs');
                    var path = require('path');
                    
                    // Determine platform and architecture
                    var platform = process.platform; // 'darwin' | 'win32'
                    var arch = process.arch; // 'arm64' | 'x64'
                    var nodeBin = platform === 'win32' ? 'node.exe' : 'node';
                    
                    // Construct path to bundled Node.js binary
                    var bundledNodePath = path.join(extPath, 'bin', platform + '-' + arch, nodeBin);
                    
                    updateDebugStatus('Looking for bundled Node.js at: ' + bundledNodePath);
                    
                    var candidates = [];
                    if (fs.existsSync(bundledNodePath)) {
                      candidates = [bundledNodePath];
                      updateDebugStatus('Found bundled Node.js binary');
                    } else {
                      updateDebugStatus('Bundled Node.js binary not found - extension requires bundled Node.js');
                      updateDebugStatus('Please reinstall the extension or contact support');
                      return;
                    }
                    
                    // Try each candidate synchronously
                    for (var i = 0; i < candidates.length; i++) {
                      try {
                        var candidate = candidates[i];
                        
                        // For bundled Node.js on macOS, ensure it has execute permissions
                        if (candidate === bundledNodePath && platform === 'darwin') {
                          try {
                            fs.chmodSync(candidate, 0o755);
                            updateDebugStatus('Set execute permissions on bundled Node.js binary');
                          } catch (chmodError) {
                            updateDebugStatus('Warning: Could not set execute permissions: ' + chmodError.message);
                          }
                        }
                        updateDebugStatus('Trying Node.js path: ' + candidate);
                        
                        // For bundled Node.js, check if file exists and is executable
                        if (fs.existsSync(candidate)) {
                          try {
                            var stats = fs.statSync(candidate);
                            if (stats.isFile()) {
                              nodePath = candidate;
                              updateDebugStatus('Found bundled Node.js at: ' + nodePath);
                              break;
                            }
                          } catch(e) {
                            updateDebugStatus('Error checking bundled Node.js: ' + e.message);
                          }
                        }
                      } catch(e) {
                        updateDebugStatus('Error testing ' + candidates[i] + ': ' + e.message);
                      }
                    }
                    
                    if (!nodePath) {
                      updateDebugStatus('Node.js executable not found');
                      return;
                    }
                    
                    // Check if dependencies need to be installed
                    var nodeModulesPath;
                    if (isWindows) {
                      nodeModulesPath = extPath.replace(/\//g, '\\') + '\\server\\node_modules';
                    } else {
                      nodeModulesPath = extPath + '/server/node_modules';
                    }
                    var expressPath = nodeModulesPath + (isWindows ? '\\express' : '/express');
                    
                    if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(expressPath)) {
                      updateDebugStatus('Dependencies missing - this should not happen');
                      updateDebugStatus('The extension package should include pre-installed node_modules');
                      updateDebugStatus('Please reinstall the extension or contact support');
                      return;
                    }
                    
                    updateDebugStatus('Spawning (detached, stdio piped): ' + nodePath + ' ' + serverPath);

                    // Detached spawn with stdout/stderr pipes so we can consume output
                    var spawn = require('child_process').spawn;
                    var child = spawn(nodePath, [serverPath], {
                      cwd: extPath + '/server',
                      detached: true,
                      stdio: ['ignore', 'pipe', 'pipe']
                    });

                    // Read server output safely into panel debug log
                    if (child.stdout) {
                      child.stdout.on('data', function(data) {
                        try { updateDebugStatus('Server stdout: ' + data.toString()); } catch(_){ }
                      });
                    }
                    if (child.stderr) {
                      child.stderr.on('data', function(data) {
                        try { updateDebugStatus('Server stderr: ' + data.toString()); } catch(_){ }
                      });
                    }

                    child.on('error', function(err) {
                      updateDebugStatus('Server spawn error: ' + err.message);
                    });

                    child.on('exit', function(code, signal) {
                      updateDebugStatus('Server exited with code: ' + code + ', signal: ' + signal);
                    });

                    child.unref();
                    serverStarted = true;
                    updateDebugStatus('Server spawned successfully');
                    
                    // Verify server started
                    setTimeout(function() {
                      fetch('http://127.0.0.1:3000/health')
                        .then(function(response) {
                          if (response.ok) {
                            updateDebugStatus('Server started and healthy');
                            try { window.__syncServerPort = 3000; } catch(_) {}
                            try { window.dispatchEvent(new CustomEvent('sync-backend-ready', { detail: { port: 3000, source: 'nle-spawn' } })); } catch(_) {}
                          } else {
                            updateDebugStatus('Server spawned but not healthy');
                          }
                        })
                        .catch(function() {
                          updateDebugStatus('Server spawned but not responding');
                        });
                    }, 4000);
                    
                  } catch(spawnError) {
                    updateDebugStatus('Spawn error: ' + spawnError.message);
                  }
                });
            } catch(e) {
              updateDebugStatus('Server startup error: ' + e.message);
            }
          }

          // Listen for panel visibility changes
          try {
            if (cs && typeof cs.addEventListener === 'function') {
              cs.addEventListener('com.adobe.csxs.events.WindowVisibilityChanged', function(event) {
                updateDebugStatus('Visibility changed: ' + event.data);
                if (event.data === 'show') {
                  startServer();
                }
              });
            } else {
              updateDebugStatus('CSInterface addEventListener not available');
            }
          } catch(e) {
            updateDebugStatus('Event listener error: ' + e.message);
            // Fallback: just start on timer
          }

          // Also start on initial load
          updateDebugStatus('Setting up auto-start timer...');
          setTimeout(function() {
            updateDebugStatus('Timer fired, calling startServer...');
            startServer();
          }, 1000);
          
        } catch(e) {
          log('nle.js auto-start error: ' + e.message);
        }

        // Lightweight NLE adapter for host-agnostic calls from UI
        function detectHostId(){
          try {
            try {
              if (window.HOST_CONFIG && window.HOST_CONFIG.isAE) return 'AEFT';
              if (window.HOST_CONFIG && window.HOST_CONFIG.hostId === 'PPRO') return 'PPRO';
            } catch(_){ }
            if (!window.CSInterface) return 'PPRO';
            var cs = new CSInterface();
            var env = cs.getHostEnvironment && cs.getHostEnvironment();
            var appName = (env && (env.appName || '')) || '';
            var appId = (env && (env.appId || '')) || '';
            var nameU = String(appName).toUpperCase();
            var idU = String(appId).toUpperCase();
            if (idU.indexOf('AEFT') !== -1 || nameU.indexOf('AFTER EFFECTS') !== -1 || nameU.indexOf('AFTEREFFECTS') !== -1) return 'AEFT';
            if (idU.indexOf('PPRO') !== -1 || nameU.indexOf('PREMIERE') !== -1) return 'PPRO';
            
            // Fallback: check extension path
            try {
              var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
              if (extPath && extPath.indexOf('ae') !== -1) return 'AEFT';
              if (extPath && extPath.indexOf('ppro') !== -1) return 'PPRO';
            } catch(_) {}
            
            return 'PPRO';
          } catch(_) { return 'PPRO'; }
        }
        function getHostId(){
          try {
            if (window.__forceHostId === 'AEFT' || window.__forceHostId === 'PPRO') return window.__forceHostId;
          } catch(_){ }
          return detectHostId();
        }
        function prefix(){ return getHostId() === 'AEFT' ? 'AEFT' : 'PPRO'; }

        async function ensureHostLoaded(){
          try {
            if (!window.CSInterface) return;
            var cs = new CSInterface();
            var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
            var h = getHostId();
            var file = h === 'AEFT' ? '/host/ae.jsx' : '/host/ppro.jsx';
            var startFn = (h === 'AEFT') ? 'AEFT_startBackend()' : 'PPRO_startBackend()';

            // Escape path for single-quoted ExtendScript string
            var escPath = String(extPath + file).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            log('Loading host script: ' + file);

            cs.evalScript("$.evalFile('" + escPath + "')", function(){
              // Load host script - auto-start is handled above
              log('Host script loaded');
            });
          } catch(_){ }
        }

        async function call(fnTail, payload){
          try {
            await ensureHostLoaded();
            var fn = prefix() + '_' + fnTail;
            if (typeof evalExtendScript === 'function') {
              return await evalExtendScript(fn, payload||{});
            }
            // Fallback: raw evalScript without JSON contract
            return new Promise(function(resolve){
              try {
                var cs = new CSInterface();
                var arg = JSON.stringify(payload||{}).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
                var code = fn + '(' + JSON.stringify(arg) + ')';
                cs.evalScript(code, function(r){
                  try { resolve(JSON.parse(r||'{}')); } catch(_){ resolve({ ok:false, error:String(r||'no response') }); }
                });
              } catch(e){ resolve({ ok:false, error:String(e) }); }
            });
          } catch(e){ return { ok:false, error:String(e) }; }
        }

        window.nle = {
          getHostId: function(){ return getHostId(); },
          loadHostScript: ensureHostLoaded,
          // Common operations
          startBackend: function(){ return call('startBackend', {}); },
          getProjectDir: function(){ return call('getProjectDir', {}); },
          exportInOutVideo: function(opts){ return call('exportInOutVideo', opts||{}); },
          exportInOutAudio: function(opts){ return call('exportInOutAudio', opts||{}); },
          insertFileAtPlayhead: function(fsPath){ return call('insertFileAtPlayhead', fsPath ? { path: fsPath } : {}); },
          importFileToBin: function(fsPath, binName){ return call('importFileToBin', { path: fsPath, binName: binName||'' }); },
          revealFile: function(fsPath){ return call('revealFile', fsPath ? { path: fsPath } : {}); },
          diagInOut: function(){ return call('diagInOut', {}); }
        };
      })();


