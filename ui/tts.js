// TTS Interface Manager
(function() {
  'use strict';

  // TTS State
  let selectedVoiceId = 'rachel';
  let selectedVoiceName = 'rachel';
  let voices = [];
  let voiceSettings = {
    stability: 0.5,
    similarityBoost: 0.8
  };

  // Initialize TTS
  function initTTS() {
    console.log('TTS Init starting...');
    console.log('TTSInterface will be available:', typeof window.TTSInterface);
    if (window.debugLog) window.debugLog('tts_init_start', { interfaceAvailable: typeof window.TTSInterface });
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTTS);
      return;
    }
    
    // Add a small delay to ensure all elements are rendered
    setTimeout(() => {
      setupTTSEventListeners();
    }, 100);
  }
  
  function setupTTSEventListeners() {
    // Get elements
    const fromTextBtn = document.querySelector('[data-action="audio-tts"]');
    const ttsInterface = document.getElementById('ttsInterface');
    const ttsCloseX = document.getElementById('ttsCloseX');
    const ttsVoiceSelectBtn = document.getElementById('ttsVoiceSelectBtn');
    const ttsSettingsBtn = document.getElementById('ttsSettingsBtn');
    const ttsPreviewBtn = document.getElementById('ttsPreviewBtn');
    const ttsVoiceSelectorOverlay = document.getElementById('ttsVoiceSelectorOverlay');
    const ttsVoiceSelectorClose = document.getElementById('ttsVoiceSelectorClose');
    const ttsSettingsPopup = document.getElementById('ttsSettingsPopup');

    console.log('TTS Elements found:', {
      fromTextBtn: !!fromTextBtn,
      ttsInterface: !!ttsInterface,
      ttsCloseX: !!ttsCloseX,
      ttsVoiceSelectBtn: !!ttsVoiceSelectBtn,
      ttsSettingsBtn: !!ttsSettingsBtn,
      ttsPreviewBtn: !!ttsPreviewBtn,
      ttsVoiceSelectorOverlay: !!ttsVoiceSelectorOverlay,
      ttsSettingsPopup: !!ttsSettingsPopup
    });
    if (window.debugLog) window.debugLog('tts_elements_found', {
      fromTextBtn: !!fromTextBtn,
      ttsInterface: !!ttsInterface,
      ttsCloseX: !!ttsCloseX,
      ttsVoiceSelectBtn: !!ttsVoiceSelectBtn,
      ttsSettingsBtn: !!ttsSettingsBtn,
      ttsPreviewBtn: !!ttsPreviewBtn,
      ttsVoiceSelectorOverlay: !!ttsVoiceSelectorOverlay,
      ttsSettingsPopup: !!ttsSettingsPopup
    });

        // From Text button
        if (fromTextBtn) {
          fromTextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('From Text clicked');
            if (window.debugLog) window.debugLog('from_text_clicked');
            showTTSInterface();
          });
          console.log('From Text button listener attached');
        } else {
          console.log('From Text button not found!');
        }

    // Close X button
    if (ttsCloseX) {
      ttsCloseX.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Close X clicked');
        hideTTSInterface();
      });
    }

        // Voice select button
        if (ttsVoiceSelectBtn) {
          ttsVoiceSelectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Voice select clicked');
            openVoiceSelector();
          });
          console.log('Voice select button listener attached');
        } else {
          console.log('Voice select button not found!');
        }

    // Settings button
    if (ttsSettingsBtn) {
      ttsSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Settings clicked');
        toggleSettingsPopup();
      });
    }

        // Preview button
        if (ttsPreviewBtn) {
          ttsPreviewBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Preview clicked');
            generateTTS();
          });
          console.log('Preview button listener attached');
        } else {
          console.log('Preview button not found!');
        }

    // Voice selector close
    if (ttsVoiceSelectorClose) {
      ttsVoiceSelectorClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeVoiceSelector();
      });
    }

    // Close voice selector on overlay click
    if (ttsVoiceSelectorOverlay) {
      ttsVoiceSelectorOverlay.addEventListener('click', (e) => {
        if (e.target === ttsVoiceSelectorOverlay) {
          closeVoiceSelector();
        }
      });
    }

    // Close settings popup when clicking outside
    document.addEventListener('click', (e) => {
      if (ttsSettingsPopup && ttsSettingsPopup.style.display !== 'none') {
        if (!ttsSettingsPopup.contains(e.target) && e.target !== ttsSettingsBtn) {
          closeSettingsPopup();
        }
      }
    });

    // Voice clone modal close button
    const ttsVoiceCloneClose = document.getElementById('ttsVoiceCloneClose');
    if (ttsVoiceCloneClose) {
      ttsVoiceCloneClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeVoiceCloneModal();
      });
    }

    console.log('TTS Setup complete');
  }

  function showTTSInterface() {
    const audioDropzone = document.getElementById('audioDropzone');
    const audioPreview = document.getElementById('audioPreview');
    const ttsInterface = document.getElementById('ttsInterface');
    
    if (window.debugLog) window.debugLog('showTTSInterface_called', {
      ttsInterface: !!ttsInterface,
      audioDropzone: !!audioDropzone,
      audioPreview: !!audioPreview
    });
    
    if (audioDropzone) audioDropzone.style.display = 'none';
    if (audioPreview) audioPreview.style.display = 'none';
    if (ttsInterface) ttsInterface.style.display = 'flex';
    
    // Initialize Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function hideTTSInterface() {
    const ttsInterface = document.getElementById('ttsInterface');
    const audioDropzone = document.getElementById('audioDropzone');
    
    if (ttsInterface) ttsInterface.style.display = 'none';
    if (audioDropzone) audioDropzone.style.display = 'flex';
    
    // Clear TTS state
    const ttsTextInput = document.getElementById('ttsTextInput');
    if (ttsTextInput) ttsTextInput.value = '';
    closeSettingsPopup();
  }

  function toggleSettingsPopup() {
    const ttsSettingsPopup = document.getElementById('ttsSettingsPopup');
    if (ttsSettingsPopup) {
      const isVisible = ttsSettingsPopup.style.display !== 'none';
      ttsSettingsPopup.style.display = isVisible ? 'none' : 'block';
      
      if (!isVisible && window.lucide) {
        window.lucide.createIcons();
      }
    }
  }

  function closeSettingsPopup() {
    const ttsSettingsPopup = document.getElementById('ttsSettingsPopup');
    if (ttsSettingsPopup) {
      ttsSettingsPopup.style.display = 'none';
    }
  }

  async function openVoiceSelector() {
    const ttsVoiceSelectorOverlay = document.getElementById('ttsVoiceSelectorOverlay');
    if (!ttsVoiceSelectorOverlay) return;
    
    // Show overlay
    ttsVoiceSelectorOverlay.style.display = 'flex';
    
    // Load voices if not already loaded
    if (voices.length === 0) {
      await loadVoices();
    } else {
      renderVoices(voices);
    }
    
    // Initialize Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function closeVoiceSelector() {
    const ttsVoiceSelectorOverlay = document.getElementById('ttsVoiceSelectorOverlay');
    if (ttsVoiceSelectorOverlay) {
      ttsVoiceSelectorOverlay.style.display = 'none';
    }
  }

  async function loadVoices() {
    const ttsVoiceList = document.getElementById('ttsVoiceList');
    if (!ttsVoiceList) return;
    
    try {
      // Show loading state
      ttsVoiceList.innerHTML = '<div class="tts-voice-loading"><div class="tts-progress-spinner"></div><span>loading voices...</span></div>';
      
      // Get ElevenLabs API key from localStorage
      const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
      const apiKey = settings.elevenlabsApiKey;
      
      console.log('Loading voices, API key found:', !!apiKey);
      
      if (!apiKey) {
        ttsVoiceList.innerHTML = '<div class="tts-voice-loading" style="color: #dc2626;">elevenlabs api key not configured. please add your api key in settings.</div>';
        return;
      }

      // Fetch voices from backend
      const response = await fetch(`http://127.0.0.1:3000/tts/voices?apiKey=${encodeURIComponent(apiKey)}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch voices');
      }

      const data = await response.json();
      voices = data.voices || [];
      
      // Render voices
      renderVoices(voices);
      
    } catch (error) {
      console.error('Error loading voices:', error);
      if (ttsVoiceList) {
        ttsVoiceList.innerHTML = '<div class="tts-voice-loading" style="color: #dc2626;">failed to load voices. please check your api key.</div>';
      }
    }
  }

  function renderVoices(voiceList) {
    const ttsVoiceList = document.getElementById('ttsVoiceList');
    if (!ttsVoiceList) return;
    
    // Group voices by category
    const builtInVoices = voiceList.filter(v => v.category === 'premade' || !v.category);
    const clonedVoices = voiceList.filter(v => v.category === 'cloned');
    
    let html = '';
    
    // Clone Voice Button at top
    html += `
      <div class="tts-voice-item clone-btn" data-action="clone-voice">
        <div class="tts-voice-play">
          <i data-lucide="plus"></i>
        </div>
        <div class="tts-voice-info">
          <div class="tts-voice-item-name" style="color: #ffffff;">clone voice</div>
        </div>
        <i data-lucide="arrow-up-right" class="tts-voice-clone-icon"></i>
      </div>
    `;
    
    // Cloned voices section
    if (clonedVoices.length > 0) {
      html += '<div class="tts-voice-category">';
      html += `<div class="tts-voice-category-title">cloned voices (${clonedVoices.length})</div>`;
      clonedVoices.forEach(voice => {
        html += renderVoiceItem(voice, true);
      });
      html += '</div>';
    }
    
    // Built-in voices section
    if (builtInVoices.length > 0) {
      html += '<div class="tts-voice-category">';
      html += `<div class="tts-voice-category-title">eleven labs (${builtInVoices.length})</div>`;
      builtInVoices.forEach(voice => {
        html += renderVoiceItem(voice, false);
      });
      html += '</div>';
    }
    
    ttsVoiceList.innerHTML = html;
    
    // Add click handlers
    document.querySelectorAll('.tts-voice-item[data-action="clone-voice"]').forEach(item => {
      item.addEventListener('click', () => {
        openVoiceCloneModal();
      });
    });
    
    document.querySelectorAll('.tts-voice-item[data-voice-id]').forEach(item => {
      item.addEventListener('click', () => {
        const voiceId = item.dataset.voiceId;
        const voiceName = item.dataset.voiceName;
        selectVoice(voiceId, voiceName);
      });
    });
    
    // Initialize Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function renderVoiceItem(voice, isCloned) {
    const isSelected = voice.voice_id === selectedVoiceId;
    
    return `
      <div class="tts-voice-item ${isSelected ? 'selected' : ''}" data-voice-id="${voice.voice_id}" data-voice-name="${voice.name}">
        <div class="tts-voice-play">
          <i data-lucide="play"></i>
        </div>
        <div class="tts-voice-info">
          <div class="tts-voice-item-name">
            ${voice.name.toLowerCase()}${isSelected ? ' <span class="current-label">(current)</span>' : ''}
          </div>
        </div>
        ${isCloned ? `
          <div class="tts-voice-delete" data-voice-id="${voice.voice_id}" onclick="event.stopPropagation(); deleteVoice('${voice.voice_id}')">
            <i data-lucide="trash-2"></i>
          </div>
        ` : ''}
      </div>
    `;
  }

  function selectVoice(voiceId, voiceName) {
    selectedVoiceId = voiceId;
    selectedVoiceName = voiceName;
    
    const ttsSelectedVoice = document.getElementById('ttsSelectedVoice');
    if (ttsSelectedVoice) {
      ttsSelectedVoice.textContent = voiceName.toLowerCase();
    }
    
    closeVoiceSelector();
  }

  function openVoiceCloneModal() {
    const ttsVoiceCloneOverlay = document.getElementById('ttsVoiceCloneOverlay');
    if (ttsVoiceCloneOverlay) {
      closeVoiceSelector(); // Close voice selector first
      ttsVoiceCloneOverlay.style.display = 'flex';
      
      // Initialize Lucide icons
      if (window.lucide) {
        window.lucide.createIcons();
      }
      
      // Show info toast
      if (window.showToast) {
        window.showToast('voice cloning requires elevenlabs professional plan', 'info');
      }
    }
  }

  function closeVoiceCloneModal() {
    const ttsVoiceCloneOverlay = document.getElementById('ttsVoiceCloneOverlay');
    if (ttsVoiceCloneOverlay) {
      ttsVoiceCloneOverlay.style.display = 'none';
    }
  }

  function deleteVoice(voiceId) {
    if (confirm('Are you sure you want to delete this custom voice?')) {
      // Note: Voice deletion requires ElevenLabs API integration
      if (window.showToast) {
        window.showToast('voice deletion requires backend implementation', 'info');
      }
    }
  }

  // Expose delete function globally for onclick handler
  window.deleteVoice = deleteVoice;

  async function generateTTS() {
    const ttsTextInput = document.getElementById('ttsTextInput');
    if (!ttsTextInput) return;
    
    const text = ttsTextInput.value.trim();
    if (!text) {
      if (window.showToast) {
        window.showToast('please enter some text first', 'error');
      }
      return;
    }

    if (!selectedVoiceId) {
      if (window.showToast) {
        window.showToast('please select a voice', 'error');
      }
      return;
    }
    
    try {
      // Get ElevenLabs API key from localStorage
      const settings = JSON.parse(localStorage.getItem('syncSettings') || '{}');
      const apiKey = settings.elevenlabsApiKey;
      
      console.log('Generating TTS, API key found:', !!apiKey);
      
      if (!apiKey) {
        if (window.showToast) {
          window.showToast('elevenlabs api key not configured', 'error');
        }
        return;
      }
      
      // Show loading state
      const ttsPreviewBtn = document.getElementById('ttsPreviewBtn');
      if (ttsPreviewBtn) {
        ttsPreviewBtn.disabled = true;
        ttsPreviewBtn.innerHTML = '<div class="tts-progress-spinner"></div>';
      }
      
      // Call backend API
      const response = await fetch('http://127.0.0.1:3000/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voiceId: selectedVoiceId,
          model: 'eleven_turbo_v2_5',
          apiKey: apiKey,
          voiceSettings: {
            stability: voiceSettings.stability,
            similarity_boost: voiceSettings.similarityBoost
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate speech');
      }
      
      const data = await response.json();
      
      // Hide TTS interface and show audio preview
      hideTTSInterface();
      
      // Load the generated audio into the audio preview
      if (window.loadAudioFile) {
        await window.loadAudioFile(data.audioPath, false);
      }
      
      if (window.showToast) {
        window.showToast('tts audio generated successfully!', 'success');
      }
      
    } catch (error) {
      console.error('TTS generation error:', error);
      if (window.showToast) {
        window.showToast('failed to generate speech: ' + error.message, 'error');
      }
    } finally {
      // Reset button state
      const ttsPreviewBtn = document.getElementById('ttsPreviewBtn');
      if (ttsPreviewBtn) {
        ttsPreviewBtn.disabled = false;
        ttsPreviewBtn.innerHTML = '<i data-lucide="audio-lines"></i>';
        if (window.lucide) {
          window.lucide.createIcons();
        }
      }
    }
  }

  // Initialize on page load
  initTTS();

  // Fallback initialization for dynamically loaded content
  window.addEventListener('load', () => {
    setTimeout(() => {
      setupTTSEventListeners();
    }, 500);
  });

  // Export functions for external use
  window.TTSInterface = {
    show: showTTSInterface,
    hide: hideTTSInterface
  };
  
  console.log('TTSInterface exported:', typeof window.TTSInterface);
  if (window.debugLog) window.debugLog('tts_interface_exported', { interfaceType: typeof window.TTSInterface });

})();