/**
 * Thumbnail generation and caching for history items
 */

// Cache directory in Application Support
const CACHE_DIR = 'sync. extensions/sync-thumbnails';

/**
 * Logs to file using the debug system
 */
function logToFile(message) {
  try {
    if (typeof window.logToFile === 'function') {
      window.logToFile(message);
    } else {
      console.log(message);
    }
  } catch(e) {
    console.log(message);
  }
}

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
    logToFile(`Failed to get cache dir: ${e.message}`);
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
    logToFile(`Failed to ensure cache dir: ${e.message}`);
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
    logToFile(`[Thumbnails] Generating thumbnail for: ${jobId} from URL: ${videoUrl}`);
    
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
        logToFile(`[Thumbnails] Thumbnail generation timeout for: ${jobId}`);
        resolveOnce(null);
      }, 10000);
      
      video.onloadedmetadata = () => {
        logToFile(`[Thumbnails] Video metadata loaded, seeking for: ${jobId}`);
        try {
          // Seek to 0.5 seconds to avoid black frames
          video.currentTime = Math.min(0.5, video.duration || 0);
        } catch(e) {
          logToFile(`[Thumbnails] Seek error for ${jobId}: ${e.message}`);
          clearTimeout(timeout);
          resolveOnce(null);
        }
      };
      
      video.onseeked = async () => {
        try {
          logToFile(`[Thumbnails] Seeked successfully, capturing frame for: ${jobId}`);
          
          // Create canvas to capture frame
          const canvas = document.createElement('canvas');
          const maxWidth = 200; // Low-res thumbnail
          
          if (!video.videoWidth || !video.videoHeight) {
            logToFile(`[Thumbnails] Invalid video dimensions for: ${jobId}`);
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
          logToFile(`[Thumbnails] Thumbnail generated successfully for: ${jobId}`);
          
          clearTimeout(timeout);
          resolveOnce(dataUrl);
        } catch(e) {
          logToFile(`[Thumbnails] Frame capture error for ${jobId}: ${e.message}`);
          clearTimeout(timeout);
          resolveOnce(null);
        }
      };
      
      video.onerror = (e) => {
        logToFile(`[Thumbnails] Video load error for job: ${jobId} - Error: ${e.type || 'unknown'}`);
        clearTimeout(timeout);
        resolveOnce(null);
      };
      
      // Set video source and start loading
      try {
        video.src = videoUrl;
        video.load();
      } catch(e) {
        logToFile(`[Thumbnails] Failed to set video source for ${jobId}: ${e.message}`);
        clearTimeout(timeout);
        resolveOnce(null);
      }
    });
  } catch(e) {
    logToFile(`[Thumbnails] Generate error for ${jobId}: ${e.message}`);
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
  if (!thumbnailPath) {
    logToFile(`[Thumbnails] No thumbnail path for job: ${jobId}`);
    return null;
  }
  
  logToFile(`[Thumbnails] Checking if thumbnail exists at: ${thumbnailPath}`);
  
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
            logToFile(`[Thumbnails] Thumbnail file exists, reading: ${jobId}`);
            // File exists, read it and convert to data URL
            const readFn = isAE ? 'AEFT_readThumbnail' : 'PPRO_readThumbnail';
            cs.evalScript(`${readFn}(${JSON.stringify(thumbnailPath)})`, (readResult) => {
              try {
                const readR = JSON.parse(readResult);
                if (readR && readR.ok && readR.dataUrl) {
                  logToFile(`[Thumbnails] Successfully loaded cached thumbnail: ${jobId}`);
                  resolve(readR.dataUrl);
                } else {
                  logToFile(`[Thumbnails] Failed to read cached thumbnail for: ${jobId}`);
                  resolve(null);
                }
              } catch(e) {
                logToFile(`[Thumbnails] Read parse error for: ${jobId} - ${e.message}`);
                resolve(null);
              }
            });
          } else {
            logToFile(`[Thumbnails] Thumbnail file does not exist: ${jobId}`);
            resolve(null);
          }
        } catch(e) {
          logToFile(`[Thumbnails] Exists parse error: ${e.message}`);
          resolve(null);
        }
      });
    });
  } catch(e) {
    logToFile(`[Thumbnails] Load error: ${e.message}`);
    return null;
  }
}

/**
 * Generates thumbnails for a batch of jobs
 */
