      function initDragAndDrop(){
        try{
          // Prevent the panel from navigating away when files are dropped
          document.addEventListener('dragover', function(e){ e.preventDefault(); }, false);
          document.addEventListener('drop', function(e){ e.preventDefault(); }, false);

          const videoZone = document.getElementById('videoDropzone');
          const audioZone = document.getElementById('audioDropzone');
          if (videoZone) attachDropHandlers(videoZone, 'video');
          if (audioZone) attachDropHandlers(audioZone, 'audio');
        }catch(_){ }
      }

      function attachDropHandlers(zoneEl, kind){
        zoneEl.addEventListener('dragenter', function(e){
          try { e.preventDefault(); } catch(_){ }
          try { zoneEl.classList.add('is-dragover'); } catch(_){ }
        });
        zoneEl.addEventListener('dragover', function(e){
          try { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } catch(_){ e.preventDefault(); }
          try { zoneEl.classList.add('is-dragover'); } catch(_){ }
        });
        zoneEl.addEventListener('dragleave', function(_e){
          try { zoneEl.classList.remove('is-dragover'); } catch(_){ }
        });
        zoneEl.addEventListener('drop', async function(e){
          try{
            e.preventDefault();
            e.stopPropagation();
            try { zoneEl.classList.remove('is-dragover'); } catch(_){ }
            const paths = extractFilePathsFromDrop(e);
            if (!paths.length) return;
            // Pick first path matching kind
            const picked = pickFirstMatchingByKind(paths, kind);
            if (!picked) return;
            if (kind === 'video') {
              await handleDroppedVideo(picked);
            } else {
              await handleDroppedAudio(picked);
            }
          }catch(_){ }
        });
      }

      function extractFilePathsFromDrop(e){
        const out = [];
        try{
          const dt = e.dataTransfer || {};
          // 1) Direct file list (may include .path in CEP/Chromium)
          if (dt.files && dt.files.length){
            for (let i=0;i<dt.files.length;i++){
              const f = dt.files[i];
              if (f && f.path) { out.push(String(f.path)); }
            }
          }
          // 2) text/uri-list (Finder drops file:// URIs)
          try {
            const uriList = dt.getData && dt.getData('text/uri-list');
            if (uriList && typeof uriList === 'string'){
              uriList.split(/\r?\n/).forEach(line => {
                const s = String(line||'').trim();
                if (!s || s[0] === '#') return;
                const p = normalizePathFromUri(s);
                if (p) out.push(p);
              });
            }
          } catch(_){ }
          // 3) text/plain fallback (sometimes provides file:/// or absolute path)
          try {
            const txt = dt.getData && dt.getData('text/plain');
            if (txt && typeof txt === 'string'){
              const lines = txt.split(/\r?\n/);
              lines.forEach(line => {
                const s = String(line||'').trim();
                if (!s) return;
                if (s.startsWith('file://')){
                  const p = normalizePathFromUri(s);
                  if (p) out.push(p);
                } else if (s.startsWith('/')) {
                  out.push(s);
                }
              });
            }
          } catch(_){ }
        }catch(_){ }
        // Deduplicate while preserving order
        const seen = {};
        return out.filter(p => { if (seen[p]) return false; seen[p]=1; return true; });
      }

      function normalizePathFromUri(uri){
        try{
          if (!uri || typeof uri !== 'string') return '';
          if (!uri.startsWith('file://')) return '';
          let u = uri.replace(/^file:\/\//, '');
          // Handle file://localhost/...
          if (u.startsWith('localhost/')) u = u.slice('localhost/'.length);
          // On macOS, u already starts with '/'
          if (u[0] !== '/') u = '/' + u;
          try { u = decodeURIComponent(u); } catch(_){ }
          return u;
        }catch(_){ return ''; }
      }

      function pickFirstMatchingByKind(paths, kind){
        const videoExtOk = function(ext){ return {mov:1,mp4:1,mxf:1,mkv:1,avi:1,m4v:1,mpg:1,mpeg:1}[ext] === 1; };
        const audioExtOk = function(ext){ return {wav:1,mp3:1,aac:1,aif:1,aiff:1,m4a:1}[ext] === 1; };
        for (let i=0;i<paths.length;i++){
          const p = String(paths[i]||'');
          const ext = p.split('.').pop().toLowerCase();
          if (kind === 'video' && videoExtOk(ext)) return p;
          if (kind === 'audio' && audioExtOk(ext)) return p;
        }
        return '';
      }

      async function statFileSizeBytes(absPath){
        return await new Promise(resolve=>{
          try{
            if (!cs) cs = new CSInterface();
            const safe = String(absPath).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';}})()`;
            cs.evalScript(es, function(r){ var n=Number(r||0); resolve(isNaN(n)?0:n); });
          }catch(_){ resolve(0); }
        });
      }

      async function handleDroppedVideo(raw){
        try{
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'validating video…'; } catch(_){ }
          const ext = raw.split('.').pop().toLowerCase();
          const ok = {mov:1,mp4:1,mxf:1,mkv:1,avi:1,m4v:1,mpg:1,mpeg:1}[ext] === 1;
          if (!ok) { try { statusEl.textContent = 'please drop a video file'; } catch(_){ } return; }
          const size = await statFileSizeBytes(raw);
          if (size > 1024*1024*1024) { try { statusEl.textContent = 'video exceeds 1GB (not allowed)'; } catch(_){ } return; }
          selectedVideoIsTemp = false;
          selectedVideo = raw;
          updateLipsyncButton();
          renderInputPreview();
          try { statusEl.textContent = 'uploading video…'; } catch(_){ }
          try{
            const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
            const body = { path: selectedVideo, apiKey: settings.apiKey||'', supabaseUrl: (settings.supabaseUrl||''), supabaseKey: (settings.supabaseKey||''), supabaseBucket: (settings.supabaseBucket||'') };
            await ensureAuthToken();
            const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
            const j = await r.json().catch(()=>null);
            if (r.ok && j && j.ok && j.url){ uploadedVideoUrl = j.url; }
          }catch(_){ }
          try { statusEl.textContent = ''; } catch(_){ }
          try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
          scheduleEstimate();
        }catch(_){ }
      }

      async function handleDroppedAudio(raw){
        try{
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'validating audio…'; } catch(_){ }
          const ext = raw.split('.').pop().toLowerCase();
          const ok = {wav:1,mp3:1,aac:1,aif:1,aiff:1,m4a:1}[ext] === 1;
          if (!ok) { try { statusEl.textContent = 'please drop an audio file'; } catch(_){ } return; }
          const size = await statFileSizeBytes(raw);
          if (size > 1024*1024*1024) { try { statusEl.textContent = 'audio exceeds 1GB (not allowed)'; } catch(_){ } return; }
          selectedAudioIsTemp = false;
          selectedAudio = raw;
          updateLipsyncButton();
          renderInputPreview();
          updateInputStatus();
          try { statusEl.textContent = 'uploading audio…'; } catch(_){ }
          try{
            const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
            const body = { path: selectedAudio, apiKey: settings.apiKey||'', supabaseUrl: (settings.supabaseUrl||''), supabaseKey: (settings.supabaseKey||''), supabaseBucket: (settings.supabaseBucket||'') };
            await ensureAuthToken();
            const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
            const j = await r.json().catch(()=>null);
            if (r.ok && j && j.ok && j.url){ uploadedAudioUrl = j.url; }
          }catch(_){ }
          try { updateInputStatus(); } catch(_){ }
          try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
          scheduleEstimate();
        }catch(_){ }
      }


