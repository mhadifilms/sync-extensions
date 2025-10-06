      function getServerPort() {
        return window.__syncServerPort || 3000;
      }
      
      function updateModelDisplay() {
        const modelEl = document.getElementById('currentModel');
        if (modelEl) {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          const model = settings.model || 'lipsync-2-pro';
          modelEl.textContent = model;
        }
      }

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
        try { localStorage.setItem('syncSettings', JSON.stringify(settings)); } catch(_){ }
        // Persist to backend as a secondary store in case localStorage resets on AE reload
        try {
          const port = getServerPort();
          fetch(`http://127.0.0.1:${port}/settings`, { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ settings }) }).catch(()=>{});
        }catch(_){ }
        updateModelDisplay();
        scheduleEstimate();
      }

      // On load, if localStorage missing, try to hydrate from backend
      (function hydrateSettings(){
        try {
          var raw = localStorage.getItem('syncSettings');
          if (!raw) {
            const port = getServerPort();
            fetch(`http://127.0.0.1:${port}/settings`, { method:'GET' }).then(function(r){ return r.json(); }).then(function(j){
              if (j && j.settings) { try { localStorage.setItem('syncSettings', JSON.stringify(j.settings)); loadSettings(); updateModelDisplay(); } catch(_){ } }
            }).catch(function(){ });
          }
        } catch(_){ }
      })();

      // Update system functions
      async function api(pathname, opts){
        const token = localStorage.getItem('syncAuthToken') || '';
        const h = Object.assign({ 'Content-Type':'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
        const port = getServerPort();
        return fetch(`http://127.0.0.1:${port}` + pathname, Object.assign({ headers: h }, opts||{}));
      }

      async function refreshCurrentVersion(){
        const el = document.getElementById('versionDisplay'); if (!el) return;
        try{
          const port = getServerPort();
          const r = await fetch(`http://127.0.0.1:${port}/health`, { cache:'no-store' }).catch(()=>null);
          if (!r || !r.ok) { el.textContent = 'version (start panel server to fetch)'; return; }
          const v = await (await api('/update/version')).json().catch(()=>({}));
          if (v && v.version) el.textContent = 'version v' + v.version;
          else el.textContent = 'version (unknown)';
        }catch(_){ el.textContent = 'version (unavailable)'; }
      }

      async function checkForUpdate(silent = false){
        const status = document.getElementById('updateStatus'); if (!silent && status) { status.style.display='block'; status.textContent = 'checking for updates…'; }
        const btnApply = document.getElementById('applyUpdateBtn'); if (btnApply) btnApply.style.display = 'none';
        const notes = document.getElementById('releaseNotesLink'); if (notes) { notes.style.display='none'; notes.href = '#'; }
        try{
          await ensureAuthToken().catch(()=>undefined);
          const r = await api('/update/check').catch(()=>null);
          if (!r) throw new Error('no response');
          const j = await r.json().catch(()=>({}));
          if (!r.ok) throw new Error(j && j.error ? j.error : 'update check failed');
          const vEl = document.getElementById('versionDisplay');
          if (vEl) vEl.textContent = 'version v' + (j.current || '—');
          if (j.canUpdate){
            if (notes && j.html_url) { notes.style.display='inline'; notes.href = j.html_url; notes.textContent = 'release notes'; }
            if (btnApply) { btnApply.dataset.tag = j.tag || ''; btnApply.style.display = 'inline-block'; }
            if (status) { status.style.display='block'; status.textContent = 'update available → v' + j.latest; }
          } else {
            if (status) status.textContent = 'up to date';
            setTimeout(() => { if (status) status.style.display = 'none'; }, 2000);
          }
        }catch(e){ if (!silent && status) status.textContent = 'update check failed: ' + String(e && e.message || e); }
      }

      async function applyUpdate(){
        const btn = document.getElementById('applyUpdateBtn');
        const status = document.getElementById('updateStatus'); if (status) { status.style.display='block'; status.textContent = 'downloading and applying update…'; }
        try{
          const tag = (btn && btn.dataset && btn.dataset.tag) ? btn.dataset.tag : undefined;
          const r = await api('/update/apply', { method:'POST', body: JSON.stringify(tag ? { tag } : {}) });
          const j = await r.json().catch(()=>({}));
          if (!r.ok) throw new Error(j && j.error ? j.error : 'update failed');
          if (status) status.textContent = 'update applied successfully — restart Adobe app to complete';
          if (btn) btn.style.display = 'none';
          setTimeout(() => { refreshCurrentVersion(); checkForUpdate(true); }, 1000);
        }catch(e){ if (status) status.textContent = 'update failed: ' + String(e && e.message || e); }
      }

      // Initialize version display on load
      setTimeout(refreshCurrentVersion, 1000);

      // listeners
      document.addEventListener('change', saveSettings);
      document.getElementById('apiKey').addEventListener('input', saveSettings);
      document.getElementById('temperature').addEventListener('input', function(e) {
        document.getElementById('tempValue').textContent = e.target.value;
      });


