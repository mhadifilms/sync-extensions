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
      
      // Per-install auth token for local server
      let __authToken = '';
      async function ensureAuthToken(){
        if (__authToken) return __authToken;
        try{
          const r = await fetch('http://127.0.0.1:3000/auth/token');
          const j = await r.json().catch(()=>null);
          if (r.ok && j && j.token){ __authToken = j.token; }
        }catch(_){ }
        return __authToken;
      }
      function authHeaders(extra){
        const h = Object.assign({}, extra||{});
        if (__authToken) h['Authorization'] = 'Bearer ' + __authToken;
        return h;
      }
      
      // UI logger to local server
      const DEBUG_LOGS = false;
      function uiLog(msg){
        if (!DEBUG_LOGS) return;
        try { fetch('http://127.0.0.1:3000/hostlog', { method:'POST', headers: authHeaders({'Content-Type':'application/json'}), body: JSON.stringify({ msg: String(msg||'') }) }).catch(()=>{}); } catch(_) {}
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
          const code = [
            '(function(){',
            '  try {',
            '    if (typeof ' + fn + " !== 'function') {",
            '      $.evalFile("' + esc(extPath) + '/host/ppro.jsx");',
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
        
        // Pause any playing media when switching tabs
        try { const v = document.getElementById('mainVideo'); if (v) v.pause(); } catch(_){ }
        try { const ov = document.getElementById('outputVideo'); if (ov) ov.pause(); } catch(_){ }
        try { const a = document.getElementById('audioPlayer'); if (a) a.pause(); } catch(_){ }

        // Show selected tab
        document.getElementById(tabName).classList.add('active');
        document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
        
        // Ensure history is always populated when shown
        if (tabName === 'history') {
          try { updateHistory(); } catch(_) {}
          try { loadJobsFromServer(); } catch(_) {}
        }
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
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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


