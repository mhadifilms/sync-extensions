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
      
      function revealFile(jobId) {
        const job = jobs.find(j => String(j.id) === String(jobId));
        if (!job || !job.outputPath) return;
        if (!cs) cs = new CSInterface();
        cs.evalScript(`PPRO_revealFile("${job.outputPath.replace(/\"/g,'\\\"')}")`, function(r){ console.log('reveal', r); });
      }
      function insertHistory(jobId) { insertJob(jobId); }


