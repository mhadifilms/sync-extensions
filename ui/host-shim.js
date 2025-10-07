      (function(){
        try {
          if (!window.CSInterface) return;
          var hostId = (function(){
            try {
              var cs = new CSInterface();
              var env = cs.getHostEnvironment && cs.getHostEnvironment();
              var ident = String((env && (env.appId || env.appName || '')) || '').toUpperCase();
              if (ident.indexOf('AEFT') !== -1 || ident.indexOf('AFTER EFFECTS') !== -1 || ident.indexOf('AFTEREFFECTS') !== -1) return 'AEFT';
            } catch(_){ }
            return 'PPRO';
          })();
          if (hostId !== 'AEFT') return;

          var proto = CSInterface.prototype;
          if (!proto || !proto.evalScript) return;
          var _orig = proto.evalScript;
          // Ensure AE host script is loaded early
          try {
            var cs = new CSInterface();
            var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
            _orig.call(cs, "$.evalFile('" + extPath + "/host/ae.jsx')", function(){});
          } catch(_){ }
          proto.evalScript = function(code, cb){
            try {
              if (typeof code === 'string') {
                // Map Premiere calls to AE counterparts and load AE host script
                code = code.replace(/\bPPRO_/g, 'AEFT_').replace(/\/host\/ppro\.jsx/g, '/host/ae.jsx');
              }
            } catch(_){ }
            return _orig.call(this, code, cb);
          };

          // Best-effort: auto-start backend shortly after panel load.
          // Safe because the server will no-op if already healthy on port 3000.
          try {
            setTimeout(function(){
              try {
                var cs2 = new CSInterface();
                _orig.call(cs2, "$.evalFile('" + cs2.getSystemPath(CSInterface.SystemPath.EXTENSION) + "/host/ae.jsx')", function(){});
                _orig.call(cs2, 'AEFT_startBackend()', function(){ /* ignore */ });
              } catch(_){ }
            }, 300);
          } catch(_){ }
        } catch(_){ }
      })();


