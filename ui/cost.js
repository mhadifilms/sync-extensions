      function scheduleEstimate(){
        try{ if (estimateTimer) clearTimeout(estimateTimer); }catch(_){ }
        estimateTimer = setTimeout(()=>estimateCost(true), 800);
      }

      async function estimateCost(auto, retry){
        const statusEl = document.getElementById('statusMessage');
        const badge = document.getElementById('costIndicator');
        const display = document.getElementById('costDisplay');
        const myToken = ++costToken;
        try{
          // Before selection: show $0.00
          if (!selectedVideo || !selectedAudio) {
            if (!auto && statusEl) statusEl.textContent = 'select both video and audio first';
            const txt = 'cost: $0.00';
            if (badge){ badge.style.display='block'; badge.textContent=txt; }
            if (display){ display.textContent = txt; }
            try{ const below=document.getElementById('costBelow'); if (below) below.textContent=txt; }catch(_){ }
            return;
          }
          const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
          const apiKey = settings.apiKey||'';
          const hasSupabase = !!(settings.supabaseUrl && settings.supabaseKey && settings.supabaseBucket);
          const hasUrls = !!(uploadedVideoUrl && uploadedAudioUrl);
          // If lacking API key or required Supabase when no URLs, show $--
          if (!apiKey || (!hasSupabase && !hasUrls)) {
            const txt = 'cost: $--';
            if (badge){ badge.style.display='block'; badge.textContent=txt; }
            if (display){ display.textContent = txt; }
            if (!auto && statusEl) statusEl.textContent = !apiKey ? 'add API key in settings' : 'set supabase in settings or upload to URLs';
            try{ const below=document.getElementById('costBelow'); if (below) below.textContent=txt; }catch(_){ }
            return;
          }
          if (badge){ badge.style.display='block'; badge.textContent='cost: estimating…'; }
          if (display){ display.textContent='cost: estimating…'; }
          try{ const below=document.getElementById('costBelow'); if (below) below.textContent='cost: estimating…'; }catch(_){ }
          const body = {
            videoPath: selectedVideo,
            audioPath: selectedAudio,
            videoUrl: uploadedVideoUrl || '',
            audioUrl: uploadedAudioUrl || '',
            model: (document.querySelector('input[name="model"]:checked')||{}).value || 'lipsync-2-pro',
            temperature: parseFloat(document.getElementById('temperature').value),
            activeSpeakerOnly: document.getElementById('activeSpeakerOnly').checked,
            detectObstructions: document.getElementById('detectObstructions').checked,
            apiKey,
            supabaseUrl: (settings.supabaseUrl||''),
            supabaseKey: (settings.supabaseKey||''),
            supabaseBucket: (settings.supabaseBucket||''),
            options: {
              sync_mode: (document.getElementById('syncMode')||{}).value || 'loop',
              temperature: parseFloat(document.getElementById('temperature').value),
              active_speaker_detection: { auto_detect: !!document.getElementById('activeSpeakerOnly').checked },
              occlusion_detection_enabled: !!document.getElementById('detectObstructions').checked
            }
          };
          let resp, data;
          try {
            await ensureAuthToken();
            resp = await fetch('http://127.0.0.1:3000/costs', { method: 'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
            data = await resp.json().catch(()=>null);
          } catch (netErr) {
            // Start backend and retry once (host-aware)
            if (!hasStartedBackendForCost) {
              try {
                if (window.nle && typeof window.nle.startBackend === 'function') {
                  await window.nle.startBackend();
                } else {
                  var hostId = (window.nle && window.nle.getHostId) ? window.nle.getHostId() : 'PPRO';
                  var fn = hostId === 'AEFT' ? 'AEFT_startBackend()' : 'PPRO_startBackend()';
                  if (!cs) cs = new CSInterface();
                  cs.evalScript(fn, function(){});
                }
              } catch(_){ }
              hasStartedBackendForCost = true;
            }
            await new Promise(r=>setTimeout(r, 1200));
            if (!retry) return estimateCost(auto, true);
            throw netErr;
          }
          if (myToken !== costToken) return; // stale
          if (resp.ok && data) {
            let est = [];
            try {
              if (Array.isArray(data.estimate)) est = data.estimate;
              else if (data.estimate && typeof data.estimate === 'object') est = [data.estimate];
            } catch(_){ }
            const val = (est.length && est[0] && typeof est[0].estimatedGenerationCost !== 'undefined') ? Number(est[0].estimatedGenerationCost) : NaN;
            if (isFinite(val)) {
              const txt = `cost: $${val.toFixed(2)}`;
              if (badge){ badge.style.display='block'; badge.textContent = txt; }
              if (display){ display.textContent = txt; }
              try { const below = document.getElementById('costBelow'); if (below){ below.textContent = txt; } } catch(_){ }
            } else {
              try { if (statusEl && data && data.error) statusEl.textContent = String(data.error).slice(0,200); } catch(_){ }
            }
          } else {
            if (myToken !== costToken) return; // stale
            if (badge){ badge.style.display='block'; badge.textContent = 'cost: n/a'; }
            if (display){ display.textContent = 'cost: n/a'; }
            try { if (statusEl && data && data.error) statusEl.textContent = String(data.error).slice(0,200); } catch(_){ }
            try { const below = document.getElementById('costBelow'); if (below){ below.textContent = 'cost: n/a'; } } catch(_){ }
          }
        }catch(e){ if (myToken !== costToken) return; if (badge){ badge.style.display='block'; badge.textContent = 'cost: n/a'; } if (display){ display.textContent = 'cost: n/a'; } try { const below=document.getElementById('costBelow'); if (below){ below.textContent = 'cost: n/a'; } } catch(_){ } }
      }
      
      // When backend is ready, if both inputs were already selected, re-estimate cost
      try {
        window.addEventListener('sync-backend-ready', function(){
          try { if (selectedVideo && selectedAudio) scheduleEstimate(); } catch(_){ }
        });
      } catch(_){ }


