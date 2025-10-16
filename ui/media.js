      function updateLipsyncButton() {
        const btn = document.getElementById('lipsyncBtn');
        const hasVideo = !!(window.selectedVideo || window.selectedVideoUrl);
        const hasAudio = !!(window.selectedAudio || window.selectedAudioUrl);
        
        // Debug logging
        console.log('[Lipsync Button] Update:', {
          selectedVideo: window.selectedVideo,
          selectedVideoUrl: window.selectedVideoUrl,
          selectedAudio: window.selectedAudio,
          selectedAudioUrl: window.selectedAudioUrl,
          hasVideo,
          hasAudio,
          willEnable: hasVideo && hasAudio
        });
        
        if (hasVideo && hasAudio) {
          btn.disabled = false;
        } else {
          btn.disabled = true;
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
              const duration = video.duration || 0;
              const durationStr = isFinite(duration) ? formatTime(duration) : '0:00';
              timeDisplay.textContent = `${current} / ${durationStr}`;
            }
            if (seekBar) {
              seekBar.value = (video.currentTime / video.duration) * 100;
            }
          });
          // Keep play button icon in sync
          video.addEventListener('play', () => { if (playBtn) playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'; });
          video.addEventListener('pause', () => { if (playBtn) playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'; });
        }
        
        if (fullscreenBtn) {
          fullscreenBtn.addEventListener('click', () => {
            if (video.requestFullscreen) {
              video.requestFullscreen();
            }
          });
        }
      }

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
              const duration = audio.duration || 0;
              const durationStr = isFinite(duration) ? formatTime(duration) : '0:00';
              timeDisplay.textContent = `${current} / ${durationStr}`;
            }
            if (seekBar) {
              seekBar.value = (audio.currentTime / audio.duration) * 100;
            }
          });
        }
        
        // Generate full waveform from decoded samples via server helper
        let waveformBars = [];
        (async function buildWaveform(){
          try{
            // Ensure layout is ready so widths are non-zero
            await new Promise(r=>requestAnimationFrame(()=>r()));
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            let displayWidth = canvas.clientWidth || canvas.offsetWidth || 0;
            let displayHeight = canvas.clientHeight || canvas.offsetHeight || 0;
            if (!displayWidth || !displayHeight) {
              // Fallback sizes if layout not ready yet
              displayWidth = 600; displayHeight = 80;
            }
            canvas.width = Math.max(1, Math.floor(displayWidth * dpr));
            canvas.height = Math.max(1, Math.floor(displayHeight * dpr));
            const ctx2 = canvas.getContext('2d');
            if (dpr !== 1) ctx2.scale(dpr, dpr);
            function normalizePath(p){
              try {
                if (!p) return '';
                // strip file:// or file:/// prefix
                p = String(p).replace(/^file:\/\//,'');
                // decode percent-escapes
                try { p = decodeURI(p); } catch(_){ p = p.replace(/%20/g,' '); }
                // ensure leading slash on mac
                if (p && p[0] !== '/' && p.indexOf('Volumes/') === 0) p = '/' + p;
                return p;
              } catch(_) { return String(p||''); }
            }
            // Handle URL inputs differently
            if (window.selectedAudioIsUrl) {
              // For URL inputs, we'll use a placeholder waveform for now
              // In a real implementation, you'd need to fetch and decode the audio
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
              return;
            }
            
            // Prefer explicit selection path, else derive from audio.src
            let localPath = normalizePath(window.selectedAudio||'');
            if (!localPath){
              try { const u = normalizePath(audio.getAttribute('src')||''); localPath = u; } catch(_){ }
            }
            if (!localPath) { renderWaveform(canvas, [], 0, displayWidth, displayHeight); return; }
            await window.ensureAuthToken();
            const resp = await fetch('http://127.0.0.1:3000/waveform/file?'+new URLSearchParams({ path: localPath }), { headers: window.window.authHeaders(), cache:'no-store' });
            if (!resp.ok) { renderWaveform(canvas, [], 0); return; }
            const ab = await resp.arrayBuffer();
            const ac = new (window.AudioContext || window.webkitAudioContext)();
            let buf = null; try { buf = await ac.decodeAudioData(ab); } catch(_){ buf=null; }
            if (!buf) { renderWaveform(canvas, [], 0); try { ac.close(); } catch(_){ } return; }
            waveformBars = buildBarsFromBuffer(buf, canvas, displayWidth, displayHeight);
            renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
            try { ac.close(); } catch(_){ }
          }catch(_){ renderWaveform(canvas, [], 0); }
        })();
      }

  window.renderInputPreview = function renderInputPreview(source) {
    const payload = {
      selectedVideo: window.selectedVideo,
      selectedVideoUrl: window.selectedVideoUrl,
      selectedVideoIsUrl: window.selectedVideoIsUrl,
      selectedAudio: window.selectedAudio,
      selectedAudioUrl: window.selectedAudioUrl,
      selectedAudioIsUrl: window.selectedAudioIsUrl,
      source: source || 'unknown'
    };
    console.log('renderInputPreview called with:', payload);
    if (window.debugLog) window.debugLog('renderInputPreview_called', payload);
    try {
      const statusEl = document.getElementById('costStatus');
      if (statusEl) {
        statusEl.textContent = `preview update from ${payload.source}`;
      }
    } catch (_){ }
        
        const videoSection = document.getElementById('videoSection');
        const videoDropzone = document.getElementById('videoDropzone');
        const videoPreview = document.getElementById('videoPreview');
        
        const audioSection = document.getElementById('audioSection');
        const audioDropzone = document.getElementById('audioDropzone');
        const audioPreview = document.getElementById('audioPreview');
        
        // Video
        if (window.selectedVideo || window.selectedVideoUrl) {
          // Validate the path before using it (only for file paths)
          if (window.selectedVideo && (!window.selectedVideo || window.selectedVideo.includes('.file/id=') || window.selectedVideo.length < 2 || (!window.selectedVideo.startsWith('/') && !window.selectedVideo.startsWith('file://')))) {
            // Invalid path - show error and clear selection
            if (typeof window.showToast === 'function') {
              window.showToast('invalid file path - please select file again', 'error');
            }
            window.selectedVideo = null;
            if (videoSection) videoSection.classList.remove('has-media');
            videoDropzone.style.display = 'flex';
            videoPreview.style.display = 'none';
            return;
          }
          
          if (videoSection) videoSection.classList.add('has-media');
          videoDropzone.style.display = 'none';
          videoPreview.style.display = 'flex';
          const videoSrc = window.selectedVideoIsUrl ? window.selectedVideoUrl : `file://${window.selectedVideo.replace(/ /g, '%20')}`;
          videoPreview.innerHTML = `
            <div class="custom-video-player">
              <video id="mainVideo" class="video-element" src="${videoSrc}" preload="metadata">
                <source src="${videoSrc}" type="video/mp4">
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
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                      </svg>
                    </button>
                    <button class="video-control-btn video-delete-btn" onclick="clearVideoSelection()">
                      <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
          initCustomVideoPlayer();
          
          // Initialize Lucide icons for video controls
          if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
          }
        } else {
          if (videoSection) videoSection.classList.remove('has-media');
          videoDropzone.style.display = 'flex';
          videoPreview.style.display = 'none';
        }
        
        // Audio
        if (window.selectedAudio || window.selectedAudioUrl) {
          // Validate the path before using it (only for file paths)
          if (window.selectedAudio && (!window.selectedAudio || window.selectedAudio.includes('.file/id=') || window.selectedAudio.length < 2 || (!window.selectedAudio.startsWith('/') && !window.selectedAudio.startsWith('file://')))) {
            // Invalid path - show error and clear selection
            if (typeof window.showToast === 'function') {
              window.showToast('invalid file path - please select file again', 'error');
            }
            window.selectedAudio = null;
            if (audioSection) audioSection.classList.remove('has-media');
            audioDropzone.style.display = 'flex';
            audioPreview.style.display = 'none';
            return;
          }
          
          if (audioSection) audioSection.classList.add('has-media');
          audioDropzone.style.display = 'none';
          audioPreview.style.display = 'flex';
          const audioSrc = window.selectedAudioIsUrl ? window.selectedAudioUrl : "file://" + window.selectedAudio.replace(/ /g, '%20');
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'audio_src_set', 
                selectedAudio: window.selectedAudio,
                audioSrc: audioSrc,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
          
          audioPreview.innerHTML = `
            <div class="custom-audio-player">
              <audio id="audioPlayer" src="${audioSrc}" preload="auto"></audio>
              <button class="audio-play-btn" id="audioPlayBtn">
                <i data-lucide="play" style="width: 18px; height: 18px;"></i>
              </button>
              <div class="audio-waveform-container">
                <canvas id="waveformCanvas" class="waveform-canvas"></canvas>
                <div class="audio-time" id="audioTime">0:00 / 0:00</div>
              </div>
              <div class="dubbing-dropdown-wrapper">
                <button class="audio-dubbing-btn" id="dubbingBtn">
                  <i data-lucide="globe" style="width: 16px; height: 16px;"></i>
                  <span id="dubbingBtnText">dubbing</span>
                </button>
               <button class="audio-dubbing-submit-btn" id="dubbingSubmitBtn" style="display: none;">
                 <i data-lucide="arrow-right" style="width: 18px; height: 18px;"></i>
               </button>
                <div class="dubbing-dropdown" id="dubbingDropdown" style="display: none;">
                  <div class="dubbing-dropdown-header">
                    <i data-lucide="search" style="width: 16px; height: 16px;"></i>
                    <input type="text" id="dubbingSearch" class="dubbing-search-input" placeholder="target language" autocomplete="off">
                  </div>
                  <div class="dubbing-dropdown-divider"></div>
                  <div class="dubbing-dropdown-options" id="dubbingOptions">
                    <div class="dubbing-option" data-lang="en">english</div>
                    <div class="dubbing-option" data-lang="hi">hindi</div>
                    <div class="dubbing-option" data-lang="pt">portuguese</div>
                    <div class="dubbing-option" data-lang="zh">chinese</div>
                    <div class="dubbing-option" data-lang="es">spanish</div>
                    <div class="dubbing-option" data-lang="fr">french</div>
                    <div class="dubbing-option" data-lang="de">german</div>
                    <div class="dubbing-option" data-lang="ja">japanese</div>
                    <div class="dubbing-option" data-lang="ar">arabic</div>
                    <div class="dubbing-option" data-lang="ru">russian</div>
                    <div class="dubbing-option" data-lang="ko">korean</div>
                    <div class="dubbing-option" data-lang="id">indonesian</div>
                    <div class="dubbing-option" data-lang="it">italian</div>
                    <div class="dubbing-option" data-lang="nl">dutch</div>
                    <div class="dubbing-option" data-lang="tr">turkish</div>
                    <div class="dubbing-option" data-lang="pl">polish</div>
                    <div class="dubbing-option" data-lang="sv">swedish</div>
                    <div class="dubbing-option" data-lang="fil">filipino</div>
                    <div class="dubbing-option" data-lang="ms">malay</div>
                    <div class="dubbing-option" data-lang="ro">romanian</div>
                    <div class="dubbing-option" data-lang="uk">ukrainian</div>
                    <div class="dubbing-option" data-lang="el">greek</div>
                    <div class="dubbing-option" data-lang="cs">czech</div>
                    <div class="dubbing-option" data-lang="da">danish</div>
                    <div class="dubbing-option" data-lang="fi">finnish</div>
                    <div class="dubbing-option" data-lang="bg">bulgarian</div>
                    <div class="dubbing-option" data-lang="hr">croatian</div>
                    <div class="dubbing-option" data-lang="sk">slovak</div>
                    <div class="dubbing-option" data-lang="ta">tamil</div>
                  </div>
                  <div class="dubbing-dropdown-scrollbar"></div>
                </div>
              </div>
              <button class="audio-delete-btn" onclick="clearAudioSelection()">
                <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
              </button>
            </div>`;
          
          initCustomAudioPlayer();
          // Initialize Lucide icons for audio player
          if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
          }
        } else {
          if (audioSection) audioSection.classList.remove('has-media');
          audioDropzone.style.display = 'flex';
          audioPreview.style.display = 'none';
        }
        
        updateLipsyncButton();
        updateInputStatus();
        updateFromVideoButton();
      }

      async function selectVideo() {
        try {
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'selectVideo_called', 
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_) {}
          
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          if (typeof window.showToast === 'function') {
            window.showToast('opening video picker…', 'info');
          }
          const raw = await openFileDialog('video');
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'selectVideo_result', 
                raw: String(raw),
                rawType: typeof raw,
                hasSlash: raw && raw.indexOf('/') !== -1,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_) {}
          
          if (raw && raw.indexOf('/') !== -1) {
            window.selectedVideoIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {mov:1,mp4:1}[ext] === 1;
            if (!ok) { 
              if (typeof window.showToast === 'function') {
                window.showToast('only mp4 and mov supported', 'error');
              }
              return; 
            }
            const size = await new Promise(resolve=>{ 
              try {
                const safe = String(raw||'').replace(/\\/g,'\\\\').replace(/\"/g,'\\\"').replace(/'/g,"\\'");
                const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';}})()`;
                cs.evalScript(es, function(r){ 
                  try {
                    var n=Number(r||0); 
                    resolve(isNaN(n)?0:n); 
                  } catch(e) {
                    resolve(0);
                  }
                });
              } catch(e) {
                resolve(0);
              }
            });
            if (size > 1024*1024*1024) { 
              if (typeof window.showToast === 'function') {
                window.showToast('video exceeds 1gb (not allowed)', 'error');
              }
              return; 
            }
            window.selectedVideo = raw;
            console.log('[Video Selection] File selected:', window.selectedVideo);
            updateLipsyncButton();
            renderInputPreview();
            updateFromVideoButton();
            // Clear any status messages
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedVideo, apiKey: settings.apiKey||'' };
              await window.ensureAuthToken();
              const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: window.authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
              const j = await r.json().catch(()=>null);
              if (r.ok && j && j.ok && j.url){ 
                uploadedVideoUrl = j.url;
                window.uploadedVideoUrl = j.url; // Set window-scoped variable for cost estimation
                if (window.showToast) {
                  window.showToast('video uploaded successfully');
                }
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
          } else {
            // Remove unnecessary status message
          }
        } catch (_) { }
      }

      async function selectAudio() {
        try {
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          if (typeof window.showToast === 'function') {
            window.showToast('opening audio picker…', 'info');
          }
          const raw = await openFileDialog('audio');
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'selectAudio_result', 
                raw: String(raw),
                rawType: typeof raw,
                hasSlash: raw && raw.indexOf('/') !== -1,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_) {}
          
          if (raw && raw.indexOf('/') !== -1) {
            window.selectedAudioIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {wav:1,mp3:1}[ext] === 1;
            if (!ok) { 
              if (typeof window.showToast === 'function') {
                window.showToast('only mp3 and wav supported', 'error');
              }
              return; 
            }
            const size = await new Promise(resolve=>{ 
              try {
                const safe = String(raw||'').replace(/\\/g,'\\\\').replace(/\"/g,'\\\"').replace(/'/g,"\\'");
                const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';}})()`;
                cs.evalScript(es, function(r){ 
                  try {
                    var n=Number(r||0); 
                    resolve(isNaN(n)?0:n); 
                  } catch(e) {
                    resolve(0);
                  }
                });
              } catch(e) {
                resolve(0);
              }
            });
            if (size > 1024*1024*1024) { 
              if (typeof window.showToast === 'function') {
                window.showToast('audio exceeds 1gb (not allowed)', 'error');
              }
              return; 
            }
            window.selectedAudio = raw;
            window.selectedAudioUrl = ''; // Clear URL selection
            window.selectedAudioIsUrl = false;
            window.selectedAudioUrl = ''; // Clear global variable
            updateLipsyncButton();
            renderInputPreview();
            updateInputStatus();
            // Clear any status messages
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedAudio, apiKey: settings.apiKey||'' };
              await window.ensureAuthToken();
              const r = await fetch('http://127.0.0.1:3000/upload', { method:'POST', headers: window.authHeaders({'Content-Type':'application/json'}), body: JSON.stringify(body) });
              const j = await r.json().catch(()=>null);
              if (r.ok && j && j.ok && j.url){ 
                uploadedAudioUrl = j.url;
                window.uploadedAudioUrl = j.url; // Set window-scoped variable for cost estimation
                if (window.showToast) {
                  window.showToast('audio uploaded successfully');
                }
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
          } else {
            try { updateInputStatus(); } catch(_){ }
          }
        } catch (_) { }
      }

      async function selectVideoInOut(){
        try{
          if (window.__videoInOutBusy) { return; }
          window.__videoInOutBusy = true;
          const statusEl = document.getElementById('statusMessage');
          // Show toast notification instead of status bar
          if (window.showToast) {
            window.showToast('loading...', 'info');
          }
          if (statusEl) statusEl.textContent = '';
          // Only set loading state on the video in/out button
          let __videoInOutBtn = null; let __videoInOutBtnOrig = '';
          try {
            __videoInOutBtn = document.querySelector('#videoSection .dropzone-buttons button:nth-child(2)');
            if (__videoInOutBtn) { __videoInOutBtnOrig = __videoInOutBtn.textContent; __videoInOutBtn.textContent = 'loading…'; }
          } catch(_){ }
          const codec = document.getElementById('renderVideo').value || 'h264';
          let res = null;
          try {
            // Always try AE route first (preload ae.jsx), then fall back
            let triedAE = false;
            let hostIsAE = false;
            try {
              if (!cs) cs = new CSInterface();
              const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
              const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
              hostIsAE = !!isAE;
              const hostFile = isAE ? 'ae.jsx' : 'ppro.jsx';
              await new Promise(resolve => cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\")`, ()=>resolve()));
              const arg = JSON.stringify({ codec }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
              const exportFunc = isAE ? 'AEFT_exportInOutVideo' : 'PPRO_exportInOutVideo';
              res = await new Promise(resolve => { 
                cs.evalScript(`${exportFunc}(\"${arg}\")`, r => { 
                  try { resolve(JSON.parse(r||'{}')); } 
                  catch(_){ resolve({ ok:false, error:String(r||'') }); } 
                }); 
              });
              triedAE = true;
            } catch(_){ }
            if (!res || !res.ok) {
              // Only attempt fallback when the host is NOT AE; avoid a second AE invoke
              if (!hostIsAE) {
                if (window.nle && typeof window.nle.exportInOutVideo === 'function') {
                  res = await window.nle.exportInOutVideo({ codec });
                } else {
                  res = await evalExtendScript('PPRO_exportInOutVideo', { codec });
                }
              }
            }
          } catch(e){ res = { ok:false, error: String(e) }; }
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'selectVideoInOut_result', 
                res: res,
                resOk: res && res.ok,
                resPath: res && res.path,
                resError: res && res.error,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_) {}
          
          if (res && res.ok && res.path){
            window.selectedVideo = res.path; window.selectedVideoIsTemp = true;
            window.selectedVideoUrl = ''; // Clear URL selection
            window.selectedVideoIsUrl = false;
            window.selectedVideoUrl = ''; // Clear global variable
            console.log('[Video Selection] In/out selected:', window.selectedVideo);
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            updateFromVideoButton();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            
            // Upload for cost estimation
            // Clear any status messages
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedVideo, apiKey: settings.apiKey||'' };
              await window.ensureAuthToken();
              
              // Add timeout and retry logic for uploads
              let uploadSuccess = false;
              let lastError = null;
              
              console.log('[Video Upload] Starting upload for:', selectedVideo);
              
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 360000); // 6 minute timeout
                  
                  const r = await fetch('http://127.0.0.1:3000/upload', { 
                    method:'POST', 
                    headers: window.authHeaders({'Content-Type':'application/json'}), 
                    body: JSON.stringify(body),
                    signal: controller.signal
                  });
                  
                  clearTimeout(timeoutId);
                  const j = await r.json().catch(()=>null);
                  
                  if (r.ok && j && j.ok && j.url){ 
                    uploadedVideoUrl = j.url;
                    window.uploadedVideoUrl = j.url;
                    uploadSuccess = true;
                    
                    // Debug logging
                    try {
                      fetch('http://127.0.0.1:3000/debug', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'upload_complete',
                          fileType: 'video',
                          url: j.url,
                          uploadedVideoUrl: uploadedVideoUrl,
                          attempt: attempt,
                          hostConfig: window.HOST_CONFIG
                        })
                      }).catch(() => {});
                    } catch(_){ }
                    break;
                  } else {
                    lastError = j?.error || `HTTP ${r.status}`;
                  }
                } catch (error) {
                  if (error.name === 'AbortError') {
                    lastError = 'upload timeout';
                  } else if (error.message?.includes('Failed to fetch')) {
                    lastError = 'server connection failed';
                  } else {
                    lastError = error.message?.toLowerCase() || 'unknown error';
                  }
                  if (attempt < 3) {
                    if (typeof window.showToast === 'function') {
                      window.showToast(`uploading video… (retry ${attempt}/3)`, 'info');
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                  }
                }
              }
              
              if (!uploadSuccess) {
                if (typeof window.showToast === 'function') {
                  window.showToast(`upload failed: ${lastError}`, 'error');
                }
              }
            }catch(e){ 
              if (typeof window.showToast === 'function') {
                const errorMsg = e.name === 'AbortError' ? 'upload timeout' : 
                                e.message?.includes('Failed to fetch') ? 'server connection failed' : 
                                e.message?.toLowerCase() || 'unknown error';
                window.showToast(`upload error: ${errorMsg}`, 'error');
              }
            }
            // Clear any status messages
            
            // Schedule cost estimation after upload completes
            try {
              if (typeof scheduleEstimate === 'function') {
                scheduleEstimate();
              } else {
                // Debug logging
                fetch('http://127.0.0.1:3000/debug', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'scheduleEstimate_not_found',
                    hostConfig: window.HOST_CONFIG
                  })
                }).catch(() => {});
              }
            } catch(e) {
              // Debug logging
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'scheduleEstimate_error',
                  error: String(e),
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            }
            try { if (__videoInOutBtn) __videoInOutBtn.textContent = __videoInOutBtnOrig || 'in/out points'; } catch(_){ }
          } else {
            let diag = null;
            try {
              const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
              if (isAE) {
                if (!cs) cs = new CSInterface();
                try { const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const hostFile = window.HOST_CONFIG && window.HOST_CONFIG.isAE ? 'ae.jsx' : 'ppro.jsx'; await new Promise(resolve => cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\")`, ()=>resolve())); } catch(_){ }
                const diagFunc = window.HOST_CONFIG && window.HOST_CONFIG.isAE ? 'AEFT_diagInOut' : 'PPRO_diagInOut';
                diag = await new Promise(resolve=>{ cs.evalScript(`${diagFunc}()`, r=>{ try{ resolve(JSON.parse(r||'{}')); } catch(_){ resolve({ ok:true, host:window.nle && window.nle.getHostId && window.nle.getHostId() || 'PPRO' }); } }); });
              } else if (window.nle && typeof window.nle.diagInOut === 'function') diag = await window.nle.diagInOut();
              else diag = await evalExtendScript('PPRO_diagInOut', {});
            } catch(_){ }
            let extra = '';
            if (diag && typeof diag === 'object') {
              extra = ' [diag: ';
              if (typeof diag.hasActiveSequence !== 'undefined') {
                extra += 'active=' + String(diag.hasActiveSequence) + ', direct=' + String(diag.hasExportAsMediaDirect);
              } else if (typeof diag.projectOpen !== 'undefined') {
                extra += 'projectOpen=' + String(diag.projectOpen);
              } else {
                extra += 'unknown';
              }
              extra += (diag.inTicks!=null?(', in='+diag.inTicks):'') +
                (diag.outTicks!=null?(', out='+diag.outTicks):'') +
                (diag.eprRoot?(', eprRoot='+diag.eprRoot):'') +
                (diag.eprCount!=null?(', eprs='+diag.eprCount):'') +
              ']';
            }
            if (statusEl) {
              var errorMsg = 'video in/out export failed: ';
              if (res && res.error) {
                errorMsg += String(res.error);
              } else {
                errorMsg += 'evalscript error';
              }
              if (res && res.eprRoot) errorMsg += ' root=' + res.eprRoot;
              if (res && res.preset) errorMsg += ' preset=' + res.preset;
              errorMsg += extra;
              if (typeof window.showToast === 'function') {
                window.showToast(errorMsg, 'error');
              }
            }
            try { if (__videoInOutBtn) __videoInOutBtn.textContent = __videoInOutBtnOrig || 'in/out points'; } catch(_){ }
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){} }
        finally { try { window.__videoInOutBusy = false; } catch(_){ } }
      }

      async function selectAudioInOut(){
        try{
          if (window.__audioInOutBusy) { return; }
          window.__audioInOutBusy = true;
          const statusEl = document.getElementById('statusMessage');
          // Show toast notification instead of status bar
          if (window.showToast) {
            window.showToast('loading...', 'info');
          }
          if (statusEl) statusEl.textContent = '';
          // Only set loading state on the audio in/out button
          let __audioInOutBtn = null; let __audioInOutBtnOrig = '';
          try {
            __audioInOutBtn = document.querySelector('#audioSection .dropzone-buttons button:nth-child(2)');
            if (__audioInOutBtn) { __audioInOutBtnOrig = __audioInOutBtn.textContent; __audioInOutBtn.textContent = 'loading…'; }
          } catch(_){ }
          const format = document.getElementById('renderAudio').value || 'wav';
          let res = null;
          try {
            // Always try AE route first (preload ae.jsx), then (only if not AE) fall back
            let triedAE = false;
            let hostIsAE = false;
            try {
              if (!cs) cs = new CSInterface();
              const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
              const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
              hostIsAE = !!isAE;
              const hostFile = isAE ? 'ae.jsx' : 'ppro.jsx';
              await new Promise(resolve => cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\")`, ()=>resolve()));
              const arg = JSON.stringify({ format }).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
              const audioExportFunc = isAE ? 'AEFT_exportInOutAudio' : 'PPRO_exportInOutAudio';
              res = await new Promise(resolve => { 
                cs.evalScript(`${audioExportFunc}(\"${arg}\")`, r => { 
                  try { resolve(JSON.parse(r||'{}')); } 
                  catch(_){ resolve({ ok:false, error:String(r||'') }); } 
                }); 
              });
              triedAE = true;
            } catch(_){ }
            if (!res || !res.ok) {
              // Only attempt fallback when the host is NOT AE; avoid a second AE invoke
              if (!hostIsAE) {
                if (window.nle && typeof window.nle.exportInOutAudio === 'function') {
                  res = await window.nle.exportInOutAudio({ format });
                } else {
                  res = await evalExtendScript('PPRO_exportInOutAudio', { format });
                }
              }
            }
          } catch(e){ res = { ok:false, error: String(e) }; }
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'selectAudioInOut_result', 
                res: res,
                resOk: res && res.ok,
                resPath: res && res.path,
                resError: res && res.error,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_) {}
          
          if (res && res.ok && res.path){
            window.selectedAudio = res.path; window.selectedAudioIsTemp = true;
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            
            // Upload for cost estimation
            // Clear any status messages
            try{
              const settings = JSON.parse(localStorage.getItem('syncSettings')||'{}');
              const body = { path: selectedAudio, apiKey: settings.apiKey||'' };
              await window.ensureAuthToken();
              
              // Add timeout and retry logic for uploads
              let uploadSuccess = false;
              let lastError = null;
              
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 360000); // 6 minute timeout
                  
                  const r = await fetch('http://127.0.0.1:3000/upload', { 
                    method:'POST', 
                    headers: window.authHeaders({'Content-Type':'application/json'}), 
                    body: JSON.stringify(body),
                    signal: controller.signal
                  });
                  
                  clearTimeout(timeoutId);
                  const j = await r.json().catch(()=>null);
                  
                  if (r.ok && j && j.ok && j.url){ 
                    uploadedAudioUrl = j.url;
                    window.uploadedAudioUrl = j.url;
                    uploadSuccess = true;
                    
                    // Debug logging
                    try {
                      fetch('http://127.0.0.1:3000/debug', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'upload_complete',
                          fileType: 'audio',
                          url: j.url,
                          uploadedAudioUrl: uploadedAudioUrl,
                          attempt: attempt,
                          hostConfig: window.HOST_CONFIG
                        })
                      }).catch(() => {});
                    } catch(_){ }
                    break;
                  } else {
                    lastError = j?.error || `HTTP ${r.status}`;
                  }
                } catch (error) {
                  if (error.name === 'AbortError') {
                    lastError = 'upload timeout';
                  } else if (error.message?.includes('Failed to fetch')) {
                    lastError = 'server connection failed';
                  } else {
                    lastError = error.message?.toLowerCase() || 'unknown error';
                  }
                  if (attempt < 3) {
                    // Remove retry message - just keep loading state
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                  }
                }
              }
              
              if (!uploadSuccess) {
                if (typeof window.showToast === 'function') {
                  window.showToast(`upload failed: ${lastError}`, 'error');
                }
              }
            }catch(e){ 
              if (typeof window.showToast === 'function') {
                const errorMsg = e.name === 'AbortError' ? 'upload timeout' : 
                                e.message?.includes('Failed to fetch') ? 'server connection failed' : 
                                e.message?.toLowerCase() || 'unknown error';
                window.showToast(`upload error: ${errorMsg}`, 'error');
              }
            }
            // Clear any status messages
            
            // Schedule cost estimation after upload completes
            try {
              if (typeof scheduleEstimate === 'function') {
                scheduleEstimate();
              } else {
                // Debug logging
                fetch('http://127.0.0.1:3000/debug', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'scheduleEstimate_not_found',
                    hostConfig: window.HOST_CONFIG
                  })
                }).catch(() => {});
              }
            } catch(e) {
              // Debug logging
              fetch('http://127.0.0.1:3000/debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'scheduleEstimate_error',
                  error: String(e),
                  hostConfig: window.HOST_CONFIG
                })
              }).catch(() => {});
            }
            try { if (__audioInOutBtn) __audioInOutBtn.textContent = __audioInOutBtnOrig || 'in/out points'; } catch(_){ }
          } else {
            let diag = null;
            try {
              const isAE = window.HOST_CONFIG ? window.HOST_CONFIG.isAE : false;
              if (isAE) {
                if (!cs) cs = new CSInterface();
                try { const extPath = cs.getSystemPath(CSInterface.SystemPath.EXTENSION).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const hostFile = window.HOST_CONFIG && window.HOST_CONFIG.isAE ? 'ae.jsx' : 'ppro.jsx'; await new Promise(resolve => cs.evalScript(`$.evalFile(\"${extPath}/host/${hostFile}\")`, ()=>resolve())); } catch(_){ }
                const diagFunc = window.HOST_CONFIG && window.HOST_CONFIG.isAE ? 'AEFT_diagInOut' : 'PPRO_diagInOut';
                diag = await new Promise(resolve=>{ cs.evalScript(`${diagFunc}()`, r=>{ try{ resolve(JSON.parse(r||'{}')); } catch(_){ resolve({ ok:true, host:window.nle && window.nle.getHostId && window.nle.getHostId() || 'PPRO' }); } }); });
              } else if (window.nle && typeof window.nle.diagInOut === 'function') diag = await window.nle.diagInOut();
              else diag = await evalExtendScript('PPRO_diagInOut', {});
            } catch(_){ }
            let extra = '';
            if (diag && typeof diag === 'object') {
              extra = ' [diag: ';
              if (typeof diag.hasActiveSequence !== 'undefined') {
                extra += 'active=' + String(diag.hasActiveSequence) + ', direct=' + String(diag.hasExportAsMediaDirect);
              } else if (typeof diag.projectOpen !== 'undefined') {
                extra += 'projectOpen=' + String(diag.projectOpen);
              } else {
                extra += 'unknown';
              }
              extra += (diag.inTicks!=null?(', in='+diag.inTicks):'') +
                (diag.outTicks!=null?(', out='+diag.outTicks):'') +
                (diag.eprRoot?(', eprRoot='+diag.eprRoot):'') +
                (diag.eprCount!=null?(', eprs='+diag.eprCount):'') +
              ']';
            }
            if (statusEl) {
              var errorMsg = 'audio in/out export failed: ';
              if (res && res.error) {
                errorMsg += String(res.error);
              } else {
                errorMsg += 'evalscript error';
              }
              errorMsg += extra;
              if (typeof window.showToast === 'function') {
                window.showToast(errorMsg, 'error');
              }
            }
            try { if (__audioInOutBtn) __audioInOutBtn.textContent = __audioInOutBtnOrig || 'in/out points'; } catch(_){ }
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){} }
        finally { try { window.__audioInOutBusy = false; } catch(_){ } }
      }

      function updateInputStatus() {
        // Remove old status messages - use toast notifications instead
        const status = document.getElementById('statusMessage');
        if (status) {
          status.textContent = '';
        }
        
        // Only show "ready for lipsync" when both video and audio are selected
        if ((selectedVideo || selectedVideoUrl) && (selectedAudio || selectedAudioUrl)) {
          if (typeof window.showToast === 'function') {
            window.showToast('ready for lipsync', 'success');
          }
        }
      }

      function updateFromVideoButton() {
        const fromVideoBtn = document.querySelector('.audio-upload .action-btn[data-action="audio-from-video"]');
        if (!fromVideoBtn) return;
        
        const hasVideo = !!(selectedVideo || selectedVideoUrl);
        
        if (hasVideo) {
          fromVideoBtn.disabled = false;
          fromVideoBtn.style.opacity = '1';
          fromVideoBtn.style.cursor = 'pointer';
        } else {
          fromVideoBtn.disabled = true;
          fromVideoBtn.style.opacity = '0.5';
          fromVideoBtn.style.cursor = 'not-allowed';
        }
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

      function initCustomVideoPlayer() {
        // Allow re-initialization for new videos
        if (window.__videoPlayerInitialized) {
          window.__videoPlayerInitialized = false;
        }
        
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
        const updateVideoDuration = () => {
          const duration = video.duration || 0;
          const durationStr = isFinite(duration) && duration > 0 ? formatTime(duration) : '--';
          if (timeDisplay) timeDisplay.textContent = `00:00 / ${durationStr}`;
          if (frameInfo) {
            const totalFrames = isFinite(duration) && duration > 0 ? Math.floor(duration * 30) : 0;
            frameInfo.textContent = `0 / ${totalFrames || '--'}`;
          }
          
          console.log('Video duration update:', {
            duration: video.duration,
            durationStr: durationStr,
            src: video.src,
            readyState: video.readyState,
            selectedVideo: window.selectedVideo
          });
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'video_duration_update', 
                duration: video.duration,
                durationStr: durationStr,
                src: video.src,
                readyState: video.readyState,
                selectedVideo: window.selectedVideo,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
        };

        // Check if metadata is already loaded, also try after a short delay
        if (video.readyState >= 1) {
          updateVideoDuration();
        } else {
          video.addEventListener('loadedmetadata', updateVideoDuration);
        }
        
        // Also listen for duration changes (useful for streaming and WebM files)
        video.addEventListener('durationchange', () => {
          console.log('Video durationchange event fired, duration:', video.duration);
          updateVideoDuration();
        });
        
        // Additional retry mechanism for WebM files that may load metadata slowly
        let retryCount = 0;
        const maxRetries = 10;
        const retryInterval = setInterval(() => {
          if (video.duration && video.duration > 0) {
            console.log('Duration loaded on retry:', video.duration);
            updateVideoDuration();
            clearInterval(retryInterval);
          } else if (retryCount >= maxRetries) {
            console.log('Max retries reached for duration loading');
            clearInterval(retryInterval);
          } else {
            retryCount++;
            console.log(`Retrying duration load (${retryCount}/${maxRetries}), readyState:`, video.readyState);
            updateVideoDuration();
          }
        }, 200);
        
        // Force metadata loading for WebM files by triggering a play/pause cycle
        video.addEventListener('canplay', () => {
          console.log('Video canplay event fired, duration:', video.duration);
          if (!video.duration || video.duration === 0) {
            console.log('Duration still null after canplay, triggering play/pause');
            video.play().then(() => {
              setTimeout(() => {
                video.pause();
                video.currentTime = 0;
                console.log('After play/pause cycle, duration:', video.duration);
                updateVideoDuration();
              }, 100);
            }).catch(() => {
              console.log('Play failed, trying seek method');
              video.currentTime = 0.01;
              setTimeout(() => {
                video.currentTime = 0;
                console.log('After seek method, duration:', video.duration);
                updateVideoDuration();
              }, 100);
            });
          } else {
            updateVideoDuration();
          }
        });
        
        // Fallback: try updating duration after delays in case metadata loads asynchronously
        setTimeout(() => {
          if (video.readyState >= 1 && video.duration > 0) {
            console.log('Video duration fallback update:', video.duration);
            updateVideoDuration();
          } else {
            console.log('Video duration fallback failed:', {
              readyState: video.readyState,
              duration: video.duration,
              src: video.src
            });
          }
        }, 100);
        
        // Additional fallback for streaming URLs that may need more time
        setTimeout(() => {
          if (video.readyState >= 1 && video.duration > 0) {
            console.log('Video duration second fallback update:', video.duration);
            updateVideoDuration();
          } else if (video.readyState >= 1 && !video.duration) {
            console.log('Video duration is null but readyState is', video.readyState, '- trying to load duration');
            // Force duration calculation by seeking to end
            video.currentTime = 0.1;
            setTimeout(() => {
              if (video.duration > 0) {
                console.log('Video duration after seek:', video.duration);
                updateVideoDuration();
              }
            }, 50);
          }
        }, 500);
        
        // Debug video loading errors
        video.addEventListener('error', (e) => {
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'video_error', 
                error: String(e),
                src: video.src,
                readyState: video.readyState,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
        });

        // Update time and progress during playback
        video.addEventListener('timeupdate', () => {
          const current = formatTime(video.currentTime);
          const duration = video.duration || 0;
          const durationStr = isFinite(duration) ? formatTime(duration) : '0:00';
          const progress = (video.currentTime / (duration || 1)) * 100;
          
          if (timeDisplay) timeDisplay.textContent = `${current} / ${durationStr}`;
          if (progressFill) progressFill.style.width = `${progress}%`;
          if (progressThumb) progressThumb.style.left = `${progress}%`;
          
          // Frame info (approximate)
          if (frameInfo && isFinite(duration)) {
            const currentFrame = Math.floor(video.currentTime * 30); // Assume 30fps
            const totalFrames = Math.floor(duration * 30);
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

        // Reset to play icon when video ends
        video.addEventListener('ended', () => {
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
        video.addEventListener('click', togglePlay);

        // Volume control
        if (volumeSlider) {
          volumeSlider.addEventListener('input', (e) => {
            video.volume = e.target.value / 100;
          });
        }

        // Volume button
        if (volumeBtn) {
          volumeBtn.addEventListener('click', () => {
            video.muted = !video.muted;
            if (video.muted) {
              volumeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2"/></svg>';
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
        // Allow re-initialization for new audio files
        if (window.__audioPlayerInitialized) {
          window.__audioPlayerInitialized = false;
        }
        
        const audio = document.getElementById('audioPlayer');
        const playBtn = document.getElementById('audioPlayBtn');
        const timeDisplay = document.getElementById('audioTime');
        const canvas = document.getElementById('waveformCanvas');
        
        if (!audio || !canvas) return;

        // Build static waveform once from decoded PCM (no live analyser)
        let waveformBars = [];
        (async function buildWaveform(){
          try{
            // Ensure layout is ready so canvas has non-zero size (retry a few frames)
            let tries = 0;
            while (tries < 8) {
              await new Promise(r=>requestAnimationFrame(()=>r()));
              const rw = canvas.clientWidth || canvas.offsetWidth || 0;
              const rh = canvas.clientHeight || canvas.offsetHeight || 0;
              if (rw > 0 && rh > 0) break;
              tries++;
            }
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            let displayWidth = canvas.clientWidth || canvas.offsetWidth || 0;
            let displayHeight = canvas.clientHeight || canvas.offsetHeight || 0;
            if (!displayWidth || !displayHeight) { displayWidth = 600; displayHeight = 80; }
            canvas.width = Math.max(1, Math.floor(displayWidth * dpr));
            canvas.height = Math.max(1, Math.floor(displayHeight * dpr));
            const ctx2 = canvas.getContext('2d');
            if (dpr !== 1) ctx2.scale(dpr, dpr);
            
            function normalizePath(p){
              try {
                if (!p) return '';
                p = String(p).replace(/^file:\/\//,'');
                try { p = decodeURI(p); } catch(_){ p = p.replace(/%20/g,' '); }
                if (p && p[0] !== '/' && p.indexOf('Volumes/') === 0) p = '/' + p;
                return p;
              } catch(_) { return String(p||''); }
            }
            let localPath = normalizePath(window.selectedAudio||'');
            if (!localPath){
              try { const u = normalizePath(audio.getAttribute('src')||''); localPath = u; } catch(_){ }
            }
            console.log('[Waveform] selectedAudio:', window.selectedAudio);
            console.log('[Waveform] audio.src:', audio.getAttribute('src'));
            console.log('[Waveform] Normalized path:', localPath);
            if (!localPath) { 
              console.warn('[Waveform] No path found, using placeholder');
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight); 
              return; 
            }
            // This endpoint is now public to avoid blank waveform when token fails
            await window.ensureAuthToken();
            const waveformUrl = 'http://127.0.0.1:3000/waveform/file?'+new URLSearchParams({ path: localPath });
            console.log('[Waveform] Fetching from:', waveformUrl);
            const resp = await fetch(waveformUrl, { headers: window.authHeaders(), cache:'no-store' }).catch((e)=>{ console.error('[Waveform] Fetch exception:', e); return null; });
            if (!resp || !resp.ok) {
              // Fallback: draw placeholder waveform so UI isn't blank
              console.error('[Waveform] Fetch failed:', resp ? resp.status : 'no response');
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
              return;
            }
            console.log('[Waveform] Fetch successful, decoding...');
            const ab = await resp.arrayBuffer();
            console.log('[Waveform] ArrayBuffer size:', ab ? ab.byteLength : 0);
            const ac = new (window.AudioContext || window.webkitAudioContext)();
            let buf = null; try { buf = await ac.decodeAudioData(ab); } catch(_){
              try {
                // Safari-style decode fallback
                buf = await new Promise((resolve, reject)=>{
                  ac.decodeAudioData(ab.slice(0), resolve, reject);
                });
              } catch(e){ buf=null; }
            }
            if (!buf) {
              console.error('[Waveform] Decode failed');
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
              try { ac.close(); } catch(_){ }
              return;
            }
            console.log('[Waveform] Decoded successfully - sampleRate:', buf.sampleRate, 'length:', buf.length);
            waveformBars = buildBarsFromBuffer(buf, canvas, displayWidth, displayHeight);
            console.log('[Waveform] Generated', waveformBars.length, 'bars');
            renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
            try { ac.close(); } catch(_){ }
          }catch(err){
            console.error('[Waveform] Exception:', err);
            const w = canvas.clientWidth||600; const h = canvas.clientHeight||80;
            waveformBars = buildPlaceholderBars(w, h);
            renderWaveform(canvas, waveformBars, 0, w, h);
          }
        })();

        // Initialize time display when metadata loads
        const updateAudioDuration = () => {
          const duration = audio.duration || 0;
          const durationStr = isFinite(duration) && duration > 0 ? formatTime(duration) : '--';
          if (timeDisplay) timeDisplay.innerHTML = `<span class="time-current">0:00</span> <span class="time-total">/ ${durationStr}</span>`;
          
          console.log('Audio duration update:', {
            duration: audio.duration,
            durationStr: durationStr,
            src: audio.src,
            readyState: audio.readyState,
            selectedAudio: window.selectedAudio
          });
          
          // Debug logging
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'audio_duration_update', 
                duration: audio.duration,
                durationStr: durationStr,
                src: audio.src,
                readyState: audio.readyState,
                selectedAudio: window.selectedAudio,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
        };

        // Check if metadata is already loaded, also try after a short delay
        if (audio.readyState >= 1) {
          updateAudioDuration();
        } else {
          audio.addEventListener('loadedmetadata', updateAudioDuration);
        }
        
        // Also listen for duration changes (useful for streaming and WebM files)
        audio.addEventListener('durationchange', () => {
          console.log('Audio durationchange event fired, duration:', audio.duration);
          updateAudioDuration();
        });
        
        // Additional retry mechanism for WebM files that may load metadata slowly
        let audioRetryCount = 0;
        const audioMaxRetries = 10;
        const audioRetryInterval = setInterval(() => {
          if (audio.duration && audio.duration > 0) {
            console.log('Audio duration loaded on retry:', audio.duration);
            updateAudioDuration();
            clearInterval(audioRetryInterval);
          } else if (audioRetryCount >= audioMaxRetries) {
            console.log('Max retries reached for audio duration loading');
            clearInterval(audioRetryInterval);
          } else {
            audioRetryCount++;
            console.log(`Retrying audio duration load (${audioRetryCount}/${audioMaxRetries}), readyState:`, audio.readyState);
            updateAudioDuration();
          }
        }, 200);
        
        // Force metadata loading for WebM files by triggering a play/pause cycle
        audio.addEventListener('canplay', () => {
          console.log('Audio canplay event fired, duration:', audio.duration);
          if (!audio.duration || audio.duration === 0) {
            console.log('Duration still null after canplay, triggering play/pause');
            audio.play().then(() => {
              setTimeout(() => {
                audio.pause();
                audio.currentTime = 0;
                console.log('After play/pause cycle, duration:', audio.duration);
                updateAudioDuration();
              }, 100);
            }).catch(() => {
              console.log('Play failed, trying seek method');
              audio.currentTime = 0.01;
              setTimeout(() => {
                audio.currentTime = 0;
                console.log('After seek method, duration:', audio.duration);
                updateAudioDuration();
              }, 100);
            });
          } else {
            updateAudioDuration();
          }
        });
        
        // Fallback: try updating duration after delays in case metadata loads asynchronously
        setTimeout(() => {
          if (audio.readyState >= 1 && audio.duration > 0) {
            console.log('Audio duration fallback update:', audio.duration);
            updateAudioDuration();
          } else {
            console.log('Audio duration fallback failed:', {
              readyState: audio.readyState,
              duration: audio.duration,
              src: audio.src
            });
          }
        }, 100);
        
        // Additional fallback for streaming URLs that may need more time
        setTimeout(() => {
          if (audio.readyState >= 1 && audio.duration > 0) {
            console.log('Audio duration second fallback update:', audio.duration);
            updateAudioDuration();
          } else if (audio.readyState >= 1 && !audio.duration) {
            console.log('Audio duration is null but readyState is', audio.readyState, '- trying to load duration');
            // Force duration calculation by seeking to end
            audio.currentTime = 0.1;
            setTimeout(() => {
              if (audio.duration > 0) {
                console.log('Audio duration after seek:', audio.duration);
                updateAudioDuration();
              }
            }, 50);
          }
        }, 500);
        
        // Debug audio loading errors
        audio.addEventListener('error', (e) => {
          try {
            fetch('http://127.0.0.1:3000/debug', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                type: 'audio_error', 
                error: String(e),
                src: audio.src,
                readyState: audio.readyState,
                hostConfig: window.HOST_CONFIG
              })
            }).catch(() => {});
          } catch(_){ }
        });

        // Update time and progress highlight
        audio.addEventListener('timeupdate', () => {
          const current = formatTime(audio.currentTime);
          const duration = audio.duration || 0;
          const durationStr = isFinite(duration) ? formatTime(duration) : '0:00';
          if (timeDisplay) timeDisplay.innerHTML = `<span class="time-current">${current}</span> <span class="time-total">/ ${durationStr}</span>`;
          const w = canvas.clientWidth || canvas.offsetWidth || 600;
          const h = canvas.clientHeight || canvas.offsetHeight || 80;
          if (waveformBars && waveformBars.length) {
            updateWaveformProgress(canvas, waveformBars, audio.currentTime / (audio.duration || 1), w, h);
          }
        });

        // Play/pause functionality
        const toggleAudioPlay = () => {
          if (audio.paused) {
            audio.play();
            if (playBtn) {
              playBtn.innerHTML = '<i data-lucide="pause" style="width: 18px; height: 18px;"></i>';
              if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
              }
            }
          } else {
            audio.pause();
            if (playBtn) {
              playBtn.innerHTML = '<i data-lucide="play" style="width: 18px; height: 18px;"></i>';
              if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
              }
            }
          }
        };

        // Play/pause button
        if (playBtn) {
          playBtn.addEventListener('click', toggleAudioPlay);
        }
        
        // Dubbing dropdown functionality
        const dubbingBtn = document.getElementById('dubbingBtn');
        const dubbingDropdown = document.getElementById('dubbingDropdown');
        const dubbingSearch = document.getElementById('dubbingSearch');
        
        if (dubbingBtn && dubbingDropdown) {
          dubbingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dubbingDropdown.style.display === 'block';
            dubbingDropdown.style.display = isVisible ? 'none' : 'block';
            
            // Focus search input when opening
            if (dubbingDropdown.style.display === 'block' && dubbingSearch) {
              setTimeout(() => dubbingSearch.focus(), 50);
            }
          });
          
          // Close dropdown when clicking outside
          document.addEventListener('click', (e) => {
            if (!dubbingBtn.contains(e.target) && !dubbingDropdown.contains(e.target)) {
              dubbingDropdown.style.display = 'none';
              // Clear search on close
              if (dubbingSearch) {
                dubbingSearch.value = '';
                filterLanguages('');
              }
            }
          });
          
          // Search functionality
          if (dubbingSearch) {
            dubbingSearch.addEventListener('input', (e) => {
              const searchTerm = e.target.value.toLowerCase();
              filterLanguages(searchTerm);
            });
            
            // Prevent dropdown from closing when clicking search input
            dubbingSearch.addEventListener('click', (e) => {
              e.stopPropagation();
            });
          }
          
          // Filter languages based on search term
          function filterLanguages(searchTerm) {
            const options = dubbingDropdown.querySelectorAll('.dubbing-option');
            options.forEach(option => {
              const langName = option.textContent.toLowerCase();
              if (langName.includes(searchTerm)) {
                option.style.display = 'flex';
              } else {
                option.style.display = 'none';
              }
            });
          }
          
          // Handle language selection
          const options = dubbingDropdown.querySelectorAll('.dubbing-option');
          options.forEach(option => {
            option.addEventListener('click', (e) => {
              const lang = option.dataset.lang;
              const langName = option.textContent;
              
              // Remove active class from all options
              options.forEach(opt => opt.classList.remove('active'));
              // Add active class to selected option
              option.classList.add('active');
              
              // Close dropdown
              dubbingDropdown.style.display = 'none';
              
              // Clear search
              if (dubbingSearch) {
                dubbingSearch.value = '';
                filterLanguages('');
              }
              
              // Update button text and show submit button
              const dubbingBtnText = document.getElementById('dubbingBtnText');
              const dubbingSubmitBtn = document.getElementById('dubbingSubmitBtn');
              
              if (dubbingBtnText) {
                dubbingBtnText.textContent = langName.toLowerCase();
              }
              
              if (dubbingSubmitBtn) {
                dubbingSubmitBtn.style.display = 'flex';
                dubbingSubmitBtn.dataset.targetLang = lang;
                dubbingSubmitBtn.dataset.langName = langName;
              }
              
              // Show toast notification
              if (window.showToast) {
              }
              
              console.log('Selected language:', lang, langName);
            });
          });
          
          // Custom scrollbar functionality
          const optionsContainer = dubbingDropdown.querySelector('.dubbing-dropdown-options');
          const scrollbar = dubbingDropdown.querySelector('.dubbing-dropdown-scrollbar');
          
          if (optionsContainer && scrollbar) {
            const updateScrollbar = () => {
              const scrollTop = optionsContainer.scrollTop;
              const scrollHeight = optionsContainer.scrollHeight;
              const clientHeight = optionsContainer.clientHeight;
              const maxScroll = scrollHeight - clientHeight;
              
              if (maxScroll > 0) {
                const scrollbarHeight = Math.max(18, (clientHeight / scrollHeight) * clientHeight);
                const scrollbarTop = (scrollTop / maxScroll) * (clientHeight - scrollbarHeight);
                
                scrollbar.style.height = `${scrollbarHeight}px`;
                scrollbar.style.top = `${36 + scrollbarTop}px`;
                scrollbar.style.display = 'block';
              } else {
                scrollbar.style.display = 'none';
              }
            };
            
            optionsContainer.addEventListener('scroll', updateScrollbar);
            updateScrollbar(); // Initial update
          }
          
          // Handle submit button click
          const dubbingSubmitBtn = document.getElementById('dubbingSubmitBtn');
          if (dubbingSubmitBtn) {
            dubbingSubmitBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              
              const targetLang = dubbingSubmitBtn.dataset.targetLang;
              const langName = dubbingSubmitBtn.dataset.langName;
              
              if (!targetLang) {
                if (window.showToast) {
                  window.showToast('please select a target language first', 'error');
                }
                return;
              }
              
              // Get ElevenLabs API key from settings
              const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
              const elevenLabsApiKey = settings.elevenLabsApiKey || 'sk_b37b42ebd75320c2e45e5f1b9312fda02b7264e2f1edc81b'; // Testing key
              
              if (!elevenLabsApiKey) {
                if (window.showToast) {
                  window.showToast('elevenlabs api key required', 'error');
                }
                return;
              }
              
             // Show loading state
             dubbingSubmitBtn.disabled = true;
             dubbingSubmitBtn.innerHTML = window.loaderHTML({ size: 'sm', color: 'white' });
              
              // Show loading state in audio preview
              const audioPreview = document.getElementById('audioPreview');
              if (audioPreview) {
                audioPreview.classList.add('loading-audio');
               const loadingOverlay = document.createElement('div');
               loadingOverlay.className = 'audio-loading-overlay';
               loadingOverlay.innerHTML = `
                 <div class="audio-loading-spinner">
                   ${window.loaderHTML({ size: 'sm', color: 'white' })}
                 </div>
                 <div class="audio-loading-text">dubbing to ${langName.toLowerCase()}...</div>
               `;
                audioPreview.appendChild(loadingOverlay);
              }
              
              if (window.showToast) {
                window.showToast(`dubbing to ${langName.toLowerCase()}...`, 'info');
              }
              
              try {
                await window.ensureAuthToken();
                
                const body = {
                  audioPath: selectedAudio,
                  audioUrl: selectedAudioUrl,
                  targetLang: targetLang,
                  apiKey: elevenLabsApiKey
                };
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
                
                const response = await fetch('http://127.0.0.1:3000/dubbing', {
                  method: 'POST',
                  headers: window.authHeaders({'Content-Type': 'application/json'}),
                  body: JSON.stringify(body),
                  signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                const result = await response.json().catch(() => null);
                
                if (!response.ok || !result || !result.ok) {
                  throw new Error(result?.error || 'Dubbing failed');
                }
                
                // Update the audio source to the dubbed version
                if (result.audioPath) {
                  window.selectedAudio = result.audioPath;
                  window.selectedAudioIsTemp = true;
                  window.selectedAudioUrl = '';
                  window.selectedAudioIsUrl = false;
                  window.selectedAudioUrl = '';
                  
                  // Upload dubbed audio to R2 for lipsync
                  try {
                    const uploadBody = { path: window.selectedAudio, apiKey: settings.apiKey || '' };
                    const uploadResponse = await fetch('http://127.0.0.1:3000/upload', {
                      method: 'POST',
                      headers: window.authHeaders({'Content-Type': 'application/json'}),
                      body: JSON.stringify(uploadBody)
                    });
                    
                    const uploadResult = await uploadResponse.json().catch(() => null);
                    
                    if (uploadResponse.ok && uploadResult && uploadResult.ok && uploadResult.url) {
                      uploadedAudioUrl = uploadResult.url;
                      window.uploadedAudioUrl = uploadResult.url;
                      console.log('[Dubbing] Uploaded dubbed audio to R2:', uploadResult.url);
                    }
                  } catch (uploadError) {
                    console.warn('Upload of dubbed audio failed:', uploadError);
                  }
                  
                  // Re-render the audio preview with the new dubbed audio
                  renderInputPreview();
                  
                  if (window.showToast) {
                    window.showToast(`dubbing to ${langName.toLowerCase()} completed`);
                  }
                }
                
              } catch (error) {
                console.error('Dubbing error:', error);
                if (window.showToast) {
                  window.showToast(`dubbing failed: ${error.message}`, 'error');
                }
              } finally {
                // Remove loading state from audio preview
                const audioPreview = document.getElementById('audioPreview');
                if (audioPreview) {
                  audioPreview.classList.remove('loading-audio');
                  const loadingOverlay = audioPreview.querySelector('.audio-loading-overlay');
                  if (loadingOverlay) {
                    loadingOverlay.remove();
                  }
                }
                
               // Reset submit button
               dubbingSubmitBtn.disabled = false;
               dubbingSubmitBtn.innerHTML = '<i data-lucide="arrow-right" style="width: 18px; height: 18px;"></i>';
                
                // Re-initialize Lucide icons
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                  lucide.createIcons();
                }
              }
            });
          }
        }

        // Click to seek on waveform
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const pos = (e.clientX - rect.left) / rect.width;
          audio.currentTime = pos * audio.duration;
        });
      }

      function generateProgressiveWaveform(audio, canvas) { return []; }

      function buildBarsFromBuffer(buffer, canvas, displayWidth, displayHeight){
        const channels = Math.min(2, buffer.numberOfChannels || 1);
        let left, right;
        try { left = buffer.getChannelData(0); } catch(_){ left = new Float32Array(0); }
        try { right = channels > 1 ? buffer.getChannelData(1) : null; } catch(_){ right = null; }
        if (!left || left.length === 0) { return []; }
        const barSpacing = 2; // 1px bar with 1px gap
        const barCount = Math.max(1, Math.floor(displayWidth / barSpacing));
        const samplesPerBar = Math.max(1, Math.floor(buffer.length / barCount));
        const sampleStride = Math.max(1, Math.floor(samplesPerBar / 64));
        const centerY = displayHeight / 2;
        // First pass: RMS energy per bar
        const energies = new Array(barCount).fill(0);
        let globalMax = 0;
        for (let i=0;i<barCount;i++){
          const start = i * samplesPerBar;
          const end = Math.min(buffer.length, start + samplesPerBar);
          let sumSquares = 0;
          let n = 0;
          for (let s = start; s < end; s += sampleStride){
            const l = left[s] || 0;
            const r = right ? (right[s] || 0) : 0;
            const mono = right ? ((l + r) * 0.5) : l;
            sumSquares += mono * mono;
            n++;
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, n));
          energies[i] = rms;
          if (rms > globalMax) globalMax = rms;
        }
        // Avoid division by tiny values
        const norm = globalMax > 1e-6 ? (1 / globalMax) : 1;
        const bars = [];
        for (let i=0;i<barCount;i++){
          const normalized = Math.min(1, Math.max(0, energies[i] * norm));
          const barHeight = Math.max(2, normalized * (displayHeight * 0.92));
          bars.push({ x: i * barSpacing, height: barHeight, centerY });
        }
        return bars;
      }

      function buildPlaceholderBars(displayWidth, displayHeight){
        const barSpacing = 2;
        const barCount = Math.max(1, Math.floor(displayWidth / barSpacing));
        const centerY = displayHeight / 2;
        const bars = [];
        // Smooth random peaks to mimic a waveform
        let current = 0.2;
        for (let i=0;i<barCount;i++){
          const target = 0.1 + Math.random() * 0.9;
          current = current * 0.85 + target * 0.15;
          const peak = Math.min(1, Math.max(0.05, current * (0.6 + 0.4*Math.sin(i*0.05))));
          const barHeight = Math.max(2, peak * (displayHeight * 0.9));
          bars.push({ x: i * barSpacing, height: barHeight, centerY });
        }
        return bars;
      }

      function renderWaveform(canvas, bars, progress, displayWidthOverride, displayHeightOverride) {
        const ctx = canvas.getContext('2d');
        const displayWidth = displayWidthOverride || canvas.clientWidth || canvas.offsetWidth || 600;
        const displayHeight = displayHeightOverride || canvas.clientHeight || canvas.offsetHeight || 40;
        
        // Clear canvas
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        
        const progressX = progress * displayWidth;
        
        bars.forEach(bar => {
          // Color based on progress: orange for played, grey for unplayed
          ctx.fillStyle = bar.x <= progressX ? '#ff7700' : '#a1a1aa';
          
          // Draw rounded rect for each bar
          const barWidth = 1;
          const barHeight = bar.height;
          const x = bar.x;
          const y = bar.centerY - barHeight/2;
          const radius = 2;
          
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, radius);
          ctx.fill();
        });
      }

      function updateWaveformProgress(canvas, bars, progress, w, h) {
        renderWaveform(canvas, bars, progress, w, h);
      }

      function clearVideoSelection() {
        try { const v = document.getElementById('mainVideo'); if (v) { v.pause(); v.currentTime = 0; v.removeAttribute('src'); v.load(); } } catch(_){ }
        console.log('[Video Selection] Clearing video selection');
        window.selectedVideo = null;
        window.selectedVideoIsTemp = false;
        window.selectedVideoUrl = '';
        window.selectedVideoIsUrl = false;
        window.selectedVideoUrl = ''; // Clear global variable
        renderInputPreview();
        updateInputStatus();
        updateFromVideoButton();
      }

      function clearAudioSelection() {
        try { const a = document.getElementById('audioPlayer'); if (a) { try { if (typeof a.__waveformCleanup === 'function') a.__waveformCleanup(); } catch(_){} a.pause(); a.currentTime = 0; a.removeAttribute('src'); a.load(); } } catch(_){ }
        window.selectedAudio = null;
        window.selectedAudioIsTemp = false;
        window.selectedAudioUrl = '';
        window.selectedAudioIsUrl = false;
        window.selectedAudioUrl = ''; // Clear global variable
        renderInputPreview();
        updateInputStatus();
      }

      function showUrlInputModal(type) {
        const overlay = document.getElementById('urlInputOverlay');
        const input = document.getElementById('urlInput');
        const submitBtn = document.getElementById('urlInputSubmit');
        
        if (!overlay || !input || !submitBtn) return;
        
        // Set placeholder based on type
        if (type === 'video') {
          input.placeholder = 'paste video url here...';
        } else {
          input.placeholder = 'paste audio url here...';
        }
        
        // Clear input
        input.value = '';
        
        // Show modal
        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('show'), 10);
        
        // Focus input
        setTimeout(() => input.focus(), 100);
        
        // Set up event handlers
        const handleSubmit = async () => {
          const url = input.value.trim();
          if (!url) return;
          
          if (typeof window.showToast === 'function') {
            window.showToast('loading...', 'info');
          }
          
          // Validate URL
          const isValid = type === 'video' ? isValidVideoUrl(url) : isValidAudioUrl(url);
          if (!isValid) {
            if (typeof window.showToast === 'function') {
              window.showToast(`invalid ${type} url format`, 'error');
            }
            return;
          }
          
          // Check file size
          const sizeCheck = await checkUrlSize(url);
          if (!sizeCheck.valid) {
            if (typeof window.showToast === 'function') {
              window.showToast(`${type} exceeds 1gb (not allowed)`, 'error');
            }
            return;
          }
          
          // Set URL selection
          if (type === 'video') {
            selectedVideoUrl = url;
            selectedVideoIsUrl = true;
            selectedVideo = null; // Clear file selection
            window.selectedVideoIsTemp = false;
            updateFromVideoButton();
          } else {
            selectedAudioUrl = url;
            selectedAudioIsUrl = true;
            selectedAudio = null; // Clear file selection
            window.selectedAudioIsTemp = false;
          }
          
          updateLipsyncButton();
          renderInputPreview();
          
          if (typeof window.showToast === 'function') {
            window.showToast(`${type} url loaded successfully`);
          }
          
          scheduleEstimate();
          
          // Close modal
          closeUrlInputModal();
        };
        
        const handleKeyPress = (e) => {
          if (e.key === 'Enter') {
            handleSubmit();
          } else if (e.key === 'Escape') {
            closeUrlInputModal();
          }
        };
        
        const closeUrlInputModal = () => {
          overlay.classList.remove('show');
          setTimeout(() => overlay.style.display = 'none', 300);
          
          // Remove event listeners
          submitBtn.removeEventListener('click', handleSubmit);
          input.removeEventListener('keydown', handleKeyPress);
          document.getElementById('urlInputClose').removeEventListener('click', closeUrlInputModal);
          overlay.removeEventListener('click', handleOverlayClick);
        };
        
        const handleOverlayClick = (e) => {
          if (e.target === overlay) {
            closeUrlInputModal();
          }
        };
        
        // Add event listeners
        submitBtn.addEventListener('click', handleSubmit);
        input.addEventListener('keydown', handleKeyPress);
        document.getElementById('urlInputClose').addEventListener('click', closeUrlInputModal);
        overlay.addEventListener('click', handleOverlayClick);
      }

      async function selectVideoUrl() {
        const urlInput = document.getElementById('videoUrlInput');
        const urlField = document.getElementById('videoUrlField');
        if (urlInput && urlField) {
          urlInput.style.display = 'flex';
          setTimeout(() => urlField.focus(), 100);
          
          // Add Enter key handler
          const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
              submitVideoUrl();
            } else if (e.key === 'Escape') {
              cancelVideoUrl();
            }
          };
          urlField.addEventListener('keydown', handleKeyPress);
          
          // Store handler for cleanup
          urlField._keyHandler = handleKeyPress;
        }
      }

      async function selectAudioUrl() {
        const urlInput = document.getElementById('audioUrlInput');
        const urlField = document.getElementById('audioUrlField');
        if (urlInput && urlField) {
          urlInput.style.display = 'flex';
          setTimeout(() => urlField.focus(), 100);
          
          // Add Enter key handler
          const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
              submitAudioUrl();
            } else if (e.key === 'Escape') {
              cancelAudioUrl();
            }
          };
          urlField.addEventListener('keydown', handleKeyPress);
          
          // Store handler for cleanup
          urlField._keyHandler = handleKeyPress;
        }
      }

      async function submitVideoUrl() {
        const urlField = document.getElementById('videoUrlField');
        const urlInput = document.getElementById('videoUrlInput');
        if (!urlField || !urlInput) return;
        
        const url = urlField.value.trim();
        if (!url) return;
        
        if (typeof window.showToast === 'function') {
          window.showToast('loading...', 'info');
        }
        
        // Validate URL
        if (!isValidVideoUrl(url)) {
          if (typeof window.showToast === 'function') {
            window.showToast('invalid video url format', 'error');
          }
          return;
        }
        
        // Check file size
        const sizeCheck = await checkUrlSize(url);
        if (!sizeCheck.valid) {
          if (typeof window.showToast === 'function') {
            window.showToast('video exceeds 1gb (not allowed)', 'error');
          }
          return;
        }
        
        // Set URL selection
            window.selectedVideoUrl = url;
            window.selectedVideoIsUrl = true;
            window.selectedVideo = null; // Clear file selection
            window.selectedVideoIsTemp = false;
        window.selectedVideoUrl = url; // Update global variable
        console.log('[Video Selection] URL selected:', window.selectedVideoUrl);
        updateFromVideoButton();
        
        updateLipsyncButton();
        renderInputPreview();
        
        if (typeof window.showToast === 'function') {
          window.showToast('video url loaded successfully');
        }
        
        scheduleEstimate();
        
        // Hide URL input
        urlInput.style.display = 'none';
        urlField.value = '';
        
        // Remove event listener
        if (urlField._keyHandler) {
          urlField.removeEventListener('keydown', urlField._keyHandler);
          urlField._keyHandler = null;
        }
      }

      async function submitAudioUrl() {
        const urlField = document.getElementById('audioUrlField');
        const urlInput = document.getElementById('audioUrlInput');
        if (!urlField || !urlInput) return;
        
        const url = urlField.value.trim();
        if (!url) return;
        
        if (typeof window.showToast === 'function') {
          window.showToast('loading...', 'info');
        }
        
        // Validate URL
        if (!isValidAudioUrl(url)) {
          if (typeof window.showToast === 'function') {
            window.showToast('invalid audio url format', 'error');
          }
          return;
        }
        
        // Check file size
        const sizeCheck = await checkUrlSize(url);
        if (!sizeCheck.valid) {
          if (typeof window.showToast === 'function') {
            window.showToast('audio exceeds 1gb (not allowed)', 'error');
          }
          return;
        }
        
        // Set URL selection
            window.selectedAudioUrl = url;
            window.selectedAudioIsUrl = true;
            window.selectedAudio = null; // Clear file selection
            window.selectedAudioIsTemp = false;
        window.selectedAudioUrl = url; // Update global variable
        
        updateLipsyncButton();
        renderInputPreview();
        
        if (typeof window.showToast === 'function') {
          window.showToast('audio url loaded successfully');
        }
        
        scheduleEstimate();
        
        // Hide URL input
        urlInput.style.display = 'none';
        urlField.value = '';
        
        // Remove event listener
        if (urlField._keyHandler) {
          urlField.removeEventListener('keydown', urlField._keyHandler);
          urlField._keyHandler = null;
        }
      }

      function clearVideoUrl() {
        const urlField = document.getElementById('videoUrlField');
        if (urlField) {
          urlField.value = '';
        }
      }

      function clearAudioUrl() {
        const urlField = document.getElementById('audioUrlField');
        if (urlField) {
          urlField.value = '';
        }
      }

      function cancelVideoUrl() {
        const urlInput = document.getElementById('videoUrlInput');
        const urlField = document.getElementById('videoUrlField');
        if (urlInput && urlField) {
          urlInput.style.display = 'none';
          urlField.value = '';
          
          // Remove event listener
          if (urlField._keyHandler) {
            urlField.removeEventListener('keydown', urlField._keyHandler);
            urlField._keyHandler = null;
          }
        }
      }

      function cancelAudioUrl() {
        const urlInput = document.getElementById('audioUrlInput');
        const urlField = document.getElementById('audioUrlField');
        if (urlInput && urlField) {
          urlInput.style.display = 'none';
          urlField.value = '';
          
          // Remove event listener
          if (urlField._keyHandler) {
            urlField.removeEventListener('keydown', urlField._keyHandler);
            urlField._keyHandler = null;
          }
        }
      }

      async function selectAudioFromVideo() {
        // Log to debug file for CEP debugging
        try {
          const debugMsg = `[${new Date().toISOString()}] selectAudioFromVideo called - selectedVideo: ${selectedVideo || 'null'}, selectedVideoUrl: ${selectedVideoUrl || 'null'}\n`;
          const fs = require('fs');
          const path = require('path');
          const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
          fs.appendFileSync(debugFile, debugMsg);
        } catch(e) {}
        
        try {
          // Check if video is selected
          if (!selectedVideo && !selectedVideoUrl) {
            console.log('No video selected');
            if (typeof window.showToast === 'function') {
              window.showToast('please select a video first', 'error');
            }
            return;
          }
          
          console.log('Video selected:', selectedVideo || selectedVideoUrl);

          if (typeof window.showToast === 'function') {
            window.showToast('loading...', 'info');
          }

          // Get audio format from settings
          const renderAudioEl = document.getElementById('renderAudio');
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          
          // Debug logging for DOM elements
          try {
            const debugMsg = `[${new Date().toISOString()}] DOM elements check - renderAudio: ${renderAudioEl ? 'found' : 'null'}, settings.apiKey: ${settings.apiKey ? 'found' : 'null'}\n`;
            const fs = require('fs');
            const path = require('path');
            const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
            fs.appendFileSync(debugFile, debugMsg);
          } catch(e) {}
          
          const audioFormat = renderAudioEl ? renderAudioEl.value : 'wav';
          
          // Prepare request body
          const body = {
            videoPath: selectedVideo || '',
            videoUrl: selectedVideoUrl || '',
            format: audioFormat,
            apiKey: settings.apiKey || ''
          };

          // Debug logging
          console.log('Audio extraction request:', body);

          try {
            console.log('ensureAuthToken function exists:', typeof ensureAuthToken);
            console.log('window.ensureAuthToken function exists:', typeof window.ensureAuthToken);
            await window.ensureAuthToken();
            console.log('Auth token ensured');
          } catch (error) {
            console.error('Auth token error:', error);
            if (typeof window.showToast === 'function') {
              window.showToast('auth error: ' + error.message, 'error');
            }
            return;
          }
          
          // Call audio extraction endpoint
          console.log('Making request to extract-audio endpoint...');
          let response;
          try {
            response = await fetch('http://127.0.0.1:3000/extract-audio', {
              method: 'POST',
              headers: window.window.authHeaders({'Content-Type': 'application/json'}),
              body: JSON.stringify(body)
            });
            console.log('Response received:', response.status, response.statusText);
          } catch (error) {
            console.error('Fetch error:', error);
            if (typeof window.showToast === 'function') {
              window.showToast('network error: ' + error.message, 'error');
            }
            return;
          }

          const result = await response.json().catch(() => null);

          // Debug logging
          console.log('Audio extraction response:', { 
            status: response.status, 
            ok: response.ok, 
            result: result 
          });

          if (!response.ok || !result || !result.ok) {
            console.error('Audio extraction failed:', { 
              status: response.status, 
              result: result 
            });
            if (typeof window.showToast === 'function') {
              window.showToast('audio extraction failed', 'error');
            }
            return;
          }

          if (!result.path) {
            if (typeof window.showToast === 'function') {
              window.showToast('no audio path returned', 'error');
            }
            return;
          }

          // Set the extracted audio
          window.selectedAudio = result.path;
          window.selectedAudioIsTemp = true;
          window.selectedAudioUrl = ''; // Clear URL selection
          window.selectedAudioIsUrl = false;
          window.selectedAudioUrl = ''; // Clear global variable

          updateLipsyncButton();
          renderInputPreview();
          updateInputStatus();

          if (typeof window.showToast === 'function') {
            window.showToast('audio extracted successfully');
          }

          // Upload for cost estimation
          try {
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            const uploadBody = { path: selectedAudio, apiKey: settings.apiKey || '' };
            
            const uploadResponse = await fetch('http://127.0.0.1:3000/upload', {
              method: 'POST',
              headers: window.authHeaders({'Content-Type': 'application/json'}),
              body: JSON.stringify(uploadBody)
            });
            
            const uploadResult = await uploadResponse.json().catch(() => null);
            
            if (uploadResponse.ok && uploadResult && uploadResult.ok && uploadResult.url) {
              uploadedAudioUrl = uploadResult.url;
              window.uploadedAudioUrl = uploadResult.url;
            }
          } catch (uploadError) {
            console.warn('Upload for cost estimation failed:', uploadError);
          }

          scheduleEstimate();

        } catch (error) {
          // Log error to debug file for CEP debugging
          try {
            const errorMsg = `[${new Date().toISOString()}] Audio extraction error: ${error.message}\n`;
            const fs = require('fs');
            const path = require('path');
            const debugFile = path.join(process.env.HOME || '', 'Library/Application Support/sync. extensions/logs/sync_ppro_debug.log');
            fs.appendFileSync(debugFile, errorMsg);
          } catch(e) {}
          
          if (typeof window.showToast === 'function') {
            window.showToast('audio extraction failed', 'error');
          }
          console.error('Audio extraction error:', error);
        }
      }

      function renderOutputVideo(job) {
        if (!job || !job.outputPath) return;
        
        const videoSection = document.getElementById('videoSection');
        const videoDropzone = document.getElementById('videoDropzone');
        const videoPreview = document.getElementById('videoPreview');
        
        if (videoSection && videoPreview) {
          // Ensure video preview is visible for output display
          videoDropzone.style.display = 'none';
          videoPreview.style.display = 'block';
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
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
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

        // Reset to play icon when video ends
        video.addEventListener('ended', () => {
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

        // REMOVED DUPLICATE: if (centerPlayBtn) centerPlayBtn.addEventListener('click', togglePlay);

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

      // Function to load audio from file path (for TTS integration)
      async function loadAudioFile(audioPath, isTemp = false) {
        try {
          window.selectedAudio = audioPath;
          window.selectedAudioIsTemp = isTemp;
          window.selectedAudioUrl = '';
          window.selectedAudioIsUrl = false;
          window.selectedAudioUrl = '';
          
          // Upload to cloud if API key is available
          const settings = window.getSettings?.() || {};
          if (settings.apiKey) {
            try {
              const uploadBody = { path: selectedAudio, apiKey: settings.apiKey };
              const uploadResp = await fetch('http://127.0.0.1:3000/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(uploadBody)
              });
              if (uploadResp.ok) {
                const uploadData = await uploadResp.json();
                window.selectedAudioUrl = uploadData.url;
                window.selectedAudioIsUrl = true;
                window.selectedAudioUrl = uploadData.url;
              }
            } catch (err) {
              console.warn('Cloud upload failed, using local file:', err);
            }
          }
          
          updateUIState();
          
          if (window.showToast) {
            window.showToast('audio generated successfully', 'success');
          }
          
          return true;
        } catch (error) {
          console.error('Error loading audio file:', error);
          if (window.showToast) {
            window.showToast('failed to load audio: ' + error.message, 'error');
          }
          return false;
        }
      }

      // Expose functions globally for event handlers
      window.selectAudioFromVideo = selectAudioFromVideo;
      window.selectVideoUrl = selectVideoUrl;
      window.selectAudioUrl = selectAudioUrl;
      window.showUrlInputModal = showUrlInputModal;
      window.updateFromVideoButton = updateFromVideoButton;
      window.updateLipsyncButton = updateLipsyncButton;
      window.updateInputStatus = updateInputStatus;
      window.loadAudioFile = loadAudioFile;

