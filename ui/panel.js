/* global CSInterface, SystemPath */
(function(){
  const cs = new CSInterface();
  const serverBase = 'http://127.0.0.1:5757';

  const els = {};
  function $(id){ return document.getElementById(id); }

  function setStatus(msg){ const e = $('status'); if (e) e.textContent = msg || ''; }

  function switchTab(name){
    document.querySelectorAll('.tab').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(n => n.classList.remove('active'));
    const tab = document.getElementById(`tab-${name}`);
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (tab) tab.classList.add('active');
    if (btn) btn.classList.add('active');
  }

  function hydrateModelList(){
    const sel = $('model');
    if (!sel) return;
    fetch(`${serverBase}/models`).then(r=>r.json()).then(data=>{
      if (!data || !data.ok || !Array.isArray(data.models)) return;
      const current = sel.value;
      sel.innerHTML = '';
      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id || m.name || String(m);
        opt.textContent = m.name || m.id || String(m);
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    }).catch(()=>{});
  }

  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem('sync_settings')||'{}');
      $('apiKey').value = s.apiKey || '';
      $('targetVideoTrack').value = s.targetVideoTrack ?? '';
      $('targetAudioTrack').value = s.targetAudioTrack ?? '';
      $('defaultBin').value = s.defaultBin || 'Sync Outputs';
      $('model').value = s.model || 'lipsync-2-pro';
      $('temperature').value = s.temperature != null ? s.temperature : 0.5;
      $('activeSpeakerOnly').checked = !!s.activeSpeakerOnly;
      $('detectObstructions').checked = !!s.detectObstructions;
      return s;
    }catch(e){ return {}; }
  }

  function saveSettings(){
    const s = {
      apiKey: $('apiKey').value.trim(),
      targetVideoTrack: Number($('targetVideoTrack').value||0),
      targetAudioTrack: Number($('targetAudioTrack').value||0),
      defaultBin: $('defaultBin').value.trim() || 'Sync Outputs',
      model: $('model').value,
      temperature: Number($('temperature').value||0.5),
      activeSpeakerOnly: $('activeSpeakerOnly').checked,
      detectObstructions: $('detectObstructions').checked
    };
    localStorage.setItem('sync_settings', JSON.stringify(s));
    setStatus('Settings saved.');
    return s;
  }

  function evalExtendScript(fn, payload){
    const json = JSON.stringify(payload||{});
    return new Promise(resolve => {
      cs.evalScript(`${fn}(${JSON.stringify(json)})`, res => {
        try{ resolve(JSON.parse(res)); }catch(e){ resolve({ok:false,error:String(res||e)}); }
      });
    });
  }

  let hostLoaded = false;
  async function ensureHostLoaded(){
    if (hostLoaded) return true;
    try{
      const extPath = cs.getSystemPath(SystemPath.EXTENSION);
      cs.evalScript(`$.evalFile('${extPath}/host/ppro.jsx')`);
      hostLoaded = true;
      return true;
    }catch(e){ return false; }
  }

  async function pickFile(kind){
    await ensureHostLoaded();
    const res = await evalExtendScript('PPRO_showFileDialog', { kind });
    if (res.ok && res.path){
      if (kind === 'video'){
        els.videoPath = res.path;
        $('videoPathLabel').textContent = res.path.split('/').pop();
      } else if (kind === 'audio'){
        els.audioPath = res.path;
        $('audioPathLabel').textContent = res.path.split('/').pop();
      }
    } else {
      setStatus('No file selected.');
    }
  }

  async function startJob(){
    setStatus('Starting job...');
    const settings = loadSettings();
    const body = {
      videoPath: els.videoPath || '',
      audioPath: els.audioPath || '',
      settings: {
        model: settings.model,
        temperature: settings.temperature,
        activeSpeakerOnly: settings.activeSpeakerOnly,
        obstruction: settings.detectObstructions
      },
      apiKey: settings.apiKey || undefined
    };
    if (!body.videoPath || !body.audioPath){ setStatus('Select both video and audio.'); return; }
    const resp = await fetch(`${serverBase}/jobs`,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r=>r.json()).catch(e=>({ok:false,error:String(e)}));
    if (!resp.ok){
      setStatus(`Job error: ${resp.error}`);
      if (String(resp.error||'').toLowerCase().indexOf('api key') !== -1){ switchTab('settings'); }
      return;
    }
    setStatus(`Job queued: ${resp.jobId}`);
    switchTab('history');
    await refreshJobs();
  }

  async function refreshJobs(){
    const list = $('jobsList');
    list.innerHTML = '<div class="loading">loading…</div>';
    const data = await fetch(`${serverBase}/jobs`).then(r=>r.json()).catch(()=>({ok:false}));
    if (!data.ok){ list.textContent = 'No jobs.'; return; }
    list.innerHTML = '';
    data.jobs.forEach(j => {
      const div = document.createElement('div');
      div.className = 'result-item';
      const buttons = (j.status === 'done' && j.outputPath)
        ? `<button data-reveal="${j.id}" class="secondary">Download</button> <button data-insert="${j.id}" class="primary">Insert at playhead</button> <button data-import="${j.id}" class="secondary">Add to bin</button>`
        : '';
      div.innerHTML = `<h3>${j.id}</h3><div>Status: ${j.status}</div><div class="path">${j.outputPath||''}</div>${buttons}`;
      list.appendChild(div);
    });
  }

  async function pollJob(jobId){
    const res = await fetch(`${serverBase}/jobs/${jobId}`).then(r=>r.json()).catch(()=>({ok:false}));
    if (res.ok && res.job && res.job.status === 'done'){ await refreshJobs(); return true; }
    return false;
  }

  async function onHistoryClick(e){
    const t = e.target;
    if (t.matches('[data-insert]')){
      const id = t.getAttribute('data-insert');
      const res = await fetch(`${serverBase}/jobs/${id}`).then(r=>r.json()).catch(()=>({ok:false}));
      if (res.ok && res.job && res.job.outputPath){
        const s = loadSettings();
        await evalExtendScript('PPRO_insertAtPlayhead', { outputPath: res.job.outputPath, videoTrack: Number(s.targetVideoTrack||0), audioTrack: Number(s.targetAudioTrack||0) });
      }
    } else if (t.matches('[data-reveal]')){
      const id = t.getAttribute('data-reveal');
      const res = await fetch(`${serverBase}/jobs/${id}`).then(r=>r.json()).catch(()=>({ok:false}));
      if (res.ok && res.job && res.job.outputPath){
        await evalExtendScript('PPRO_revealFile', { path: res.job.outputPath });
      }
    } else if (t.matches('[data-import]')){
      const id = t.getAttribute('data-import');
      const res = await fetch(`${serverBase}/jobs/${id}`).then(r=>r.json()).catch(()=>({ok:false}));
      if (res.ok && res.job && res.job.outputPath){
        const s = loadSettings();
        await evalExtendScript('PPRO_importIntoBin', { path: res.job.outputPath, binName: s.defaultBin || 'Sync Outputs' });
      }
    }
  }

  function bind(){
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', ()=> switchTab(btn.dataset.tab)));
    $('pickVideo').addEventListener('click', ()=> pickFile('video'));
    $('pickAudio').addEventListener('click', ()=> pickFile('audio'));
    $('startJob').addEventListener('click', startJob);
    $('saveSettings').addEventListener('click', saveSettings);
    $('jobsList').addEventListener('click', onHistoryClick);
    $('temperature').addEventListener('input', ()=> $('tempValue').textContent = $('temperature').value);
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', ()=>{ if (btn.dataset.tab==='settings') hydrateModelList(); }));
  }

  async function init(){
    bind();
    // Load host JSX once to register functions
    try{
      const extPath = cs.getSystemPath(SystemPath.EXTENSION);
      cs.evalScript(`$.evalFile('${extPath}/host/ppro.jsx')`);
      hostLoaded = true;
    }catch(e){}
    // Ensure backend server is running
    try{ await evalExtendScript('PPRO_startBackend', {}); }catch(e){}
    loadSettings();
    switchTab('sources');
    hydrateModelList();
    // Load history immediately on startup
    refreshJobs();
    setInterval(refreshJobs, 4000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();


