      function saveJobsLocal() {
        try { localStorage.setItem('syncJobs', JSON.stringify(jobs)); } catch(_) {}
      }
      function loadJobsLocal() {
        try {
          const raw = localStorage.getItem('syncJobs');
          if (raw) { jobs = JSON.parse(raw) || []; }
        } catch(_) {}
      }

      async function startLipsync() {
        if (!selectedVideo || !selectedAudio) return;
        const myToken = ++runToken;
        
        const btn = document.getElementById('lipsyncBtn');
        btn.disabled = true;
        btn.textContent = 'generating...';
        document.getElementById('clearBtn').style.display = 'inline-block';
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = 'starting backend...';
        
        // Start backend server (host-agnostic)
        try { await (window.nle && window.nle.startBackend ? window.nle.startBackend() : Promise.resolve({ ok:true })); } catch(_){ }
        if (!cs) cs = new CSInterface();
        cs.evalScript('PPRO_startBackend()', async function(result) {
          console.log('Backend start result:', result);
          if (myToken !== runToken) return;
          statusEl.textContent = 'waiting for backend health...';
          
          await ensureAuthToken();
          const healthy = await waitForHealth(20, 250, myToken);
          if (!healthy) {
            if (myToken !== runToken) return;
            statusEl.textContent = 'backend failed to start (health check failed)';
            btn.disabled = false;
            btn.textContent = 'lipsync';
            document.getElementById('clearBtn').style.display = 'inline-block';
            return;
          }
          if (myToken !== runToken) return;
          statusEl.textContent = 'backend ready. creating job...';
          const mainBtn = document.getElementById('lipsyncBtn');
          if (mainBtn) { mainBtn.textContent = 'rendering…'; mainBtn.disabled = true; }
          
          // Resolve output directory from host project
          let outputDir = null;
          try {
            if (window.nle && typeof window.nle.getProjectDir === 'function') {
              const r = await window.nle.getProjectDir();
              if (r && r.ok && r.outputDir) outputDir = r.outputDir;
              // AE fallback: if no project folder, prefer ~/Documents mode
              if ((!outputDir || !r.ok) && window.nle.getHostId && window.nle.getHostId() === 'AEFT') {
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
            videoPath: selectedVideo,
            audioPath: selectedAudio,
            isTempVideo: !!selectedVideoIsTemp,
            isTempAudio: !!selectedAudioIsTemp,
            model: document.querySelector('input[name="model"]:checked').value,
            temperature: parseFloat(document.getElementById('temperature').value),
            activeSpeakerOnly: document.getElementById('activeSpeakerOnly').checked,
            detectObstructions: document.getElementById('detectObstructions').checked,
            apiKey: document.getElementById('apiKey').value,
            supabaseUrl: (document.getElementById('supabaseUrl').value||'').trim(),
            supabaseKey: (document.getElementById('supabaseKey').value||'').trim(),
            supabaseBucket: (document.getElementById('supabaseBucket').value||'').trim(),
            outputDir: outputDir
          };
          const placeholderId = 'local-' + Date.now();
          const localJob = { id: placeholderId, videoPath: selectedVideo, audioPath: selectedAudio, model: jobData.model, status: 'processing', createdAt: new Date().toISOString(), syncJobId: null, error: null };
          jobs.push(localJob);
          saveJobsLocal();
          updateHistory();
          
          try {
            try { if (currentFetchController) currentFetchController.abort(); } catch(_){ }
            currentFetchController = new AbortController();
            const resp = await fetch('http://localhost:3000/jobs', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(jobData), signal: currentFetchController.signal });
            const text = await resp.text();
            let data = {};
            try { data = JSON.parse(text || '{}'); } catch(_) { data = { error: text }; }
            if (!resp.ok) { throw new Error(data && data.error ? data.error : (text || 'job creation failed')); }
            if (myToken !== runToken) return;
            statusEl.textContent = 'job created: ' + (data.syncJobId || data.id) + '. rendering/transcoding…';
            jobs = jobs.map(j => j.id === placeholderId ? data : j);
            saveJobsLocal();
            updateHistory();
            // show history immediately
            try { showTab('history'); } catch(_) {}
            pollJobStatus(data.id);
          } catch (error) {
            console.error('Error creating job:', error);
            if (myToken !== runToken) return;
            statusEl.textContent = 'job error: ' + error.message;
            jobs = jobs.map(j => j.id === placeholderId ? { ...j, status: 'failed', error: error.message } : j);
            saveJobsLocal();
            updateHistory();
            btn.disabled = false;
            btn.textContent = 'lipsync';
            document.getElementById('clearBtn').style.display = 'inline-block';
          }
        });
      }

      function pollJobStatus(jobId) {
        const interval = setInterval(() => {
          fetch(`http://localhost:3000/jobs/${jobId}`, { headers: authHeaders() })
          .then(response => response.json())
          .then(data => {
            if (data.status === 'completed') {
              clearInterval(interval);
              jobs = jobs.map(j => j.id === jobId ? data : j);
              saveJobsLocal();
              updateHistory();
              
              const statusEl = document.getElementById('statusMessage');
              if (statusEl) statusEl.textContent = 'lipsync completed';
              const btn = document.getElementById('lipsyncBtn');
              btn.style.display = 'none';
              const audioSection = document.getElementById('audioSection');
              if (audioSection) audioSection.style.display = 'none';
              renderOutputVideo(data);
              showPostLipsyncActions(data);
            } else if (data.status === 'failed') {
              clearInterval(interval);
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
          });
        }, 2000);
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
        if (badge) { preview.appendChild(badge); badge.textContent = 'cost: —'; }
        try { updateInputStatus(); } catch(_){ }
      }

      function markSaved(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        const original = btn.textContent;
        const originalBg = btn.style.background;
        const originalBorder = btn.style.borderColor;
        btn.textContent = '✓ saved';
        btn.style.background = '#166534';
        btn.style.borderColor = '#166534';
        setTimeout(()=>{ btn.textContent = original; btn.style.background = originalBg; btn.style.borderColor = originalBorder; }, 2000);
      }
      function markWorking(buttonId, label){
        const btn = document.getElementById(buttonId);
        if (!btn) return ()=>{};
        const original = btn.textContent;
        btn.textContent = label || 'working…';
        btn.disabled = true;
        return function reset(){ btn.textContent = original; btn.disabled = false; };
      }
      function markError(buttonId, message){
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        const original = btn.textContent;
        const originalBg = btn.style.background;
        const originalBorder = btn.style.borderColor;
        btn.textContent = message || 'error';
        btn.style.background = '#7f1d1d';
        btn.style.borderColor = '#7f1d1d';
        setTimeout(()=>{ btn.textContent = original; btn.style.background = originalBg; btn.style.borderColor = originalBorder; }, 2000);
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
          // If project selected but host didn’t resolve, stop here with user-facing error
          if (!targetDir) {
            const statusEl = document.getElementById('statusMessage');
            if (statusEl) statusEl.textContent = 'could not resolve project folder; open/switch to a saved project and try again';
            markError('insert-'+jobId, 'project dir');
            if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
            insertingGuard = false; return;
          }
        }
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        let savedPath = '';
        const reset = markWorking('save-'+jobId, 'saving…');
        try {
          const resp = await fetch(`http://localhost:3000/jobs/${jobId}/save`, { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('save-'+jobId, 'error'); reset(); return; }
        } catch(_){ markError('save-'+jobId, 'error'); reset(); return; }
        if (!savedPath) {
          try { const res = await fetch(`http://localhost:3000/jobs/${jobId}`, { headers: authHeaders() }); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        reset();
        if (savedPath) {
          const fp = savedPath.replace(/\"/g,'\\\"');
          try {
            if (window.nle && typeof window.nle.importFileToBin === 'function') {
              await window.nle.importFileToBin(savedPath, 'sync. outputs');
              markSaved('save-'+jobId);
            } else {
              cs.evalScript(`PPRO_importFileToBin(\"${fp}\", \"sync. outputs\")`, function(){ markSaved('save-'+jobId); });
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
          await new Promise((resolve) => {
            cs.evalScript('PPRO_getProjectDir()', function(resp){
              try { const r = JSON.parse(resp||'{}'); if (r && r.ok && r.outputDir) targetDir = r.outputDir; } catch(_){ }
              resolve();
            });
          });
        }
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        let savedPath = '';
        const reset = markWorking('insert-'+jobId, 'inserting…');
        const mainInsertBtn = document.getElementById('insertBtn');
        const mainInsertWasDisabled = mainInsertBtn ? mainInsertBtn.disabled : false;
        if (mainInsertBtn) { mainInsertBtn.disabled = true; mainInsertBtn.textContent = 'inserting…'; }
        try {
          const resp = await fetch(`http://localhost:3000/jobs/${jobId}/save`, { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        } catch(_){ markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        if (!savedPath) {
          try { const res = await fetch(`http://localhost:3000/jobs/${jobId}`, { headers: authHeaders() }); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        reset();
        if (!savedPath) { markError('insert-'+jobId, 'not ready'); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        const fp = savedPath.replace(/\"/g,'\\\"');
        try {
          if (window.nle && typeof window.nle.insertFileAtPlayhead === 'function') {
            const out = await window.nle.insertFileAtPlayhead(savedPath);
            try {
              const statusEl = document.getElementById('statusMessage');
              if (out && out.ok === true) { if (statusEl) statusEl.textContent = 'inserted' + (out.diag? ' ['+out.diag+']':''); }
              else { if (statusEl) statusEl.textContent = 'insert failed' + (out && out.error ? ' ('+out.error+')' : ''); }
            } catch(_){ }
            if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
            insertingGuard = false;
          } else {
            cs.evalScript(`PPRO_insertFileAtPlayhead(\"${fp}\")`, function(r){
               try {
                 const out = (typeof r === 'string') ? JSON.parse(r) : r;
                 const statusEl = document.getElementById('statusMessage');
                 if (out && out.ok === true) { if (statusEl) statusEl.textContent = 'inserted' + (out.diag? ' ['+out.diag+']':''); }
                 else { if (statusEl) statusEl.textContent = 'insert failed' + (out && out.error ? ' ('+out.error+')' : ''); }
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

      async function loadJobsFromServer() {
        const historyList = document.getElementById('historyList');
        if (historyList && !historyList.innerHTML.trim()) {
          historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">loading…</div>';
        }
        try {
          const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
          if (!apiKey) {
            if (historyList && !historyList.innerHTML.trim()) historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">add your API key in settings to load history</div>';
            return;
          }
          await ensureAuthToken();
          const gen = await fetch('http://127.0.0.1:3000/generations?'+new URLSearchParams({ apiKey }), { headers: authHeaders() }).then(function(r){ return r.json(); }).catch(function(){ return null; });
          if (Array.isArray(gen)) {
            jobs = gen.map(function(g){
              var arr = (g && g.input && g.input.slice) ? g.input.slice() : [];
              var vid = null, aud = null;
              for (var i=0;i<arr.length;i++){ var it = arr[i]; if (it && it.type==='video' && !vid) vid = it; if (it && it.type==='audio' && !aud) aud = it; }
              return {
                id: g && g.id,
                status: (String(g && g.status || '').toLowerCase()==='completed' ? 'completed' : String(g && g.status || 'processing').toLowerCase()),
                model: g && g.model,
                createdAt: g && g.createdAt,
                videoPath: (vid && vid.url) || '',
                audioPath: (aud && aud.url) || '',
                syncJobId: g && g.id,
                outputPath: (g && g.outputUrl) || ''
              };
            });
            saveJobsLocal();
            updateHistory();
            return;
          }
          if (historyList) historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">no generations yet</div>';
        } catch (e) {
          console.warn('Failed to load cloud history');
          if (historyList && !historyList.innerHTML.trim()) historyList.innerHTML = '<div style="color:#f87171; text-align:center; padding:20px;">failed to load history</div>';
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

      function saveOutput() {
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_importFileToBin("${latest.outputPath.replace(/\"/g,'\\\"')}", "sync. outputs")`, function(r){ console.log('save/import result', r); });
      }

      function insertOutput() {
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_insertFileAtPlayhead("${latest.outputPath.replace(/\"/g,'\\\"')}")`, function(r){ console.log('insert result', r); });
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



