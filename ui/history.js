// History Tab Management
// Handles rendering and pagination of job/generation history

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

// Pagination state
window.historyState = {
  allJobs: [],
  displayedCount: 0,
  pageSize: 10,
  isLoading: false,
  hasMore: true,
  isLoadingFromServer: false
};

/**
 * Updates the history display
 */
window.updateHistory = async function() {
  console.log('[History] updateHistory called');
  const historyList = document.getElementById('historyList');
  if (!historyList) {
    console.warn('[History] historyList element not found');
    return;
  }
  
  // Determine if we already have visible items to avoid flashing UI
  // Only count actual job cards, not loading or empty states
  let hasRenderedItems = false;
  try { hasRenderedItems = /history-card/.test(historyList.innerHTML); } catch(_){ hasRenderedItems = false; }
  
  const isShowingLoading = /history-loading-state/.test(historyList.innerHTML);
  const isShowingEmpty = /history-empty-state/.test(historyList.innerHTML);
  
  // Check API key first
  const settingsStr = localStorage.getItem('syncSettings') || '{}';
  const settings = JSON.parse(settingsStr);
  // Check both old and new property names for backwards compatibility
  const apiKey = settings.syncApiKey || settings.apiKey || '';
  
  console.log('[History] API key check:', { 
    hasApiKey: !!apiKey, 
    apiKeyLength: apiKey.length,
    settingsStr: settingsStr,
    settingsKeys: Object.keys(settings),
    hasSyncApiKey: !!settings.syncApiKey,
    hasLegacyApiKey: !!settings.apiKey
  });
  
  // Debug logging
  console.log('[History] Checking API key:', {
    hasSettings: !!settingsStr && settingsStr !== '{}',
    settingsKeys: Object.keys(settings),
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey ? apiKey.length : 0,
    hasSyncApiKey: !!settings.syncApiKey,
    hasOldApiKey: !!settings.apiKey
  });
  
  if (!apiKey) {
    historyList.innerHTML = `
      <div class="history-empty-state">
        <div class="history-empty-icon icon-key">
          <i data-lucide="key-round"></i>
        </div>
        <div class="history-empty-message">
          please add your api key in <a onclick="showTab('settings')">settings</a>.
        </div>
      </div>
    `;
    // Initialize lucide icons
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      requestAnimationFrame(() => {
  lucide.createIcons();
});
    }
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
        historyList.innerHTML = `
          <div class="history-empty-state">
            <div class="history-empty-icon">
              <i data-lucide="wifi-off"></i>
            </div>
            <div class="history-empty-message">
              hmm... you might be offline, or<br>
              the local server is down. <a onclick="if(window.nle && typeof window.nle.startBackend === 'function') { window.nle.startBackend(); }">fix this</a>
            </div>
          </div>
        `;
        // Initialize lucide icons
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
          requestAnimationFrame(() => {
  lucide.createIcons();
});
        }
      }
      try { if (window.nle && typeof window.nle.startBackend === 'function') { await window.nle.startBackend(); } } catch(_){ }
      return;
    }
  } catch(_){ 
    if (!hasRenderedItems) {
      historyList.innerHTML = `
        <div class="history-empty-state">
          <div class="history-empty-icon">
            <i data-lucide="wifi-off"></i>
          </div>
          <div class="history-empty-message">
            hmm... you might be offline, or<br>
            the local server is down. <a onclick="if(window.nle && typeof window.nle.startBackend === 'function') { window.nle.startBackend(); }">fix this</a>
          </div>
        </div>
      `;
      // Initialize lucide icons
      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        requestAnimationFrame(() => {
  lucide.createIcons();
});
      }
    }
    return;
  }
  
  // If we have an API key but no jobs loaded yet, load from server
  if (apiKey && (!window.jobs || window.jobs.length === 0) && !window.historyState.isLoadingFromServer) {
    console.log('[History] API key present but no jobs loaded, fetching from server...');
    
    // Always show loading state when fetching from server
    historyList.innerHTML = `
      <div class="history-loading-state">
        ${loaderHTML({ size: 'lg', color: 'white' })}
        <div class="history-loading-text">loading your generations...</div>
      </div>
    `;
    
    window.historyState.isLoadingFromServer = true;
    try {
      if (typeof window.loadJobsFromServer === 'function') {
        await window.loadJobsFromServer();
      }
    } catch(e) {
      console.warn('[History] Failed to load jobs from server:', e);
    }
    // Don't clear isLoadingFromServer here - let renderHistoryPage handle it
  }
  
  // Get jobs from global window.jobs array
  const currentJobs = window.jobs || [];
  console.log('[History] Current jobs:', { count: currentJobs.length, jobs: currentJobs });
  
  // Sort jobs by created date (newest first)
  const sorted = currentJobs.slice().sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
  
  // Check if data has actually changed (compare with existing state)
  const existingJobIds = window.historyState.allJobs.map(j => j.id).join(',');
  const newJobIds = sorted.map(j => j.id).join(',');
  const dataChanged = existingJobIds !== newJobIds || window.historyState.allJobs.length !== sorted.length;
  
  // Also check if any job statuses have changed
  let statusChanged = false;
  if (!dataChanged && window.historyState.allJobs.length === sorted.length) {
    for (let i = 0; i < sorted.length; i++) {
      const oldJob = window.historyState.allJobs[i];
      const newJob = sorted[i];
      if (oldJob && newJob && oldJob.id === newJob.id && oldJob.status !== newJob.status) {
        statusChanged = true;
        break;
      }
    }
  }
  
  window.historyState.allJobs = sorted;
  
  // Only show empty state if we've actually loaded from server and still have no jobs
  if (sorted.length === 0) {
    console.log('[History] No jobs found, showing empty state');
    historyList.innerHTML = `
      <div class="history-empty-state">
        <div class="history-empty-icon">
          <i data-lucide="clapperboard"></i>
        </div>
        <div class="history-empty-message">
          no generations yet. <a onclick="showTab('sources')">get started</a>
        </div>
      </div>
    `;
    // Initialize lucide icons
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      requestAnimationFrame(() => {
  lucide.createIcons();
});
    }
    return;
  }
  
  // Only re-render if data actually changed or status changed
  if (!hasRenderedItems) {
    // First time loading - render directly (don't clear loading state yet)
    console.log('[History] First time loading - rendering initial page');
    window.historyState.displayedCount = 0;
    await renderHistoryPage();
  } else if (dataChanged || statusChanged) {
    // Data changed - re-render
    console.log('[History] Data changed - re-rendering from start');
    window.historyState.displayedCount = 0;
    historyList.innerHTML = '';
    await renderHistoryPage();
  } else {
    console.log('[History] No changes detected - skipping render');
  }
  // Otherwise, do nothing - silent refresh (data hasn't changed)
}

