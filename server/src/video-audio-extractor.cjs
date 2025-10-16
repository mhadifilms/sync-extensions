const fs = require('fs');
const path = require('path');
const os = require('os');

// Use the same app-data logs directory as the server
function platformAppData(appName){
  const home = os.homedir();
  if (process.platform === 'win32') return require('path').join(home, 'AppData', 'Roaming', appName);
  if (process.platform === 'darwin') return require('path').join(home, 'Library', 'Application Support', appName);
  return require('path').join(home, '.config', appName);
}

const BASE_DIR = process.env.SYNC_EXTENSIONS_DIR || platformAppData('sync. extensions');
const LOGS_DIR = require('path').join(BASE_DIR, 'logs');
try { require('fs').mkdirSync(LOGS_DIR, { recursive: true }); } catch(_){ }

const DEBUG = (function(){
  try{
    const fs2 = require('fs');
    const flag = require('path').join(LOGS_DIR, 'debug.enabled');
    return fs2.existsSync(flag);
  }catch(_){ return false; }
})();

const DEBUG_LOG = require('path').join(LOGS_DIR, 'sync_video_extract_debug.log');

function tlog(){
  if (!DEBUG) return;
  try{
    const line = `[${new Date().toISOString()}] [video-extract.js] ` + Array.from(arguments).map(a=>String(a)).join(' ') + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  }catch(_){ }
}

// Fast video-to-audio extraction for MP4/MOV only using Node.js libraries
async function extractAudioFromVideo(videoPath, outputFormat = 'wav') {
  tlog('extractAudioFromVideo start', videoPath, '->', outputFormat);
  
  const ext = path.extname(videoPath).toLowerCase();
  const outputPath = videoPath.replace(/\.[^.]+$/, `.${outputFormat}`);
  
  try {
    // Only support MP4 and MOV as per requirements
    if (ext === '.mp4') {
      return await extractAudioFromMP4(videoPath, outputPath, outputFormat);
    } else if (ext === '.mov') {
      return await extractAudioFromMOV(videoPath, outputPath, outputFormat);
    } else {
      throw new Error(`Unsupported video format: ${ext}. Only MP4 and MOV are supported.`);
    }
  } catch (error) {
    tlog('extractAudioFromVideo error:', error.message);
    throw error;
  }
}

// MP4 audio extraction using FFmpeg
async function extractAudioFromMP4(videoPath, outputPath, format) {
  tlog('extractAudioFromMP4 start', videoPath);
  
  try {
    const { spawn } = require('child_process');
    
    // Use FFmpeg to extract audio properly
    const ffmpegArgs = [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', 'pcm_s16le', // 16-bit PCM
      '-ar', '44100', // Sample rate
      '-ac', '2', // Stereo
      '-f', 'wav', // WAV format
      '-y', // Overwrite output
      outputPath
    ];
    
    tlog('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          tlog('FFmpeg extraction successful');
          resolve(outputPath);
        } else {
          tlog('FFmpeg error:', stderr);
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });
      
      ffmpeg.on('error', (error) => {
        tlog('FFmpeg spawn error:', error.message);
        reject(error);
      });
    });
    
  } catch (error) {
    tlog('extractAudioFromMP4 error:', error.message);
    throw error;
  }
}

// MOV audio extraction using FFmpeg
async function extractAudioFromMOV(videoPath, outputPath, format) {
  tlog('extractAudioFromMOV start', videoPath);
  
  try {
    const { spawn } = require('child_process');
    
    // Use FFmpeg to extract audio properly
    const ffmpegArgs = [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', 'pcm_s16le', // 16-bit PCM
      '-ar', '44100', // Sample rate
      '-ac', '2', // Stereo
      '-f', 'wav', // WAV format
      '-y', // Overwrite output
      outputPath
    ];
    
    tlog('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));
    
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      
      let stderr = '';
      
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          tlog('FFmpeg extraction successful');
          resolve(outputPath);
        } else {
          tlog('FFmpeg error:', stderr);
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });
      
      ffmpeg.on('error', (error) => {
        tlog('FFmpeg spawn error:', error.message);
        reject(error);
      });
    });
    
  } catch (error) {
    tlog('extractAudioFromMOV error:', error.message);
    throw error;
  }
}

