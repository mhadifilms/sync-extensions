/**
 * Thumbnail generation and caching for history items
 */

// Cache directory in Application Support
const CACHE_DIR = 'sync. extensions/sync-thumbnails';

/**
 * Gets the cache directory path from CEP
 */
async function getCacheDir() {
  try {
    if (!window.CSInterface) return null;
    const cs = new CSInterface();
    const userDataPath = cs.getSystemPath(CSInterface.SystemPath.USER_DATA);
    // On macOS: ~/Library/Application Support
    // On Windows: %APPDATA%
    return `${userDataPath}/${CACHE_DIR}`;
  } catch(e) {
    console.error('Failed to get cache dir:', e);
    return null;
  }
}

/**
 * Ensures cache directory exists
 */
async function ensureCacheDir() {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return false;
  
  try {
    // Call host script to create directory if it doesn't exist
    const cs = new CSInterface();
    const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
    const fn = isAE ? 'AEFT_ensureDir' : 'PPRO_ensureDir';
    
    return new Promise((resolve) => {
      cs.evalScript(`${fn}(${JSON.stringify(cacheDir)})`, (result) => {
        try {
          const r = JSON.parse(result);
          resolve(r && r.ok);
        } catch(e) {
          resolve(false);
        }
      });
    });
  } catch(e) {
    console.error('Failed to ensure cache dir:', e);
    return false;
  }
}

/**
 * Generates thumbnail file path for a job
 */
async function getThumbnailPath(jobId) {
  const cacheDir = await getCacheDir();
  if (!cacheDir) return null;
  return `${cacheDir}/${jobId}.jpg`;
}

/**
 * Generates a thumbnail from video URL or path  
 */
async function generateThumbnail(videoUrl, jobId) {
  try {
    console.log('[Thumbnails] Generating thumbnail for:', jobId, 'from URL:', videoUrl);
    
    // Show loader while generating
    const card = document.querySelector(`.history-card[data-job-id="${jobId}"]`);
    if (card) {
      const loader = card.querySelector('.history-thumbnail-loader');
      if (loader) loader.style.display = 'flex';
    }
    
    // Create video element to capture frame
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    // For HTTP URLs, try with and without crossOrigin
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      // Try without crossOrigin first - works for many CDNs
      video.crossOrigin = null;
    } else {
      video.crossOrigin = 'anonymous';
    }
    
    return new Promise((resolve) => {
      let hasResolved = false;
      
      const cleanup = () => {
        try {
          video.pause();
          video.src = '';
          video.load();
        } catch(e) {}
      };
      
      const resolveOnce = (value) => {
        if (!hasResolved) {
          hasResolved = true;
          cleanup();
          resolve(value);
        }
      };
      
      // Timeout after 10 seconds
      const timeout = setTimeout(() => {
        console.warn('[Thumbnails] Thumbnail generation timeout for:', jobId);
        resolveOnce(null);
      }, 10000);
      
      video.onloadedmetadata = () => {
        console.log('[Thumbnails] Video metadata loaded, seeking...');
        try {
          // Seek to 0.5 seconds to avoid black frames
          video.currentTime = Math.min(0.5, video.duration || 0);
        } catch(e) {
          console.error('[Thumbnails] Seek error:', e);
          clearTimeout(timeout);
          resolveOnce(null);
        }
      };
      
      video.onseeked = async () => {
        try {
          console.log('[Thumbnails] Seeked successfully, capturing frame...');
          
          // Create canvas to capture frame
          const canvas = document.createElement('canvas');
          const maxWidth = 200; // Low-res thumbnail
          
          if (!video.videoWidth || !video.videoHeight) {
            console.error('[Thumbnails] Invalid video dimensions');
            clearTimeout(timeout);
            resolveOnce(null);
            return;
          }
          
          const aspectRatio = video.videoHeight / video.videoWidth;
          canvas.width = maxWidth;
          canvas.height = Math.round(maxWidth * aspectRatio);
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Convert to JPEG data URL
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          console.log('[Thumbnails] Thumbnail generated successfully');
          
          clearTimeout(timeout);
          resolveOnce(dataUrl);
        } catch(e) {
          console.error('[Thumbnails] Frame capture error:', e);
          clearTimeout(timeout);
          resolveOnce(null);
        }
      };
      
      video.onerror = (e) => {
        console.warn('[Thumbnails] Video load error for job:', jobId, 'Error:', e.type || 'unknown');
        clearTimeout(timeout);
        resolveOnce(null);
      };
      
      // Set video source and start loading
      try {
        video.src = videoUrl;
        video.load();
      } catch(e) {
        console.error('[Thumbnails] Failed to set video source:', e);
        clearTimeout(timeout);
        resolveOnce(null);
      }
    });
  } catch(e) {
    console.error('[Thumbnails] Generate error:', e);
    // Hide loader on error
    const card = document.querySelector(`.history-card[data-job-id="${jobId}"]`);
    if (card) {
      const loader = card.querySelector('.history-thumbnail-loader');
      if (loader) loader.style.display = 'none';
    }
    return null;
  }
}