/**
 * Renders a page of history items
 */
window.renderHistoryPage = async function() {
  const historyList = document.getElementById('historyList');
  if (!historyList) {
    console.warn('[History] historyList not found, cannot render');
    return;
  }
  
  const { allJobs, displayedCount, pageSize } = window.historyState;
  const endIndex = Math.min(displayedCount + pageSize, allJobs.length);
  const jobsToRender = allJobs.slice(displayedCount, endIndex);
  
  console.log('[History] Rendering page:', {
    startIndex: displayedCount,
    endIndex: endIndex,
    toRender: jobsToRender.length,
    hasMore: endIndex < allJobs.length
  });
  
  // Create cards in memory but DON'T add to DOM yet
  const cardsFragment = document.createDocumentFragment();
  const cardsToAdd = [];
  
  jobsToRender.forEach(job => {
    const card = window.createHistoryCard(job);
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.3s ease';
    cardsToAdd.push(card);
    cardsFragment.appendChild(card);
  });
  
  // Update state before thumbnail generation
  window.historyState.displayedCount = endIndex;
  window.historyState.hasMore = endIndex < allJobs.length;
  
  // Temporarily add cards to DOM for thumbnail generation (but keep them hidden)
  // We need to add them for the thumbnail code to find the elements
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'absolute';
  tempContainer.style.visibility = 'hidden';
  tempContainer.style.pointerEvents = 'none';
  tempContainer.style.height = '0';
  tempContainer.style.overflow = 'hidden';
  cardsToAdd.forEach(card => tempContainer.appendChild(card));
  historyList.appendChild(tempContainer);
  
  // Generate thumbnails while cards are in hidden container
  if (typeof window.generateThumbnailsForJobs === 'function') {
    const thumbnailPromise = window.generateThumbnailsForJobs(jobsToRender).catch(e => {
      console.error('[History] Thumbnail generation error:', e);
    });
    
    // Wait for thumbnails with max 5 second timeout
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.race([thumbnailPromise, timeoutPromise]);
    console.log('[History] Thumbnails ready, adding cards to DOM');
  }
  
  // Handle loading state fade-out and history fade-in
  const isShowingLoading = /history-loading-state/.test(historyList.innerHTML);
  if (isShowingLoading) {
    // Fade out loading state over 1 second
    const loadingElement = historyList.querySelector('.history-loading-state');
    if (loadingElement) {
      loadingElement.style.transition = 'opacity 1s ease-out';
      loadingElement.style.opacity = '0';
      
      // After fade-out completes, clear and add cards
      setTimeout(() => {
        historyList.innerHTML = '';
        
        // Move cards from temp container to actual DOM
        cardsToAdd.forEach(card => {
          historyList.appendChild(card);
        });
        
        // Remove temp container
        tempContainer.remove();
        
        // Fade in all the cards over 1 second
        setTimeout(() => {
          cardsToAdd.forEach(card => {
            card.style.transition = 'opacity 1s ease-in';
            card.style.opacity = '1';
          });
        }, 10);
      }, 1000);
    } else {
      // Fallback if loading element not found
      historyList.innerHTML = '';
      cardsToAdd.forEach(card => {
        historyList.appendChild(card);
      });
      tempContainer.remove();
      setTimeout(() => {
        cardsToAdd.forEach(card => {
          card.style.opacity = '1';
        });
      }, 10);
    }
  } else {
    // No loading state - add cards directly
    cardsToAdd.forEach(card => {
      historyList.appendChild(card);
    });
    tempContainer.remove();
    setTimeout(() => {
      cardsToAdd.forEach(card => {
        card.style.opacity = '1';
      });
    }, 10);
  }
  
  // Initialize lucide icons for new cards
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    // Use requestAnimationFrame for more reliable timing
    requestAnimationFrame(() => {
      lucide.createIcons();
    });
  }
  
  // Add loader if more items available (after thumbnails are ready)
  if (window.historyState.hasMore) {
    // Only add loader if we're showing the 10th item (or more)
    if (window.historyState.displayedCount >= 10) {
      window.addInfiniteScrollLoader();
    }
  } else {
    window.removeInfiniteScrollLoader();
  }
  
  // Clear loading from server flag after rendering is complete
  window.historyState.isLoadingFromServer = false;
}

