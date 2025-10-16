      function initDragAndDrop(){
        try{
          // Prevent the panel from navigating away when files are dropped
          document.addEventListener('dragover', function(e){ e.preventDefault(); }, false);
          document.addEventListener('drop', function(e){ e.preventDefault(); }, false);

          const videoZone = document.getElementById('videoDropzone');
          const audioZone = document.getElementById('audioDropzone');
          
          if (videoZone) {
            attachDropHandlers(videoZone, 'video');
          }
          if (audioZone) {
            attachDropHandlers(audioZone, 'audio');
          }
        }catch(err){ 
          console.error('[DnD] Error initializing drag and drop:', err);
        }
      }

      function attachDropHandlers(zoneEl, kind){
        // Add handlers to the main dropzone
        zoneEl.addEventListener('dragenter', function(e){
          try { e.preventDefault(); } catch(_){ }
          try { zoneEl.classList.add('is-dragover'); } catch(_){ }
        });
        zoneEl.addEventListener('dragover', function(e){
          try { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } catch(_){ e.preventDefault(); }
          try { zoneEl.classList.add('is-dragover'); } catch(_){ }
        });
        zoneEl.addEventListener('dragleave', function(e){
          try { 
            // Only remove dragover if we're actually leaving the dropzone
            if (!zoneEl.contains(e.relatedTarget)) {
              zoneEl.classList.remove('is-dragover'); 
            }
          } catch(_){ }
        });
        zoneEl.addEventListener('drop', async function(e){
          try{
            e.preventDefault();
            e.stopPropagation();
            try { zoneEl.classList.remove('is-dragover'); } catch(_){ }
            
            // Delegate to the main drop handler
            await handleDropEvent(e, kind);
          }catch(err){ 
            console.error('[DnD] Error in drop handler:', err);
          }
        });
        
        // Also add handlers to child elements to ensure events propagate
        const childElements = zoneEl.querySelectorAll('*');
        childElements.forEach(child => {
          child.addEventListener('dragenter', function(e){
            try { e.preventDefault(); } catch(_){ }
            try { zoneEl.classList.add('is-dragover'); } catch(_){ }
          });
          child.addEventListener('dragover', function(e){
            try { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } catch(_){ e.preventDefault(); }
            try { zoneEl.classList.add('is-dragover'); } catch(_){ }
          });
          child.addEventListener('dragleave', function(e){
            try { 
              if (!zoneEl.contains(e.relatedTarget)) {
                zoneEl.classList.remove('is-dragover'); 
              }
            } catch(_){ }
          });
          child.addEventListener('drop', async function(e){
            try{
              e.preventDefault();
              e.stopPropagation();
              try { zoneEl.classList.remove('is-dragover'); } catch(_){ }
              
              // Delegate to the main drop handler
              await handleDropEvent(e, kind);
            }catch(err){ 
              console.error('[DnD] Error in child drop handler:', err);
            }
          });
        });
      }
      
      async function handleDropEvent(e, kind) {
        try{
            
            const paths = extractFilePathsFromDrop(e);
            
            if (!paths.length) {
              // Check if we have file references that need to be resolved
              const hasFileReferences = checkForFileReferences(e);
              if (hasFileReferences) {
                // Fall back to file picker for file references
                if (typeof window.showToast === 'function') {
                  window.showToast('resolving file reference…', 'info');
                }
                try {
                  const path = await window.openFileDialog(kind);
                  if (path) {
                    if (kind === 'video') {
                      await handleDroppedVideo(path);
                    } else {
                      await handleDroppedAudio(path);
                    }
                    return;
                  }
                } catch(_) {
                  // Fall through to error message
                }
              }
              
              // Show user-friendly error message
              if (typeof window.showToast === 'function') {
                window.showToast('could not read dropped file path - try using upload button instead', 'error');
              }
              if (window.showToast) {
                window.showToast('drag & drop failed - please use upload button', 'error');
              }
              return;
            }
            // Pick first path matching kind
            const picked = pickFirstMatchingByKind(paths, kind);
            if (!picked) {
              if (typeof window.showToast === 'function') {
                const message = kind === 'video' ? 'only mp4 and mov supported' : 'only mp3 and wav supported';
                window.showToast(message, 'error');
              }
              return;
            }
            if (kind === 'video') {
              await handleDroppedVideo(picked);
            } else {
              await handleDroppedAudio(picked);
            }
        }catch(err){ 
          console.error('[DnD] Error in handleDropEvent:', err);
        }
      }

      function checkForFileReferences(e) {
        try {
          const dt = e.dataTransfer || {};
          
          // Check dataTransferItems for file references
          if (dt.items && dt.items.length > 0) {
            for (let i = 0; i < dt.items.length; i++) {
              const item = dt.items[i];
              if (item.kind === 'file') {
                return true; // We have file items, even if paths aren't extractable
              }
            }
          }
          
          // Check files array
          if (dt.files && dt.files.length > 0) {
            return true;
          }
          
          // Check for file reference URLs in text data
          try {
            const uriList = dt.getData && dt.getData('text/uri-list');
            if (uriList && uriList.includes('.file/id=')) {
              return true;
            }
          } catch(_) {}
          
          try {
            const txt = dt.getData && dt.getData('text/plain');
            if (txt && txt.includes('.file/id=')) {
              return true;
            }
          } catch(_) {}
          
          return false;
        } catch(_) {
          return false;
        }
      }

      function extractFilePathsFromDrop(e){
        const out = [];
        try{
          const dt = e.dataTransfer || {};
          
          // 1) Direct file list (may include .path in CEP/Chromium)
          if (dt.files && dt.files.length){
            for (let i=0;i<dt.files.length;i++){
              const f = dt.files[i];
              // Check for .path property (Electron/CEP)
              if (f && f.path && typeof f.path === 'string' && f.path.length > 0) {
                const cleanPath = String(f.path).trim();
                if (cleanPath && !cleanPath.startsWith('.file/id=') && !cleanPath.includes('.file/id=')) {
                  out.push(cleanPath);
                }
              }
              // Also check name property as fallback (might need to resolve with CSInterface)
              else if (f && f.name && typeof f.name === 'string') {
                // Will be handled by async file picker fallback
              }
            }
          }
          
          // 2) Check for DataTransferItems (more modern API)
          try {
            if (dt.items && dt.items.length > 0) {
              for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i];
                if (item.kind === 'file') {
                  const file = item.getAsFile();
                  if (file && file.path && typeof file.path === 'string') {
                    const cleanPath = String(file.path).trim();
                    if (cleanPath && !cleanPath.includes('.file/id=') && cleanPath.startsWith('/')) {
                      out.push(cleanPath);
                    }
                  }
                }
              }
            }
          } catch(_){ }
          
          // 3) text/uri-list (Finder drops file:// URIs)
          try {
            const uriList = dt.getData && dt.getData('text/uri-list');
            if (uriList && typeof uriList === 'string'){
              uriList.split(/\r?\n/).forEach(line => {
                const s = String(line||'').trim();
                if (!s || s[0] === '#') return;
                // Skip file reference URLs (macOS specific issue)
                if (s.includes('.file/id=')) return;
                const p = normalizePathFromUri(s);
                if (p) out.push(p);
              });
            }
          } catch(_){ }
          
          // 4) text/plain fallback (sometimes provides file:/// or absolute path)
          try {
            const txt = dt.getData && dt.getData('text/plain');
            if (txt && typeof txt === 'string'){
              const lines = txt.split(/\r?\n/);
              lines.forEach(line => {
                const s = String(line||'').trim();
                if (!s) return;
                // Skip file reference URLs
                if (s.includes('.file/id=')) return;
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
          
          // Skip file reference URLs (macOS specific issue)
          if (uri.includes('.file/id=')) return '';
          
          let u = uri.replace(/^file:\/\//, '');
          // Handle file://localhost/...
          if (u.startsWith('localhost/')) u = u.slice('localhost/'.length);
          // On macOS, u already starts with '/'
          if (u[0] !== '/') u = '/' + u;
          
          // Decode URI components carefully
          try { 
            u = decodeURIComponent(u); 
          } catch(_){ 
            // Fallback: just replace common encoded characters
            try {
              u = u.replace(/%20/g, ' ').replace(/%2F/g, '/');
            } catch(_){}
          }
          
          // Final validation: ensure we have a valid path
          if (!u || u.length < 2 || !u.startsWith('/')) return '';
          
          return u;
        }catch(_){ return ''; }
      }

      function pickFirstMatchingByKind(paths, kind){
        const videoExtOk = function(ext){ return {mov:1,mp4:1}[ext] === 1; };
        const audioExtOk = function(ext){ return {wav:1,mp3:1}[ext] === 1; };
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
          
          // Validate path before proceeding
          if (!raw || typeof raw !== 'string' || raw.includes('.file/id=') || raw.length < 2) {
            if (typeof window.showToast === 'function') {
              window.showToast('invalid file path - please use upload button instead', 'error');
            }
            return;
          }
          
          if (typeof window.showToast === 'function') {
            window.showToast('validating video…', 'info');
          }
          const ext = raw.split('.').pop().toLowerCase();
          const ok = {mov:1,mp4:1,mxf:1,mkv:1,avi:1,m4v:1,mpg:1,mpeg:1}[ext] === 1;
          if (!ok) { 
            if (typeof window.showToast === 'function') {
              window.showToast('please drop a video file', 'error');
            }
            return; 
          }
          const size = await statFileSizeBytes(raw);
          if (size > 1024*1024*1024) { 
            if (typeof window.showToast === 'function') {
              window.showToast('video exceeds 1gb (not allowed)', 'error');
            }
            return; 
          }
          selectedVideoIsTemp = false;
          selectedVideo = raw;
          console.log('[Video Selection] Drag & drop selected:', selectedVideo);
          updateLipsyncButton();
          renderInputPreview();
          if (typeof window.showToast === 'function') {
            window.showToast('uploading video…', 'info');
          }
          try{
            const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
            const body = { path: selectedVideo, apiKey: settings.apiKey||'' };
            await ensureAuthToken();
            const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
            const j = await r.json().catch(()=>null);
            if (r.ok && j && j.ok && j.url){ 
              uploadedVideoUrl = j.url; 
              window.uploadedVideoUrl = j.url; 
            } else {
              const errorMsg = j?.error || 'server error';
              if (window.showToast) {
                window.showToast(`video upload failed: ${errorMsg.toLowerCase()}`, 'error');
              }
            }
          }catch(e){ 
            if (window.showToast) {
              const errorMsg = e.name === 'AbortError' ? 'upload timeout' : 
                              e.message?.includes('Failed to fetch') ? 'server connection failed' : 
                              e.message?.toLowerCase() || 'unknown error';
              window.showToast(`video upload failed: ${errorMsg}`, 'error');
            }
          }
          // Clear any status messages
          try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
          scheduleEstimate();
        }catch(_){ }
      }

      async function handleDroppedAudio(raw){
        try{
          var statusEl = document.getElementById('statusMessage');
          
          // Validate path before proceeding
          if (!raw || typeof raw !== 'string' || raw.includes('.file/id=') || raw.length < 2) {
            if (typeof window.showToast === 'function') {
              window.showToast('invalid file path - please use upload button instead', 'error');
            }
            return;
          }
          
          if (typeof window.showToast === 'function') {
            window.showToast('validating audio…', 'info');
          }
          const ext = raw.split('.').pop().toLowerCase();
          const ok = {wav:1,mp3:1,aac:1,aif:1,aiff:1,m4a:1}[ext] === 1;
          if (!ok) { 
            if (typeof window.showToast === 'function') {
              window.showToast('please drop an audio file', 'error');
            }
            return; 
          }
          const size = await statFileSizeBytes(raw);
          if (size > 1024*1024*1024) { 
            if (typeof window.showToast === 'function') {
              window.showToast('audio exceeds 1gb (not allowed)', 'error');
            }
            return; 
          }
          selectedAudioIsTemp = false;
          selectedAudio = raw;
          updateLipsyncButton();
          renderInputPreview();
          updateInputStatus();
          if (typeof window.showToast === 'function') {
            window.showToast('uploading audio…', 'info');
          }
          try{
            const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
            const body = { path: selectedAudio, apiKey: settings.apiKey||'' };
            await ensureAuthToken();
            const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
            const j = await r.json().catch(()=>null);
            if (r.ok && j && j.ok && j.url){ 
              uploadedAudioUrl = j.url; 
              window.uploadedAudioUrl = j.url; 
            } else {
              const errorMsg = j?.error || 'server error';
              if (window.showToast) {
                window.showToast(`audio upload failed: ${errorMsg.toLowerCase()}`, 'error');
              }
            }
          }catch(e){ 
            if (window.showToast) {
              const errorMsg = e.name === 'AbortError' ? 'upload timeout' : 
                              e.message?.includes('Failed to fetch') ? 'server connection failed' : 
                              e.message?.toLowerCase() || 'unknown error';
              window.showToast(`audio upload failed: ${errorMsg}`, 'error');
            }
          }
          try { updateInputStatus(); } catch(_){ }
          try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
          scheduleEstimate();
        }catch(_){ }
      }


