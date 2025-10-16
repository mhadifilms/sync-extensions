      console.log('Core.js loaded and executing');
      
      // Debug logging helper
      function debugLog(type, payload) {
        try {
          fetch('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type,
              timestamp: new Date().toISOString(),
              hostConfig: window.HOST_CONFIG,
              ...payload
            })
          }).catch(() => {});
        } catch (_) {}
      }
      window.debugLog = window.debugLog || debugLog;
      
      debugLog('core_loaded');
      
      let cs = null;
      let selectedVideo = null;
      let selectedAudio = null;
      let jobs = [];
      window.jobs = jobs; // Expose jobs globally for history.js
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
      
      // URL input support
      let selectedVideoUrl = '';
      let selectedAudioUrl = '';
      let selectedVideoIsUrl = false;
      let selectedAudioIsUrl = false;
      
      // Expose variables globally for cost estimation
      window.uploadedVideoUrl = uploadedVideoUrl;
      window.uploadedAudioUrl = uploadedAudioUrl;
      window.selectedVideoUrl = selectedVideoUrl;
      window.selectedAudioUrl = selectedAudioUrl;
      
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
      
      // Per-install auth token for local server
      let __authToken = '';
      async function ensureAuthToken(){
        if (__authToken) return __authToken;
        try{
          const r = await fetchWithTimeout('http://127.0.0.1:3000/auth/token', {
            headers: { 'X-CEP-Panel': 'sync' }
          }, 5000); // 5 second timeout
          const j = await r.json().catch(()=>null);
          if (r.ok && j && j.token){ __authToken = j.token; }
        }catch(_){ }
        return __authToken;
      }
      function authHeaders(extra){
        const h = Object.assign({}, extra||{});
        h['X-CEP-Panel'] = 'sync'; // Required by server for CORS validation
        if (__authToken) h['Authorization'] = 'Bearer ' + __authToken;
        return h;
      }
      
      // Expose auth functions globally for media.js and other modules
      window.ensureAuthToken = ensureAuthToken;
      window.authHeaders = authHeaders;
      
      // UI logger (disabled - use debug.md file-based logging instead)
      const DEBUG_LOGS = false;
      function uiLog(msg){
        // Dead code - logging moved to file-based system per debug.md
        return;
      }
      
      // Helper to call JSX with JSON payload and parse JSON response (with auto-load + retry)
      function evalExtendScript(fn, payload) {
        if (!cs) cs = new CSInterface();
        const arg = JSON.stringify(payload || {});
        const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
        // Build safe IIFE that ensures host is loaded before invoking
        function buildCode() {
          function esc(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\\"'); }
          const call = fn + '(' + JSON.stringify(arg) + ')';
          var hostFile = '/host/ppro.jsx';
          try { if (String(fn||'').indexOf('AEFT_') === 0) hostFile = '/host/ae.jsx'; } catch(_){ }
          const code = [
            '(function(){',
            '  try {',
            '    if (typeof ' + fn + " !== 'function') {",
            '      $.evalFile("' + esc(extPath) + hostFile + '");',
            '    }',
            '    var r = ' + call + ';',
            '    return r;',
            '  } catch(e) {',
            '    return String(e);',
            '  }',
            '})()'
          ].join('\n');
          return code;
        }
        function callOnce() {
          return new Promise((resolve) => {
            try { uiLog('evalScript start ' + fn); } catch(_) {}
            const code = buildCode();
            cs.evalScript(code, function(res){
              let out = null;
              try { out = (typeof res === 'string') ? JSON.parse(res) : res; } catch(_) {}
              if (!out || typeof out !== 'object' || out.ok === undefined) {
                // Fallback: treat raw string as a selected path
                if (res && typeof res === 'string' && res.indexOf('/') !== -1) {
                  resolve({ ok: true, path: res, _local: true });
                  return;
                }
                try { uiLog('evalScript cb raw ' + String(res||'')); } catch(_){ }
                resolve({ ok:false, error: String(res || 'no response'), _local: true });
                return;
              }
              try { uiLog('evalScript cb ok ' + fn); } catch(_) {}
              resolve(out);
            });
          });
        }
        return new Promise(async (resolve) => {
          let settled = false;
          const timeoutMs = 20000;
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { uiLog('evalScript timeout ' + fn); } catch(_) {}
              resolve({ ok:false, error:'EvalScript timeout' });
            }
          }, timeoutMs);
          try {
            const result = await callOnce();
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(result);
            }
          } catch (e) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve({ ok:false, error:String(e||'EvalScript error') });
            }
          }
        });
      }

      // Expose a quick diagnostic runner used by UI to surface host state
      async function runInOutDiagnostics(){
        try{
          const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
          if (isAE) {
            try {
              const aeRes = await evalExtendScript('AEFT_diagInOut', {});
              if (aeRes && typeof aeRes === 'object') return aeRes;
            } catch(_){ }
            return { ok:true, host:'AEFT' };
          }
          let res = await evalExtendScript('PPRO_diagInOut', {});
          // If host call failed or missing fields, try inline diag that doesn't depend on host
          const needsInline = !res || res.ok === false || (typeof res.hasActiveSequence === 'undefined' && typeof res.hasExportAsMediaDirect === 'undefined');
          if (!needsInline) return res;
          if (!cs) cs = new CSInterface();
          const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION);
          function esc(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\\"'); }
          const es = (
            "(function(){\n"+
            "  try{\n"+
            "    var seq = (app && app.project) ? app.project.activeSequence : null;\n"+
            "    var hasSeq = !!seq;\n"+
            "    var hasDirect = !!(seq && typeof seq.exportAsMediaDirect === 'function');\n"+
            "    var inT = 0, outT = 0;\n"+
            "    try{ var ip = seq && seq.getInPoint ? seq.getInPoint() : null; inT = ip ? (ip.ticks||0) : 0; }catch(_){ inT=0; }\n"+
            "    try{ var op = seq && seq.getOutPoint ? seq.getOutPoint() : null; outT = op ? (op.ticks||0) : 0; }catch(_){ outT=0; }\n"+
            "    var eprRoot = '';\n"+
            "    try{ var f = new Folder('" + esc(extPath) + "/epr'); if (f && f.exists) { eprRoot = f.fsName; } }catch(_){ eprRoot=''; }\n"+
            "    var eprCount = 0;\n"+
            "    try{ if (eprRoot){ var ff = new Folder(eprRoot); var items = ff.getFiles(function(x){ try { return (x instanceof File) && /\\.epr$/i.test(String(x.name||'')); } catch(e){ return false; } }); eprCount = (items||[]).length; } }catch(_){ eprCount=0; }\n"+
            "    function escStr(s){ try{ s=String(s||''); s=s.replace(/\\\\|;/g,' '); return s; }catch(e){ return ''; } }\n"+
            "    return 'ok='+(hasSeq?1:0)+';active='+(hasSeq?1:0)+';direct='+(hasDirect?1:0)+';in='+inT+';out='+outT+';eprRoot='+escStr(eprRoot)+';eprs='+eprCount;\n"+
            "  } catch(e){ return 'ok=0;error='+String(e); }\n"+
            "})()"
          );
          const inline = await new Promise(resolve => { cs.evalScript(es, function(r){ resolve(r); }); });
          // Parse key=value; pairs into object
          let txt = String(inline||'');
          const out = { ok:false };
          try {
            const parts = txt.split(';');
            const map = {};
            for (let i=0;i<parts.length;i++){
              const kv = parts[i].split('=');
              if (kv.length >= 2) map[kv[0].trim()] = kv.slice(1).join('=').trim();
            }
            out.ok = map.ok === '1';
            out.hasActiveSequence = map.active === '1';
            out.hasExportAsMediaDirect = map.direct === '1';
            out.inTicks = Number(map.in||0) || 0;
            out.outTicks = Number(map.out||0) || 0;
            out.eprRoot = map.eprRoot || '';
            out.eprCount = Number(map.eprs||0) || 0;
            if (map.error) out.error = map.error;
          } catch(_) {
            out.ok = false; out.error = 'parse';
          }
          return out;
        }catch(e){ return { ok:false, error:String(e) }; }
      }

      // Host-backed file picker to avoid inline ExtendScript parser issues
      let __pickerBusy = false;
      
      try {
        fetchWithTimeout('http://127.0.0.1:3000/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            type: 'ui_loaded', 
            hostConfig: window.HOST_CONFIG,
            timestamp: Date.now()
          })
        }, 3000).then(r => {
          // Debug: fetch response
          fetchWithTimeout('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              type: 'ui_loaded_response', 
              status: r.status,
              ok: r.ok
            })
          }, 3000).catch(() => {});
        }).catch(e => {
          // Debug: fetch error
          fetchWithTimeout('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              type: 'ui_loaded_error', 
              error: String(e.message || e)
            })
          }, 3000).catch(() => {});
        });
      } catch(e) {
        // Debug: try-catch error
        try {
          fetchWithTimeout('http://127.0.0.1:3000/debug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              type: 'ui_loaded_try_catch_error', 
              error: String(e.message || e)
            })
          }, 3000).catch(() => {});
        } catch(_) {}
      }
      window.openFileDialog = async function openFileDialog(kind) {
        if (__pickerBusy) { return ''; }
        __pickerBusy = true;
        try {
          const k = (typeof kind === 'string' ? kind : 'video');
          if (!cs) cs = new CSInterface();
          
          // Debug logging
          try {
            fetchWithTimeout('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'file_picker_start', 
                kind: k,
                hostConfig: window.HOST_CONFIG
              })
            }, 3000).catch(() => {});
          } catch(_) {}
          // Ensure only current host script is loaded before invoking
          try {
            const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
            const hostFile = isAE ? 'ae' : 'ppro';
            await new Promise(resolve => cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}.jsx\")`, ()=>resolve()));
          } catch(_){ }
          // Prefer host-specific dialog helper
          try {
            const payload = JSON.stringify({ kind: k }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
            return await new Promise(resolve => {
              const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
              const fn = isAE ? 'AEFT_showFileDialog' : 'PPRO_showFileDialog';
              cs.evalScript(`${fn}(\"${payload}\")`, function(r){
                // Debug logging
                try {
                    fetchWithTimeout('http://127.0.0.1:3000/debug', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        type: 'file_picker_response', 
                        response: String(r),
                        responseType: typeof r,
                        function: fn,
                        responseLength: String(r).length,
                        responsePreview: String(r).substring(0, 200),
                        hostConfig: window.HOST_CONFIG
                      })
                    }, 3000).catch(() => {});
                } catch(_) {}
                
                try { 
                  var j = JSON.parse(r||'{}'); 
                  if (j && j.ok && j.path) { 
                    resolve(j.path); 
                    return; 
                  } 
                  // If JSON parsing failed but we got a string that looks like a path, use it
                  if (typeof r === 'string' && r.indexOf('/') !== -1 && !r.startsWith('{')) {
                    resolve(r);
                    return;
                  }
                } catch(e){ 
                  // Debug JSON parse error
                  try {
                    fetchWithTimeout('http://127.0.0.1:3000/debug', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type: 'file_picker_json_parse_error',
                        error: String(e),
                        response: String(r),
                        function: fn,
                        hostConfig: window.HOST_CONFIG
                      })
                    }, 3000).catch(() => {});
                  } catch(_){ }
                  
                  // If JSON parsing failed but we got a string that looks like a path, use it
                  if (typeof r === 'string' && r.indexOf('/') !== -1 && !r.startsWith('{')) {
                    resolve(r);
                    return;
                  }
                }
                resolve('');
              });
            });
          } catch(_){ return ''; }
        } finally {
          __pickerBusy = false;
        }
      }
      
      window.showTab = function showTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-pane').forEach(tab => {
          tab.classList.remove('active');
        });
        document.querySelectorAll('.tab-switch').forEach(tab => {
          tab.classList.remove('active');
        });
        
        // Pause any playing media when switching tabs
        try { const v = document.getElementById('mainVideo'); if (v) v.pause(); } catch(_){ }
        try { const ov = document.getElementById('outputVideo'); if (ov) ov.pause(); } catch(_){ }
        try { const a = document.getElementById('audioPlayer'); if (a) a.pause(); } catch(_){ }

        // Show selected tab
        document.getElementById(tabName).classList.add('active');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        // Ensure history is always populated when shown
        if (tabName === 'history') {
          // Only show loading animation if we need to load from server
          // updateHistory() will handle showing loading state when needed
          try { updateHistory(); } catch(_) {}
          // Start auto-refresh for history tab
          try { 
            if (typeof startHistoryAutoRefresh === 'function') startHistoryAutoRefresh(); 
          } catch(_) {}
          // Reset scroll to top to avoid landing mid-list after job submit
          try {
            setTimeout(function(){
              try {
                var container = document.querySelector('#history .tab-container') || document.getElementById('history');
                if (container && typeof container.scrollTop === 'number') { container.scrollTop = 0; }
              } catch(_) { }
              try { if (document.scrollingElement) { document.scrollingElement.scrollTop = 0; } } catch(_) { }
              try { window.scrollTo(0, 0); } catch(_) { }
            }, 0);
          } catch(_) { }
        } else {
          // Stop auto-refresh when switching away from history tab
          try { 
            if (typeof stopHistoryAutoRefresh === 'function') stopHistoryAutoRefresh(); 
          } catch(_) {}
          
          // Update lipsync button state when switching back to sources tab
          if (tabName === 'sources') {
            try {
              if (typeof window.updateLipsyncButton === 'function') {
                window.updateLipsyncButton();
              }
            } catch(_) {}
          }
        }
      }

      async function waitForHealth(maxAttempts = 20, delayMs = 250, expectedToken) {
        for (let i = 0; i < maxAttempts; i++) {
          try {
            const resp = await fetchWithTimeout(`http://127.0.0.1:${getServerPort()}/health`, { 
              headers: { 'X-CEP-Panel': 'sync' }, 
              cache: 'no-store' 
            }, 5000); // 5 second timeout per attempt
            if (resp.ok) return true;
          } catch (e) {
            // ignore until attempts exhausted
          }
          if (expectedToken != null && expectedToken !== runToken) return false;
          await new Promise(r => setTimeout(r, delayMs));
        }
        return false;
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

      function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }

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
      // URL validation functions
      function isValidUrl(string) {
        try {
          const url = new URL(string);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
          return false;
        }
      }

      function isValidVideoUrl(url) {
        if (!isValidUrl(url)) return false;
        const videoExtensions = ['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'];
        const urlLower = url.toLowerCase();
        return videoExtensions.some(ext => urlLower.includes(ext));
      }

      function isValidAudioUrl(url) {
        if (!isValidUrl(url)) return false;
        const audioExtensions = ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'];
        const urlLower = url.toLowerCase();
        return audioExtensions.some(ext => urlLower.includes(ext));
      }

      async function checkUrlSize(url) {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          const contentLength = response.headers.get('content-length');
          if (contentLength) {
            const sizeInBytes = parseInt(contentLength);
            const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
            return { size: sizeInGB, valid: sizeInGB <= 1 };
          }
          return { size: 0, valid: true }; // If no content-length header, assume valid
        } catch (error) {
          return { size: 0, valid: false };
        }
      }

      // External link handler for CEP extensions
      window.openExternalURL = function(url) {
        if (!url) return;
        try {
          if (!cs) cs = new CSInterface();
          cs.openURLInDefaultBrowser(url);
        } catch(e) {
          console.error('Failed to open URL:', e);
        }
      }
      
      // Intercept all external link clicks and open them in browser
      document.addEventListener('click', function(e) {
        let target = e.target;
        // Traverse up to find an anchor tag
        while (target && target.tagName !== 'A') {
          target = target.parentElement;
        }
        
        if (target && target.tagName === 'A') {
          const href = target.getAttribute('href');
          // Check if it's an external link (http/https/mailto)
          if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:'))) {
            e.preventDefault();
            e.stopPropagation();
            openExternalURL(href);
            return false;
          }
        }
      }, true);
      
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

      (function wireSourcesButtons(){
        try{
          function on(selector, handler){ 
            try { 
              const el = document.querySelector(selector); 
              if (el) {
                el.addEventListener('click', handler);
                if (selector.includes('audio-from-video')) {
                  console.log('From video button found and handler attached:', el);
                }
              } else {
                if (selector.includes('audio-from-video')) {
                  console.error('From video button NOT FOUND with selector:', selector);
                }
              }
            } catch(e){
              if (selector.includes('audio-from-video')) {
                console.error('Error attaching handler to from video button:', e);
              }
            } 
          }
          // Video buttons
          console.log('Setting up video button listeners');
          const videoRecordBtn = document.querySelector('.video-upload .action-btn[data-action="video-record"]');
          console.log('Video record button found:', !!videoRecordBtn);
          debugLog('wire_buttons_start', { 
            videoRecordBtn: !!videoRecordBtn,
            audioRecordBtn: false, // will be set below
            audioTtsBtn: false // will be set below
          });
          
          on('.video-upload .action-btn[data-action="video-upload"]', function(){ try{ selectVideo(); }catch(_){ } });
          on('.video-upload .action-btn[data-action="video-inout"]', function(){ try{ selectVideoInOut(); }catch(_){ } });
          on('.video-upload .action-btn[data-action="video-record"]', function(){ 
            console.log('Video record button clicked');
            debugLog('video_record_clicked');
            try{ 
              if (typeof window.startVideoRecording === 'function') {
                console.log('Calling startVideoRecording');
                debugLog('start_video_recording', {
                  functionAvailable: true,
                  selectedVideo: window.selectedVideo,
                  selectedAudio: window.selectedAudio,
                  selectedVideoUrl: window.selectedVideoUrl,
                  selectedAudioUrl: window.selectedAudioUrl
                });
                window.startVideoRecording();
              } else {
                console.error('startVideoRecording function not available');
                debugLog('start_video_recording', {
                  functionAvailable: false,
                  selectedVideo: window.selectedVideo,
                  selectedAudio: window.selectedAudio,
                  selectedVideoUrl: window.selectedVideoUrl,
                  selectedAudioUrl: window.selectedAudioUrl
                });
              }
            }catch(e){ 
              console.error('Video recording error:', e);
              debugLog('video_recording_error', { error: String(e) });
            } 
          });
          on('.video-upload .action-btn[data-action="video-link"]', function(){ try{ selectVideoUrl(); }catch(_){ } });

          // Audio buttons
          console.log('Setting up audio button listeners');
          const audioRecordBtn = document.querySelector('.audio-upload .action-btn[data-action="audio-record"]');
          const audioTtsBtn = document.querySelector('.audio-upload .action-btn[data-action="audio-tts"]');
          console.log('Audio record button found:', !!audioRecordBtn);
          console.log('Audio TTS button found:', !!audioTtsBtn);
          debugLog('wire_audio_buttons', { 
            audioRecordBtn: !!audioRecordBtn,
            audioTtsBtn: !!audioTtsBtn
          });
          
          on('.audio-upload .action-btn[data-action="audio-upload"]', function(){ try{ selectAudio(); }catch(_){ } });
          on('.audio-upload .action-btn[data-action="audio-inout"]', function(){ try{ selectAudioInOut(); }catch(_){ } });
          on('.audio-upload .action-btn[data-action="audio-record"]', function(){ 
            console.log('Audio record button clicked');
            debugLog('audio_record_clicked');
            try{ 
              if (typeof window.startAudioRecording === 'function') {
                console.log('Calling startAudioRecording');
                debugLog('start_audio_recording', {
                  functionAvailable: true,
                  selectedVideo: window.selectedVideo,
                  selectedAudio: window.selectedAudio,
                  selectedVideoUrl: window.selectedVideoUrl,
                  selectedAudioUrl: window.selectedAudioUrl
                });
                window.startAudioRecording();
              } else {
                console.error('startAudioRecording function not available');
                debugLog('start_audio_recording', {
                  functionAvailable: false,
                  selectedVideo: window.selectedVideo,
                  selectedAudio: window.selectedAudio,
                  selectedVideoUrl: window.selectedVideoUrl,
                  selectedAudioUrl: window.selectedAudioUrl
                });
              }
            }catch(e){ 
              console.error('Audio recording error:', e);
              debugLog('audio_recording_error', { error: String(e) });
            } 
          });
          on('.audio-upload .action-btn[data-action="audio-from-video"]', async function(){ 
            // Log to debug file for CEP debugging
            try {
              const debugMsg = `[${new Date().toISOString()}] FROM VIDEO BUTTON CLICKED - selectedVideo: ${selectedVideo || 'null'}, selectedVideoUrl: ${selectedVideoUrl || 'null'}, selectAudioFromVideo exists: ${typeof window.selectAudioFromVideo}, ensureAuthToken exists: ${typeof window.ensureAuthToken}\n`;
              const fs = require('fs');
              const path = require('path');
              const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
              fs.appendFileSync(debugFile, debugMsg);
            } catch(e) {}
            
            try {
              if (typeof window.selectAudioFromVideo === 'function') {
                await window.selectAudioFromVideo();
              } else {
                // Log error to debug file
                try {
                  const errorMsg = `[${new Date().toISOString()}] ERROR: window.selectAudioFromVideo is not a function!\n`;
                  const fs = require('fs');
                  const path = require('path');
                  const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
                  fs.appendFileSync(debugFile, errorMsg);
                } catch(e) {}
              }
            } catch (e) {
              // Log error to debug file
              try {
                const errorMsg = `[${new Date().toISOString()}] ERROR in selectAudioFromVideo: ${e.message}\n`;
                const fs = require('fs');
                const path = require('path');
                const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
                fs.appendFileSync(debugFile, errorMsg);
              } catch(e) {}
            }
          });
          // TTS/Dubbing stub dropdowns (toggle only)
          on('.audio-upload .action-btn[data-action="audio-tts"]', function(){ 
            console.log('TTS button clicked');
            debugLog('tts_button_clicked');
            try{ 
              if (typeof window.TTSInterface !== 'undefined' && window.TTSInterface.show) {
                console.log('Calling TTSInterface.show');
                debugLog('tts_interface_show', { interfaceAvailable: true });
                window.TTSInterface.show();
              } else {
                console.error('TTSInterface not available');
                debugLog('tts_interface_show', { interfaceAvailable: false });
              }
            }catch(e){ 
              console.error('TTS button error:', e);
              debugLog('tts_button_error', { error: String(e) });
            } 
          });
          on('.audio-upload .action-btn-icon[data-action="audio-dubbing"]', function(){ try{ const m=document.getElementById('dubbingMenu'); if(m){ m.style.display = (m.style.display==='none'||!m.style.display)?'block':'none'; } }catch(_){ } });
          // Audio link button
          on('.audio-upload .action-btn[data-action="audio-link"]', function(){ try{ selectAudioUrl(); }catch(_){ } });
          
          // URL input handlers
          on('.url-submit-btn[data-action="video-url-submit"]', function(){ try{ submitVideoUrl(); }catch(_){ } });
          on('.url-clear-btn[data-action="video-url-clear"]', function(){ try{ clearVideoUrl(); }catch(_){ } });
          on('.url-submit-btn[data-action="audio-url-submit"]', function(){ try{ submitAudioUrl(); }catch(_){ } });
          on('.url-clear-btn[data-action="audio-url-clear"]', function(){ try{ clearAudioUrl(); }catch(_){ } });
          
          // Lipsync button
          on('#lipsyncBtn', function(){ 
            try{ 
              // Disable button immediately
              const btn = document.getElementById('lipsyncBtn');
              if (btn) {
                btn.disabled = true;
                btn.textContent = 'submitting...';
              }
              if (window.showToast) {
                window.showToast('submitting...', 'info');
              }
              startLipsync(); 
            }catch(_){ } 
          });

          // Close stub menus on outside click
          document.addEventListener('click', function(e){
            try{
              const t = e.target;
              const inTTS = t && (t.closest && t.closest('#ttsMenu'));
              const inDub = t && (t.closest && t.closest('#dubbingMenu'));
              const ttsBtn = t && (t.closest && t.closest('[data-action="audio-tts"]'));
              const dubBtn = t && (t.closest && t.closest('[data-action="audio-dubbing"]'));
              if (!inTTS && !ttsBtn) { const m=document.getElementById('ttsMenu'); if(m) m.style.display='none'; }
              if (!inDub && !dubBtn) { const m=document.getElementById('dubbingMenu'); if(m) m.style.display='none'; }
            }catch(_){ }
          });
        }catch(_){ }
      })();

      (function ensureDnDZones(){
        try{
          if (typeof initDragAndDrop === 'function') initDragAndDrop();
        }catch(_){ }
      })();





