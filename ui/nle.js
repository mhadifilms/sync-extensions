      (function(){
        // Lightweight NLE adapter for host-agnostic calls from UI
        function detectHostId(){
          try {
            if (!window.CSInterface) return 'PPRO';
            var cs = new CSInterface();
            var env = cs.getHostEnvironment && cs.getHostEnvironment();
            var appName = (env && (env.appName || '')) || '';
            var appId = (env && (env.appId || '')) || '';
            var nameU = String(appName).toUpperCase();
            var idU = String(appId).toUpperCase();
            if (idU.indexOf('AEFT') !== -1 || nameU.indexOf('AFTER EFFECTS') !== -1 || nameU.indexOf('AFTEREFFECTS') !== -1) return 'AEFT';
            if (idU.indexOf('PPRO') !== -1 || nameU.indexOf('PREMIERE') !== -1) return 'PPRO';
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
            cs.evalScript("$.evalFile('" + extPath + file + "')", function(){});
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