/**
 * Creates a history card element for a job
 */
window.createHistoryCard = function(job) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.jobId = job.id;
  
  // Determine status
  const status = String(job.status || 'processing').toLowerCase();
  const isPending = status === 'pending';
  const isProcessing = status === 'processing';
  const isFailed = status === 'failed';
  const isRejected = status === 'rejected';
  const isCompleted = status === 'completed';
  
  // Format timestamp
  const timestamp = formatHistoryTimestamp(job);
  
  // Get model and settings
  const modelText = getModelText(job);
  
  // Build the card HTML
  card.innerHTML = `
    <div class="history-card-inner">
      <div class="history-thumbnail-wrapper">
        ${(isProcessing || isPending) && !window.historyState.isLoadingFromServer ? `
          <div class="history-thumbnail-loader">
            ${loaderHTML({ size: 'sm', color: 'white' })}
          </div>
        ` : (isCompleted && (job.outputPath || job.videoPath)) ? `
          <img src="" alt="Thumbnail" class="history-thumbnail" data-job-id="${job.id}" style="opacity: 0;" />
        ` : ''}
        ${isPending ? `
          <div class="history-status-badge history-status-pending">
            pending
          </div>
        ` : isProcessing ? `
          <div class="history-status-badge history-status-processing">
            processing
          </div>
        ` : isFailed ? `
          <div class="history-status-badge history-status-failed">
            failed
          </div>
        ` : isRejected ? `
          <div class="history-status-badge history-status-rejected">
            rejected
          </div>
        ` : isCompleted ? `
          <div class="history-status-badge history-status-completed">
            completed
          </div>
        ` : ''}
      </div>
      
      <div class="history-card-content">
        <div class="history-card-header">
          <div class="history-timestamp">${timestamp}</div>
          <div class="history-settings">${modelText}</div>
        </div>
        
        <div class="history-card-actions">
          <div class="history-actions-left">
            ${isCompleted && job.outputPath ? `
              <button class="history-btn history-btn-primary" id="save-${job.id}" onclick="saveJob('${job.id}')">
                <i data-lucide="cloud-download"></i>
                <span>save</span>
              </button>
              <button class="history-btn history-btn-primary" id="insert-${job.id}" onclick="insertJob('${job.id}')">
                <i data-lucide="copy-plus"></i>
                <span>insert</span>
              </button>
            ` : `
              <button class="history-btn history-btn-disabled" disabled>
                <i data-lucide="cloud-download"></i>
                <span>save</span>
              </button>
              <button class="history-btn history-btn-disabled" disabled>
                <i data-lucide="copy-plus"></i>
                <span>insert</span>
              </button>
            `}
          </div>
          
          <div class="history-actions-right">
            ${isCompleted && job.outputPath ? `
              <button class="history-btn-icon" 
                      onclick="copyOutputLink('${job.id}')" 
                      title="copy output link">
                <i data-lucide="link"></i>
              </button>
            ` : `
              <button class="history-btn-icon history-btn-disabled" disabled title="copy output link">
                <i data-lucide="link"></i>
              </button>
            `}
            <button class="history-btn-icon" onclick="copyJobId('${job.syncJobId || job.id}')" title="copy job id">
              <span class="history-job-id">id</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  return card;
}

/**
 * Formats the timestamp for a job
 */
function formatHistoryTimestamp(job) {
  if (!job.createdAt) return '';
  
  try {
    const date = new Date(job.createdAt);
    const time = date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    });
    
    // Add duration if completed
    if (job.status === 'completed' && job.completedAt) {
      const created = new Date(job.createdAt);
      const completed = new Date(job.completedAt);
      const durationMs = completed - created;
      const durationStr = formatDuration(durationMs);
      return `${time} on ${dateStr} · took ${durationStr}`;
    }
    
    return `${time} on ${dateStr}`;
  } catch (e) {
    return job.createdAt || '';
  }
}

/**
 * Formats a duration in milliseconds to a human-readable string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    const remainingSeconds = seconds % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}min ${remainingSeconds}sec`;
  } else {
    return `${seconds}sec`;
  }
}