/**
 * Loads thumbnail for a job if it exists
 * Returns data URL from cached file
 */
async function loadThumbnail(jobId) {
  const thumbnailPath = await getThumbnailPath(jobId);
  if (!thumbnailPath) return null;
  
  try {
    // Check if thumbnail file exists and read it
    const cs = new CSInterface();
    const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
    const fnExists = isAE ? 'AEFT_fileExists' : 'PPRO_fileExists';
    
    return new Promise((resolve) => {
      cs.evalScript(`${fnExists}(${JSON.stringify(thumbnailPath)})`, (result) => {
        try {
          const r = JSON.parse(result);
          if (r && r.ok && r.exists) {
            // File exists, read it and convert to data URL
            const readFn = isAE ? 'AEFT_readThumbnail' : 'PPRO_readThumbnail';
            cs.evalScript(`${readFn}(${JSON.stringify(thumbnailPath)})`, (readResult) => {
              try {
                const readR = JSON.parse(readResult);
                if (readR && readR.ok && readR.dataUrl) {
                  resolve(readR.dataUrl);
                } else {
                  console.warn('[Thumbnails] Failed to read cached thumbnail');
                  resolve(null);
                }
              } catch(e) {
                console.error('[Thumbnails] Read parse error:', e);
                resolve(null);
              }
            });
          } else {
            resolve(null);
          }
        } catch(e) {
          console.error('[Thumbnails] Exists parse error:', e);
          resolve(null);
        }
      });
    });
  } catch(e) {
    console.error('[Thumbnails] Load error:', e);
    return null;
  }
}

/**
 * Generates thumbnails for a batch of jobs
 */
async function generateThumbnailsForJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    console.log('[Thumbnails] No jobs to generate thumbnails for');
    return;
  }
  
  console.log('[Thumbnails] Starting generation for batch:', jobs.length, 'jobs');
  
  // Only process completed jobs
  const completedJobs = jobs.filter(j => j && j.status === 'completed' && j.id && (j.outputPath || j.videoPath));
  console.log('[Thumbnails] Completed jobs with video:', completedJobs.length);
  
  for (const job of completedJobs) {
    try {
      console.log('[Thumbnails] Processing job:', job.id, {
        outputPath: job.outputPath,
        videoPath: job.videoPath,
        status: job.status
      });
      
      // Check for cached thumbnail first
      const existing = await loadThumbnail(job.id);
      if (existing) {
        console.log('[Thumbnails] Using cached thumbnail:', job.id);
        updateCardThumbnail(job.id, existing);
        continue;
      }
      
      // Try to generate from outputPath or videoPath
      const videoUrl = job.outputPath || job.videoPath;
      if (!videoUrl) {
        console.warn('[Thumbnails] No video URL for job:', job.id);
        // Hide loader if no video
        const card = document.querySelector(`.history-card[data-job-id="${job.id}"]`);
        if (card) {
          const loader = card.querySelector('.history-thumbnail-loader');
          if (loader) loader.style.display = 'none';
        }
        continue;
      }
      
      // For HTTP URLs, try to generate through backend proxy
      let finalVideoUrl = videoUrl;
      if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
        console.log('[Thumbnails] HTTP URL detected, will try with CORS:', videoUrl);
        // We'll try to load it directly - many CDNs support CORS
        // If it fails, the onerror handler will hide the loader
      } else if (videoUrl.startsWith('file://')) {
        finalVideoUrl = videoUrl;
      } else {
        // Local path without file:// prefix
        finalVideoUrl = 'file://' + videoUrl;
      }
      
      console.log('[Thumbnails] Generating thumbnail from:', finalVideoUrl);
      const thumbnailDataUrl = await generateThumbnail(finalVideoUrl, job.id);
      if (thumbnailDataUrl) {
        console.log('[Thumbnails] Generated thumbnail successfully');
        updateCardThumbnail(job.id, thumbnailDataUrl);
        
        // Cache the generated thumbnail
        try {
          await cacheThumbnail(job.id, thumbnailDataUrl);
        } catch(e) {
          console.warn('[Thumbnails] Failed to cache thumbnail:', e);
        }
      } else {
        console.warn('[Thumbnails] Failed to generate thumbnail, showing placeholder for:', job.id);
        // Show placeholder on failure
        const card = document.querySelector(`.history-card[data-job-id="${job.id}"]`);
        if (card) {
          const loader = card.querySelector('.history-thumbnail-loader');
          if (loader) loader.style.display = 'none';
          
          // Replace with placeholder icon
          const wrapper = card.querySelector('.history-thumbnail-wrapper');
          const img = card.querySelector('.history-thumbnail');
          if (img) img.remove();
          
          if (wrapper && !wrapper.querySelector('.history-thumbnail-placeholder')) {
            const placeholder = document.createElement('div');
            placeholder.className = 'history-thumbnail-placeholder';
            placeholder.innerHTML = '<i data-lucide="video"></i>';
            wrapper.appendChild(placeholder);
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
              lucide.createIcons();
            }
          }
        }
      }
    } catch(e) {
      console.error('[Thumbnails] Error processing job:', job.id, e);
    }
  }
  
  console.log('[Thumbnails] Batch generation complete');
}

