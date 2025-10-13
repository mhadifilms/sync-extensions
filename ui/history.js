      // Timeout wrapper for fetch requests to prevent hanging
      async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
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

      async function updateHistory() {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        
        // Determine if we already have visible items to avoid flashing UI
        let hasRenderedItems = false;
        try { hasRenderedItems = /history-item/.test(historyList.innerHTML); } catch(_){ hasRenderedItems = false; }
        
        // Check API key first
        const apiKey = (JSON.parse(localStorage.getItem('syncSettings')||'{}').apiKey)||'';
        if (!apiKey) {
          historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">no api key found</div>';
          return;
        }
        
        // Check server health
        try {
          let healthy = false;
          try { 
            const r = await fetchWithTimeout('http://127.0.0.1:3000/health', { cache:'no-store' }, 5000); 
            healthy = !!(r && r.ok); 
          } catch(_){ 
            healthy = false; 
          }
          
          if (!healthy) {
            if (!hasRenderedItems) {
              historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">server offline</div>';
            }
            try { if (window.nle && typeof window.nle.startBackend === 'function') { await window.nle.startBackend(); } } catch(_){ }
            return;
          }
        } catch(_){ 
          if (!hasRenderedItems) historyList.innerHTML = '<div style="color:#888; text-align:center; padding:20px;">server offline</div>';
          return;
        }
        
        // Only show loading if list is empty to avoid visible refresh
        if (!hasRenderedItems) {
          historyList.innerHTML = '<div style="color:#666; text-align:center; padding:20px;">loading generations...</div>';
        }
        
        // Always show last known jobs (persisted)
        const sorted = jobs.slice().sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
        if (sorted.length > 0) {
          historyList.innerHTML = sorted.map(job => {
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
                <div class=\"history-actions\">\n                  <button class=\"history-button\" id=\"save-${job.id}\" onclick=\"saveJob('${job.id}')\">save</button>\n                  <button class=\"history-button\" id=\"insert-${job.id}\" onclick=\"insertJob('${job.id}')\">insert</button>\n          </div>
              </div>` : `
                <div class=\"history-actions\">\n                  \n          </div>
              </div>`;
            return base + done;
          }).join('');
        }
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
      
      // Refresh history when backend signals readiness
      try {
        window.addEventListener('sync-backend-ready', function(){
          try { updateHistory(); } catch(_){ }
          try { if (typeof loadJobsFromServer === 'function') loadJobsFromServer(); } catch(_){ }
        });
      } catch(_){ }
      
      // Auto-refresh history every 3 seconds to catch status changes
      let historyRefreshInterval = null;
      let historyRefreshTimeout = null;
      
      function startHistoryAutoRefresh() {
        if (historyRefreshInterval) return; // Already running
        
        historyRefreshInterval = setInterval(() => {
          try { 
            updateHistory(); 
            // Also refresh from server periodically to catch any missed updates
            if (typeof loadJobsFromServer === 'function') loadJobsFromServer(); 
          } catch(_){ }
        }, 3000); // 3 seconds - industry standard polling interval
        
        // Auto-stop after 30 minutes to prevent memory leaks
        historyRefreshTimeout = setTimeout(() => {
          stopHistoryAutoRefresh();
        }, 1800000); // 30 minutes
      }
      
      function stopHistoryAutoRefresh() {
        if (historyRefreshInterval) {
          clearInterval(historyRefreshInterval);
          historyRefreshInterval = null;
        }
        if (historyRefreshTimeout) {
          clearTimeout(historyRefreshTimeout);
          historyRefreshTimeout = null;
        }
      }
      
      // Auto-refresh is now handled in core.js showTab function
      
      // Also start auto-refresh if history tab is already active on page load
      try {
        setTimeout(() => {
          const historyTab = document.getElementById('history');
          if (historyTab && historyTab.classList.contains('active')) {
            startHistoryAutoRefresh();
          }
        }, 1000); // Wait 1 second after page load
      } catch(_){ }
      
      async function revealFile(jobId) {
        const job = jobs.find(j => String(j.id) === String(jobId));
        if (!job || !job.outputPath) return;
        try {
          if (window.nle && typeof window.nle.revealFile === 'function') {
            await window.nle.revealFile(job.outputPath);
          } else {
            if (!cs) cs = new CSInterface();
            cs.evalScript(`PPRO_revealFile("${job.outputPath.replace(/\"/g,'\\\"')}")`, function(r){ console.log('reveal', r); });
          }
        } catch(_){ }
      }
      function insertHistory(jobId) { insertJob(jobId); }