// Create WAV file from real audio samples
async function createWavFromSamples(audioSamples, outputPath, trackInfo) {
  tlog('createWavFromSamples start', outputPath, 'samples:', audioSamples.length);
  
  try {
    const sampleRate = trackInfo.sampleRate || 44100;
    const channels = trackInfo.channels || 2;
    const bitsPerSample = trackInfo.bitsPerSample || 16;
    
    // Convert samples to 16-bit PCM data
    const pcmData = Buffer.alloc(audioSamples.length * channels * 2); // 16-bit = 2 bytes per sample
    let offset = 0;
    
    for (const sample of audioSamples) {
      // Convert sample to 16-bit PCM
      const sampleData = sample.data;
      if (sampleData) {
        // Handle different sample formats
        if (sampleData instanceof Int16Array) {
          for (let i = 0; i < sampleData.length; i++) {
            pcmData.writeInt16LE(sampleData[i], offset);
            offset += 2;
          }
        } else if (sampleData instanceof Float32Array) {
          for (let i = 0; i < sampleData.length; i++) {
            const int16Sample = Math.max(-32768, Math.min(32767, Math.round(sampleData[i] * 32767)));
            pcmData.writeInt16LE(int16Sample, offset);
            offset += 2;
          }
        } else if (sampleData instanceof Uint8Array) {
          // Assume 8-bit samples, convert to 16-bit
          for (let i = 0; i < sampleData.length; i++) {
            const int16Sample = (sampleData[i] - 128) * 256;
            pcmData.writeInt16LE(int16Sample, offset);
            offset += 2;
          }
        }
      }
    }
    
    const dataSize = offset;
    const totalSize = 44 + dataSize;
    const buffer = Buffer.alloc(totalSize);
    
    // Write WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byte rate
    buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Copy PCM data
    pcmData.copy(buffer, 44, 0, dataSize);
    
    // Write WAV file
    fs.writeFileSync(outputPath, buffer);
    
    tlog('createWavFromSamples done', outputPath, 'size=', fs.statSync(outputPath).size, 'samples=', audioSamples.length);
    return outputPath;
    
  } catch (error) {
    tlog('createWavFromSamples error:', error.message);
    throw error;
  }
}

// Create WAV file from real audio data
async function createWavFromAudioData(audioData, outputPath, trackInfo) {
  tlog('createWavFromAudioData start', outputPath, 'audioDataSize:', audioData?.length);
  
  try {
    const sampleRate = trackInfo.sampleRate || 44100;
    const channels = trackInfo.channels || 2;
    const bitsPerSample = trackInfo.bitsPerSample || 16;
    
    let pcmData;
    
    if (audioData && audioData.length > 0) {
      // Use real audio data
      tlog('Using real audio data, size:', audioData.length);
      
      // Convert audio data to 16-bit PCM
      if (audioData instanceof Buffer) {
        // Assume it's already PCM data
        pcmData = audioData;
      } else if (audioData instanceof Uint8Array) {
        // Convert Uint8Array to Buffer
        pcmData = Buffer.from(audioData);
      } else {
        // Fallback: create silent audio
        tlog('Unknown audio data format, creating silent audio');
        const duration = 1; // 1 second of silence
        const numSamples = Math.floor(sampleRate * duration * channels);
        const dataSize = numSamples * (bitsPerSample / 8);
        pcmData = Buffer.alloc(dataSize, 0);
      }
    } else {
      // Fallback: create silent audio
      tlog('No audio data, creating silent audio');
      const duration = 1; // 1 second of silence
      const numSamples = Math.floor(sampleRate * duration * channels);
      const dataSize = numSamples * (bitsPerSample / 8);
      pcmData = Buffer.alloc(dataSize, 0);
    }
    
    const dataSize = pcmData.length;
    const totalSize = 44 + dataSize;
    const buffer = Buffer.alloc(totalSize);
    
    // Write WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byte rate
    buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Copy PCM data
    pcmData.copy(buffer, 44, 0, dataSize);
    
    // Write WAV file
    fs.writeFileSync(outputPath, buffer);
    
    tlog('createWavFromAudioData done', outputPath, 'size=', fs.statSync(outputPath).size);
    return outputPath;
    
  } catch (error) {
    tlog('createWavFromAudioData error:', error.message);
    throw error;
  }
}

// Fast WAV to MP3 conversion using optimized lamejs
async function convertWavToMp3(wavPath, mp3Path) {
  tlog('convertWavToMp3 start', wavPath, '->', mp3Path);
  
  try {
    // Use the optimized convertAudio function from audio.cjs
    const { convertAudio } = require('./audio.cjs');
    const result = await convertAudio(wavPath, 'mp3');
    
    // Move the result to the desired path if needed
    if (result !== mp3Path) {
      fs.renameSync(result, mp3Path);
    }
    
    // Clean up temporary WAV file
    try { fs.unlinkSync(wavPath); } catch(_){}
    
    tlog('convertWavToMp3 done', mp3Path);
    return mp3Path;
    
  } catch (error) {
    tlog('convertWavToMp3 error:', error.message);
    throw error;
  }
}

module.exports = { extractAudioFromVideo };