/**
 * Gets the model and settings text for a job
 */
function getModelText(job) {
  const parts = [];
  
  // Add model
  if (job.model) {
    parts.push(job.model);
  }
  
  // Add all options if available
  if (job.options && typeof job.options === 'object') {
    // Sync mode
    if (job.options.sync_mode) {
      parts.push(job.options.sync_mode);
    }
    
    // Active speaker detection
    if (job.options.active_speaker_detection) {
      if (typeof job.options.active_speaker_detection === 'object' && job.options.active_speaker_detection.auto_detect) {
        parts.push('asd');
      } else if (job.options.active_speaker_detection === true) {
        parts.push('asd');
      }
    }
    
    // Obstruction/occlusion detection
    if (job.options.occlusion_detection_enabled || job.options.obstruction_detection_enabled) {
      parts.push('obstruction detection');
    }
    
    // Reasoning
    if (job.options.reasoning_enabled) {
      parts.push('reasoning');
    }
    
    // Temperature (if not default)
    if (job.options.temperature !== undefined && job.options.temperature !== 1) {
      parts.push(`temp: ${job.options.temperature}`);
    }
  }
  
  return parts.join(' · ');
}

/**
 * Adds infinite scroll loader at the bottom
 */
window.addInfiniteScrollLoader = function() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  
  // Remove existing loader if any
  window.removeInfiniteScrollLoader();
  
  // Create loader element
  const loaderDiv = document.createElement('div');
  loaderDiv.className = 'history-infinite-loader';
  loaderDiv.id = 'historyInfiniteLoader';
  loaderDiv.innerHTML = loaderHTML({ size: 'md', color: 'muted' });
  
  historyList.appendChild(loaderDiv);
  
  console.log('[History] Added infinite scroll loader at bottom');
  
  // Set up intersection observer with a small delay to ensure DOM is ready
  setTimeout(() => {
    setupInfiniteScroll();
  }, 50);
}

/**
 * Removes infinite scroll loader
 */
window.removeInfiniteScrollLoader = function() {
  const loader = document.getElementById('historyInfiniteLoader');
  if (loader) loader.remove();
  
  // Clean up observer
  if (window.historyScrollObserver) {
    window.historyScrollObserver.disconnect();
    window.historyScrollObserver = null;
  }
}

/**
 * Sets up infinite scroll using Intersection Observer
 */
