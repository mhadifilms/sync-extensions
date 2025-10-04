      let cs = null;
      let selectedVideo = null;
      let selectedAudio = null;
      let jobs = [];
      let insertingGuard = false;
      let runToken = 0;
      let currentFetchController = null;
      
      let selectedVideoIsTemp = false;
      let selectedAudioIsTemp = false;
      let estimateTimer = null;
      let hasStartedBackendForCost = false;

      let uploadedVideoUrl = '';
      let uploadedAudioUrl = '';
      let costToken = 0;
      
      // UI logger to local server
      function uiLog(msg){
        try { fetch('http://127.0.0.1:3000/hostlog', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ msg: String(msg||'') }) }).catch(()=>{}); } catch(_) {}
      }
      
      // Helper to call JSX with JSON payload and parse JSON response (with auto-load + retry)
      function evalExtendScript(fn, payload) {
        if (!cs) cs = new CSInterface();
        const arg = JSON.stringify(payload || {});
        function callOnce() {
          return new Promise((resolve) => {
            cs.evalScript(`${fn}(${JSON.stringify(arg)})`, function(res){
              let out = null;
              try { out = (typeof res === 'string') ? JSON.parse(res) : res; } catch(_) {}
              if (!out || typeof out !== 'object' || out.ok === undefined) {
                // Fallback: treat raw string as a selected path
                if (res && typeof res === 'string' && res.indexOf('/') !== -1) {
                  resolve({ ok: true, path: res, _local: true });
                  return;
                }
                resolve({ ok:false, error: String(res || 'no response'), _local: true });
                return;
              }
              resolve(out);
            });
          });
        }
        return new Promise(async (resolve) => {
          const result = await callOnce();
          // Do not auto-retry here to avoid triggering a second dialog
          resolve(result);
        });
      }

      // Single inline ExtendScript picker (host-independent) to avoid host bridge issues
      let __pickerBusy = false;
      async function openFileDialog(kind) {
        if (__pickerBusy) { return ''; }
        __pickerBusy = true;
        try {
          const k = (typeof kind === 'string' ? kind : 'video');
          if (!cs) cs = new CSInterface();
          const es = (
            "(function(){\n"+
            "  try{\n"+
            "    var kind = " + JSON.stringify(k) + ";\n"+
            "    var allow = (kind === 'audio') ? { wav:1, mp3:1, aac:1, aif:1, aiff:1, m4a:1 } : { mov:1, mp4:1, mxf:1, mkv:1, avi:1, m4v:1, mpg:1, mpeg:1 };\n"+
            "    var file = null;\n"+
            "    try {\n"+
            "      if ($.os && $.os.toString().indexOf('Windows') !== -1) {\n"+
            "        var filterStr = (kind === 'audio') ? 'Audio files:*.wav;*.mp3;*.aac;*.aif;*.aiff;*.m4a' : 'Video files:*.mov;*.mp4;*.mxf;*.mkv;*.avi;*.m4v;*.mpg;*.mpeg';\n"+
            "        file = File.openDialog('Select ' + kind + ' file', filterStr);\n"+
            "      } else {\n"+
            "        var fn = function(f){ try { if (f instanceof Folder) return true; var n = (f && f.name) ? String(f.name).toLowerCase() : ''; var i = n.lastIndexOf('.'); if (i < 0) return false; var ext = n.substring(i+1); return allow[ext] === 1; } catch (e) { return true; } };\n"+
            "        file = File.openDialog('Select ' + kind + ' file', fn);\n"+
            "      }\n"+
            "    } catch (_) { return 'ERROR: dialog failed ' + String(_); }\n"+
            "    if (file && file.exists) {\n"+
            "      try { var n = String(file.name || '').toLowerCase(); var i = n.lastIndexOf('.'); var ext = (i >= 0) ? n.substring(i+1) : ''; if (allow[ext] !== 1) { return 'ERROR: Invalid file type'; } } catch(e) { return 'ERROR: type check ' + String(e); }\n"+
            "      return file.fsName;\n"+
            "    }\n"+
            "    return 'ERROR: No file selected';\n"+
            "  } catch(e) {\n"+
            "    return 'ERROR: ' + String(e);\n"+
            "  }\n"+
            "})()"
          );
          const inlineRes = await new Promise(resolve => { try { cs.evalScript(es, function(r){ resolve(r); }); } catch(e){ resolve(''); } });
          if (inlineRes && typeof inlineRes === 'string' && inlineRes.indexOf('/') !== -1) {
            return inlineRes;
          } else if (inlineRes && inlineRes.startsWith('ERROR:')) {
            console.warn(inlineRes);
            return '';
          } else {
            return '';
          }
        } finally {
          __pickerBusy = false;
        }
      }
      
      function showTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
          tab.classList.remove('active');
        });
        document.querySelectorAll('.tab').forEach(tab => {
          tab.classList.remove('active');
        });
        
        // Show selected tab
        document.getElementById(tabName).classList.add('active');
        document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
        
        // Ensure history is always populated when shown
        if (tabName === 'history') {
          try { updateHistory(); } catch(_) {}
          try { loadJobsFromServer(); } catch(_) {}
        }
      }
      
      async function selectVideo() {
        try {
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'opening video picker…'; } catch(_){ }
          const raw = await openFileDialog('video');
          if (raw && raw.indexOf('/') !== -1) {
            selectedVideoIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {mov:1,mp4:1,mxf:1,mkv:1,avi:1,m4v:1,mpg:1,mpeg:1}[ext] === 1;
            if (!ok) { try { statusEl.textContent = 'please select a video file'; } catch(_){ } return; }
            // 1GB guard via ExtendScript stat
            const size = await new Promise(resolve=>{ const safe = String(raw).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';}})()`; cs.evalScript(es, function(r){ var n=Number(r||0); resolve(isNaN(n)?0:n); }); });
            if (size > 1024*1024*1024) { try { statusEl.textContent = 'video exceeds 1GB (not allowed)'; } catch(_){ } return; }
            selectedVideo = raw;
            updateLipsyncButton();
            renderInputPreview();
            try { statusEl.textContent = 'uploading video…'; } catch(_){ }
            // Immediate upload to Supabase for cost/job
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedVideo, apiKey: settings.apiKey||'', supabaseUrl: (settings.supabaseUrl||''), supabaseKey: (settings.supabaseKey||''), supabaseBucket: (settings.supabaseBucket||'') };
              const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
              const j = await r.json().catch(()=>null);
              if (r.ok && j && j.ok && j.url){ uploadedVideoUrl = j.url; }
            }catch(_){ }
            try { statusEl.textContent = ''; } catch(_){ }
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            console.warn('No video selected');
            try { statusEl.textContent = 'no video selected'; } catch(_){ }
          }
        } catch (_) { console.warn('Video select failed'); }
      }
      
      async function selectAudio() {
        try {
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'opening audio picker…'; } catch(_){ }
          const raw = await openFileDialog('audio');
          if (raw && raw.indexOf('/') !== -1) {
            selectedAudioIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {wav:1,mp3:1,aac:1,aif:1,aiff:1,m4a:1}[ext] === 1;
            if (!ok) { try { statusEl.textContent = 'please select an audio file'; } catch(_){ } return; }
            const size = await new Promise(resolve=>{ const safe = String(raw).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';}})()`; cs.evalScript(es, function(r){ var n=Number(r||0); resolve(isNaN(n)?0:n); }); });
            if (size > 1024*1024*1024) { try { statusEl.textContent = 'audio exceeds 1GB (not allowed)'; } catch(_){ } return; }
            selectedAudio = raw;
            updateLipsyncButton();
            renderInputPreview();
            updateInputStatus();
            try { statusEl.textContent = 'uploading audio…'; } catch(_){ }
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedAudio, apiKey: settings.apiKey||'', supabaseUrl: (settings.supabaseUrl||''), supabaseKey: (settings.supabaseKey||''), supabaseBucket: (settings.supabaseBucket||'') };
              const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
              const j = await r.json().catch(()=>null);
              if (r.ok && j && j.ok && j.url){ uploadedAudioUrl = j.url; }
            }catch(_){ }
            try { updateInputStatus(); } catch(_){ }
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            console.warn('No audio selected');
            try { updateInputStatus(); } catch(_){ }
          }
        } catch (_) { console.warn('Audio select failed'); }
      }
      
      async function selectVideoInOut(){
        try{
          const statusEl = document.getElementById('statusMessage');
          if (statusEl) statusEl.textContent = 'rendering video in/out…';
          const codec = document.getElementById('renderVideo').value || 'h264';
          const res = await evalExtendScript('PPRO_exportInOutVideo', { codec });
          if (res && res.ok && res.path){
            selectedVideo = res.path; selectedVideoIsTemp = true;
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            if (statusEl) statusEl.textContent = 'video in/out export failed: ' + (res && res.error ? res.error : 'unknown') + (res && res.eprRoot ? (' root=' + res.eprRoot) : '') + (res && res.preset ? (' preset=' + res.preset) : '');
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){}}
      }

      async function selectAudioInOut(){
        try{
          const statusEl = document.getElementById('statusMessage');
          if (statusEl) statusEl.textContent = 'rendering audio in/out…';
          const format = document.getElementById('renderAudio').value || 'wav';
          const res = await evalExtendScript('PPRO_exportInOutAudio', { format });
          if (res && res.ok && res.path){
            selectedAudio = res.path; selectedAudioIsTemp = true;
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            if (statusEl) statusEl.textContent = 'audio in/out export failed: ' + (res && res.error ? res.error : 'unknown');
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){}}
      }
      
      function updateLipsyncButton() {
        const btn = document.getElementById('lipsyncBtn');
        if (selectedVideo && selectedAudio) {
          btn.disabled = false;
        } else {
          btn.disabled = true;
        }
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
        
        // Start backend server
        if (!cs) cs = new CSInterface();
        cs.evalScript('PPRO_startBackend()', async function(result) {
          console.log('Backend start result:', result);
          if (myToken !== runToken) return;
          statusEl.textContent = 'waiting for backend health...';
          
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
          
          // Resolve output directory from Premiere project
          let outputDir = null;
          await new Promise((resolve) => {
            cs.evalScript('PPRO_getProjectDir()', function(resp){
              try {
                const r = JSON.parse(resp || '{}');
                if (r && r.ok && r.outputDir) outputDir = r.outputDir;
              } catch(_) {}
              resolve();
            });
          });

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
          
          console.log('POST /jobs', jobData);
          try {
            try { if (currentFetchController) currentFetchController.abort(); } catch(_){ }
            currentFetchController = new AbortController();
            const resp = await fetch('http://localhost:3000/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobData), signal: currentFetchController.signal });
            const text = await resp.text();
            let data = {};
            try { data = JSON.parse(text || '{}'); } catch(_) { data = { error: text }; }
            if (!resp.ok) { throw new Error(data && data.error ? data.error : (text || 'job creation failed')); }
            console.log('Job created:', data);
            if (myToken !== runToken) return;
            statusEl.textContent = 'job created: ' + (data.syncJobId || data.id) + '. polling status...';
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

      async function waitForHealth(maxAttempts = 20, delayMs = 250, expectedToken) {
        for (let i = 0; i < maxAttempts; i++) {
          try {
            const resp = await fetch('http://localhost:3000/health', { cache: 'no-store' });
            if (resp.ok) return true;
          } catch (e) {
            // ignore until attempts exhausted
          }
          if (expectedToken != null && expectedToken !== runToken) return false;
          await new Promise(r => setTimeout(r, delayMs));
        }
        return false;
      }
      
      function pollJobStatus(jobId) {
        const interval = setInterval(() => {
          fetch(`http://localhost:3000/jobs/${jobId}`)
          .then(response => response.json())
          .then(data => {
            if (data.status === 'completed') {
              clearInterval(interval);
              jobs = jobs.map(j => j.id === jobId ? data : j);
              saveJobsLocal();
              updateHistory();
              
              // Update status message
              const statusEl = document.getElementById('statusMessage');
              if (statusEl) statusEl.textContent = 'lipsync completed';
              
              // Hide lipsync button and show completion state
              const btn = document.getElementById('lipsyncBtn');
              btn.style.display = 'none';
              
              // Hide audio player and show output video
              const audioSection = document.getElementById('audioSection');
              if (audioSection) audioSection.style.display = 'none';
              
              // Update video player with output
              renderOutputVideo(data);
              
              // Show post-lipsync actions
              showPostLipsyncActions(data);
            } else if (data.status === 'failed') {
              clearInterval(interval);
              jobs = jobs.map(j => j.id === jobId ? data : j);
              saveJobsLocal();
              updateHistory();
              // Re-enable UI for next attempt
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
      
      function updateHistory() {
        const historyList = document.getElementById('historyList');
        // Always show last known jobs (persisted)
        const sorted = jobs.slice().sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
        historyList.innerHTML = (sorted.length ? sorted : []).map(job => {
          const started = job.createdAt ? new Date(job.createdAt).toLocaleString() : '';
          const vName = niceName(job.videoPath, 'video');
          const aName = niceName(job.audioPath, 'audio');
          const base = `
            <div class="history-item">
              <div class="history-status ${job.status}">${job.status}</div>
              <div style=\"font-size:12px;color:#888;\">${(job.syncJobId || job.id) ? '<span class=\\"jid\\" data-id=\\"'+(job.syncJobId || job.id)+'\\" tabindex=\\"0\\" role=\\"button\\" title=\\"click to copy\\" style=\\"cursor:pointer;\\">job id '+(job.syncJobId || job.id)+'</span>' : ''} • ${job.model || ''} • ${started}</div>
              <div>${vName}${aName ? ' + '+aName : ''}</div>
              ${job.error ? `<div style=\"font-size:12px;color:#f87171;margin-top:6px;\">${job.error}</div>` : ''}
          `;
          const done = job.status === 'completed' ? `
              <div class=\"history-actions\">\n                <button class=\"history-button\" id=\"save-${job.id}\" onclick=\"saveJob('${job.id}')\">save</button>\n                <button class=\"history-button\" id=\"insert-${job.id}\" onclick=\"insertJob('${job.id}')\">insert</button>\n        </div>
            </div>` : `
              <div class=\"history-actions\">\n                \n        </div>
            </div>`;
          return base + done;
        }).join('') || '<div style="color: #666; text-align: center; padding: 20px;">no generations yet</div>';
      }

      // Delegate jid click/Enter-to-copy
      function copyJobId(el){
        const id = el.getAttribute('data-id');
        if (!id) return;
        try { navigator.clipboard.writeText(id); } catch(_) {}
        const original = el.textContent;
        el.textContent = 'copied!';
        setTimeout(()=>{ el.textContent = original; }, 800);
      }
      document.addEventListener('click', function(e){
        const el = e.target;
        if (el && el.classList && el.classList.contains('jid')) { copyJobId(el); }
      });
      document.addEventListener('keydown', function(e){
        if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('jid')){
          e.preventDefault();
          copyJobId(document.activeElement);
        }
      });
      // Block Premiere keyboard shortcuts from this panel.
      function isEditable(el){ return el && (el.tagName==='INPUT' || el.tagName==='TEXTAREA' || el.isContentEditable); }
      function isMeta(e){ return e.metaKey || e.ctrlKey; }
      function isStandardEditCombo(e){
        if (!isMeta(e)) return false;
        const k = e.key.toLowerCase();
        return k === 'c' || k === 'x' || k === 'v' || k === 'a';
      }
      // Register interest in common edit shortcuts so CEP routes them to this panel
      (function registerKeyInterest(){
        try {
          if (!cs) cs = new CSInterface();
          cs.registerKeyEventsInterest([
            { keyCode: 67, metaKey: true }, // Cmd/Ctrl+C
            { keyCode: 88, metaKey: true }, // Cmd/Ctrl+X
            { keyCode: 86, metaKey: true }, // Cmd/Ctrl+V
            { keyCode: 65, metaKey: true }  // Cmd/Ctrl+A
          ]);
        } catch(_) {}
      })();

      // Clipboard helpers
      function performCopy(){
        try {
          if (document.execCommand && document.execCommand('copy')) return true;
        } catch(_) {}
        try {
          const sel = window.getSelection && window.getSelection().toString();
          if (sel && navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(sel); return true; }
        } catch(_) {}
        return false;
      }
      function performPasteInto(el){
        try {
          if (!navigator.clipboard || !navigator.clipboard.readText) return false;
          navigator.clipboard.readText().then(text => {
            if (!text) return;
            if (el && typeof el.setRangeText === 'function') {
              const start = el.selectionStart||0; const end = el.selectionEnd||0;
              el.setRangeText(text, start, end, 'end');
            } else if (document.execCommand) {
              document.execCommand('insertText', false, text);
            }
          });
          return true;
        } catch(_) { return false; }
      }
      document.addEventListener('keydown', function(e){
        const targetEditable = isEditable(e.target);
        // Allow standard edit combos in editable fields
        if (targetEditable && isStandardEditCombo(e)) {
          // Handle copy/paste/select-all ourselves so CEP honors Cmd/Ctrl in panel
          const k = e.key.toLowerCase();
          if (k === 'a') { try { document.execCommand('selectAll', false, null); } catch(_) {} }
          if (k === 'c') { performCopy(); }
          if (k === 'v') { performPasteInto(e.target); }
          // cut will be handled by the input default; ensure Premiere doesn't catch it
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        // Block browser back/forward keys and all other shortcuts from reaching Premiere
        const k = e.key;
        if (k === 'Backspace' && !targetEditable) { e.preventDefault(); }
        if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
          // prevent Premiere timeline nudges when panel focused
          e.preventDefault();
        }
        e.stopImmediatePropagation();
      }, true);
      document.addEventListener('keyup', function(e){ e.stopImmediatePropagation(); }, true);
      document.addEventListener('keypress', function(e){ e.stopImmediatePropagation(); }, true);

      // History action handlers
      function revealFile(jobId) {
        const job = jobs.find(j => String(j.id) === String(jobId));
        if (!job || !job.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_revealFile("${job.outputPath.replace(/"/g,'\\"')}")`, function(r){ console.log('reveal', r); });
      }
      function insertHistory(jobId) { insertJob(jobId); }

      // remove button disabled per requirements
      
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
          await new Promise((resolve) => {
            cs.evalScript('PPRO_getProjectDir()', function(resp){
              try { const r = JSON.parse(resp||'{}'); if (r && r.ok && r.outputDir) targetDir = r.outputDir; } catch(_){ }
              resolve();
            });
          });
        }
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        let savedPath = '';
        const reset = markWorking('save-'+jobId, 'saving…');
        try {
          const resp = await fetch(`http://localhost:3000/jobs/${jobId}/save`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('save-'+jobId, 'error'); reset(); return; }
        } catch(_){ markError('save-'+jobId, 'error'); reset(); return; }
        if (!savedPath) {
          try { const res = await fetch(`http://localhost:3000/jobs/${jobId}`); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        reset();
        if (savedPath) {
          const fp = savedPath.replace(/\"/g,'\\\"');
          cs.evalScript(`PPRO_importFileToBin(\"${fp}\", \"sync. outputs\")`, function(){ markSaved('save-'+jobId); });
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
          const resp = await fetch(`http://localhost:3000/jobs/${jobId}/save`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ location, targetDir, apiKey }) });
          const data = await resp.json().catch(()=>null);
          if (resp.ok && data && data.outputPath) { savedPath = data.outputPath; }
          else if (!resp.ok) { markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        } catch(_){ markError('insert-'+jobId, 'error'); reset(); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        if (!savedPath) {
          try { const res = await fetch(`http://localhost:3000/jobs/${jobId}`); const j = await res.json(); if (j && j.outputPath) { savedPath = j.outputPath; } } catch(_){ }
        }
        reset();
        if (!savedPath) { markError('insert-'+jobId, 'not ready'); if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; } insertingGuard = false; return; }
        const fp = savedPath.replace(/\"/g,'\\\"');
        cs.evalScript(`PPRO_insertFileAtPlayhead(\"${fp}\")`, function(r){
           try { console.log('insert result', r); } catch(_){ }
           try {
             const out = (typeof r === 'string') ? JSON.parse(r) : r;
             const statusEl = document.getElementById('statusMessage');
             if (!out || out.ok !== true) {
               if (statusEl) statusEl.textContent = 'insert failed; retrying…' + (out && out.error ? ' ('+out.error+')' : '') + (out && out.diag ? ' ['+out.diag+']' : '');
               // fallback: try importing to bin directly and re-invoking
               cs.evalScript(`PPRO_importFileToBin(\"${fp}\", \"sync. outputs\")`, function(){
                 cs.evalScript(`PPRO_insertFileAtPlayhead(\"${fp}\")`, function(rr){
                   try { const oo = (typeof rr==='string')?JSON.parse(rr):rr; if (statusEl) statusEl.textContent = (oo&&oo.ok===true) ? ('inserted (retry)' + (oo.diag? ' ['+oo.diag+']':'')) : ('insert failed (retry)' + (oo&&oo.error? ' ('+oo.error+')':'' + (oo&&oo.diag? ' ['+oo.diag+']':''))); } catch(_){ }
                   try { console.log('insert retry', rr); } catch(_){}
                 });
               });
             } else {
               if (statusEl) statusEl.textContent = 'inserted' + (out.diag? ' ['+out.diag+']':'');
               try { console.log('inserted to tracks', out.videoTrack, out.audioTrack, 'diag=', out.diag); } catch(_){}
             }
           } catch(_){ }
           if (mainInsertBtn){ mainInsertBtn.textContent='insert'; mainInsertBtn.disabled = mainInsertWasDisabled; }
           insertingGuard = false;
         });
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
          const gen = await fetch('http://localhost:3000/generations?'+new URLSearchParams({ apiKey })).then(r=>r.json()).catch(()=>null);
          if (Array.isArray(gen)) {
            jobs = gen.map(g=>({ id:g.id, status: (String(g.status||'').toLowerCase()==='completed'?'completed': String(g.status||'processing').toLowerCase()), model:g.model, createdAt:g.createdAt, videoPath: (g.input||[]).find(x=>x.type==='video')?.url||'', audioPath: (g.input||[]).find(x=>x.type==='audio')?.url||'', syncJobId:g.id, outputPath: g.outputUrl||'' }));
          saveJobsLocal();
          updateHistory();
            return;
          }
          if (historyList && !historyList.innerHTML.trim()) historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">no generations found</div>';
        } catch (e) {
          console.warn('Failed to load cloud history');
          if (historyList && !historyList.innerHTML.trim()) historyList.innerHTML = '<div style="color:#f87171; text-align:center; padding:20px;">failed to load history</div>';
        }
      }

      function renderPreview(job) {
        const preview = document.getElementById('preview');
        const badge = document.getElementById('costIndicator');
        if (!job || !job.outputPath) {
          preview.innerHTML = '';
          if (badge) { preview.appendChild(badge); }
          return;
        }
        // Local file preview via file://
        const src = 'file://' + job.outputPath.replace(/"/g,'\\"').replace(/ /g, '%20');
        preview.innerHTML = `<div class="player">
          <video class="player-media" src="${src}"></video>
          <div class="player-controls">
            <button class="player-btn play-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            </button>
            <div class="player-time">00:00 / 00:00</div>
            <input type="range" class="player-seek" min="0" max="100" value="0">
            <button class="player-btn fullscreen-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>
          </div>
        </div>`;
        try { const p = preview.querySelector('.player'); if (p) initVideoPlayer(p); } catch(_){ }
        if (badge) { preview.appendChild(badge); }
      }

      function renderInputPreview() {
        const videoSection = document.getElementById('videoSection');
        const videoDropzone = document.getElementById('videoDropzone');
        const videoPreview = document.getElementById('videoPreview');
        
        const audioSection = document.getElementById('audioSection');
        const audioDropzone = document.getElementById('audioDropzone');
        const audioPreview = document.getElementById('audioPreview');
        
        // Video
        if (selectedVideo) {
          videoDropzone.style.display = 'none';
          videoPreview.style.display = 'block';
          videoPreview.innerHTML = `
            <div class="custom-video-player">
              <video id="mainVideo" class="video-element" src="file://${selectedVideo.replace(/ /g, '%20')}">
                <source src="file://${selectedVideo.replace(/ /g, '%20')}" type="video/mp4">
              </video>
              <!-- Center play button overlay -->
              <div class="video-play-overlay" id="videoPlayOverlay">
                <button class="center-play-btn" id="centerPlayBtn">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21"/>
                  </svg>
                </button>
              </div>
              <div class="video-controls">
                <div class="video-progress-container">
                  <div class="video-progress-bar">
                    <div class="video-progress-fill" id="videoProgress"></div>
                    <div class="video-progress-thumb" id="videoThumb"></div>
                  </div>
                </div>
                <div class="video-control-buttons">
                  <div class="video-left-controls">
                    <button class="video-control-btn volume-btn" id="volumeBtn">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                      </svg>
                    </button>
                    <input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="100">
                  </div>
                  <div class="video-center-controls">
                    <div class="video-time" id="videoTime">00:00 / 00:00</div>
                    <div class="video-frame-info" id="videoFrameInfo">0 / 0</div>
                  </div>
                  <div class="video-right-controls">
                    <button class="video-control-btn fullscreen-btn" id="fullscreenBtn">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2 2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    </button>
                    <button class="video-control-btn video-delete-btn" onclick="clearVideoSelection()">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
          initCustomVideoPlayer();
        } else {
          videoDropzone.style.display = 'flex';
          videoPreview.style.display = 'none';
        }
        
        // Audio
        if (selectedAudio) {
          audioDropzone.style.display = 'none';
          audioPreview.style.display = 'block';
          audioPreview.innerHTML = `
            <div class="custom-audio-player">
              <audio id="audioPlayer" src="file://${selectedAudio.replace(/ /g, '%20')}" preload="auto"></audio>
              <div class="audio-waveform-container">
                <canvas id="waveformCanvas" class="waveform-canvas"></canvas>
                <div class="audio-controls-bottom">
                  <button class="audio-play-btn" id="audioPlayBtn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21"/>
                    </svg>
                  </button>
                  <div class="audio-time" id="audioTime">00:00 / 00:00</div>
                  <button class="audio-delete-btn" onclick="clearAudioSelection()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3,6 5,6 21,6"></polyline>
                      <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>`;
          initCustomAudioPlayer();
        } else {
          audioDropzone.style.display = 'flex';
          audioPreview.style.display = 'none';
        }
        
        updateLipsyncButton();
        updateInputStatus();
      }
      
      function updateInputStatus() {
        const status = document.getElementById('statusMessage');
        if (!status) return;
        
        if (!selectedVideo && !selectedAudio) {
          status.textContent = 'no video/audio selected';
        } else if (!selectedVideo) {
          status.textContent = 'no video selected';
        } else if (!selectedAudio) {
          status.textContent = 'no audio selected';
        } else {
          status.textContent = 'ready to lipsync';
        }
      }

      function updateModelDisplay() {
        const modelEl = document.getElementById('currentModel');
        if (modelEl) {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          const model = settings.model || 'lipsync-2-pro';
          modelEl.textContent = model;
        }
      }

      async function saveOutput() {
        // Already saved to disk; import bin
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_importFileToBin("${latest.outputPath.replace(/"/g,'\\"')}", "sync. outputs")`, function(r){ console.log('save/import result', r); });
      }

      function insertOutput() {
        const latest = jobs.slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0))[0];
        if (!latest || latest.status !== 'completed' || !latest.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_insertFileAtPlayhead("${latest.outputPath.replace(/"/g,'\\"')}")`, function(r){ console.log('insert result', r); });
      }
      
      // Temperature slider
      document.getElementById('temperature').addEventListener('input', function(e) {
        document.getElementById('tempValue').textContent = e.target.value;
      });
      
      // Load settings
      function loadSettings() {
        const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
        if (settings.model) {
          document.querySelector(`input[value="${settings.model}"]`).checked = true;
        }
        if (settings.temperature !== undefined) {
          document.getElementById('temperature').value = settings.temperature;
          document.getElementById('tempValue').textContent = settings.temperature;
        }
        if (settings.activeSpeakerOnly) {
          document.getElementById('activeSpeakerOnly').checked = settings.activeSpeakerOnly;
        }
        if (settings.detectObstructions) {
          document.getElementById('detectObstructions').checked = settings.detectObstructions;
        }
        if (settings.syncMode) {
          const sm = document.getElementById('syncMode'); if (sm) sm.value = settings.syncMode;
        }
        if (settings.apiKey) {
          document.getElementById('apiKey').value = settings.apiKey;
        }
        if (settings.supabaseUrl) {
          document.getElementById('supabaseUrl').value = settings.supabaseUrl;
        }
        if (settings.supabaseKey) {
          document.getElementById('supabaseKey').value = settings.supabaseKey;
        }
        if (settings.supabaseBucket) {
          document.getElementById('supabaseBucket').value = settings.supabaseBucket;
        }
        if (settings.saveLocation) {
          const opt = document.querySelector(`input[name="saveLocation"][value="${settings.saveLocation}"]`);
          if (opt) opt.checked = true;
        }
        if (settings.renderVideo) {
          const rv = document.getElementById('renderVideo');
          if (rv) rv.value = settings.renderVideo;
        }
        if (settings.renderAudio) {
          const ra = document.getElementById('renderAudio');
          if (ra) ra.value = settings.renderAudio;
        }
      }

      // Persist jobs across reloads
      function saveJobsLocal() {
        try { localStorage.setItem('syncJobs', JSON.stringify(jobs)); } catch(_) {}
      }
      function loadJobsLocal() {
        try {
          const raw = localStorage.getItem('syncJobs');
          if (raw) { jobs = JSON.parse(raw) || []; }
        } catch(_) {}
      }
      
      // Save settings
      function saveSettings() {
        const settings = {
          model: document.querySelector('input[name="model"]:checked').value,
          temperature: parseFloat(document.getElementById('temperature').value),
          activeSpeakerOnly: document.getElementById('activeSpeakerOnly').checked,
          detectObstructions: document.getElementById('detectObstructions').checked,
          syncMode: (document.getElementById('syncMode')||{}).value || 'loop',
          apiKey: document.getElementById('apiKey').value,
          supabaseUrl: (document.getElementById('supabaseUrl').value||'').trim(),
          supabaseKey: (document.getElementById('supabaseKey').value||'').trim(),
          supabaseBucket: (document.getElementById('supabaseBucket').value||'').trim(),
          saveLocation: (document.querySelector('input[name="saveLocation"]:checked')||{}).value || 'project',
          renderVideo: document.getElementById('renderVideo').value || 'h264',
          renderAudio: document.getElementById('renderAudio').value || 'wav'
        };
        localStorage.setItem('syncSettings', JSON.stringify(settings));
        updateModelDisplay();
        scheduleEstimate();
      }
      
      // Save settings on change
      document.addEventListener('change', saveSettings);
      document.getElementById('apiKey').addEventListener('input', saveSettings);
      
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

      function scheduleEstimate(){
        try{ if (estimateTimer) clearTimeout(estimateTimer); }catch(_){ }
        estimateTimer = setTimeout(()=>estimateCost(true), 800);
      }

      async function estimateCost(auto, retry){
        const statusEl = document.getElementById('statusMessage');
        const badge = document.getElementById('costIndicator');
        const myToken = ++costToken;
        try{
          if (!selectedVideo || !selectedAudio) { if (!auto && statusEl) statusEl.textContent = 'select both video and audio first'; if (badge){ badge.style.display='block'; badge.textContent='cost: select both'; } try{ const below=document.getElementById('costBelow'); if (below) below.textContent='cost: select both'; }catch(_){ } return; }
          const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
          const apiKey = settings.apiKey||'';
          if (!apiKey) { if (badge){ badge.style.display='block'; badge.textContent='cost: set API key'; } try{ const below=document.getElementById('costBelow'); if (below) below.textContent='cost: set API key'; }catch(_){ } if (!auto && statusEl) statusEl.textContent = 'add API key in settings'; return; }
          if (!settings.supabaseUrl || !settings.supabaseKey || !settings.supabaseBucket) { if (badge){ badge.style.display='block'; badge.textContent='cost: set supabase in settings'; } try{ const below=document.getElementById('costBelow'); if (below) below.textContent='cost: set supabase in settings'; }catch(_){ } return; }
          if (badge){ badge.style.display='block'; badge.textContent='cost: estimating…'; } try{ const below=document.getElementById('costBelow'); if (below) below.textContent='cost: estimating…'; }catch(_){ }
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
            try { console.log('cost request', body); } catch(_){ }
            resp = await fetch('http://127.0.0.1:3000/costs', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
            data = await resp.json().catch(()=>null);
          } catch (netErr) {
            // Start backend and retry once
            if (!hasStartedBackendForCost) {
              try { cs.evalScript('PPRO_startBackend()', function(){ /* no-op */ }); } catch(_){ }
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
              try { const below = document.getElementById('costBelow'); if (below){ below.textContent = txt; } } catch(_){ }
            } else {
              // Do not clobber a recent valid value on ambiguous success
              try { if (statusEl && data && data.error) statusEl.textContent = String(data.error).slice(0,200); } catch(_){ }
            }
          } else {
            if (myToken !== costToken) return; // stale
            if (badge){ badge.style.display='block'; badge.textContent = 'cost: n/a'; }
            try { if (statusEl && data && data.error) statusEl.textContent = String(data.error).slice(0,200); } catch(_){ }
            try { const below = document.getElementById('costBelow'); if (below){ below.textContent = 'cost: n/a'; } } catch(_){ }
          }
        }catch(e){ if (myToken !== costToken) return; if (badge){ badge.style.display='block'; badge.textContent = 'cost: n/a'; } try { const below=document.getElementById('costBelow'); if (below){ below.textContent = 'cost: n/a'; } } catch(_){ } }
      }

      function niceName(p, fallback){
        try{
          if (!p || typeof p !== 'string') return fallback || '';
          const noQuery = p.split('?')[0];
          const last = noQuery.split('/').pop() || fallback || '';
          const dec = decodeURIComponent(last);
          if (dec.length > 80) return dec.slice(0, 77) + '…';
          return dec;
        }catch(_){ return fallback || ''; }
      }

      // Custom video player functionality
      function initVideoPlayer(playerEl) {
        const video = playerEl.querySelector('.player-media');
        if (!video) return;
        
        const playBtn = playerEl.querySelector('.play-btn');
        const timeDisplay = playerEl.querySelector('.player-time');
        const seekBar = playerEl.querySelector('.player-seek');
        const fullscreenBtn = playerEl.querySelector('.fullscreen-btn');
        
        if (playBtn) {
          playBtn.addEventListener('click', () => {
            if (video.paused) {
              video.play();
              playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            } else {
              video.pause();
              playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            }
          });
        }
        
        if (seekBar) {
          seekBar.addEventListener('input', () => {
            const time = (seekBar.value / 100) * video.duration;
            video.currentTime = time;
          });
        }
        
        if (video) {
          video.addEventListener('timeupdate', () => {
            if (timeDisplay) {
              const current = formatTime(video.currentTime);
              const duration = formatTime(video.duration);
              timeDisplay.textContent = `${current} / ${duration}`;
            }
            if (seekBar) {
              seekBar.value = (video.currentTime / video.duration) * 100;
            }
          });
        }
        
        if (fullscreenBtn) {
          fullscreenBtn.addEventListener('click', () => {
            if (video.requestFullscreen) {
              video.requestFullscreen();
            }
          });
        }
      }

      // Custom audio player functionality
      function initAudioPlayer(audioWrap) {
        const audio = audioWrap.querySelector('audio');
        if (!audio) return;
        
        // Create waveform canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'audio-canvas';
        audioWrap.appendChild(canvas);
        
        // Create audio controls
        const controls = document.createElement('div');
        controls.className = 'audio-controls';
        controls.innerHTML = `
          <button class="player-btn play-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          </button>
          <div class="player-time">00:00 / 00:00</div>
          <input type="range" class="player-seek" min="0" max="100" value="0">
        `;
        audioWrap.appendChild(controls);
        
        const playBtn = controls.querySelector('.play-btn');
        const timeDisplay = controls.querySelector('.player-time');
        const seekBar = controls.querySelector('.player-seek');
        
        if (playBtn) {
          playBtn.addEventListener('click', () => {
            if (audio.paused) {
              audio.play();
              playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            } else {
              audio.pause();
              playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            }
          });
        }
        
        if (seekBar) {
          seekBar.addEventListener('input', () => {
            const time = (seekBar.value / 100) * audio.duration;
            audio.currentTime = time;
          });
        }
        
        if (audio) {
          audio.addEventListener('timeupdate', () => {
            if (timeDisplay) {
              const current = formatTime(audio.currentTime);
              const duration = formatTime(audio.duration);
              timeDisplay.textContent = `${current} / ${duration}`;
            }
            if (seekBar) {
              seekBar.value = (audio.currentTime / audio.duration) * 100;
            }
          });
        }
        
        // Generate waveform
        generateWaveform(audio, canvas);
      }

      function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }

      function generateWaveform(audio, canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        
        // Simple waveform visualization
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = '#0066ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < width; i += 4) {
          const x = i;
          const y = height / 2 + Math.sin(i * 0.1) * 20;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      
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
        } catch(e) {
          console.error('CSInterface error:', e);
        }
      });



      function initCustomVideoPlayer() {
        const video = document.getElementById('mainVideo');
        const centerPlayBtn = document.getElementById('centerPlayBtn');
        const playOverlay = document.getElementById('videoPlayOverlay');
        const timeDisplay = document.getElementById('videoTime');
        const frameInfo = document.getElementById('videoFrameInfo');
        const progressFill = document.getElementById('videoProgress');
        const progressThumb = document.getElementById('videoThumb');
        const progressBar = document.querySelector('.video-progress-bar');
        const volumeBtn = document.getElementById('volumeBtn');
        const volumeSlider = document.getElementById('volumeSlider');
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        
        if (!video) return;

        // Initialize display when metadata loads
        video.addEventListener('loadedmetadata', () => {
          const duration = formatTime(video.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `00:00 / ${duration}`;
          if (frameInfo) {
            const totalFrames = Math.floor(video.duration * 30);
            frameInfo.textContent = `0 / ${totalFrames}`;
          }
        });

        // Update time and progress during playback
        video.addEventListener('timeupdate', () => {
          const current = formatTime(video.currentTime);
          const duration = formatTime(video.duration || 0);
          const progress = (video.currentTime / (video.duration || 1)) * 100;
          
          if (timeDisplay) timeDisplay.textContent = `${current} / ${duration}`;
          if (progressFill) progressFill.style.width = `${progress}%`;
          if (progressThumb) progressThumb.style.left = `${progress}%`;
          
          // Frame info (approximate)
          if (frameInfo && video.duration) {
            const currentFrame = Math.floor(video.currentTime * 30); // Assume 30fps
            const totalFrames = Math.floor(video.duration * 30);
            frameInfo.textContent = `${currentFrame} / ${totalFrames}`;
          }
        });

        // Hide overlay when playing, show when paused
        video.addEventListener('play', () => {
          if (playOverlay) playOverlay.classList.add('hidden');
        });

        video.addEventListener('pause', () => {
          if (playOverlay) playOverlay.classList.remove('hidden');
        });

        // Progress bar scrubbing
        if (progressBar) {
          progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            video.currentTime = pos * video.duration;
          });
        }

        // Play/pause functionality - only center button
        const togglePlay = () => {
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
        };

        // Only center play button
        if (centerPlayBtn) centerPlayBtn.addEventListener('click', togglePlay);

        // Volume control
        if (volumeSlider) {
          volumeSlider.addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
          });
        }

        if (volumeBtn) {
          volumeBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            if (video.muted) {
              volumeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
            } else {
              volumeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
            }
          });
        }

        // Fullscreen
        if (fullscreenBtn) {
          fullscreenBtn.addEventListener('click', () => {
            if (video.requestFullscreen) {
              video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
              video.webkitRequestFullscreen();
            }
          });
        }
      }

      function initCustomAudioPlayer() {
        const audio = document.getElementById('audioPlayer');
        const playBtn = document.getElementById('audioPlayBtn');
        const timeDisplay = document.getElementById('audioTime');
        const canvas = document.getElementById('waveformCanvas');
        
        if (!audio || !canvas) return;

        // Generate waveform and store bars for progress rendering
        const waveformBars = generateProgressiveWaveform(audio, canvas);

        // Initialize time display when metadata loads
        audio.addEventListener('loadedmetadata', () => {
          const duration = formatTime(audio.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `00:00 / ${duration}`;
        });

        // Update time and waveform progress
        audio.addEventListener('timeupdate', () => {
          const current = formatTime(audio.currentTime);
          const duration = formatTime(audio.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `${current} / ${duration}`;
          
          // Update waveform progress
          updateWaveformProgress(canvas, waveformBars, audio.currentTime / (audio.duration || 1));
        });

        // Play/pause functionality
        const toggleAudioPlay = () => {
          if (audio.paused) {
            audio.play();
            if (playBtn) playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          } else {
            audio.pause();
            if (playBtn) playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
          }
        };

        // Play/pause button
        if (playBtn) {
          playBtn.addEventListener('click', toggleAudioPlay);
        }

        // Click to seek on waveform
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const pos = (e.clientX - rect.left) / rect.width;
          audio.currentTime = pos * audio.duration;
        });
      }

      function generateProgressiveWaveform(audio, canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        const height = canvas.height = canvas.offsetHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const displayWidth = canvas.offsetWidth;
        const displayHeight = canvas.offsetHeight;
        
        // Generate waveform data
        const barCount = Math.floor(displayWidth / 2); // Bars every 2 pixels for denser waveform
        const barWidth = 1;
        const centerY = displayHeight / 2;
        const bars = [];
        
        for (let i = 0; i < barCount; i++) {
          const x = i * 2;
          
          // Generate realistic audio waveform pattern
          let amplitude = 0;
          
          // Create different frequency components for more realistic audio
          const lowFreq = Math.sin(i * 0.01) * 0.4;
          const midFreq = Math.sin(i * 0.05) * 0.3;
          const highFreq = Math.sin(i * 0.15) * 0.2;
          const noise = (Math.random() - 0.5) * 0.1;
          
          amplitude = Math.abs(lowFreq + midFreq + highFreq + noise);
          
          // Add variation and realistic audio patterns
          if (Math.random() < 0.08) amplitude *= 1.8; // Random peaks
          if (Math.random() < 0.03) amplitude *= 0.2; // Random valleys
          
          const barHeight = Math.max(2, amplitude * (displayHeight * 0.8)); // Minimum height of 2px
          
          bars.push({
            x: x,
            height: barHeight,
            centerY: centerY
          });
        }
        
        // Initial render with all bars grey
        renderWaveform(canvas, bars, 0);
        
        return bars;
      }

      function renderWaveform(canvas, bars, progress) {
        const ctx = canvas.getContext('2d');
        const displayWidth = canvas.offsetWidth;
        const displayHeight = canvas.offsetHeight;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        
        const progressX = progress * displayWidth;
        
        bars.forEach(bar => {
          // Color based on progress: white for played, grey for unplayed
          ctx.fillStyle = bar.x <= progressX ? '#ffffff' : '#666666';
          ctx.fillRect(bar.x, bar.centerY - bar.height/2, 1, bar.height);
        });
        
        // Add subtle center line
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, displayHeight / 2);
        ctx.lineTo(displayWidth, displayHeight / 2);
        ctx.stroke();
      }

      function updateWaveformProgress(canvas, bars, progress) {
        renderWaveform(canvas, bars, progress);
      }


      function clearVideoSelection() {
        selectedVideo = null;
        selectedVideoIsTemp = false;
        renderInputPreview();
        updateInputStatus();
      }

      function clearAudioSelection() {
        selectedAudio = null;
        selectedAudioIsTemp = false;
        renderInputPreview();
        updateInputStatus();
      }


      function renderOutputVideo(job) {
        if (!job || !job.outputPath) return;
        
        const videoSection = document.getElementById('videoSection');
        const videoPreview = document.getElementById('videoPreview');
        
        if (videoSection && videoPreview) {
          videoPreview.innerHTML = `
            <div class="custom-video-player">
              <video id="outputVideo" class="video-element" src="file://${job.outputPath.replace(/ /g, '%20')}">
                <source src="file://${job.outputPath.replace(/ /g, '%20')}" type="video/mp4">
              </video>
              <!-- Center play button overlay -->
              <div class="video-play-overlay" id="outputVideoPlayOverlay">
                <button class="center-play-btn" id="outputCenterPlayBtn">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21"/>
                  </svg>
                </button>
              </div>
              <div class="video-controls">
                <div class="video-progress-container">
                  <div class="video-progress-bar">
                    <div class="video-progress-fill" id="outputVideoProgress"></div>
                    <div class="video-progress-thumb" id="outputVideoThumb"></div>
                  </div>
                </div>
                <div class="video-control-buttons">
                  <div class="video-left-controls">
                    <button class="video-control-btn volume-btn" id="outputVolumeBtn">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                      </svg>
                    </button>
                    <input type="range" class="volume-slider" id="outputVolumeSlider" min="0" max="100" value="100">
                  </div>
                  <div class="video-center-controls">
                    <div class="video-time" id="outputVideoTime">00:00 / 00:00</div>
                    <div class="video-frame-info" id="outputVideoFrameInfo">0 / 0</div>
                  </div>
                  <div class="video-right-controls">
                    <button class="video-control-btn fullscreen-btn" id="outputFullscreenBtn">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2 2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
          initOutputVideoPlayer();
        }
      }

      function showPostLipsyncActions(job) {
        const videoSection = document.getElementById('videoSection');
        if (!videoSection) return;
        
        // Create actions container
        const actionsHtml = `
          <div class="post-lipsync-actions" id="postLipsyncActions">
            <button class="action-btn action-btn-primary" onclick="saveCompletedJob('${job.id}')">
              save
            </button>
            <button class="action-btn" onclick="insertCompletedJob('${job.id}')">
              insert
            </button>
            <button class="action-btn" onclick="clearCompletedJob()">
              clear
            </button>
          </div>`;
        
        videoSection.insertAdjacentHTML('afterend', actionsHtml);
      }

      function initOutputVideoPlayer() {
        const video = document.getElementById('outputVideo');
        const centerPlayBtn = document.getElementById('outputCenterPlayBtn');
        const playOverlay = document.getElementById('outputVideoPlayOverlay');
        const timeDisplay = document.getElementById('outputVideoTime');
        const frameInfo = document.getElementById('outputVideoFrameInfo');
        const progressFill = document.getElementById('outputVideoProgress');
        const progressThumb = document.getElementById('outputVideoThumb');
        const progressBar = document.querySelector('.video-progress-bar');
        const volumeBtn = document.getElementById('outputVolumeBtn');
        const volumeSlider = document.getElementById('outputVolumeSlider');
        const fullscreenBtn = document.getElementById('outputFullscreenBtn');
        
        if (!video) return;

        // Initialize display when metadata loads
        video.addEventListener('loadedmetadata', () => {
          const duration = formatTime(video.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `00:00 / ${duration}`;
          if (frameInfo) {
            const totalFrames = Math.floor(video.duration * 30);
            frameInfo.textContent = `0 / ${totalFrames}`;
          }
        });

        // Update time and progress during playback
        video.addEventListener('timeupdate', () => {
          const current = formatTime(video.currentTime);
          const duration = formatTime(video.duration || 0);
          const progress = (video.currentTime / (video.duration || 1)) * 100;
          
          if (timeDisplay) timeDisplay.textContent = `${current} / ${duration}`;
          if (progressFill) progressFill.style.width = `${progress}%`;
          if (progressThumb) progressThumb.style.left = `${progress}%`;
          
          // Frame info (approximate)
          if (frameInfo && video.duration) {
            const currentFrame = Math.floor(video.currentTime * 30);
            const totalFrames = Math.floor(video.duration * 30);
            frameInfo.textContent = `${currentFrame} / ${totalFrames}`;
          }
        });

        // Hide overlay when playing, show when paused
        video.addEventListener('play', () => {
          if (playOverlay) playOverlay.classList.add('hidden');
        });

        video.addEventListener('pause', () => {
          if (playOverlay) playOverlay.classList.remove('hidden');
        });

        // Progress bar scrubbing
        if (progressBar) {
          progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            video.currentTime = pos * video.duration;
          });
        }

        // Play/pause functionality
        const togglePlay = () => {
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
        };

        if (centerPlayBtn) centerPlayBtn.addEventListener('click', togglePlay);

        // Volume control
        if (volumeSlider) {
          volumeSlider.addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
          });
        }

        if (volumeBtn) {
          volumeBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            if (video.muted) {
              volumeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
            } else {
              volumeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
            }
          });
        }

        if (fullscreenBtn) {
          fullscreenBtn.addEventListener('click', () => {
            if (video.requestFullscreen) {
              video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
              video.webkitRequestFullscreen();
            }
          });
        }
      }

      async function saveCompletedJob(jobId) {
        await saveJob(jobId);
      }

      async function insertCompletedJob(jobId) {
        await insertJob(jobId);
      }

      function clearCompletedJob() {
        // Reset to initial state
        selectedVideo = null;
        selectedAudio = null;
        selectedVideoIsTemp = false;
        selectedAudioIsTemp = false;
        
        // Show lipsync button again
        const btn = document.getElementById('lipsyncBtn');
        btn.style.display = 'flex';
        btn.disabled = true;
        btn.textContent = 'lipsync';
        
        // Show audio section again
        const audioSection = document.getElementById('audioSection');
        if (audioSection) audioSection.style.display = 'block';
        
        // Remove post-lipsync actions
        const actions = document.getElementById('postLipsyncActions');
        if (actions) actions.remove();
        
        // Reset video and audio sections
        renderInputPreview();
        updateInputStatus();
      }