async function generateThumbnailsForJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    logToFile('[Thumbnails] No jobs to generate thumbnails for');
    return;
  }
  
  logToFile(`[Thumbnails] Starting generation for batch: ${jobs.length} jobs`);
  
  // Only process completed jobs
  const completedJobs = jobs.filter(j => j && j.status === 'completed' && j.id && (j.outputPath || j.videoPath));
  logToFile(`[Thumbnails] Completed jobs with video: ${completedJobs.length}`);
  
  for (const job of completedJobs) {
    try {
      logToFile(`[Thumbnails] Processing job: ${job.id} - outputPath: ${job.outputPath || 'none'}, videoPath: ${job.videoPath || 'none'}, status: ${job.status}`);
      
      // Check for cached thumbnail first
      logToFile(`[Thumbnails] Checking cache for job: ${job.id}`);
      const existing = await loadThumbnail(job.id);
      if (existing) {
        logToFile(`[Thumbnails] Using cached thumbnail: ${job.id}`);
        updateCardThumbnail(job.id, existing);
        continue;
      } else {
        logToFile(`[Thumbnails] No cached thumbnail found, generating new one for: ${job.id}`);
      }
      
      // Try to generate from outputPath or videoPath
      const videoUrl = job.outputPath || job.videoPath;
      if (!videoUrl) {
        logToFile(`[Thumbnails] No video URL for job: ${job.id}`);
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
        logToFile(`[Thumbnails] HTTP URL detected, will try with CORS: ${videoUrl}`);
        // We'll try to load it directly - many CDNs support CORS
        // If it fails, the onerror handler will hide the loader
      } else if (videoUrl.startsWith('file://')) {
        finalVideoUrl = videoUrl;
      } else {
        // Local path without file:// prefix
        finalVideoUrl = 'file://' + videoUrl;
      }
      
      logToFile(`[Thumbnails] Generating thumbnail from: ${finalVideoUrl}`);
      const thumbnailDataUrl = await generateThumbnail(finalVideoUrl, job.id);
      if (thumbnailDataUrl) {
        logToFile(`[Thumbnails] Generated thumbnail successfully for: ${job.id}`);
        updateCardThumbnail(job.id, thumbnailDataUrl);
        
        // Cache the generated thumbnail
        try {
          await cacheThumbnail(job.id, thumbnailDataUrl);
        } catch(e) {
          logToFile(`[Thumbnails] Failed to cache thumbnail: ${e.message}`);
        }
      } else {
        logToFile(`[Thumbnails] Failed to generate thumbnail, showing placeholder for: ${job.id}`);
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
      logToFile(`[Thumbnails] Error processing job: ${job.id} - ${e.message}`);
    }
  }
  
  logToFile('[Thumbnails] Batch generation complete');
}

/**
 * Caches a thumbnail to disk
 */
async function cacheThumbnail(jobId, thumbnailDataUrl) {
  try {
    const thumbnailPath = await getThumbnailPath(jobId);
    if (!thumbnailPath) {
      logToFile(`[Thumbnails] No cache path available for: ${jobId}`);
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
            logToFile(`[Thumbnails] Cached thumbnail successfully: ${jobId}`);
            resolve(true);
          } else {
            logToFile(`[Thumbnails] Failed to cache thumbnail: ${r?.error || 'unknown error'}`);
            resolve(false);
          }
        } catch(e) {
          logToFile(`[Thumbnails] Cache parse error: ${e.message}`);
          resolve(false);
        }
      });
    });
  } catch(e) {
    logToFile(`[Thumbnails] Cache error: ${e.message}`);
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
    logToFile(`[Thumbnails] Card not found for job: ${jobId}`);
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
    logToFile(`[Thumbnails] Updating card thumbnail: ${jobId} - ${thumbnailUrl}`);
    img.onload = () => {
      img.style.opacity = '1';
    };
    img.onerror = () => {
      logToFile(`[Thumbnails] Failed to load image: ${thumbnailUrl}`);
      img.style.opacity = '0';
    };
    img.src = thumbnailUrl;
  } else {
    logToFile(`[Thumbnails] Image element not found for job: ${jobId}`);
  }
}

// Expose functions globally
window.generateThumbnailsForJobs = generateThumbnailsForJobs;
window.updateCardThumbnail = updateCardThumbnail;
window.loadThumbnail = loadThumbnail;
window.cacheThumbnail = cacheThumbnail;