function setupInfiniteScroll() {
  const loader = document.getElementById('historyInfiniteLoader');
  if (!loader) {
    console.warn('[History] Cannot setup infinite scroll - loader not found');
    return;
  }
  
  console.log('[History] Setting up intersection observer for loader');
  
  // Clean up existing observer
  if (window.historyScrollObserver) {
    window.historyScrollObserver.disconnect();
    console.log('[History] Disconnected previous observer');
  }
  
  // Create new observer
  window.historyScrollObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !window.historyState.isLoading && window.historyState.hasMore) {
        console.log('[History] Loading more items...', {
          displayedCount: window.historyState.displayedCount,
          totalJobs: window.historyState.allJobs.length,
          hasMore: window.historyState.hasMore
        });
        
        // Mark as loading to prevent concurrent loads
        window.historyState.isLoading = true;
        console.log('[History] Loader intersected! Starting to load next batch');
        
        // Keep loader visible while loading - it will be replaced when renderHistoryPage completes
        // Load next page asynchronously - this will wait for thumbnails to complete (max 5s)
        (async () => {
          try {
            if (typeof window.renderHistoryPage === 'function') {
              await window.renderHistoryPage();
              console.log('[History] Finished rendering next batch');
            }
          } catch (e) {
            console.error('[History] Error rendering page:', e);
          } finally {
            // Mark loading as complete
            window.historyState.isLoading = false;
            console.log('[History] Loading complete, ready for next batch');
          }
        })();
        
        // Break after first intersecting entry to avoid multiple triggers
        break;
      }
    }
  }, {
    root: null,
    rootMargin: '100px',
    threshold: 0.1
  });
  
  window.historyScrollObserver.observe(loader);
  console.log('[History] Now observing loader element');
}

/**
 * Copies text to clipboard using CEP-compatible method
 */
function copyToClipboard(text) {
  // Try multiple methods for CEP compatibility
  try {
    // Method 1: Create temporary textarea (most reliable in CEP)
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (success) return true;
  } catch(e) {
    console.error('Copy method 1 failed:', e);
  }
  
  // Method 2: Clipboard API (may not work in CEP)
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch(e) {
    console.error('Copy method 2 failed:', e);
  }
  
  return false;
}

/**
 * Copies a job ID to clipboard
 */
window.copyJobId = function(jobId) {
  if (!jobId) return;
  
  if (copyToClipboard(jobId)) {
    showToast('job id copied to clipboard');
  } else {
    showToast('failed to copy job id', 'error');
  }
}

/**
 * Copies the output file path/URL to clipboard
 */
window.copyOutputLink = function(jobId) {
  if (!jobId) return;
  
  const job = (window.jobs || []).find(j => String(j.id) === String(jobId));
  if (!job || !job.outputPath) {
    showToast('output path not available', 'error');
    return;
  }
  
  if (copyToClipboard(job.outputPath)) {
    showToast('output link copied to clipboard');
  } else {
    showToast('failed to copy output link', 'error');
  }
}

/**
 * Redoes a generation with the same parameters
 */
window.redoGeneration = async function(jobId) {
  const job = jobs.find(j => String(j.id) === String(jobId));
  if (!job) {
    showToast('job not found', 'error');
    return;
  }
  
  try {
    // Set the video and audio from the original job
    if (job.videoPath) {
      selectedVideo = job.videoPath;
      window.uploadedVideoUrl = job.videoUrl;
      selectedVideoIsTemp = job.isTempVideo || false;
    }
    
    if (job.audioPath) {
      selectedAudio = job.audioPath;
      window.uploadedAudioUrl = job.audioUrl;
      selectedAudioIsTemp = job.isTempAudio || false;
    }
    
    // Set model and options
    if (job.model) {
      const modelRadio = document.querySelector(`input[name="model"][value="${job.model}"]`);
      if (modelRadio) modelRadio.checked = true;
    }
    
    if (job.temperature !== undefined) {
      const tempSlider = document.getElementById('modelTemperature') || document.getElementById('temperature');
      if (tempSlider) tempSlider.value = job.temperature;
    }
    
    if (job.options) {
      if (job.options.sync_mode) {
        const syncModeSelect = document.getElementById('syncMode');
        if (syncModeSelect) syncModeSelect.value = job.options.sync_mode;
      }
      
      if (job.options.active_speaker_detection !== undefined) {
        const asdCheckbox = document.getElementById('activeSpeakerOnly');
        if (asdCheckbox) asdCheckbox.checked = job.options.active_speaker_detection.auto_detect || false;
      }
      
      if (job.options.occlusion_detection_enabled !== undefined) {
        const obstructionCheckbox = document.getElementById('detectObstructions');
        if (obstructionCheckbox) obstructionCheckbox.checked = job.options.occlusion_detection_enabled;
      }
    }
    
    // Switch to sources tab and update UI
    showTab('sources');
    updateInputStatus();
    renderInputPreview();
    
    showToast('generation parameters restored. ready to lipsync!');
  } catch (e) {
    console.error('Failed to redo generation:', e);
    showToast('failed to restore generation parameters', 'error');
  }
}

/**
 * Shows a toast notification
 */
window.showToast = function(message, type = 'success') {
  // Remove any existing toast
  const existingToast = document.querySelector('.history-toast');
  if (existingToast) existingToast.remove();
  
  const toast = document.createElement('div');
  toast.className = `history-toast history-toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
      
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
