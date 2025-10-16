      function saveJobsLocal() {
        try { localStorage.setItem('syncJobs', JSON.stringify(jobs)); } catch(_) {}
      }
      window.loadJobsLocal = function loadJobsLocal() {
        try {
          const raw = localStorage.getItem('syncJobs');
          if (raw) { 
            jobs = JSON.parse(raw) || []; 
            window.jobs = jobs; // Update global reference
          }
        } catch(_) {}
      }

      async function startLipsync() {
        // Debug logging for job submission
        console.log('[Job Submission] Starting lipsync with:', {
          selectedVideo,
          selectedVideoUrl,
          selectedAudio,
          selectedAudioUrl,
          uploadedVideoUrl: window.uploadedVideoUrl,
          uploadedAudioUrl: window.uploadedAudioUrl,
          hasVideo: !!(selectedVideo || selectedVideoUrl),
          hasAudio: !!(selectedAudio || selectedAudioUrl)
        });
        
        if ((!selectedVideo && !selectedVideoUrl) || (!selectedAudio && !selectedAudioUrl)) {
          console.log('[Job Submission] Missing video or audio - aborting');
          return;
        }
        
        // Check for API key before proceeding
        const apiKey = document.getElementById('apiKey').value;
        if (!apiKey || apiKey.trim() === '') {
          if (typeof window.showToast === 'function') {
            window.showToast('api key required - add it in settings', 'error');
          }
          return;
        }
        
        const myToken = ++runToken;
        
        document.getElementById('clearBtn').style.display = 'inline-block';
        if (typeof window.showToast === 'function') {
          window.showToast('starting backend...', 'info');
        }
        
        // Backend is already started on panel load; skip starting again to avoid AE instability
        if (!cs) cs = new CSInterface();
        ;(async function(){
          if (myToken !== runToken) return;
          if (typeof window.showToast === 'function') {
            window.showToast('waiting for backend health...', 'info');
          }
          
          await ensureAuthToken();
          const healthy = await waitForHealth(20, 250, myToken);
          if (!healthy) {
            if (myToken !== runToken) return;
            if (typeof window.showToast === 'function') {
              window.showToast('backend failed to start (health check failed)', 'error');
            }
            btn.disabled = false;
            btn.textContent = 'lipsync';
            document.getElementById('clearBtn').style.display = 'inline-block';
            return;
          }
          if (myToken !== runToken) return;
          if (typeof window.showToast === 'function') {
            window.showToast('backend ready. creating job...', 'info');
          }
          // Button state is already managed in core.js
          
          // Resolve output directory from host project
          let outputDir = null;
          try {
            if (window.nle && typeof window.nle.getProjectDir === 'function') {
              const r = await window.nle.getProjectDir();
              if (r && r.ok && r.outputDir) outputDir = r.outputDir;
              // AE fallback: if no project folder, prefer ~/Documents mode
              if ((!outputDir || !r.ok) && window.HOST_CONFIG && window.HOST_CONFIG.isAE) {
                try { const r2 = await window.nle.getProjectDir(); if (r2 && r2.ok && r2.outputDir) outputDir = r2.outputDir; } catch(_){ }
              }
            } else {
              await new Promise((resolve) => {
                cs.evalScript('PPRO_getProjectDir()', function(resp){
                  try { const r = JSON.parse(resp || '{}'); if (r && r.ok && r.outputDir) outputDir = r.outputDir; } catch(_) {}
                  resolve();
                });
              });
            }
          } catch(_){ }

          // Create job via backend
          const jobData = {
            videoPath: selectedVideo || '',
            audioPath: selectedAudio || '',
            videoUrl: window.uploadedVideoUrl || window.selectedVideoUrl || '',
            audioUrl: window.uploadedAudioUrl || window.selectedAudioUrl || '',
            isTempVideo: !!selectedVideoIsTemp,
            isTempAudio: !!selectedAudioIsTemp,
            isVideoUrl: !!selectedVideoIsUrl,
            isAudioUrl: !!selectedAudioIsUrl,
            model: document.querySelector('input[name="model"]:checked').value,
            temperature: parseFloat(document.getElementById('temperature').value),
            activeSpeakerOnly: document.getElementById('activeSpeakerOnly').checked,
            detectObstructions: document.getElementById('detectObstructions').checked,
            apiKey: document.getElementById('apiKey').value,
            outputDir: outputDir,
            options: {
              sync_mode: (document.getElementById('syncMode')||{}).value || 'loop',
              temperature: parseFloat(document.getElementById('temperature').value),
              active_speaker_detection: { auto_detect: !!document.getElementById('activeSpeakerOnly').checked },
              occlusion_detection_enabled: !!document.getElementById('detectObstructions').checked
            }
          };
          const placeholderId = 'local-' + Date.now();
          const localJob = { id: placeholderId, videoPath: selectedVideo, audioPath: selectedAudio, model: jobData.model, status: 'processing', createdAt: new Date().toISOString(), syncJobId: null, error: null };
          jobs.push(localJob);
          saveJobsLocal();
          updateHistory();
          
          try {
            try { if (currentFetchController) currentFetchController.abort(); } catch(_){ }
            currentFetchController = new AbortController();
            
            // Debug logging
            try {
              fetchWithTimeout('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  type: 'job_submission_start', 
                  jobData: jobData,
                  hostConfig: window.HOST_CONFIG
                })
              }, 3000).catch(() => {});
            } catch(_){ }
            
            const resp = await fetchWithTimeout(`http://127.0.0.1:${getServerPort()}/jobs`, { 
              method: 'POST', 
              headers: authHeaders({ 'Content-Type': 'application/json' }), 
              body: JSON.stringify(jobData), 
              signal: currentFetchController.signal 
            }, 30000); // 30 second timeout for job submission
            const text = await resp.text();
            let data = {};
            try { data = JSON.parse(text || '{}'); } catch(_) { data = { error: text }; }
            
            // Debug logging
            try {
              fetchWithTimeout('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  type: 'job_submission_response', 
                  respOk: resp.ok,
                  respStatus: resp.status,
                  text: text,
                  data: data,
                  hostConfig: window.HOST_CONFIG
                })
              }, 3000).catch(() => {});
            } catch(_){ }
            
            if (!resp.ok) { throw new Error(data && data.error ? data.error : (text || 'job creation failed')); }
            if (myToken !== runToken) return;
            if (typeof window.showToast === 'function') {
              window.showToast('job successfully submitted', 'success');
            }
            jobs = jobs.map(j => j.id === placeholderId ? data : j);
            saveJobsLocal();
            updateHistory();
            // show history immediately
            try { showTab('history'); } catch(_) {}
            // Show submitted toast when history tab is shown
            if (typeof window.showToast === 'function') {
              window.showToast('submitted', 'success');
            }
            // Keep button disabled until user returns to sources tab
            document.getElementById('clearBtn').style.display = 'inline-block';
            pollJobStatus(data.id);
          } catch (error) {
            console.error('Error creating job:', error);
            if (myToken !== runToken) return;
            if (typeof window.showToast === 'function') {
              window.showToast('job error: ' + error.message, 'error');
            }
            jobs = jobs.map(j => j.id === placeholderId ? { ...j, status: 'failed', error: error.message } : j);
            saveJobsLocal();
            updateHistory();
            btn.disabled = false;
            btn.textContent = 'lipsync';
            document.getElementById('clearBtn').style.display = 'inline-block';
          }
        })();
      }

      // Track active polling intervals for cleanup
      const activePollingIntervals = new Set();
      
      function pollJobStatus(jobId) {
        const interval = setInterval(() => {
          fetchWithTimeout(`http://127.0.0.1:${getServerPort()}/jobs/${jobId}`, { headers: authHeaders() }, 10000)
          .then(response => response.json())
          .then(data => {
            if (data.status === 'completed') {
              clearInterval(interval);
              activePollingIntervals.delete(interval);
              jobs = jobs.map(j => j.id === jobId ? data : j);
              saveJobsLocal();
              updateHistory();
              
              // Only show result if this is the latest completed job
              const latestCompleted = jobs
                .filter(j => j.status === 'completed')
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
              
              if (latestCompleted && latestCompleted.id === jobId) {
                if (typeof window.showToast === 'function') {
                  window.showToast('lipsync completed', 'success');
                }
                const btn = document.getElementById('lipsyncBtn');
                btn.style.display = 'none';
                const audioSection = document.getElementById('audioSection');
                if (audioSection) audioSection.style.display = 'none';
                renderOutputVideo(data);
                showPostLipsyncActions(data);
              }
            } else if (data.status === 'failed') {
              clearInterval(interval);
              activePollingIntervals.delete(interval);
              jobs = jobs.map(j => j.id === jobId ? data : j);
              saveJobsLocal();
              updateHistory();
              const btn = document.getElementById('lipsyncBtn');
              btn.disabled = false;
              btn.textContent = 'lipsync';
              document.getElementById('postActions').style.display = 'none';
            }
          })
          .catch(error => {
            console.error('Error polling job:', error);
            clearInterval(interval);
            activePollingIntervals.delete(interval);
          });
        }, 2000);
        
        activePollingIntervals.add(interval);
        
        // Auto-cleanup after 10 minutes to prevent memory leaks
        setTimeout(() => {
          if (activePollingIntervals.has(interval)) {
            clearInterval(interval);
            activePollingIntervals.delete(interval);
          }
        }, 600000); // 10 minutes
      }

      function clearSelection() {
        try { if (currentFetchController) currentFetchController.abort(); } catch(_) {}
        currentFetchController = null;
        runToken++;
        selectedVideo = null;
        selectedAudio = null;
        selectedVideoIsTemp = false;
        selectedAudioIsTemp = false;
        updateInputStatus();
        const btn = document.getElementById('lipsyncBtn');
        btn.disabled = true;
        btn.textContent = 'lipsync';
        document.getElementById('clearBtn').style.display = 'none';
        document.getElementById('postActions').style.display = 'none';
        const preview = document.getElementById('preview');
        const badge = document.getElementById('costIndicator');
        preview.innerHTML = '';
        if (badge) { preview.appendChild(badge); badge.textContent = 'cost: $0.00'; }
        try { updateInputStatus(); } catch(_){ }
      }

      function markSaved(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        
        // Show toast notification
        if (typeof window.showToast === 'function') {
          window.showToast('successfully saved', 'success');
        }
        
        // Restore button to original structure
        // For save button: cloud-download icon + "save" text
        btn.innerHTML = '<i data-lucide="cloud-download"></i><span>save</span>';
        btn.disabled = false;
        
        // Re-initialize Lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
          lucide.createIcons();
        }
      }
      function markWorking(buttonId, label){
        const btn = document.getElementById(buttonId);
        if (!btn) return ()=>{};
        
        // Store original button structure (including icons)
        const originalHTML = btn.innerHTML;
        const originalText = btn.textContent;
        
        // Show working state
        btn.textContent = label || 'working…';
        btn.disabled = true;
        
        return function reset(){ 
          // Restore original structure and re-initialize icons
          btn.innerHTML = originalHTML;
          btn.disabled = false;
          
          // Re-initialize Lucide icons
          if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
          }
        };
      }
      function markError(buttonId, message){
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        
        // Show toast notification
        if (typeof window.showToast === 'function') {
          window.showToast(message || 'save failed', 'error');
        }
        
        // Restore button to original structure based on button type
        if (buttonId.startsWith('save-')) {
          btn.innerHTML = '<i data-lucide="cloud-download"></i><span>save</span>';
        } else if (buttonId.startsWith('insert-')) {
          btn.innerHTML = '<i data-lucide="copy-plus"></i><span>insert</span>';
        }
        btn.disabled = false;
        
        // Re-initialize Lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
          lucide.createIcons();
        }
      }

      async function saveJob(jobId) {
        const job = jobs.find(j => String(j.id) === String(jobId)) || { id: jobId, status: 'completed' };
        const saveLocation = (document.querySelector('input[name="saveLocation"]:checked')||{}).value || 'project';
        let location = saveLocation === 'documents' ? 'documents' : 'project';
        let targetDir = '';
        if (location === 'project') {
          try {
            if (window.nle && typeof window.nle.getProjectDir === 'function') {
              const r = await window.nle.getProjectDir();
              if (r && r.ok && r.outputDir) targetDir = r.outputDir;
            } else {
              await new Promise((resolve) => {
                cs.evalScript('PPRO_getProjectDir()', function(resp){
                  try { const r = JSON.parse(resp||'{}'); if (r && r.ok && r.outputDir) targetDir = r.outputDir; } catch(_){ }
                  resolve();
                });
              });
            }
          } catch(_){ }
          // If project selected but host didn’t resolve, fallback to Documents in AE
          try {
            if (!targetDir && window.HOST_CONFIG && window.HOST_CONFIG.isAE) {
              location = 'documents';
            }
          } catch(_){ }
        }
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        let savedPath = '';
        const reset = markWorking('save-'+jobId, 'saving…');
        try {
          const resp = await fetch(`http://127.0.0.1:${getServerPort()}/jobs/${jobId}/save`, { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('save-'+jobId, 'error'); reset(); return; }
        } catch(_){ markError('save-'+jobId, 'error'); reset(); return; }
        if (!savedPath) {
          try { const res = await fetch(`http://127.0.0.1:${getServerPort()}/jobs/${jobId}`, { headers: authHeaders() }); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        // Wait briefly for file to exist on disk if path looks local
        try {
          if (savedPath && savedPath.indexOf('://') === -1) {
            if (!cs) cs = new CSInterface();
            const safe = String(savedPath).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            let tries = 0; let exists = false;
            while (tries < 20 && !exists) {
              await new Promise(resolve=>{
                const es = `(function(){try{var f=new File("${safe}");return (f&&f.exists)?'1':'0';}catch(e){return '0';}})()`;
                cs.evalScript(es, function(r){ exists = String(r||'0')==='1'; resolve(); });
              });
              if (!exists) await new Promise(r=>setTimeout(r, 250));
              tries++;
            }
          }
        } catch(_){ }
        reset();
        if (savedPath) {
          const fp = savedPath.replace(/\"/g,'\\\"');
          try {
            if (!cs) cs = new CSInterface();
            const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
            
            // File logging for debugging
            function logToFile(msg) {
              try {
                var logPath = (function(){
                  try {
                    var dir = '';
                    if (window.CSInterface) {
                      var cs2 = new CSInterface();
                      cs2.evalScript('(typeof SYNC_getLogDir===\'function\'?SYNC_getLogDir():\'\')', function(r){ dir = r||''; });
                    }
                    if (dir) return dir + ((navigator.platform && navigator.platform.indexOf('Win') !== -1) ? '\\' : '/') + 'sync_save_debug.log';
                  } catch(_){ }
                  if (navigator.platform && navigator.platform.indexOf('Win') !== -1) return 'C:\\temp\\sync_save_debug.log';
                  try{ if (typeof require !== 'undefined'){ return require('os').tmpdir() + '/sync_save_debug.log'; } }catch(_){ }
                  return '/tmp/sync_save_debug.log';
                })();
                // Only write when debug flag file exists
                try{ if (typeof require !== 'undefined'){ var fs2=require('fs'); var path2=require('path'); var base=logPath.replace(/(\\|\/)sync_save_debug\.log$/,''); if(!fs2.existsSync(path2.join(base,'debug.enabled'))){ return; } } }catch(_){ }
                var logFile = new File(logPath);
                logFile.open('a');
                logFile.write('[' + new Date().toISOString() + '] ' + msg + '\n');
                logFile.close();
              } catch(e) {}
            }
            
            logToFile('[AE Save] Host detection result: ' + isAE);
            
            if (isAE) {
              try {
                const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
                logToFile('[AE Save] Extension path: ' + extPath);
                logToFile('[AE Save] File path: ' + fp);
                
                // Use HOST_CONFIG for reliable host detection
                const hostFile = isAE ? 'ae.jsx' : 'ppro.jsx';
                const payload = JSON.stringify({ path: savedPath, binName: 'sync. outputs' }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
                const importFunc = isAE ? 'AEFT_importFileToBin' : 'PPRO_importFileToBin';
                cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\"); ${importFunc}(\"${payload}\")`, function(r){
                  logToFile('[AE Save] Raw response: ' + String(r));
                  let ok = false; let out = null;
                  try { 
                    // Handle different response types
                    if (typeof r === 'string') {
                      // Try to parse as JSON first
                      try {
                        out = JSON.parse(r||'{}');
                      } catch(parseErr) {
                        // If not JSON, check if it's "[object Object]" which means success
                        if (r === '[object Object]' || r.indexOf('ok') !== -1) {
                          out = { ok: true };
                        } else {
                          out = { ok: false, error: r };
                        }
                      }
                    } else if (typeof r === 'object' && r !== null) {
                      out = r;
                    } else {
                      out = { ok: false, error: String(r) };
                    }
                    
                    ok = !!(out && out.ok); 
                    logToFile('[AE Save] Parsed result: ' + JSON.stringify(out) + ' ok: ' + ok);
                  } catch(e){ 
                    logToFile('[AE Save] Parse error: ' + String(e) + ' raw: ' + String(r)); 
                    ok = false; 
                  }
                  
                  if (ok) { 
                    logToFile('[AE Save] SUCCESS - marking saved');
                    markSaved('save-'+jobId); 
                  } else { 
                    logToFile('[AE Save] FAILED - marking error');
                    markError('save-'+jobId, 'error'); 
                  }
                });
              } catch(e) {
                logToFile('[AE Save] Error: ' + String(e));
                markError('save-'+jobId, 'error');
              }
            } else {
            // PPro fallback
            const payload = JSON.stringify({ path: savedPath, binName: 'sync. outputs' }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            cs.evalScript(`PPRO_importFileToBin(\"${payload}\")`, function(r){ try{ var j=(typeof r==='string')?JSON.parse(r):r; if(j&&j.ok){ markSaved('save-'+jobId); } else { markError('save-'+jobId,'error'); } }catch(_){ markError('save-'+jobId,'error'); } });
            }
          } catch(_){ markError('save-'+jobId, 'error'); }
        } else {
          markError('save-'+jobId, 'not ready');
        }
      }

      async function insertJob(jobId) {
        if (insertingGuard) return; insertingGuard = true;
        const job = jobs.find(j => String(j.id) === String(jobId)) || { id: jobId, status: 'completed' };
        const saveLocation = (document.querySelector('input[name="saveLocation"]:checked')||{}).value || 'project';
        let location = saveLocation === 'documents' ? 'documents' : 'project';
        let targetDir = '';
        if (location === 'project') {
          try {
            if (window.nle && typeof window.nle.getProjectDir === 'function') {
              const r = await window.nle.getProjectDir();
              if (r && r.ok && r.outputDir) targetDir = r.outputDir;
            } else {
              await new Promise((resolve) => {
                cs.evalScript('PPRO_getProjectDir()', function(resp){
                  try { const r = JSON.parse(resp||'{}'); if (r && r.ok && r.outputDir) targetDir = r.outputDir; } catch(_){ }
                  resolve();
                });
              });
            }
          } catch(_){ }
          // If project selected but host didn’t resolve, fallback to Documents in AE
          try {
            if (!targetDir && window.HOST_CONFIG && window.HOST_CONFIG.isAE) {
              location = 'documents';
            }
          } catch(_){ }
        }
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        let savedPath = '';
        const reset = markWorking('insert-'+jobId, 'inserting…');
        const mainInsertBtn = document.getElementById('insertBtn');
        const mainInsertWasDisabled = mainInsertBtn ? mainInsertBtn.disabled : false;
        if (mainInsertBtn) { mainInsertBtn.disabled = true; mainInsertBtn.textContent = 'inserting…'; }
        try {
          const resp = await fetch(`http://127.0.0.1:${getServerPort()}/jobs/${jobId}/save`, { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        } catch(_){ markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        if (!savedPath) {
          try { const res = await fetch(`http://127.0.0.1:${getServerPort()}/jobs/${jobId}`, { headers: authHeaders() }); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        reset();
        if (!savedPath) { markError('insert-'+jobId, 'not ready'); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        const fp = savedPath.replace(/\"/g,'\\\"');
        try {
          if (!cs) cs = new CSInterface();
          const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
          
          // File logging for debugging
            function logToFile(msg) {
            try {
              var logPath = (function(){
                try {
                  var dir = '';
                  if (window.CSInterface) {
                    var cs3 = new CSInterface();
                    cs3.evalScript('(typeof SYNC_getLogDir===\'function\'?SYNC_getLogDir():\'\')', function(r){ dir = r||''; });
                  }
                  if (dir) return dir + ((navigator.platform && navigator.platform.indexOf('Win') !== -1) ? '\\' : '/') + 'sync_insert_debug.log';
                } catch(_){ }
                if (navigator.platform && navigator.platform.indexOf('Win') !== -1) return 'C:\\temp\\sync_insert_debug.log';
                try{ if (typeof require !== 'undefined'){ return require('os').tmpdir() + '/sync_insert_debug.log'; } }catch(_){ }
                return '/tmp/sync_insert_debug.log';
              })();
              // Only write when debug flag file exists
              try{ if (typeof require !== 'undefined'){ var fs3=require('fs'); var path3=require('path'); var base=logPath.replace(/(\\|\/)sync_insert_debug\.log$/,''); if(!fs3.existsSync(path3.join(base,'debug.enabled'))){ return; } } }catch(_){ }
              var logFile = new File(logPath);
              logFile.open('a');
              logFile.write('[' + new Date().toISOString() + '] ' + msg + '\n');
              logFile.close();
            } catch(e) {}
          }
          
          logToFile('[AE Insert] Host detection result: ' + isAE);
          
          if (isAE) {
            try {
              const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
              logToFile('[AE Insert] Extension path: ' + extPath);
              logToFile('[AE Insert] File path: ' + fp);
              
              // Use HOST_CONFIG for reliable host detection
              const hostFile = isAE ? 'ae.jsx' : 'ppro.jsx';
              const insertFunc = isAE ? 'AEFT_insertFileAtPlayhead' : 'PPRO_insertFileAtPlayhead';
              cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\"); ${insertFunc}(\"${fp.replace(/\\/g,'\\\\')}\")`, function(r){
                logToFile('[AE Insert] Raw response: ' + String(r));
                let out = null;
                try { 
                  // Handle different response types
                  if (typeof r === 'string') {
                    // Try to parse as JSON first
                    try {
                      out = JSON.parse(r||'{}');
                    } catch(parseErr) {
                      // If not JSON, check if it's "[object Object]" which means success
                      if (r === '[object Object]' || r.indexOf('ok') !== -1) {
                        out = { ok: true };
                      } else {
                        out = { ok: false, error: r };
                      }
                    }
                  } else if (typeof r === 'object' && r !== null) {
                    out = r;
                  } else {
                    out = { ok: false, error: String(r) };
                  }
                  
                  logToFile('[AE Insert] Parsed result: ' + JSON.stringify(out));
                } catch(e){ 
                  logToFile('[AE Insert] Parse error: ' + String(e) + ' raw: ' + String(r)); 
                  out = { ok: false, error: 'Parse error' };
                }
                
                try {
                  if (out && out.ok === true) { 
                    logToFile('[AE Insert] SUCCESS - marking inserted');
                    if (typeof window.showToast === 'function') {
                      window.showToast('inserted' + (out.diag? ' ['+out.diag+']':''), 'success');
                    }
                  } else { 
                    logToFile('[AE Insert] FAILED - marking error: ' + (out && out.error ? out.error : 'unknown'));
                    if (typeof window.showToast === 'function') {
                      window.showToast('insert failed' + (out && out.error ? ' ('+out.error+')' : ''), 'error');
                    }
                  }
                } catch(_){ }
                if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
                insertingGuard = false;
              });
            } catch(e) {
              logToFile('[AE Insert] Error: ' + String(e));
              if (typeof window.showToast === 'function') {
                window.showToast('insert failed (error)', 'error');
              }
              if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
              insertingGuard = false;
            }
          } else {
            // PPro fallback
            const payload = JSON.stringify({ path: savedPath }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            cs.evalScript(`PPRO_insertFileAtPlayhead(\"${payload}\")`, function(r){
               try {
                 const out = (typeof r === 'string') ? JSON.parse(r) : r;
                 if (out && out.ok === true) { 
                   if (typeof window.showToast === 'function') {
                     window.showToast('inserted' + (out.diag? ' ['+out.diag+']':''), 'success');
                   }
                 } else { 
                   if (typeof window.showToast === 'function') {
                     window.showToast('insert failed' + (out && out.error ? ' ('+out.error+')' : ''), 'error');
                   }
                 }
               } catch(_){ }
               if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
               insertingGuard = false;
             });
          }
        } catch(_){
          markError('insert-'+jobId, 'error');
          if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
          insertingGuard = false;
        }
      }

      // Timeout wrapper for fetch requests to prevent hanging
      async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error('Request timeout');
          }
          throw error;
        }
      }

      window.loadJobsFromServer = async function loadJobsFromServer() {
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
          const apiKey = settings.syncApiKey || settings.apiKey || '';
          
          if (!apiKey) {
            console.log('[Jobs] No API key, skipping server load');
            return;
          }
          
          // Check server health first
          let healthy = false;
          try { 
            const r = await fetchWithTimeout('http://127.0.0.1:3000/health', { cache:'no-store' }, 5000); 
            healthy = !!(r && r.ok); 
          } catch(_){ 
            healthy = false; 
          }
          
          if (!healthy) {
            console.log('[Jobs] Server not healthy, skipping load');
            return;
          }
          
          await ensureAuthToken();
          const gen = await fetchWithTimeout(`http://127.0.0.1:${getServerPort()}/generations?`+new URLSearchParams({ apiKey }), { headers: authHeaders() }, 15000)
            .then(function(r){ return r.json(); })
            .catch(function(){ return null; });
          
          if (Array.isArray(gen)) {
            jobs = gen.map(function(g){
              var arr = (g && g.input && g.input.slice) ? g.input.slice() : [];
              var vid = null, aud = null;
              for (var i=0;i<arr.length;i++){ var it = arr[i]; if (it && it.type==='video' && !vid) vid = it; if (it && it.type==='audio' && !aud) aud = it; }
              
              
              return {
                id: g && g.id,
                status: String(g && g.status || 'processing').toLowerCase(),
                model: g && g.model,
                createdAt: g && g.createdAt,
                completedAt: g && g.completedAt,
                videoPath: (vid && vid.url) || '',
                audioPath: (aud && aud.url) || '',
                syncJobId: g && g.id,
                outputPath: (g && g.outputUrl) || '',
                options: g && g.options || {}
              };
            });
            // Store jobs globally for history.js to use
            window.jobs = jobs;
            saveJobsLocal();
            console.log('[Jobs] Loaded', jobs.length, 'jobs from server');
            return jobs;
          }
        } catch (e) {
          console.warn('[Jobs] Failed to load from server:', e);
        }
      }

      async function saveCompletedJob(jobId) { await saveJob(jobId); }
      async function insertCompletedJob(jobId) { await insertJob(jobId); }

      function clearCompletedJob() {
        selectedVideo = null;
        selectedAudio = null;
        selectedVideoIsTemp = false;
        selectedAudioIsTemp = false;
        const btn = document.getElementById('lipsyncBtn');
        btn.style.display = 'flex';
        btn.disabled = true;
        btn.textContent = 'lipsync';
        const audioSection = document.getElementById('audioSection');
        if (audioSection) audioSection.style.display = 'block';
        const actions = document.getElementById('postLipsyncActions');
        if (actions) actions.remove();
        renderInputPreview();
        updateInputStatus();
      }

      async function saveOutput() {
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        try {
          if (window.nle && typeof window.nle.importFileToBin === 'function') {
            await window.nle.importFileToBin(latest.outputPath, 'sync. outputs');
          } else {
            if (!cs) cs = new CSInterface();
            cs.evalScript(`PPRO_importFileToBin("${latest.outputPath.replace(/\"/g,'\\\"')}", "sync. outputs")`, function(r){ console.log('save/import result', r); });
          }
        } catch(_){ }
      }

      async function insertOutput() {
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        try {
          if (window.nle && typeof window.nle.insertFileAtPlayhead === 'function') {
            await window.nle.insertFileAtPlayhead(latest.outputPath);
          } else {
            if (!cs) cs = new CSInterface();
            cs.evalScript(`PPRO_insertFileAtPlayhead("${latest.outputPath.replace(/\"/g,'\\\"')}")`, function(r){ console.log('insert result', r); });
          }
        } catch(_){ }
      }

      async function saveLatest(){
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed') return;
        return saveJob(String(latest.id));
      }
      async function insertLatest(){
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed') return;
        return insertJob(String(latest.id));
      }



