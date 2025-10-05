      (function(){
        async function init(){
          try { if (typeof loadSettings === 'function') loadSettings(); } catch(_){ }
          try { if (typeof updateModelDisplay === 'function') updateModelDisplay(); } catch(_){ }
          // Gentle backend warmup: ping health (won't start server), then request token (server auto-started by actions)
          try {
            fetch('http://127.0.0.1:3000/health', { cache:'no-store' }).catch(function(){});
          } catch(_){ }
          try { if (typeof ensureAuthToken === 'function') await ensureAuthToken(); } catch(_){ }
        }
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
        else { init(); }
      })();

