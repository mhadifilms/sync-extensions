      (function(){
        async function init(){
          try { if (typeof loadSettings === 'function') loadSettings(); } catch(_){ }
          try { if (typeof updateModelDisplay === 'function') updateModelDisplay(); } catch(_){ }
          
          // Helper function to check health on a specific port
          async function checkHealth(port) {
            try {
              const r = await fetch(`http://127.0.0.1:${port}/health`, { cache:'no-store' }); 
              return !!(r && r.ok);
            } catch(_) { 
              return false; 
            }
          }
          
          // Helper function to find which port the server is running on
          async function findServerPort() {
            const ports = [3000, 3001, 3002, 3003, 3004];
            for (const port of ports) {
              if (await checkHealth(port)) {
                return port;
              }
            }
            return null;
          }
          
          // Gentle backend warmup: ping health (won't start server), then request token (server auto-started by actions)
          try {
            const serverPort = await findServerPort();
            if (serverPort) {
              fetch(`http://127.0.0.1:${serverPort}/health`, { cache:'no-store' }).catch(function(){});
            }
          } catch(_){ }
          try { if (typeof ensureAuthToken === 'function') await ensureAuthToken(); } catch(_){ }
          
          // If backend is not running, try to start it via host adapter and wait briefly
          try {
            let healthy = false;
            let serverPort = await findServerPort();
            
            if (!serverPort) {
              try { 
                if (window.nle && typeof window.nle.startBackend === 'function') { 
                  await window.nle.startBackend();
                } else {
                  // Fallback: direct host call
                  if (window.CSInterface) {
                    var cs = new CSInterface();
                    var hostId = (window.nle && window.nle.getHostId) ? window.nle.getHostId() : 'PPRO';
                    var fn = hostId === 'AEFT' ? 'AEFT_startBackend()' : 'PPRO_startBackend()';
                    cs.evalScript(fn, function(result){});
                  }
                }
              } catch(e){ }
              
              // Wait up to ~5s for health on any port
              let tries = 0;
              while (tries < 20 && !healthy) {
                serverPort = await findServerPort();
                if (serverPort) {
                  healthy = true;
                  break;
                }
                await new Promise(r=>setTimeout(r, 250)); 
                tries++;
              }
            } else {
              healthy = true;
            }
            
            // Store the server port globally for other parts of the app
            if (healthy && serverPort) {
              window.__syncServerPort = serverPort;
            }
          } catch(e){ }
        }
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 100); }); }
        else { setTimeout(init, 100); }
      })();

