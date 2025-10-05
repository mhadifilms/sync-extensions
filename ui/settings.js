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
          fetch('http://127.0.0.1:3000/settings', { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ settings }) }).catch(()=>{});
        }catch(_){ }
        updateModelDisplay();
        scheduleEstimate();
      }

      // On load, if localStorage missing, try to hydrate from backend
      (function hydrateSettings(){
        try {
          var raw = localStorage.getItem('syncSettings');
          if (!raw) {
            fetch('http://127.0.0.1:3000/settings', { method:'GET' }).then(function(r){ return r.json(); }).then(function(j){
              if (j && j.settings) { try { localStorage.setItem('syncSettings', JSON.stringify(j.settings)); loadSettings(); updateModelDisplay(); } catch(_){ } }
            }).catch(function(){ });
          }
        } catch(_){ }
      })();

      // listeners
      document.addEventListener('change', saveSettings);
      document.getElementById('apiKey').addEventListener('input', saveSettings);
      document.getElementById('temperature').addEventListener('input', function(e) {
        document.getElementById('tempValue').textContent = e.target.value;
      });