/**
 * Caches a thumbnail to disk
 */
async function cacheThumbnail(jobId, thumbnailDataUrl) {
  try {
    const thumbnailPath = await getThumbnailPath(jobId);
    if (!thumbnailPath) {
      console.warn('[Thumbnails] No cache path available for:', jobId);
      return false;
    }
    
    // Ensure cache directory exists
    const cacheDir = await getCacheDir();
    if (cacheDir) {
      await ensureCacheDir();
    }
    
    // Save thumbnail using host function
    const cs = new CSInterface();
    const isAE = (window.HOST_CONFIG && window.HOST_CONFIG.isAE);
    const saveFn = isAE ? 'AEFT_saveThumbnail' : 'PPRO_saveThumbnail';
    
    const payload = JSON.stringify({
      path: thumbnailPath,
      dataUrl: thumbnailDataUrl
    });
    
    return new Promise((resolve) => {
      cs.evalScript(`${saveFn}(${payload})`, (result) => {
        try {
          const r = JSON.parse(result);
          if (r && r.ok) {
            console.log('[Thumbnails] Cached thumbnail successfully:', jobId);
            resolve(true);
          } else {
            console.warn('[Thumbnails] Failed to cache thumbnail:', r?.error || 'unknown error');
            resolve(false);
          }
        } catch(e) {
          console.error('[Thumbnails] Cache parse error:', e);
          resolve(false);
        }
      });
    });
  } catch(e) {
    console.error('[Thumbnails] Cache error:', e);
    return false;
  }
}

/**
 * Updates thumbnail for a specific card
 */
function updateCardThumbnail(jobId, thumbnailUrl) {
  if (!thumbnailUrl) return;
  
  // Find the card element
  const card = document.querySelector(`.history-card[data-job-id="${jobId}"]`);
  if (!card) {
    console.log('[Thumbnails] Card not found for job:', jobId);
    return;
  }
  
  // Hide the loader
  const loader = card.querySelector('.history-thumbnail-loader');
  if (loader) {
    loader.style.display = 'none';
  }
  
  // Update the thumbnail image
  const img = card.querySelector(`.history-thumbnail[data-job-id="${jobId}"]`);
  if (img) {
    console.log('[Thumbnails] Updating card thumbnail:', jobId, thumbnailUrl);
    img.onload = () => {
      img.style.opacity = '1';
    };
    img.onerror = () => {
      console.error('[Thumbnails] Failed to load image:', thumbnailUrl);
      img.style.opacity = '0';
    };
    img.src = thumbnailUrl;
  } else {
    console.warn('[Thumbnails] Image element not found for job:', jobId);
  }
}

// Expose functions globally
window.generateThumbnailsForJobs = generateThumbnailsForJobs;
window.updateCardThumbnail = updateCardThumbnail;
window.loadThumbnail = loadThumbnail;
window.cacheThumbnail = cacheThumbnail;

