      function updateLipsyncButton() {
        const btn = document.getElementById('lipsyncBtn');
        if (selectedVideo && selectedAudio) {
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

        // Click on video toggles play/pause
        video.addEventListener('click', () => {
          if (video.paused) { video.play(); }
          else { video.pause(); }
          if (playBtn) {
            if (video.paused) playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            else playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          }
        });
        
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
              const duration = formatTime(video.duration);
              timeDisplay.textContent = `${current} / ${duration}`;
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
              const duration = formatTime(audio.duration);
              timeDisplay.textContent = `${current} / ${duration}`;
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
            // Prefer explicit selection path, else derive from audio.src
            let localPath = normalizePath(selectedAudio||'');
            if (!localPath){
              try { const u = normalizePath(audio.getAttribute('src')||''); localPath = u; } catch(_){ }
            }
            if (!localPath) { renderWaveform(canvas, [], 0, displayWidth, displayHeight); return; }
            await ensureAuthToken();
            const resp = await fetch('http://127.0.0.1:3000/waveform/file?'+new URLSearchParams({ path: localPath }), { headers: authHeaders(), cache:'no-store' });
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

      function renderInputPreview() {
        const videoSection = document.getElementById('videoSection');
        const videoDropzone = document.getElementById('videoDropzone');
        const videoPreview = document.getElementById('videoPreview');
        
        const audioSection = document.getElementById('audioSection');
        const audioDropzone = document.getElementById('audioDropzone');
        const audioPreview = document.getElementById('audioPreview');
        
        // Video
        if (selectedVideo) {
          videoDropzone.style.display = 'none';
          videoPreview.style.display = 'block';
          videoPreview.innerHTML = `
            <div class="custom-video-player">
              <video id="mainVideo" class="video-element" src="file://${selectedVideo.replace(/ /g, '%20')}">
                <source src="file://${selectedVideo.replace(/ /g, '%20')}" type="video/mp4">
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
          initCustomVideoPlayer();
        } else {
          videoDropzone.style.display = 'flex';
          videoPreview.style.display = 'none';
        }
        
        // Audio
        if (selectedAudio) {
          audioDropzone.style.display = 'none';
          audioPreview.style.display = 'block';
          audioPreview.innerHTML = `
            <div class="custom-audio-player">
              <audio id="audioPlayer" src="file://${selectedAudio.replace(/ /g, '%20')}" preload="auto"></audio>
              <div class="audio-waveform-container">
                <canvas id="waveformCanvas" class="waveform-canvas"></canvas>
                <div class="audio-controls-bottom">
                  <button class="audio-play-btn" id="audioPlayBtn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21"/>
                    </svg>
                  </button>
                  <div class="audio-time" id="audioTime">00:00 / 00:00</div>
                  <button class="audio-delete-btn" onclick="clearAudioSelection()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3,6 5,6 21,6"></polyline>
                      <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>`;
          initCustomAudioPlayer();
        } else {
          audioDropzone.style.display = 'flex';
          audioPreview.style.display = 'none';
        }
        
        updateLipsyncButton();
        updateInputStatus();
      }

      async function selectVideo() {
        try {
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'opening video picker…'; } catch(_){ }
          const raw = await openFileDialog('video');
          if (raw && raw.indexOf('/') !== -1) {
            selectedVideoIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {mov:1,mp4:1,mxf:1,mkv:1,avi:1,m4v:1,mpg:1,mpeg:1}[ext] === 1;
            if (!ok) { try { statusEl.textContent = 'please select a video file'; } catch(_){ } return; }
            const size = await new Promise(resolve=>{ const safe = String(raw).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';})()`; cs.evalScript(es, function(r){ var n=Number(r||0); resolve(isNaN(n)?0:n); }); });
            if (size > 1024*1024*1024) { try { statusEl.textContent = 'video exceeds 1GB (not allowed)'; } catch(_){ } return; }
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
          } else {
            try { statusEl.textContent = 'no video selected'; } catch(_){ }
          }
        } catch (_) { }
      }

      async function selectAudio() {
        try {
          if (typeof __pickerBusy !== 'undefined' && __pickerBusy) { return; }
          var statusEl = document.getElementById('statusMessage');
          try { statusEl.textContent = 'opening audio picker…'; } catch(_){ }
          const raw = await openFileDialog('audio');
          if (raw && raw.indexOf('/') !== -1) {
            selectedAudioIsTemp = false;
            const ext = raw.split('.').pop().toLowerCase();
            const ok = {wav:1,mp3:1,aac:1,aif:1,aiff:1,m4a:1}[ext] === 1;
            if (!ok) { try { statusEl.textContent = 'please select an audio file'; } catch(_){ } return; }
            const size = await new Promise(resolve=>{ const safe = String(raw).replace(/\\/g,'\\\\').replace(/\"/g,'\\\"'); const es = `(function(){try{var f=new File("${safe}");if(f&&f.exists){return String(f.length||0);}return '0';}catch(e){return '0';})()`; cs.evalScript(es, function(r){ var n=Number(r||0); resolve(isNaN(n)?0:n); }); });
            if (size > 1024*1024*1024) { try { statusEl.textContent = 'audio exceeds 1GB (not allowed)'; } catch(_){ } return; }
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
          } else {
            try { updateInputStatus(); } catch(_){ }
          }
        } catch (_) { }
      }

      async function selectVideoInOut(){
        try{
          const statusEl = document.getElementById('statusMessage');
          if (statusEl) statusEl.textContent = 'rendering video in/out…';
          const codec = document.getElementById('renderVideo').value || 'h264';
          const res = await evalExtendScript('PPRO_exportInOutVideo', { codec });
          if (res && res.ok && res.path){
            selectedVideo = res.path; selectedVideoIsTemp = true;
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            let diag = null;
            try { diag = await evalExtendScript('PPRO_diagInOut', {}); } catch(_){ }
            let extra = '';
            if (diag && typeof diag === 'object') {
              extra = ' [diag: ' +
                'active=' + String(diag.hasActiveSequence) +
                ', direct=' + String(diag.hasExportAsMediaDirect) +
                (diag.inTicks!=null?(', in='+diag.inTicks):'') +
                (diag.outTicks!=null?(', out='+diag.outTicks):'') +
                (diag.eprRoot?(', eprRoot='+diag.eprRoot):'') +
                (diag.eprCount!=null?(', eprs='+diag.eprCount):'') +
              ']';
            }
            if (statusEl) statusEl.textContent = 'video in/out export failed: ' + (res && res.error ? res.error : 'EvalScript error') + (res && res.eprRoot ? (' root=' + res.eprRoot) : '') + (res && res.preset ? (' preset=' + res.preset) : '') + extra;
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){} }
      }

      async function selectAudioInOut(){
        try{
          const statusEl = document.getElementById('statusMessage');
          if (statusEl) statusEl.textContent = 'rendering audio in/out…';
          const format = document.getElementById('renderAudio').value || 'wav';
          const res = await evalExtendScript('PPRO_exportInOutAudio', { format });
          if (res && res.ok && res.path){
            selectedAudio = res.path; selectedAudioIsTemp = true;
            updateLipsyncButton(); renderInputPreview(); if (statusEl) statusEl.textContent = '';
            updateInputStatus();
            try { document.getElementById('clearBtn').style.display = 'inline-block'; } catch(_){ }
            scheduleEstimate();
          } else {
            let diag = null;
            try { diag = await evalExtendScript('PPRO_diagInOut', {}); } catch(_){ }
            let extra = '';
            if (diag && typeof diag === 'object') {
              extra = ' [diag: ' +
                'active=' + String(diag.hasActiveSequence) +
                ', direct=' + String(diag.hasExportAsMediaDirect) +
                (diag.inTicks!=null?(', in='+diag.inTicks):'') +
                (diag.outTicks!=null?(', out='+diag.outTicks):'') +
                (diag.eprRoot?(', eprRoot='+diag.eprRoot):'') +
                (diag.eprCount!=null?(', eprs='+diag.eprCount):'') +
              ']';
            }
            if (statusEl) statusEl.textContent = 'audio in/out export failed: ' + (res && res.error ? res.error : 'EvalScript error') + extra;
          }
        }catch(e){ try{ updateInputStatus(); }catch(_){} }
      }

      function updateInputStatus() {
        const status = document.getElementById('statusMessage');
        if (!status) return;
        
        if (!selectedVideo && !selectedAudio) {
          status.textContent = 'no video/audio selected';
        } else if (!selectedVideo) {
          status.textContent = 'no video selected';
        } else if (!selectedAudio) {
          status.textContent = 'no audio selected';
        } else {
          status.textContent = 'ready to lipsync';
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
            const currentFrame = Math.floor(video.currentTime * 30); // Assume 30fps
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
        // Click anywhere on video toggles play/pause
        video.addEventListener('click', togglePlay);

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
            // Draw a quick placeholder immediately to avoid a blank state
            if (!waveformBars || waveformBars.length === 0) {
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
            }
            function normalizePath(p){
              try {
                if (!p) return '';
                p = String(p).replace(/^file:\/\//,'');
                try { p = decodeURI(p); } catch(_){ p = p.replace(/%20/g,' '); }
                if (p && p[0] !== '/' && p.indexOf('Volumes/') === 0) p = '/' + p;
                return p;
              } catch(_) { return String(p||''); }
            }
            let localPath = normalizePath(selectedAudio||'');
            if (!localPath){
              try { const u = normalizePath(audio.getAttribute('src')||''); localPath = u; } catch(_){ }
            }
            try { uiLog('waveform path '+localPath); } catch(_){ }
            if (!localPath) { renderWaveform(canvas, [], 0, displayWidth, displayHeight); return; }
            // This endpoint is now public to avoid blank waveform when token fails
            await ensureAuthToken();
            const resp = await fetch('http://127.0.0.1:3000/waveform/file?'+new URLSearchParams({ path: localPath }), { cache:'no-store' }).catch((e)=>{ try{ uiLog('waveform fetch exception '+String(e)); }catch(_){} return null; });
            if (!resp || !resp.ok) {
              // Fallback: draw placeholder waveform so UI isn't blank
              try { uiLog('waveform fetch failed'); } catch(_){ }
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
              return;
            }
            const ab = await resp.arrayBuffer();
            try { uiLog('waveform bytes '+(ab && ab.byteLength)); } catch(_){ }
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
              try { uiLog('waveform decode failed'); } catch(_){ }
              waveformBars = buildPlaceholderBars(displayWidth, displayHeight);
              renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
              try { ac.close(); } catch(_){ }
              return;
            }
            try { uiLog('waveform decoded sr='+buf.sampleRate+' len='+buf.length); } catch(_){ }
            waveformBars = buildBarsFromBuffer(buf, canvas, displayWidth, displayHeight);
            renderWaveform(canvas, waveformBars, 0, displayWidth, displayHeight);
            try { ac.close(); } catch(_){ }
          }catch(_){
            const w = canvas.clientWidth||600; const h = canvas.clientHeight||80;
            waveformBars = buildPlaceholderBars(w, h);
            renderWaveform(canvas, waveformBars, 0, w, h);
          }
        })();

        // Initialize time display when metadata loads
        audio.addEventListener('loadedmetadata', () => {
          const duration = formatTime(audio.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `00:00 / ${duration}`;
        });

        // Update time and progress highlight
        audio.addEventListener('timeupdate', () => {
          const current = formatTime(audio.currentTime);
          const duration = formatTime(audio.duration || 0);
          if (timeDisplay) timeDisplay.textContent = `${current} / ${duration}`;
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
            if (playBtn) playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          } else {
            audio.pause();
            if (playBtn) playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
          }
        };

        // Play/pause button
        if (playBtn) {
          playBtn.addEventListener('click', toggleAudioPlay);
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
        const displayHeight = displayHeightOverride || canvas.clientHeight || canvas.offsetHeight || 80;
        
        // Clear canvas
        ctx.fillStyle = getComputedStyle(canvas).backgroundColor || '#1a1a1a';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        
        const progressX = progress * displayWidth;
        
        bars.forEach(bar => {
          // Color based on progress: white for played, grey for unplayed
          ctx.fillStyle = bar.x <= progressX ? '#ffffff' : '#7a7a7a';
          ctx.fillRect(bar.x, bar.centerY - bar.height/2, 1, bar.height);
        });
        
        // Add subtle center line
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, displayHeight / 2);
        ctx.lineTo(displayWidth, displayHeight / 2);
        ctx.stroke();
      }

      function updateWaveformProgress(canvas, bars, progress, w, h) {
        renderWaveform(canvas, bars, progress, w, h);
      }

      function clearVideoSelection() {
        try { const v = document.getElementById('mainVideo'); if (v) { v.pause(); v.currentTime = 0; v.removeAttribute('src'); v.load(); } } catch(_){ }
        selectedVideo = null;
        selectedVideoIsTemp = false;
        renderInputPreview();
        updateInputStatus();
      }

      function clearAudioSelection() {
        try { const a = document.getElementById('audioPlayer'); if (a) { try { if (typeof a.__waveformCleanup === 'function') a.__waveformCleanup(); } catch(_){} a.pause(); a.currentTime = 0; a.removeAttribute('src'); a.load(); } } catch(_){ }
        selectedAudio = null;
        selectedAudioIsTemp = false;
        renderInputPreview();
        updateInputStatus();
      }

      function renderOutputVideo(job) {
        if (!job || !job.outputPath) return;
        
        const videoSection = document.getElementById('videoSection');
        const videoPreview = document.getElementById('videoPreview');
        
        if (videoSection && videoPreview) {
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

        if (centerPlayBtn) centerPlayBtn.addEventListener('click', togglePlay);

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


