      document.addEventListener('DOMContentLoaded', function() {
        try {
          cs = new CSInterface();
          // Ensure host script is loaded on startup so dialogs work immediately
          try {
            var extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
            cs.evalScript("$.evalFile('" + extPath + "/host/ppro.jsx')", function(){
              // no-op
            });
          } catch (e) {
            console.log('Host load error:', e);
          }
          loadJobsLocal();
          loadSettings();
          console.log('Panel loaded successfully');

          // Start backend and load history immediately
          cs.evalScript('PPRO_startBackend()', async function(res){
            try { console.log('Backend start:', res); } catch(_) {}
            const ok = await waitForHealth(40, 250);
            if (!ok) {
              console.warn('Backend health check failed');
            }
            await loadJobsFromServer();
            // Periodic refresh
            setInterval(loadJobsFromServer, 4000);
            // Kick initial estimate if inputs preloaded
            scheduleEstimate();
          });
          // Ensure cost badge is inside preview from the start
          try { const pv=document.getElementById('preview'); const badge=document.getElementById('costIndicator'); if (pv && badge){ pv.appendChild(badge); badge.style.position='absolute'; badge.style.left='8px'; badge.style.bottom='8px'; } } catch(_){ }
          // Render initial dropzone
          try { renderInputPreview(); } catch(_){ }
          // Update model display
          try { updateModelDisplay(); } catch(_){ }
          // Initialize drag & drop support
          try { initDragAndDrop(); } catch(_){ }
        } catch(e) {
          console.error('CSInterface error:', e);
        }
      });


