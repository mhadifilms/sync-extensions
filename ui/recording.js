// recording.js - Handle video and audio recording

(function() {
  'use strict';

  // Recording state
  let videoMediaRecorder = null;
  let audioMediaRecorder = null;
  let videoChunks = [];
  let audioChunks = [];
  let videoStream = null;
  let audioStream = null;
  let videoStartTime = 0;
  let audioStartTime = 0;
  let videoTimerInterval = null;
  let audioTimerInterval = null;
  let audioAnalyser = null;
  let audioContext = null;
  let audioAnimationFrame = null;
  let videoRecordingCancelled = false;
  let audioRecordingCancelled = false;
  let availableDevices = { video: [], audio: [] };
  let currentVideoDeviceId = null;
  let currentAudioDeviceId = null;


  // Get CEP-compatible MediaRecorder options
  function getMediaRecorderOptions(type) {
    const options = {};
    
    if (type === 'video') {
      // Try WebM first (most compatible with CEP)
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        options.mimeType = 'video/webm';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        options.mimeType = 'video/mp4';
      }
    } else if (type === 'audio') {
      // Try WebM audio first
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      }
    }
    
    return options;
  }

  // Enumerate available media devices
  async function enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      availableDevices.video = devices.filter(device => device.kind === 'videoinput');
      availableDevices.audio = devices.filter(device => device.kind === 'audioinput');
      
      // Set default devices
      if (availableDevices.video.length > 0 && !currentVideoDeviceId) {
        currentVideoDeviceId = availableDevices.video[0].deviceId;
      }
      if (availableDevices.audio.length > 0 && !currentAudioDeviceId) {
        currentAudioDeviceId = availableDevices.audio[0].deviceId;
      }
      
      return availableDevices;
    } catch (error) {
      console.error('Error enumerating devices:', error);
      return { video: [], audio: [] };
    }
  }

  // Switch video device
  async function switchVideoDevice(deviceId) {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }
    
    currentVideoDeviceId = deviceId;
    
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          deviceId: { exact: deviceId },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        }, 
        audio: false 
      });
      
      // Update video preview
      const video = document.getElementById('videoRecordPreview');
      if (video) {
        video.srcObject = videoStream;
      }
      
      return true;
    } catch (error) {
      console.error('Error switching video device:', error);
      return false;
    }
  }

  // Switch audio device
  async function switchAudioDevice(deviceId) {
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
    
    currentAudioDeviceId = deviceId;
    
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 44100 },
          channelCount: { ideal: 1 }
        }
      });
      
      // Update audio context
      if (audioContext) {
        audioContext.close();
      }
      
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(audioStream);
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 2048;
      source.connect(audioAnalyser);
      
      return true;
    } catch (error) {
      console.error('Error switching audio device:', error);
      return false;
    }
  }

  // Format time as MM:SS
  function formatRecordingTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Start video recording
  window.startVideoRecording = async function() {
    console.log('startVideoRecording called');
    videoRecordingCancelled = false; // Reset cancellation flag
    if (window.debugLog) window.debugLog('startVideoRecording_called', {
      selectedVideo: window.selectedVideo,
      selectedAudio: window.selectedAudio
    });
    try {
      const videoSection = document.getElementById('videoSection');
      const videoDropzone = document.getElementById('videoDropzone');
      const videoPreview = document.getElementById('videoPreview');
      
      if (!videoSection || !videoDropzone || !videoPreview) {
        throw new Error('Video elements not found');
      }

      // Enumerate devices first
      await enumerateDevices();

      // Request camera access with selected device
      const videoConstraints = { 
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
      };
      
      if (currentVideoDeviceId) {
        videoConstraints.deviceId = { exact: currentVideoDeviceId };
      }

      videoStream = await navigator.mediaDevices.getUserMedia({ 
        video: videoConstraints, 
        audio: false 
      });

      // Hide dropzone, show recording UI
      videoDropzone.style.display = 'none';
      videoPreview.style.display = 'flex';
      videoSection.classList.add('recording');

      // Create recording UI with device switching
      videoPreview.innerHTML = `
        <div class="recording-container">
          <video id="videoRecordPreview" class="recording-preview" autoplay muted playsinline></video>
          <button class="recording-close-btn" id="videoBackBtn">
            <i data-lucide="x"></i>
          </button>
          <div class="recording-device-switcher" id="videoDeviceSwitcher">
            <select id="videoDeviceSelect" class="device-select">
              ${availableDevices.video.map(device => 
                `<option value="${device.deviceId}" ${device.deviceId === currentVideoDeviceId ? 'selected' : ''}>
                  ${device.label || 'Camera ' + (availableDevices.video.indexOf(device) + 1)}
                </option>`
              ).join('')}
            </select>
          </div>
          <button class="recording-stop-btn" id="videoStopBtn">
            <div class="recording-stop-icon"></div>
            <span class="recording-timer" id="videoTimer">00:00</span>
          </button>
        </div>
      `;

      // Initialize icons
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
      }

      // Get video element and attach stream
      const video = document.getElementById('videoRecordPreview');
      if (video) {
        video.srcObject = videoStream;
      }

      // Setup media recorder with CEP-compatible options
      videoChunks = [];
      const videoOptions = getMediaRecorderOptions('video');
      console.log('Video MediaRecorder options:', videoOptions);
      console.log('Video stream tracks:', videoStream.getTracks().map(track => ({
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        settings: track.getSettings()
      })));
      
      videoMediaRecorder = new MediaRecorder(videoStream, videoOptions);

      videoMediaRecorder.onstart = () => {
        console.log('Video MediaRecorder started, state:', videoMediaRecorder.state);
      };

      videoMediaRecorder.onstop = () => {
        console.log('Video MediaRecorder stopped, state:', videoMediaRecorder.state);
      };

      videoMediaRecorder.onerror = (event) => {
        console.error('Video MediaRecorder error:', event.error);
      };

      videoMediaRecorder.ondataavailable = (event) => {
        console.log('Video data available:', {
          size: event.data ? event.data.size : 0,
          type: event.data ? event.data.type : 'unknown'
        });
        if (event.data && event.data.size > 0) {
          videoChunks.push(event.data);
        }
      };

      videoMediaRecorder.onstop = async () => {
        console.log('Video MediaRecorder onstop triggered');
        if (window.debugLog) window.debugLog('video_recorder_onstop', {
          selectedVideo: window.selectedVideo,
          selectedAudio: window.selectedAudio
        });
        await handleVideoRecordingComplete();
      };

      // Wait for camera to warm up before starting recording (prevents black first frame)
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Start recording
      videoMediaRecorder.start();
      videoStartTime = Date.now();

      // Update timer
      videoTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - videoStartTime) / 1000);
        const timer = document.getElementById('videoTimer');
        if (timer) {
          timer.textContent = formatRecordingTime(elapsed);
        }
      }, 1000);

      // Stop button handler
      const stopBtn = document.getElementById('videoStopBtn');
      if (stopBtn) {
        stopBtn.addEventListener('click', stopVideoRecording);
      }

      // Back button handler (cancel recording)
      const backBtn = document.getElementById('videoBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', cancelVideoRecording);
      }

      // Device switcher handler
      const deviceSelect = document.getElementById('videoDeviceSelect');
      if (deviceSelect) {
        deviceSelect.addEventListener('change', async (e) => {
          const success = await switchVideoDevice(e.target.value);
          if (!success) {
            if (typeof window.showToast === 'function') {
              window.showToast('failed to switch camera', 'error');
            }
            // Revert selection
            e.target.value = currentVideoDeviceId;
          }
        });
      }

    } catch (error) {
      console.error('Video recording error:', error);
      let errorMessage = 'Camera access denied or unavailable';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Camera access denied. Please allow camera access in your browser/system preferences and try again.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No camera found. Please connect a camera and try again.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Camera is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'Camera constraints cannot be satisfied. Try with different video settings.';
      } else if (error.name === 'SecurityError') {
        errorMessage = 'Camera access blocked due to security restrictions. Check system permissions.';
      } else if (error.name === 'AbortError') {
        errorMessage = 'Camera access was interrupted. Please try again.';
      }
      
      if (typeof window.showToast === 'function') {
        window.showToast(errorMessage, 'error');
      }
      resetVideoUI();
    }
  };

  // Stop video recording
  window.stopVideoRecording = function() {
    console.log('stopVideoRecording called, recorder state:', videoMediaRecorder ? videoMediaRecorder.state : 'null');
    console.log('Video chunks before stop:', videoChunks.length);
    
    if (videoTimerInterval) {
      clearInterval(videoTimerInterval);
      videoTimerInterval = null;
    }

    if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
      console.log('Stopping video MediaRecorder...');
      
      // Request data before stopping to ensure we get any pending chunks
      try {
        videoMediaRecorder.requestData();
      } catch (e) {
        console.log('requestData failed:', e);
      }
      
      // Small delay to ensure data is captured
      setTimeout(() => {
        videoMediaRecorder.stop();
      }, 100);
    } else {
      console.log('Video MediaRecorder not active or null');
    }

    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }
  };

  // Cancel video recording
  window.cancelVideoRecording = function() {
    console.log('cancelVideoRecording called');
    if (window.debugLog) window.debugLog('cancel_video_recording', {});
    
    videoRecordingCancelled = true;
    
    if (videoTimerInterval) {
      clearInterval(videoTimerInterval);
      videoTimerInterval = null;
    }

    if (videoMediaRecorder && videoMediaRecorder.state !== 'inactive') {
      videoMediaRecorder.stop();
    }

    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }

    videoChunks = [];
    videoMediaRecorder = null;
    resetVideoUI();
  };

  // Handle video recording complete
  async function handleVideoRecordingComplete() {
    // Check if recording was cancelled
    if (videoRecordingCancelled) {
      console.log('Video recording was cancelled, not processing');
      videoRecordingCancelled = false; // Reset flag
      return;
    }
    
    // Wait a bit for any remaining data to be captured
    await new Promise(resolve => setTimeout(resolve, 200));
    
    try {
      // Determine file extension based on MIME type
      const mimeType = videoMediaRecorder?.mimeType || 'video/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      
      console.log('Video recording complete:', {
        chunks: videoChunks.length,
        totalSize: videoChunks.reduce((sum, chunk) => sum + chunk.size, 0),
        mimeType: mimeType
      });
      
      if (videoChunks.length === 0) {
        throw new Error('No video data captured');
      }
      
      const blob = new Blob(videoChunks, { type: mimeType });
      
      if (blob.size === 0) {
        throw new Error('Video blob is empty');
      }
      
      console.log('Video blob created:', {
        size: blob.size,
        type: blob.type
      });
      
      // Save to file
      const fileName = `recording_${Date.now()}.${extension}`;
      const result = await saveRecordedFile(blob, fileName, 'video');
      
      if (result && result.path) {
        console.log('Video recording saved successfully:', result.path);
        // Set as selected video - use file:// URL for CEP compatibility
        window.selectedVideo = result.path;
        window.selectedVideoIsTemp = false;
        window.selectedVideoIsUrl = false; // Use file:// URL for CEP compatibility
        window.selectedVideoUrl = '';
        console.log('Video variables set:', {
          selectedVideo: window.selectedVideo,
          selectedVideoIsTemp: window.selectedVideoIsTemp,
          selectedVideoIsUrl: window.selectedVideoIsUrl,
          selectedVideoUrl: window.selectedVideoUrl
        });
        
        // Upload to server
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          await window.ensureAuthToken();
          const uploadResp = await fetch('http://127.0.0.1:3000/upload', {
            method: 'POST',
            headers: window.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ path: savedPath, apiKey: settings.apiKey || '' })
          });
          const uploadData = await uploadResp.json();
          if (uploadData.ok && uploadData.url) {
            window.selectedVideoUrl = uploadData.url;
            // Keep using local file for playback, just store URL for later use
            // window.selectedVideoIsUrl = true; // Don't switch to URL
          }
        } catch (e) {
          console.error('Upload error:', e);
        }

        // Show loading toast
        if (typeof window.showToast === 'function') {
          window.showToast('loading...', 'info');
        }
        
        // Wait for video duration to load before rendering preview
        console.log('Video recording saved, waiting for duration to load');
        if (window.debugLog) window.debugLog('video_duration_wait_start', {
          selectedVideo: window.selectedVideo,
          savedPath: result.path
        });
        if (window.debugLog) window.debugLog('video_recording_saved', {
          selectedVideo: window.selectedVideo,
          selectedVideoUrl: window.selectedVideoUrl,
          selectedVideoIsUrl: window.selectedVideoIsUrl
        });
        
        // No wait - let the UI handle duration loading
        
        // Now render preview
        console.log('Video recording ready, calling renderInputPreview');
        if (typeof window.renderInputPreview === 'function') {
          if (window.debugLog) window.debugLog('renderInputPreview_call_from_video', {
            functionAvailable: true,
            selectedVideo: window.selectedVideo,
            selectedAudio: window.selectedAudio
          });
          window.renderInputPreview('videoRecording');
        } else {
          console.error('renderInputPreview function not available');
          if (window.debugLog) window.debugLog('renderInputPreview_call_from_video', {
            functionAvailable: false,
            selectedVideo: window.selectedVideo,
            selectedAudio: window.selectedAudio
          });
        }
        
        if (typeof window.updateLipsyncButton === 'function') {
          window.updateLipsyncButton();
        }
        
        // Remove recording class to clear orange outline
        const videoSection = document.getElementById('videoSection');
        if (videoSection) {
          videoSection.classList.remove('recording');
        }
        
        if (typeof window.showToast === 'function') {
          window.showToast('video recorded successfully', 'success');
        }
      }
    } catch (error) {
      console.error('Error handling video recording:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('failed to save recording', 'error');
      }
      resetVideoUI();
    }

    // Cleanup
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
    videoChunks = [];
    videoMediaRecorder = null;
  }

  // Reset video UI to initial state
  function resetVideoUI() {
    const videoSection = document.getElementById('videoSection');
    const videoDropzone = document.getElementById('videoDropzone');
    const videoPreview = document.getElementById('videoPreview');
    
    if (videoSection) {
      videoSection.classList.remove('recording');
    }
    // Show dropzone, hide preview to return to input state
    if (videoDropzone) {
      videoDropzone.style.display = 'flex';
    }
    if (videoPreview) {
      videoPreview.style.display = 'none';
      videoPreview.innerHTML = '';
    }
  }

  // Start audio recording
  window.startAudioRecording = async function() {
    console.log('startAudioRecording called');
    audioRecordingCancelled = false; // Reset cancellation flag
    if (window.debugLog) window.debugLog('startAudioRecording_called', {
      selectedVideo: window.selectedVideo,
      selectedAudio: window.selectedAudio
    });
    try {
      const audioSection = document.getElementById('audioSection');
      const audioDropzone = document.getElementById('audioDropzone');
      const audioPreview = document.getElementById('audioPreview');
      
      if (!audioSection || !audioDropzone || !audioPreview) {
        throw new Error('Audio elements not found');
      }

      // Enumerate devices first
      await enumerateDevices();

      // Request microphone access with selected device
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 44100 },
        channelCount: { ideal: 1 }
      };
      
      if (currentAudioDeviceId) {
        audioConstraints.deviceId = { exact: currentAudioDeviceId };
      }

      audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: audioConstraints
      });

      // Hide dropzone, show recording UI
      audioDropzone.style.display = 'none';
      audioPreview.style.display = 'flex';
      audioSection.classList.add('recording');

      // Create recording UI with waveform and device switching
      audioPreview.innerHTML = `
        <div class="audio-recording-container">
          <div class="audio-waveform-wrapper">
            <canvas id="audioRecordWaveform" class="audio-record-waveform"></canvas>
            <div class="audio-timeline-dots"></div>
            <div class="audio-playhead" id="audioPlayhead"></div>
          </div>
          <div class="recording-device-switcher" id="audioDeviceSwitcher">
            <select id="audioDeviceSelect" class="device-select">
              ${availableDevices.audio.map(device => 
                `<option value="${device.deviceId}" ${device.deviceId === currentAudioDeviceId ? 'selected' : ''}>
                  ${device.label || 'Microphone ' + (availableDevices.audio.indexOf(device) + 1)}
                </option>`
              ).join('')}
            </select>
          </div>
          <button class="audio-recording-stop-btn" id="audioStopBtn">
            <div class="audio-stop-icon"></div>
            <span class="recording-timer" id="audioTimer">00:00</span>
          </button>
          <button class="recording-close-btn" id="audioBackBtn">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;

      // Initialize icons
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
      }

      // Setup audio context and analyser for waveform
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(audioStream);
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 2048;
      source.connect(audioAnalyser);

      // Setup canvas for waveform
      const canvas = document.getElementById('audioRecordWaveform');
      if (canvas) {
        canvas.width = canvas.offsetWidth * 2; // 2x for retina
        canvas.height = canvas.offsetHeight * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2); // Scale for retina

        // Draw waveform animation using the same style as normal audio waveform
        function drawWaveform() {
          audioAnimationFrame = requestAnimationFrame(drawWaveform);
          
          const bufferLength = audioAnalyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          audioAnalyser.getByteTimeDomainData(dataArray);

          const width = canvas.width / 2;
          const height = canvas.height / 2;
          
          // Clear canvas
          ctx.clearRect(0, 0, width, height);
          
          // Skip drawing if no meaningful audio data yet
          let hasAudioData = false;
          for (let i = 0; i < dataArray.length; i++) {
            if (Math.abs(dataArray[i] - 128) > 5) {
              hasAudioData = true;
              break;
            }
          }
          if (!hasAudioData) return;
          
          // Use the same bar rendering style as normal waveform
          const barSpacing = 2; // 1px bar with 1px gap
          const barCount = Math.max(1, Math.floor(width / barSpacing));
          const centerY = height / 2;
          
          // Convert time domain data to bars (same as normal waveform)
          for (let i = 0; i < barCount; i++) {
            const dataIndex = Math.floor((i / barCount) * bufferLength);
            const normalized = Math.abs((dataArray[dataIndex] - 128) / 128.0); // Convert to amplitude
            const barHeight = Math.max(2, normalized * (height * 0.8));
            
            // Skip drawing if bar height is too small (prevents weird tall lines)
            if (barHeight < 3) continue;
            
            // Skip the first few bars to prevent left-side artifact
            if (i < 2) continue;
            
            // Use white color for recording waveform
            ctx.fillStyle = '#ffffff';
            
            // Draw rounded rect for each bar (same as normal waveform)
            const barWidth = 1;
            const x = i * barSpacing;
            const y = centerY - barHeight / 2;
            const radius = 2;
            
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(x, y, barWidth, barHeight, radius);
            } else {
              // Fallback for browsers without roundRect support
              ctx.rect(x, y, barWidth, barHeight);
            }
            ctx.fill();
          }
        }
        
        drawWaveform();
      }

      // Setup media recorder with CEP-compatible options
      audioChunks = [];
      const audioOptions = getMediaRecorderOptions('audio');
      console.log('Audio MediaRecorder options:', audioOptions);
      console.log('Audio stream tracks:', audioStream.getTracks().map(track => ({
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        settings: track.getSettings()
      })));
      
      audioMediaRecorder = new MediaRecorder(audioStream, audioOptions);

      audioMediaRecorder.onstart = () => {
        console.log('Audio MediaRecorder started, state:', audioMediaRecorder.state);
      };

      audioMediaRecorder.onstop = () => {
        console.log('Audio MediaRecorder stopped, state:', audioMediaRecorder.state);
      };

      audioMediaRecorder.onerror = (event) => {
        console.error('Audio MediaRecorder error:', event.error);
      };

      audioMediaRecorder.ondataavailable = (event) => {
        console.log('Audio data available:', {
          size: event.data ? event.data.size : 0,
          type: event.data ? event.data.type : 'unknown'
        });
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      audioMediaRecorder.onstop = async () => {
        console.log('Audio MediaRecorder onstop triggered');
        if (window.debugLog) window.debugLog('audio_recorder_onstop', {
          selectedVideo: window.selectedVideo,
          selectedAudio: window.selectedAudio
        });
        await handleAudioRecordingComplete();
      };

      // Start recording
      audioMediaRecorder.start();
      audioStartTime = Date.now();

      // Update timer
      audioTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - audioStartTime) / 1000);
        const timer = document.getElementById('audioTimer');
        if (timer) {
          timer.textContent = formatRecordingTime(elapsed);
        }
      }, 1000);

      // Stop button handler
      const stopBtn = document.getElementById('audioStopBtn');
      if (stopBtn) {
        stopBtn.addEventListener('click', stopAudioRecording);
      }

      // Back button handler (cancel recording)
      const backBtn = document.getElementById('audioBackBtn');
      if (backBtn) {
        backBtn.addEventListener('click', cancelAudioRecording);
      }

      // Device switcher handler
      const deviceSelect = document.getElementById('audioDeviceSelect');
      if (deviceSelect) {
        deviceSelect.addEventListener('change', async (e) => {
          const success = await switchAudioDevice(e.target.value);
          if (!success) {
            if (typeof window.showToast === 'function') {
              window.showToast('failed to switch microphone', 'error');
            }
            // Revert selection
            e.target.value = currentAudioDeviceId;
          }
        });
      }

    } catch (error) {
      console.error('Audio recording error:', error);
      let errorMessage = 'Microphone access denied or unavailable';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Microphone access denied. Please allow microphone access in your browser/system preferences and try again.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone and try again.';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Microphone is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = 'Microphone constraints cannot be satisfied. Try with different audio settings.';
      } else if (error.name === 'SecurityError') {
        errorMessage = 'Microphone access blocked due to security restrictions. Check system permissions.';
      } else if (error.name === 'AbortError') {
        errorMessage = 'Microphone access was interrupted. Please try again.';
      }
      
      if (typeof window.showToast === 'function') {
        window.showToast(errorMessage, 'error');
      }
      resetAudioUI();
    }
  };

  // Stop audio recording
  window.stopAudioRecording = function() {
    console.log('stopAudioRecording called, recorder state:', audioMediaRecorder ? audioMediaRecorder.state : 'null');
    console.log('Audio chunks before stop:', audioChunks.length);
    
    if (audioTimerInterval) {
      clearInterval(audioTimerInterval);
      audioTimerInterval = null;
    }

    if (audioAnimationFrame) {
      cancelAnimationFrame(audioAnimationFrame);
      audioAnimationFrame = null;
    }

    if (audioMediaRecorder && audioMediaRecorder.state !== 'inactive') {
      console.log('Stopping audio MediaRecorder...');
      
      // Request data before stopping to ensure we get any pending chunks
      try {
        audioMediaRecorder.requestData();
      } catch (e) {
        console.log('requestData failed:', e);
      }
      
      // Small delay to ensure data is captured
      setTimeout(() => {
        audioMediaRecorder.stop();
      }, 100);
    } else {
      console.log('Audio MediaRecorder not active or null');
    }

    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  };

  // Cancel audio recording
  window.cancelAudioRecording = function() {
    console.log('cancelAudioRecording called');
    if (window.debugLog) window.debugLog('cancel_audio_recording', {});
    
    audioRecordingCancelled = true;
    
    if (audioTimerInterval) {
      clearInterval(audioTimerInterval);
      audioTimerInterval = null;
    }

    if (audioAnimationFrame) {
      cancelAnimationFrame(audioAnimationFrame);
      audioAnimationFrame = null;
    }

    if (audioMediaRecorder && audioMediaRecorder.state !== 'inactive') {
      audioMediaRecorder.stop();
    }

    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }

    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    audioChunks = [];
    audioMediaRecorder = null;
    resetAudioUI();
  };

  // Handle audio recording complete
  async function handleAudioRecordingComplete() {
    // Check if recording was cancelled
    if (audioRecordingCancelled) {
      console.log('Audio recording was cancelled, not processing');
      audioRecordingCancelled = false; // Reset flag
      return;
    }
    
    // Wait a bit for any remaining data to be captured
    await new Promise(resolve => setTimeout(resolve, 200));
    
    try {
      // Determine file extension based on MIME type
      const mimeType = audioMediaRecorder?.mimeType || 'audio/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      
      console.log('Audio recording complete:', {
        chunks: audioChunks.length,
        totalSize: audioChunks.reduce((sum, chunk) => sum + chunk.size, 0),
        mimeType: mimeType
      });
      
      if (audioChunks.length === 0) {
        throw new Error('No audio data captured');
      }
      
      const blob = new Blob(audioChunks, { type: mimeType });
      
      if (blob.size === 0) {
        throw new Error('Audio blob is empty');
      }
      
      console.log('Audio blob created:', {
        size: blob.size,
        type: blob.type
      });
      
      // Save to file
      const fileName = `recording_${Date.now()}.${extension}`;
      const result = await saveRecordedFile(blob, fileName, 'audio');
      
      if (result && result.path) {
        console.log('Audio recording saved successfully:', result.path);
        // Set as selected audio - use file:// URL for CEP compatibility
        window.selectedAudio = result.path;
        window.selectedAudioIsTemp = false;
        window.selectedAudioIsUrl = false; // Use file:// URL for CEP compatibility
        window.selectedAudioUrl = '';
        console.log('Audio variables set:', {
          selectedAudio: window.selectedAudio,
          selectedAudioIsTemp: window.selectedAudioIsTemp,
          selectedAudioIsUrl: window.selectedAudioIsUrl,
          selectedAudioUrl: window.selectedAudioUrl
        });
        
        // Upload to server
        try {
          const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
          await window.ensureAuthToken();
          const uploadResp = await fetch('http://127.0.0.1:3000/upload', {
            method: 'POST',
            headers: window.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ path: savedPath, apiKey: settings.apiKey || '' })
          });
          const uploadData = await uploadResp.json();
          if (uploadData.ok && uploadData.url) {
            window.selectedAudioUrl = uploadData.url;
            // Keep using local file for playback, just store URL for later use
            // window.selectedAudioIsUrl = true; // Don't switch to URL
          }
        } catch (e) {
          console.error('Upload error:', e);
        }

        // Show loading toast
        if (typeof window.showToast === 'function') {
          window.showToast('loading...', 'info');
        }
        
        // Wait for audio duration to load before rendering preview
        console.log('Audio recording saved, waiting for duration to load');
        if (window.debugLog) window.debugLog('audio_duration_wait_start', {
          selectedAudio: window.selectedAudio,
          savedPath: result.path
        });
        if (window.debugLog) window.debugLog('audio_recording_saved', {
          selectedAudio: window.selectedAudio,
          selectedAudioUrl: window.selectedAudioUrl,
          selectedAudioIsUrl: window.selectedAudioIsUrl
        });
        
        // No wait - let the UI handle duration loading
        
        // Now render preview
        console.log('Audio recording ready, calling renderInputPreview');
        if (typeof window.renderInputPreview === 'function') {
          if (window.debugLog) window.debugLog('renderInputPreview_call_from_audio', {
            functionAvailable: true,
            selectedVideo: window.selectedVideo,
            selectedAudio: window.selectedAudio
          });
          window.renderInputPreview('audioRecording');
        } else {
          console.error('renderInputPreview function not available');
          if (window.debugLog) window.debugLog('renderInputPreview_call_from_audio', {
            functionAvailable: false,
            selectedVideo: window.selectedVideo,
            selectedAudio: window.selectedAudio
          });
        }
        
        if (typeof window.updateLipsyncButton === 'function') {
          window.updateLipsyncButton();
        }
        
        // Remove recording class to clear orange outline
        const audioSection = document.getElementById('audioSection');
        if (audioSection) {
          audioSection.classList.remove('recording');
        }
        
        if (typeof window.showToast === 'function') {
          window.showToast('audio recorded successfully', 'success');
        }
      }
    } catch (error) {
      console.error('Error handling audio recording:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('failed to save recording', 'error');
      }
      resetAudioUI();
    }

    // Cleanup
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    audioChunks = [];
    audioMediaRecorder = null;
    audioAnalyser = null;
  }

  // Reset audio UI to initial state
  function resetAudioUI() {
    const audioSection = document.getElementById('audioSection');
    const audioDropzone = document.getElementById('audioDropzone');
    const audioPreview = document.getElementById('audioPreview');
    
    if (audioSection) {
      audioSection.classList.remove('recording');
    }
    // Show dropzone, hide preview to return to input state
    if (audioDropzone) {
      audioDropzone.style.display = 'flex';
    }
    if (audioPreview) {
      audioPreview.style.display = 'none';
      audioPreview.innerHTML = '';
    }
  }

  // Save recorded file via server
  async function saveRecordedFile(blob, fileName, type) {
    try {
      // Get save location from settings
      const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
      const saveLocation = settings.saveLocation || 'project';
      
      // Get target directory
      let targetDir = '';
      
      if (saveLocation === 'documents') {
        // Server will handle Documents path
        targetDir = 'documents';
      } else {
        // Get project directory from ExtendScript
        try {
          targetDir = await getProjectSaveDirectory();
          if (!targetDir) {
            targetDir = 'documents'; // Fallback
          }
        } catch (error) {
          console.warn('Failed to get project directory, using documents fallback:', error);
          targetDir = 'documents';
        }
      }

      // Use FormData to send file efficiently
      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('targetDir', targetDir);
      formData.append('type', type);
      
      // Send to server to save (no auth needed for recording/save)
      console.log('Sending recording to server:', {
        fileName,
        type,
        targetDir,
        blobSize: blob.size
      });
      
      const response = await fetch('http://127.0.0.1:3000/recording/save', {
        method: 'POST',
        body: formData
      });

      console.log('Server response:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server response error:', response.status, errorText);
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Server result:', result);
      
      if (result.ok && result.path) {
        return result; // Return full result object with path and url
      } else {
        throw new Error(result.error || 'Failed to save recording');
      }
    } catch (error) {
      console.error('Save recorded file error:', error);
      throw error;
    }
  }

  // Get project save directory
  function getProjectSaveDirectory() {
    return new Promise((resolve) => {
      if (typeof cs !== 'undefined') {
        // Try to get project path (Premiere specific)
        cs.evalScript(`
          (function() {
            try {
              if (typeof app !== 'undefined' && app.project && app.project.path) {
                var projectPath = String(app.project.path);
                var folder = new Folder(projectPath);
                if (folder.exists) {
                  // Get parent directory of the project file
                  var parentDir = folder.parent.fsName;
                  var syncFolder = new Folder(parentDir + '/sync. outputs');
                  if (!syncFolder.exists) {
                    syncFolder.create();
                  }
                  return syncFolder.fsName;
                }
              }
            } catch(e) {}
            return '';
          })()
        `, (result) => {
          resolve(result || null);
        });
      } else {
        resolve(null);
      }
    });
  }

})();

