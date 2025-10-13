      function getServerPort() {
        return window.__syncServerPort || 3000;
      }
      
      // Checkmark management functions
      function showCheckmark(checkmarkId) {
        const checkmark = document.getElementById(checkmarkId);
        if (checkmark) {
          checkmark.classList.add('visible');
          // Hide after 5 seconds
          setTimeout(() => {
            checkmark.classList.remove('visible');
          }, 5000);
        }
      }
      
      function setupCheckmarkEvents(inputId, checkmarkId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        let hasContent = false;
        
        // Track content changes
        input.addEventListener('input', function() {
          hasContent = this.value.trim().length > 0;
        });
        
        // Show checkmark on paste
        input.addEventListener('paste', function() {
          setTimeout(() => {
            if (this.value.trim().length > 0) {
              showCheckmark(checkmarkId);
            }
          }, 10); // Small delay to ensure paste content is processed
        });
        
        // Show checkmark on blur if content exists
        input.addEventListener('blur', function() {
          if (hasContent && this.value.trim().length > 0) {
            showCheckmark(checkmarkId);
          }
        });
      }
      
      function updateModelDisplay() {
        const modelEl = document.getElementById('currentModel');
        if (modelEl) {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          const model = settings.model || 'lipsync-2-pro';
          modelEl.textContent = model;
        }
      }

      // Custom Dropdown for Sync Mode
      (function initCustomDropdown() {
        const trigger = document.getElementById('syncModeBtn');
        const menu = document.getElementById('syncModeMenu');
        const valueDisplay = document.getElementById('syncModeValue');
        const hiddenInput = document.getElementById('syncMode');
        const options = document.querySelectorAll('.custom-dropdown-option');

        if (!trigger || !menu) return;

        // Load saved value
        function loadSyncMode() {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          const syncMode = settings.syncMode || 'loop';
          hiddenInput.value = syncMode;
          
          // Update display text
          const displayText = syncMode === 'cutoff' ? 'cut off' : syncMode;
          valueDisplay.textContent = displayText;
          
          // Mark active option
          options.forEach(opt => {
            if (opt.dataset.value === syncMode) {
              opt.classList.add('active');
            } else {
              opt.classList.remove('active');
            }
          });
        }

        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.classList.toggle('show');
          
          // Reinitialize Lucide icons for newly visible elements
          setTimeout(() => {
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
              lucide.createIcons();
            }
          }, 50);
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
          if (!trigger.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
          }
        });

        // Handle option selection
        options.forEach(option => {
          option.addEventListener('click', () => {
            const value = option.dataset.value;
            hiddenInput.value = value;
            
            // Update display text
            const displayText = value === 'cutoff' ? 'cut off' : value;
            valueDisplay.textContent = displayText;
            
            // Update active state
            options.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            
            // Close menu
            menu.classList.remove('show');
            
            // Save to settings
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            settings.syncMode = value;
            localStorage.setItem('syncSettings', JSON.stringify(settings));
            
            if (typeof saveSettings === 'function') {
              saveSettings();
            }
          });
        });

        loadSyncMode();
      })();

      // Model Selector functionality
      (function initModelSelector() {
        const overlay = document.getElementById('modelSelectorOverlay');
        const openBtn = document.getElementById('modelSelectorBtn');
        const closeBtn = document.getElementById('modelSelectorClose');
        const modelRadios = document.querySelectorAll('input[name="model"]');
        const tempSlider = document.getElementById('modelTemperature');
        const tempValue = document.getElementById('modelTempValue');
        const activeSpeakerCheckbox = document.getElementById('modelActiveSpeaker');
        const detectObstructionsCheckbox = document.getElementById('modelDetectObstructions');

        if (!overlay || !openBtn) return;

        // Function to update checkmark visibility
        function updateModelCheckmarks() {
          const modelOptions = document.querySelectorAll('.model-option');
          modelOptions.forEach(option => {
            const radio = option.querySelector('input[name="model"]');
            const iconDiv = option.querySelector('.model-option-icon');
            
            if (radio && iconDiv) {
              // Clear existing content
              iconDiv.innerHTML = '';
              
              // Add checkmark if this option is selected
              if (radio.checked) {
                const checkIcon = document.createElement('i');
                checkIcon.setAttribute('data-lucide', 'check');
                iconDiv.appendChild(checkIcon);
                
                // Reinitialize Lucide icons
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                  lucide.createIcons();
                }
              }
            }
          });
        }

        // Load current settings into modal
        function loadModalSettings() {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          
          // Set model radio
          const model = settings.model || 'lipsync-2-pro';
          modelRadios.forEach(radio => {
            if (radio.value === model) {
              radio.checked = true;
            }
          });
          
          // Update checkmarks to match selected model
          updateModelCheckmarks();
          
          // Set temperature
          if (tempSlider && tempValue) {
            const temp = settings.temperature !== undefined ? settings.temperature : 0.5;
            tempSlider.value = temp;
            tempValue.textContent = temp;
          }
          
          // Set toggles
          if (activeSpeakerCheckbox) {
            activeSpeakerCheckbox.checked = settings.activeSpeakerOnly || false;
          }
          if (detectObstructionsCheckbox) {
            detectObstructionsCheckbox.checked = settings.detectObstructions || false;
          }
        }

        // Open modal
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadModalSettings();
          overlay.classList.add('show');
          
          // Reinitialize Lucide icons for newly visible elements
          setTimeout(() => {
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
              lucide.createIcons();
            }
          }, 50);
        });

        // Close modal
        function closeModal() {
          overlay.classList.remove('show');
        }

        if (closeBtn) {
          closeBtn.addEventListener('click', closeModal);
        }

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            closeModal();
          }
        });

        // Handle model selection
        modelRadios.forEach(radio => {
          radio.addEventListener('change', () => {
            if (radio.checked) {
              const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
              settings.model = radio.value;
              localStorage.setItem('syncSettings', JSON.stringify(settings));
              
              // Update checkmark visibility
              updateModelCheckmarks();
              
              // Update display in bottom bar
              updateModelDisplay();
              
              // Call existing saveSettings if available
              if (typeof saveSettings === 'function') {
                saveSettings();
              }
            }
          });
        });

        // Handle temperature slider
        if (tempSlider && tempValue) {
          tempSlider.addEventListener('input', (e) => {
            const value = e.target.value;
            tempValue.textContent = value;
            
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            settings.temperature = parseFloat(value);
            localStorage.setItem('syncSettings', JSON.stringify(settings));
            
            if (typeof saveSettings === 'function') {
              saveSettings();
            }
          });
        }

        // Handle active speaker checkbox
        if (activeSpeakerCheckbox) {
          activeSpeakerCheckbox.addEventListener('change', () => {
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            settings.activeSpeakerOnly = activeSpeakerCheckbox.checked;
            localStorage.setItem('syncSettings', JSON.stringify(settings));
            
            if (typeof saveSettings === 'function') {
              saveSettings();
            }
          });
        }

        // Handle detect obstructions checkbox
        if (detectObstructionsCheckbox) {
          detectObstructionsCheckbox.addEventListener('change', () => {
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            settings.detectObstructions = detectObstructionsCheckbox.checked;
            localStorage.setItem('syncSettings', JSON.stringify(settings));
            
            if (typeof saveSettings === 'function') {
              saveSettings();
            }
          });
        }

        // Initialize display on load
        updateModelDisplay();
      })();

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
        // Initialize checkmark events for all input fields
        setupCheckmarkEvents('apiKey', 'apiKeyCheck');
      }

      function saveSettings() {
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          
          // Get model from either old or new selector
          const modelRadio = document.querySelector('input[name="model"]:checked');
          if (modelRadio) settings.model = modelRadio.value;
          
          // Get temperature from either old or new slider
          const tempEl = document.getElementById('temperature') || document.getElementById('modelTemperature');
          if (tempEl) settings.temperature = parseFloat(tempEl.value);
          
          // Get checkboxes from either old or new UI
          const activeSpeakerEl = document.getElementById('activeSpeakerOnly') || document.getElementById('modelActiveSpeaker');
          if (activeSpeakerEl) settings.activeSpeakerOnly = activeSpeakerEl.checked;
          
          const detectObstructionsEl = document.getElementById('detectObstructions') || document.getElementById('modelDetectObstructions');
          if (detectObstructionsEl) settings.detectObstructions = detectObstructionsEl.checked;
          
          // Optional old fields
          const syncModeEl = document.getElementById('syncMode');
          if (syncModeEl) settings.syncMode = syncModeEl.value || 'loop';
          
          const apiKeyEl = document.getElementById('apiKey');
          if (apiKeyEl) settings.apiKey = apiKeyEl.value;
          
          const saveLocationRadio = document.querySelector('input[name="saveLocation"]:checked');
          if (saveLocationRadio) settings.saveLocation = saveLocationRadio.value;
          else if (!settings.saveLocation) settings.saveLocation = 'project';
          
          const renderVideoEl = document.getElementById('renderVideo');
          if (renderVideoEl) settings.renderVideo = renderVideoEl.value || 'h264';
          else if (!settings.renderVideo) settings.renderVideo = 'h264';
          
          const renderAudioEl = document.getElementById('renderAudio');
          if (renderAudioEl) settings.renderAudio = renderAudioEl.value || 'wav';
          else if (!settings.renderAudio) settings.renderAudio = 'wav';
          
          localStorage.setItem('syncSettings', JSON.stringify(settings));
          
        // Persist to backend as a secondary store in case localStorage resets on AE reload
        try {
          const port = getServerPort();
          fetch(`http://127.0.0.1:${port}/settings`, { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ settings }) }).catch(()=>{});
        }catch(_){ }
          
        updateModelDisplay();
          
          if (typeof scheduleEstimate === 'function') {
        scheduleEstimate();
          }
        } catch(e) {
          console.error('Failed to save settings:', e);
        }
      }

      // On load, if localStorage missing, try to hydrate from backend
      (function hydrateSettings(){
        try {
          var raw = localStorage.getItem('syncSettings');
          if (!raw) {
            const port = getServerPort();
            fetch(`http://127.0.0.1:${port}/settings`, { method:'GET' }).then(function(r){ return r.json(); }).then(function(j){
              if (j && j.settings) { try { localStorage.setItem('syncSettings', JSON.stringify(j.settings)); loadSettings(); updateModelDisplay(); } catch(_){ } }
            }).catch(function(){ });
          }
        } catch(_){ }
      })();

      // Update system functions (reuse shared auth token/headers from core.js)
      async function api(pathname, opts){
        try { if (typeof ensureAuthToken === 'function') await ensureAuthToken(); } catch(_){ }
        const port = getServerPort();
        const baseHeaders = (typeof authHeaders === 'function') ? authHeaders({'Content-Type':'application/json'}) : { 'Content-Type':'application/json' };
        const extra = (opts && opts.headers) || {};
        const headers = Object.assign({}, baseHeaders, extra);
        const init = Object.assign({}, opts||{}, { headers });
        return fetch(`http://127.0.0.1:${port}` + pathname, init);
      }

      async function refreshCurrentVersion(){
        const el = document.getElementById('versionDisplay'); if (!el) return;
        try{
          const port = getServerPort();
          const r = await fetch(`http://127.0.0.1:${port}/health`, { cache:'no-store' }).catch(()=>null);
          if (!r || !r.ok) { el.textContent = 'version (start panel server to fetch)'; return; }
          const v = await (await api('/update/version')).json().catch(()=>({}));
          if (v && v.version) el.textContent = 'version v' + v.version;
          else el.textContent = 'version (unknown)';
        }catch(_){ el.textContent = 'version (unavailable)'; }
      }

      async function checkForUpdate(silent = false){
        const status = document.getElementById('updateStatus'); if (!silent && status) { status.style.display='block'; status.textContent = 'checking for updates…'; }
        const btnApply = document.getElementById('applyUpdateBtn'); if (btnApply) btnApply.style.display = 'none';
        try{
          await ensureAuthToken().catch(()=>undefined);
          const r = await api('/update/check').catch(()=>null);
          if (!r) throw new Error('no response');
          const j = await r.json().catch(()=>({}));
          if (!r.ok) throw new Error(j && j.error ? j.error : 'update check failed');
          const vEl = document.getElementById('versionDisplay');
          if (vEl) vEl.textContent = 'version v' + (j.current || '—');
          if (j.canUpdate){
            if (btnApply) { btnApply.dataset.tag = j.tag || ''; btnApply.style.display = 'inline-block'; }
            if (status) { status.style.display='block'; status.textContent = 'update available → v' + j.latest; }
          } else {
            if (status) status.textContent = 'up to date';
            setTimeout(() => { if (status) status.style.display = 'none'; }, 2000);
          }
        }catch(e){ if (!silent && status) status.textContent = 'update check failed: ' + String(e && e.message || e); }
      }

      async function applyUpdate(){
        const btn = document.getElementById('applyUpdateBtn');
        const status = document.getElementById('updateStatus'); if (status) { status.style.display='block'; status.textContent = 'downloading and applying update…'; }
        
        // Add timeout to prevent infinite hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Update timeout after 5 minutes')), 300000); // 5 minutes
        });
        
        try{
          const tag = (btn && btn.dataset && btn.dataset.tag) ? btn.dataset.tag : undefined;
          const updatePromise = api('/update/apply', { method:'POST', body: JSON.stringify(tag ? { tag } : {}) });
          
          const r = await Promise.race([updatePromise, timeoutPromise]);
          const j = await r.json().catch(()=>({}));
          if (!r.ok) throw new Error(j && j.error ? j.error : 'update failed');
          if (status) status.textContent = 'update applied successfully — restart Adobe app to complete';
          if (btn) btn.style.display = 'none';
          setTimeout(() => { refreshCurrentVersion(); }, 1000);
        }catch(e){ 
          if (status) status.textContent = 'update failed: ' + String(e && e.message || e);
          console.error('Update failed:', e);
        }
      }

      // Initialize version display on load
      setTimeout(refreshCurrentVersion, 1000);
      
      // Refresh version when backend becomes ready
      try {
        window.addEventListener('sync-backend-ready', function(){ setTimeout(refreshCurrentVersion, 200); });
      } catch(_){ }

      // Debug functions
      function testHostScripts() {
        const debugEl = document.getElementById('debugStatus');
        if (!debugEl) return;
        
        debugEl.textContent = 'Testing host scripts...\n';
        
        try {
          if (!window.CSInterface) {
            debugEl.textContent += 'ERROR: CSInterface not available\n';
            return;
          }
          
          const cs = new CSInterface();
          const hostId = window.nle && window.nle.getHostId ? window.nle.getHostId() : 'Unknown';
          
          debugEl.textContent += `Host detected: ${hostId}\n`;
          
          // Test the appropriate host script
          const testFunc = hostId === 'AEFT' ? 'AEFT_testLog()' : 'PPRO_testLog()';
          
          cs.evalScript(testFunc, function(result) {
            try {
              const parsed = JSON.parse(result || '{}');
              if (parsed.ok) {
                debugEl.textContent += `SUCCESS: ${testFunc} executed\n`;
                debugEl.textContent += `Response: ${parsed.message}\n`;
              } else {
                debugEl.textContent += `ERROR: ${testFunc} failed\n`;
                debugEl.textContent += `Error: ${parsed.error || 'Unknown error'}\n`;
              }
            } catch(e) {
              debugEl.textContent += `ERROR: Failed to parse result: ${result}\n`;
              debugEl.textContent += `Exception: ${e.message}\n`;
            }
          });
          
        } catch(e) {
          debugEl.textContent += `ERROR: ${e.message}\n`;
        }
      }
      
      function clearDebugLogs() {
        const debugEl = document.getElementById('debugStatus');
        if (debugEl) {
          debugEl.textContent = 'Debug logs cleared.\n';
        }
      }

      // listeners
      document.addEventListener('change', saveSettings);
      const apiKeyEl = document.getElementById('apiKey');
      if (apiKeyEl) {
        apiKeyEl.addEventListener('input', saveSettings);
      }
      const temperatureEl = document.getElementById('temperature');
      const tempValueEl = document.getElementById('tempValue');
      if (temperatureEl && tempValueEl) {
        temperatureEl.addEventListener('input', function(e) {
          tempValueEl.textContent = e.target.value;
        });
      }

      // New API Key validation and management for sync. and elevenlabs keys
      function validateAndShowCheckmark(input) {
        const value = input.value.trim();
        const prefix = input.dataset.keyPrefix;
        const checkmarkId = input.id + 'Check';
        const checkmark = document.getElementById(checkmarkId);
        
        if (checkmark && value.startsWith(prefix)) {
          checkmark.classList.add('visible');
          setTimeout(() => {
            checkmark.classList.remove('visible');
          }, 3000);
        }
      }
      
      // API Key inputs for sync. and elevenlabs
      const syncApiKeyInput = document.getElementById('syncApiKey');
      const elevenlabsApiKeyInput = document.getElementById('elevenlabsApiKey');
      
      if (syncApiKeyInput) {
        syncApiKeyInput.addEventListener('input', (e) => {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.syncApiKey = e.target.value;
          localStorage.setItem('syncSettings', JSON.stringify(settings));
        });
        
        syncApiKeyInput.addEventListener('blur', (e) => {
          validateAndShowCheckmark(e.target);
        });
        
        syncApiKeyInput.addEventListener('paste', (e) => {
          setTimeout(() => validateAndShowCheckmark(e.target), 10);
        });
      }
      
      if (elevenlabsApiKeyInput) {
        elevenlabsApiKeyInput.addEventListener('input', (e) => {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.elevenlabsApiKey = e.target.value;
          localStorage.setItem('syncSettings', JSON.stringify(settings));
        });
        
        elevenlabsApiKeyInput.addEventListener('blur', (e) => {
          validateAndShowCheckmark(e.target);
        });
        
        elevenlabsApiKeyInput.addEventListener('paste', (e) => {
          setTimeout(() => validateAndShowCheckmark(e.target), 10);
        });
      }
      
      // Copy button functionality
      document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const targetId = btn.dataset.target;
          const input = document.getElementById(targetId);
          
          if (input && input.value) {
            try {
              await navigator.clipboard.writeText(input.value);
              
              // Add orange highlight immediately, then fade back
              btn.classList.add('copied');
              // Remove after transition completes to allow smooth fade
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  btn.classList.remove('copied');
                });
              });
            } catch (err) {
              console.error('Failed to copy:', err);
            }
          }
        });
      });
      
      // Info button functionality
      document.querySelectorAll('.info-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        });
      });
      
      // Save location buttons
      document.querySelectorAll('.save-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const location = btn.dataset.saveLocation;
          
          // Update active state
          document.querySelectorAll('.save-option').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          // Save to localStorage
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.saveLocation = location;
          localStorage.setItem('syncSettings', JSON.stringify(settings));
          
          // Reinitialize Lucide icons for updated state
          if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
          }
        });
      });
      
      // Load saved settings for new API keys on page load
      (function loadNewApiKeys() {
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          
          if (settings.syncApiKey && syncApiKeyInput) {
            syncApiKeyInput.value = settings.syncApiKey;
          }
          
          if (settings.elevenlabsApiKey && elevenlabsApiKeyInput) {
            elevenlabsApiKeyInput.value = settings.elevenlabsApiKey;
          }
          
          if (settings.saveLocation) {
            document.querySelectorAll('.save-option').forEach(btn => {
              if (btn.dataset.saveLocation === settings.saveLocation) {
                btn.classList.add('active');
              } else {
                btn.classList.remove('active');
              }
            });
          }
        } catch (e) {
          console.error('Failed to load settings:', e);
        }
      })();

      // Render Settings - Video Format Selection (MP4)
      const mp4Button = document.querySelector('[data-video-format="mp4"]');
      if (mp4Button) {
        mp4Button.addEventListener('click', () => {
          // Deactivate all video options
          document.querySelectorAll('.video-option').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.prores-option').forEach(b => b.classList.remove('active'));
          
          // Activate MP4
          mp4Button.classList.add('active');
          
          // Save to localStorage using existing key
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.renderVideo = 'h264';
          localStorage.setItem('syncSettings', JSON.stringify(settings));
          if (typeof saveSettings === 'function') saveSettings();
        });
      }

      // Render Settings - ProRes Container Click
      const proresContainer = document.querySelector('[data-video-format="prores"]');
      if (proresContainer) {
        proresContainer.addEventListener('click', (e) => {
          // If clicking directly on container (not a prores-option button)
          if (!e.target.classList.contains('prores-option') && 
              !e.target.closest('.prores-option')) {
            // Deactivate all video options and prores options
            document.querySelectorAll('.video-option').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.prores-option').forEach(b => b.classList.remove('active'));
            
            // Activate prores container and default 422
            proresContainer.classList.add('active');
            const default422 = document.querySelector('[data-prores-type="422"]');
            if (default422) {
              default422.classList.add('active');
            }
            
            // Save to localStorage using existing key - default to prores422
            const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
            settings.renderVideo = 'prores422';
            localStorage.setItem('syncSettings', JSON.stringify(settings));
            if (typeof saveSettings === 'function') saveSettings();
          }
        });
      }

      // Render Settings - ProRes Type Selection
      document.querySelectorAll('.prores-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          
          const proresType = btn.dataset.proresType;
          
          // Deactivate all video options and prores options
          document.querySelectorAll('.video-option').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.prores-option').forEach(b => b.classList.remove('active'));
          
          // Activate this prores option and the container
          btn.classList.add('active');
          if (proresContainer) {
            proresContainer.classList.add('active');
          }
          
          // Save to localStorage using existing key
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.renderVideo = 'prores' + proresType.replace('-', '');
          localStorage.setItem('syncSettings', JSON.stringify(settings));
          if (typeof saveSettings === 'function') saveSettings();
        });
      });

      // Render Settings - Audio Format Selection
      document.querySelectorAll('.audio-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const format = btn.dataset.audioFormat;
          
          // Deactivate all audio options
          document.querySelectorAll('.audio-option').forEach(b => b.classList.remove('active'));
          
          // Activate this one
          btn.classList.add('active');
          
          // Save to localStorage using existing key
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          settings.renderAudio = format;
          localStorage.setItem('syncSettings', JSON.stringify(settings));
          if (typeof saveSettings === 'function') saveSettings();
        });
      });

      // Load saved render settings on page load
      (function loadRenderSettings() {
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          
          // Load video format from renderVideo setting
          if (settings.renderVideo) {
            const renderVideo = settings.renderVideo;
            
            // Deactivate all first
            document.querySelectorAll('.video-option').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.prores-option').forEach(b => b.classList.remove('active'));
            
            if (renderVideo === 'h264') {
              // Activate MP4
              const mp4 = document.querySelector('[data-video-format="mp4"]');
              if (mp4) mp4.classList.add('active');
            } else if (renderVideo.startsWith('prores')) {
              // Activate prores container
              const proresContainer = document.querySelector('[data-video-format="prores"]');
              if (proresContainer) proresContainer.classList.add('active');
              
              // Activate specific prores type
              let proresType = renderVideo.replace('prores', '');
              // Convert prores422hq to 422hq, etc.
              if (proresType === '422hq') proresType = '422hq';
              else if (proresType === '422proxy') proresType = '422proxy';
              else if (proresType === '422lt') proresType = '422lt';
              else if (proresType === '422') proresType = '422';
              
              const proresBtn = document.querySelector(`[data-prores-type="${proresType}"]`);
              if (proresBtn) proresBtn.classList.add('active');
            }
          }
          
          // Load audio format from renderAudio setting
          if (settings.renderAudio) {
            document.querySelectorAll('.audio-option').forEach(btn => {
              if (btn.dataset.audioFormat === settings.renderAudio) {
                btn.classList.add('active');
              } else {
                btn.classList.remove('active');
              }
            });
          }
        } catch (e) {
          console.error('Failed to load render settings:', e);
        }
      })();


