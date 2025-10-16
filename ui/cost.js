      function scheduleEstimate(){
        try{ if (estimateTimer) clearTimeout(estimateTimer); }catch(_){ }
        // Debug logging
        try {
          fetch('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'scheduleEstimate_called',
              selectedVideo: selectedVideo || '',
              selectedAudio: selectedAudio || '',
              uploadedVideoUrl: window.uploadedVideoUrl || '',
              uploadedAudioUrl: window.uploadedAudioUrl || '',
              hostConfig: window.HOST_CONFIG
            })
          }).catch(() => {});
        } catch(_){ }
        estimateTimer = setTimeout(()=>estimateCost(true), 800);
      }

      async function estimateCost(auto, retry){
        const statusEl = document.getElementById('statusMessage');
        const display = document.getElementById('costDisplay');
        const badge = document.getElementById('costBadge');
        
        // Debug logging for DOM elements
        try {
          fetch('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'cost_estimation_dom_elements',
              statusEl: !!statusEl,
              display: !!display,
              hostConfig: window.HOST_CONFIG
            })
          }).catch(() => {});
        } catch(_){ }
        const myToken = ++costToken;
        
        // Debug logging
        try {
          fetch('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'estimateCost_called',
              auto: auto,
              retry: retry,
              selectedVideo: selectedVideo || '',
              selectedAudio: selectedAudio || '',
              uploadedVideoUrl: window.uploadedVideoUrl || '',
              uploadedAudioUrl: window.uploadedAudioUrl || '',
              hostConfig: window.HOST_CONFIG
            })
          }).catch(() => {});
        } catch(_){ }
        
        try{
          // Before selection: show $0.00
          if ((!selectedVideo && !selectedVideoUrl) || (!selectedAudio && !selectedAudioUrl)) {
            // Debug logging
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_estimation_no_files',
                  selectedVideo: selectedVideo || '',
                  selectedAudio: selectedAudio || '',
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
            
            // Remove unnecessary status message
            const txt = '$0.00';
            if (display){ display.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; }
            try{ const below=document.getElementById('costBelow'); if (below) below.innerHTML='<span class="cost-label">est. cost:</span> ' + txt; }catch(_){ }
            return;
          }
          const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
          const apiKey = settings.apiKey||'';
          // Check if we have uploaded URLs, direct URLs, OR local file paths for cost estimation
          const hasUploadedUrls = !!(window.uploadedVideoUrl && window.uploadedAudioUrl);
          const hasDirectUrls = !!(window.selectedVideoUrl && window.selectedAudioUrl);
          const hasLocalFiles = !!(selectedVideo && selectedAudio);
          const hasMixedInputs = (window.selectedVideoUrl && selectedAudio) || (selectedVideo && window.selectedAudioUrl);
          const canEstimate = hasUploadedUrls || hasDirectUrls || hasLocalFiles || hasMixedInputs;
          
          // Debug logging for URL state
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'cost_estimation_url_check',
                uploadedVideoUrl: window.uploadedVideoUrl || '',
                uploadedAudioUrl: window.uploadedAudioUrl || '',
                selectedVideoUrl: window.selectedVideoUrl || '',
                selectedAudioUrl: window.selectedAudioUrl || '',
                hasUploadedUrls: hasUploadedUrls,
                hasDirectUrls: hasDirectUrls,
                hasLocalFiles: hasLocalFiles,
                hasMixedInputs: hasMixedInputs,
                canEstimate: canEstimate,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
          
          // If lacking API key, show $--
          if (!apiKey) {
            const txt = '$0.00';
            if (display){ display.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; }
            // Remove unnecessary status message
            try{ const below=document.getElementById('costBelow'); if (below) below.innerHTML='<span class="cost-label">est. cost:</span> ' + txt; }catch(_){ }
            // Debug logging for missing API key
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_estimation_no_api_key',
                  apiKey: apiKey || '',
                  apiKeyLength: (apiKey || '').length,
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
            return;
          }
          
          // If no files selected at all, show estimating and wait
          if (!canEstimate) {
            if (display){ display.innerHTML='<span class="cost-label">est. cost:</span> estimating…'; }
            
            // Remove unnecessary upload status messages
            
            try{ const below=document.getElementById('costBelow'); if (below) below.innerHTML='<span class="cost-label">est. cost:</span> estimating…'; }catch(_){ }
            
            // Debug logging
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_estimation_waiting',
                  uploadedVideoUrl: window.uploadedVideoUrl || '',
                  uploadedAudioUrl: window.uploadedAudioUrl || '',
                  hasUrls: hasUrls,
                  hasLocalFiles: hasLocalFiles,
                  canEstimate: canEstimate,
                  retry: retry,
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
            
            // Retry after a delay if files still not ready, but limit retries
            if (retry !== false && (retry === undefined || retry < 30)) {
              setTimeout(() => estimateCost(auto, (retry || 0) + 1), 2000);
            } else if (retry >= 30) {
              // After 30 retries (60 seconds), show error
              if (display){ display.innerHTML='<span class="cost-label">est. cost:</span> $0.00'; }
              if (typeof window.showToast === 'function') {
                window.showToast('upload timeout - please try again', 'error');
              }
              try{ const below=document.getElementById('costBelow'); if (below) below.innerHTML='<span class="cost-label">est. cost:</span> $0.00'; }catch(_){ }
            }
            return;
          }
          
          // Log what type of inputs we're using for cost estimation
          if (hasDirectUrls) {
            console.log('[Cost] Using direct URLs for estimation:', { selectedVideoUrl: window.selectedVideoUrl, selectedAudioUrl: window.selectedAudioUrl });
          } else if (hasUploadedUrls) {
            console.log('[Cost] Using uploaded URLs for estimation:', { uploadedVideoUrl: window.uploadedVideoUrl, uploadedAudioUrl: window.uploadedAudioUrl });
          } else if (hasLocalFiles) {
            console.log('[Cost] Using local file paths for estimation:', { selectedVideo, selectedAudio });
          } else if (hasMixedInputs) {
            console.log('[Cost] Using mixed inputs for estimation:', { 
              video: window.selectedVideoUrl || selectedVideo, 
              audio: window.selectedAudioUrl || selectedAudio 
            });
          }
          if (display){ display.innerHTML='<span class="cost-label">est. cost:</span> estimating…'; }
          try{ const below=document.getElementById('costBelow'); if (below) below.innerHTML='<span class="cost-label">est. cost:</span> estimating…'; }catch(_){ }
          const body = {
            videoPath: selectedVideo || '',
            audioPath: selectedAudio || '',
            videoUrl: window.uploadedVideoUrl || window.selectedVideoUrl || '',
            audioUrl: window.uploadedAudioUrl || window.selectedAudioUrl || '',
            model: (document.querySelector('input[name="model"]:checked')||{}).value || 'lipsync-2-pro',
            temperature: parseFloat(document.getElementById('temperature').value),
            activeSpeakerOnly: document.getElementById('activeSpeakerOnly').checked,
            detectObstructions: document.getElementById('detectObstructions').checked,
            apiKey,
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
            // Debug logging for cost API request
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_api_request_start',
                  body: body,
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
            
            // Add timeout to cost estimation request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout
            
            resp = await fetch('http://127.0.0.1:3000/costs', { 
              method: 'POST', 
              headers: authHeaders({'Content-Type':'application/json'}), 
              body: JSON.stringify(body),
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            data = await resp.json().catch(()=>null);
            // Debug logging for cost API response
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_api_response',
                  status: resp.status,
                  ok: resp.ok,
                  data: data,
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
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
            // Debug logging for cost calculation
            try {
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'cost_calculation',
                  est: est,
                  val: val,
                  isFinite: isFinite(val),
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            } catch(_){ }
            if (isFinite(val)) {
              const txt = `$${val.toFixed(2)}`;
              if (badge){ badge.style.display='block'; badge.textContent = 'cost: ' + txt; }
              if (display){ display.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; }
              try { const below = document.getElementById('costBelow'); if (below){ below.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; } } catch(_){ }
            } else {
              try { 
                if (typeof window.showToast === 'function' && data && data.error) {
                  window.showToast(String(data.error).toLowerCase().slice(0,200), 'error');
                }
              } catch(_){ }
            }
          } else {
            if (myToken !== costToken) return; // stale
            const txt = '$0.00';
            if (badge){ badge.style.display='block'; badge.textContent = 'cost: ' + txt; }
            if (display){ display.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; }
            try { 
              if (typeof window.showToast === 'function' && data && data.error) {
                window.showToast(String(data.error).slice(0,200), 'error');
              }
            } catch(_){ }
            try { const below = document.getElementById('costBelow'); if (below){ below.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; } } catch(_){ }
          }
        }catch(e){ if (myToken !== costToken) return; const txt = '$0.00'; if (badge){ badge.style.display='block'; badge.textContent = 'cost: ' + txt; } if (display){ display.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; } try { const below=document.getElementById('costBelow'); if (below){ below.innerHTML = '<span class="cost-label">est. cost:</span> ' + txt; } } catch(_){ } }
      }
      
      // When backend is ready, if both inputs were already selected, re-estimate cost
      try {
        window.addEventListener('sync-backend-ready', function(){
          try { if (selectedVideo && selectedAudio) scheduleEstimate(); } catch(_){ }
        });
      } catch(_){ }


