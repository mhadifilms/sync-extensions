      (function(){
        async function init(){
          try { if (typeof loadSettings === 'function') loadSettings(); } catch(_){ }
          try { if (typeof updateModelDisplay === 'function') updateModelDisplay(); } catch(_){ }
          // Gentle backend warmup: ping health (won't start server), then request token (server auto-started by actions)
          try {
            fetch('http://127.0.0.1:3000/health', { cache:'no-store' }).catch(function(){});
          } catch(_){ }
          try { if (typeof ensureAuthToken === 'function') await ensureAuthToken(); } catch(_){ }
          // If backend is not running, try to start it via host adapter and wait briefly
          try {
            let healthy = false;
            try { const r = await fetch('http://127.0.0.1:3000/health', { cache:'no-store' }); healthy = !!(r && r.ok); } catch(_){ healthy = false; }
            if (!healthy) {
              try { if (window.nle && typeof window.nle.startBackend === 'function') { await window.nle.startBackend(); } } catch(_){ }
              // Wait up to ~5s for health
              let tries = 0;
              while (tries < 20 && !healthy) {
                try { const r2 = await fetch('http://127.0.0.1:3000/health', { cache:'no-store' }); healthy = !!(r2 && r2.ok); } catch(_){ healthy = false; }
                if (healthy) break; await new Promise(r=>setTimeout(r, 250)); tries++;
              }
            }
          } catch(_){ }
        }
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
        else { init(); }
      })();

