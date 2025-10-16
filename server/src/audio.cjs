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

// Minimal AIFF (AIFF/AIFC PCM) -> WAV converter implemented in pure Node.
const BASE_DIR = process.env.SYNC_EXTENSIONS_DIR || platformAppData('sync. extensions');
const LOGS_DIR = require('path').join(BASE_DIR, 'logs');
try { require('fs').mkdirSync(LOGS_DIR, { recursive: true }); } catch(_){ }
// Flag file only (shared with server)
const DEBUG = (function(){
  try{
    const fs2 = require('fs');
    const flag = require('path').join(LOGS_DIR, 'debug.enabled');
    return fs2.existsSync(flag);
  }catch(_){ return false; }
})();
const DEBUG_LOG = require('path').join(LOGS_DIR, 'sync_ae_debug.log');
function tlog(){
  if (!DEBUG) return;
  try{
    const line = `[${new Date().toISOString()}] [audio.js] ` + Array.from(arguments).map(a=>String(a)).join(' ') + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  }catch(_){ }
}

// Supports AIFF 'NONE' (big-endian PCM) and AIFC 'sowt' (little-endian PCM).
// Bits per sample: 8/16/24/32. Streams without loading full file into memory.

function readUInt32BE(buf, off){ return buf.readUInt32BE(off); }
function readUInt16BE(buf, off){ return buf.readUInt16BE(off); }

function readFloat80BE(buf, off){
  // Reads 80-bit extended float (big-endian) → JS Number (approximate).
  const b0 = buf[off];
  const b1 = buf[off+1];
  const sign = (b0 & 0x80) ? -1 : 1;
  const exp = ((b0 & 0x7F) << 8) | b1;
  const hi = buf.readUInt32BE(off+2);
  const lo = buf.readUInt32BE(off+6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  if (exp === 0x7FFF) return sign * Infinity;
  // Mantissa is 1.integer(63 bits)
  const mantissa = (hi * Math.pow(2, 32)) + lo; // up to 2^64, precision ok after scaling below
  const frac = mantissa / Math.pow(2, 63);
  return sign * frac * Math.pow(2, exp - 16383);
}

function parseAiffHeader(fd){
  // Returns metadata and SSND data position
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  if (head.toString('ascii', 0, 4) !== 'FORM') throw new Error('Not an AIFF file');
  const formType = Buffer.alloc(4);
  fs.readSync(fd, formType, 0, 4, 8);
  const isAIFC = formType.toString('ascii') === 'AIFC';
  if (!(isAIFC || formType.toString('ascii') === 'AIFF')) throw new Error('Unsupported AIFF FORM');

  let pos = 12;
  let numChannels = 0, numFrames = 0, sampleSize = 0, sampleRate = 0;
  let compressionType = 'NONE';
  let ssndOffset = -1, ssndDataStart = -1, ssndDataSize = 0;

  const stat = fs.fstatSync(fd);
  const fileSize = stat.size;
  while (pos + 8 <= fileSize) {
    const hdr = Buffer.alloc(8);
    fs.readSync(fd, hdr, 0, 8, pos);
    const ckId = hdr.toString('ascii', 0, 4);
    const ckSize = readUInt32BE(hdr, 4);
    const ckStart = pos + 8;

    if (ckId === 'COMM') {
      const comm = Buffer.alloc(Math.min(ckSize, 64));
      fs.readSync(fd, comm, 0, comm.length, ckStart);
      numChannels = readUInt16BE(comm, 0);
      numFrames = readUInt32BE(comm, 2);
      sampleSize = readUInt16BE(comm, 6);
      sampleRate = readFloat80BE(comm, 8);
      if (isAIFC && ckSize >= 22) {
        // compressionType is 4 bytes immediately after 80-bit rate
        const cTypeBuf = Buffer.alloc(4);
        fs.readSync(fd, cTypeBuf, 0, 4, ckStart + 18);
        compressionType = cTypeBuf.toString('ascii');
      }
    } else if (ckId === 'SSND') {
      const ssndHdr = Buffer.alloc(8);
      fs.readSync(fd, ssndHdr, 0, 8, ckStart);
      const offset = readUInt32BE(ssndHdr, 0);
      // const blockSize = readUInt32BE(ssndHdr, 4); // unused
      ssndOffset = offset;
      ssndDataStart = ckStart + 8 + offset;
      // Sample data length may be smaller than chunk if offset present
      ssndDataSize = ckSize - 8 - offset;
    }

    // Chunks are even padded
    pos = ckStart + ckSize + (ckSize % 2);
    if (numChannels && numFrames && sampleSize && ssndDataStart !== -1) break; // we have what we need
  }

  if (numChannels <= 0 || numFrames <= 0 || sampleSize <= 0 || ssndDataStart < 0)
    throw new Error('AIFF missing required chunks');

  if (!isFinite(sampleRate) || sampleRate < 800 || sampleRate > 768000) {
    // Fall back if parsing the 80-bit float failed
    sampleRate = 48000;
  }

  const bytesPerSample = Math.ceil(sampleSize / 8);
  // Use SSND size when present; fall back to frames*channels*bytes if larger
  const pcmBytes = numFrames * numChannels * bytesPerSample;
  let dataBytes = ssndDataSize > 0 ? ssndDataSize : pcmBytes;
  if (!isFinite(dataBytes) || dataBytes <= 0) dataBytes = pcmBytes;
  dataBytes = Math.min(dataBytes, Math.max(0, (fileSize - ssndDataStart)));
  const meta = { isAIFC, compressionType, numChannels, numFrames, sampleSize, sampleRate, bytesPerSample, dataBytes, ssndDataStart };
  try { tlog('parseAiffHeader', JSON.stringify(meta)); } catch(_){ }
  return meta;
}

function writeWavHeader(fd, meta){
  const { numChannels, sampleRate, sampleSize, dataBytes } = meta;
  const blockAlign = Math.ceil(sampleSize/8) * numChannels;
  const byteRate = sampleRate * blockAlign;
  const riffSize = 36 + dataBytes;
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 4, 'ascii');
  buf.writeUInt32LE(riffSize, 4);
  buf.write('WAVE', 8, 4, 'ascii');
  buf.write('fmt ', 12, 4, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM fmt size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(Math.round(sampleRate), 24);
  buf.writeUInt32LE(Math.round(byteRate), 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(sampleSize, 34);
  buf.write('data', 36, 4, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  // Write header and advance file pointer (omit explicit position)
  fs.writeSync(fd, buf, 0, 44);
}

function swapEndianInPlace(buf, bytesPerSample){
  if (bytesPerSample === 1) return buf; // nothing
  const out = Buffer.allocUnsafe(buf.length);
  if (bytesPerSample === 2){
    for (let i=0;i<buf.length;i+=2){ out[i] = buf[i+1]; out[i+1] = buf[i]; }
  } else if (bytesPerSample === 3){
    for (let i=0;i<buf.length;i+=3){ out[i] = buf[i+2]; out[i+1] = buf[i+1]; out[i+2] = buf[i]; }
  } else if (bytesPerSample === 4){
    for (let i=0;i<buf.length;i+=4){ out[i] = buf[i+3]; out[i+1] = buf[i+2]; out[i+2] = buf[i+1]; out[i+3] = buf[i]; }
  } else {
    // Fallback: copy as-is
    buf.copy(out);
  }
  return out;
}

function pcmToInt16Array(buf, bytesPerSample) {
  if (bytesPerSample === 1) {
    const out = new Int16Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      out[i] = (buf[i] - 128) * 256;
    }
    return out;
  } else if (bytesPerSample === 2) {
    return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  } else {
    throw new Error('Unsupported sample size: ' + bytesPerSample);
  }
}

async function convertAiffToWav(srcPath, destPath){
  tlog('convertAiffToWav start', srcPath, '->', destPath||'(auto)');
  const fd = fs.openSync(srcPath, 'r');
  try{
    const meta = parseAiffHeader(fd);
    if (!(meta.compressionType === 'NONE' || meta.compressionType === 'sowt')){
      throw new Error('Unsupported AIFF compression: ' + meta.compressionType);
    }
    const out = destPath || srcPath.replace(/\.[^.]+$/, '.wav');
    const ofd = fs.openSync(out, 'w');
    try{
      writeWavHeader(ofd, meta);
      const chunkSize = 64 * 1024;
      const bytesPerSample = meta.bytesPerSample;
      let remaining = meta.dataBytes;
      let pos = meta.ssndDataStart;
      // Maintain alignment across chunk boundaries
      let leftover = Buffer.alloc(0);
      let totalWritten = 0;
      while (remaining > 0){
        const toRead = Math.min(remaining, chunkSize);
        const buf = Buffer.alloc(toRead);
        const n = fs.readSync(fd, buf, 0, toRead, pos);
        if (!n) break;
        pos += n; remaining -= n;
        let work = buf.slice(0, n);
        if (leftover.length){
          work = Buffer.concat([leftover, work]);
          leftover = Buffer.alloc(0);
        }
        const aligned = Math.floor(work.length / bytesPerSample) * bytesPerSample;
        const body = work.slice(0, aligned);
        leftover = work.slice(aligned);
        // If AIFF big-endian (NONE), swap to little-endian; sowt already LE
        const payload = (meta.compressionType === 'NONE') ? swapEndianInPlace(body, bytesPerSample) : body;
        if (payload.length) { fs.writeSync(ofd, payload); totalWritten += payload.length; }
      }
      if (leftover.length){
        // Drop tail bytes if not aligned (should not happen)
      }
      try { const sz = fs.statSync(out).size; tlog('convertAiffToWav done bytesWritten=', totalWritten, 'fileSize=', sz); } catch(_){ }
    } finally { fs.closeSync(ofd); }
    return destPath || srcPath.replace(/\.[^.]+$/, '.wav');
  } finally { fs.closeSync(fd); }
}

async function convertAiffToMp3(srcPath, destPath){
  tlog('convertAiffToMp3 start', srcPath, '->', destPath||'(auto)');
  const finalPath = destPath || srcPath.replace(/\.[^.]+$/, '.mp3');
  
  // Load lamejs for MP3 encoding (using fixed version with dynamic import)
  let lamejs;
  try {
    lamejs = await import('@breezystack/lamejs');
    tlog('@breezystack/lamejs loaded successfully');
  } catch(e) {
    tlog('Failed to load @breezystack/lamejs:', e.message);
    throw new Error('MP3 encoding requires @breezystack/lamejs dependency: ' + e.message);
  }
  
  // Parse AIFF header to get audio metadata
  const fd = fs.openSync(srcPath, 'r');
  let meta;
  try {
    meta = parseAiffHeader(fd);
    tlog('AIFF meta for MP3:', meta);
    
    if (!(meta.compressionType === 'NONE' || meta.compressionType === 'sowt')) {
      throw new Error('Unsupported AIFF compression: ' + meta.compressionType);
    }
    if (!(meta.bytesPerSample === 1 || meta.bytesPerSample === 2)) {
      throw new Error('MP3 encoder supports 8/16-bit PCM only');
    }
  } finally {
    fs.closeSync(fd);
  }
  
  // Create MP3 encoder with error handling
  let mp3enc;
  try {
    mp3enc = new lamejs.Mp3Encoder(meta.numChannels, Math.round(meta.sampleRate), 192);
    tlog('MP3 encoder created successfully');
  } catch(e) {
    tlog('Failed to create MP3 encoder:', e.message);
    throw new Error('Failed to create MP3 encoder: ' + e.message);
  }
  const mp3Data = [];
  
  // Convert AIFF to MP3
  const fd2 = fs.openSync(srcPath, 'r');
  try {
    const chunkSize = 32 * 1024;
    let remaining = meta.dataBytes;
    let pos = meta.ssndDataStart;
    let leftover = Buffer.alloc(0);
    
    while (remaining > 0) {
      const toRead = Math.min(remaining, chunkSize);
      const buf = Buffer.alloc(toRead);
      const n = fs.readSync(fd2, buf, 0, toRead, pos);
      if (!n) break;
      pos += n; remaining -= n;
      let work = buf.slice(0, n);
      if (leftover.length) {
        work = Buffer.concat([leftover, work]);
        leftover = Buffer.alloc(0);
      }
      const aligned = Math.floor(work.length / meta.bytesPerSample) * meta.bytesPerSample;
      const body = work.slice(0, aligned);
      leftover = work.slice(aligned);
      const payload = (meta.compressionType === 'NONE') ? swapEndianInPlace(body, meta.bytesPerSample) : body;
      if (payload.length) {
        try {
          const samples = pcmToInt16Array(payload, meta.bytesPerSample);
          if (meta.numChannels === 1) {
            const mp3buf = mp3enc.encodeBuffer(samples, samples);
            if (mp3buf.length > 0) mp3Data.push(Buffer.from(mp3buf));
          } else {
            const left = new Int16Array(samples.length / 2);
            const right = new Int16Array(samples.length / 2);
            for (let i = 0; i < samples.length; i += 2) {
              left[i/2] = samples[i];
              right[i/2] = samples[i+1];
            }
            const mp3buf = mp3enc.encodeBuffer(left, right);
            if (mp3buf.length > 0) mp3Data.push(Buffer.from(mp3buf));
          }
        } catch(e) {
          tlog('MP3 encoding error:', e.message);
          throw new Error('MP3 encoding failed: ' + e.message);
        }
      }
    }
    
    try {
      const mp3buf = mp3enc.flush();
      if (mp3buf.length > 0) mp3Data.push(Buffer.from(mp3buf));
    } catch(e) {
      tlog('MP3 flush error:', e.message);
      throw new Error('MP3 flush failed: ' + e.message);
    }
    
    const mp3Buffer = Buffer.concat(mp3Data);
    fs.writeFileSync(finalPath, mp3Buffer);
    tlog('convertAiffToMp3 done bytesWritten=', mp3Buffer.length, 'fileSize=', fs.statSync(finalPath).size);
  } finally {
    fs.closeSync(fd2);
  }

  return finalPath;
}

async function convertWavToMp3(srcPath, destPath){
  tlog('convertWavToMp3 start', srcPath, '->', destPath||'(auto)');
  const finalPath = destPath || srcPath.replace(/\.[^.]+$/, '.mp3');
  
  // Load lamejs for MP3 encoding (using fixed version with dynamic import)
  let lamejs;
  try {
    lamejs = await import('@breezystack/lamejs');
    tlog('@breezystack/lamejs loaded successfully');
  } catch(e) {
    tlog('Failed to load @breezystack/lamejs:', e.message);
    throw new Error('MP3 encoding requires @breezystack/lamejs dependency: ' + e.message);
  }
  
  // Read WAV file
  const fd = fs.openSync(srcPath, 'r');
  try {
    // Read WAV header
    const header = Buffer.alloc(44);
    fs.readSync(fd, header, 0, 44, 0);
    
    // Parse WAV header
    const audioFormat = header.readUInt16LE(20);
    const sampleRate = header.readUInt32LE(24);
    const channels = header.readUInt16LE(22);
    const bitsPerSample = header.readUInt16LE(34);
    const dataSize = header.readUInt32LE(40);
    
    tlog('WAV info:', 'sampleRate=', sampleRate, 'channels=', channels, 'bitsPerSample=', bitsPerSample, 'dataSize=', dataSize);
    
    // Read audio data
    const audioData = Buffer.alloc(dataSize);
    fs.readSync(fd, audioData, 0, dataSize, 44);
    
    // Convert to 16-bit samples
    let samples;
    if (bitsPerSample === 16) {
      samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
    } else if (bitsPerSample === 8) {
      // Convert 8-bit to 16-bit
      samples = new Int16Array(dataSize);
      for (let i = 0; i < dataSize; i++) {
        samples[i] = (audioData[i] - 128) * 256;
      }
    } else if (bitsPerSample === 24) {
      // Convert 24-bit to 16-bit
      const sampleCount = dataSize / 3;
      samples = new Int16Array(sampleCount);
      
      for (let i = 0; i < sampleCount; i++) {
        // Read 24-bit sample (3 bytes) and convert to 16-bit
        // 24-bit samples are typically stored as signed integers
        const byte1 = audioData[i * 3];
        const byte2 = audioData[i * 3 + 1];
        const byte3 = audioData[i * 3 + 2];
        
        // Convert 24-bit signed integer to 16-bit
        // 24-bit range: -8,388,608 to 8,388,607
        let sample24;
        if (byte3 & 0x80) {
          // Negative number - sign extend
          sample24 = (byte3 << 16) | (byte2 << 8) | byte1;
          sample24 |= 0xFF000000; // Sign extend to 32-bit
        } else {
          // Positive number
          sample24 = (byte3 << 16) | (byte2 << 8) | byte1;
        }
        
        // Convert to 16-bit range by dividing by 256 (24-bit to 16-bit scaling)
        const sample16 = Math.max(-32768, Math.min(32767, Math.round(sample24 / 256)));
        samples[i] = sample16;
      }
    } else if (bitsPerSample === 32) {
      // Convert 32-bit to 16-bit
      const sampleCount = dataSize / 4;
      samples = new Int16Array(sampleCount);
      
      // Check if it's 32-bit float or integer by looking at audio format
      const audioFormat = header.readUInt16LE(20);
      const isFloat = audioFormat === 3; // IEEE 754 float
      const isExtensible = audioFormat === 65534; // Extensible WAV format
      
      for (let i = 0; i < sampleCount; i++) {
        let sample16;
        if (isFloat) {
          // 32-bit float: range -1.0 to 1.0
          const sampleFloat = audioData.readFloatLE(i * 4);
          sample16 = Math.max(-32768, Math.min(32767, Math.round(sampleFloat * 32767)));
        } else if (isExtensible) {
          // Extensible WAV format - try both float and integer interpretation
          // First try as float
          const sampleFloat = audioData.readFloatLE(i * 4);
          if (Math.abs(sampleFloat) <= 1.0) {
            // Looks like float data
            sample16 = Math.max(-32768, Math.min(32767, Math.round(sampleFloat * 32767)));
          } else {
            // Looks like integer data
            const sample32 = audioData.readInt32LE(i * 4);
            sample16 = Math.max(-32768, Math.min(32767, Math.round(sample32 / 65536)));
          }
        } else {
          // 32-bit: Check audio format to determine if it's float or integer
          if (audioFormat === 3) {
            // IEEE 754 float: values are between -1.0 and 1.0
            const sampleFloat = audioData.readFloatLE(i * 4);
            sample16 = Math.max(-32768, Math.min(32767, Math.round(sampleFloat * 32767)));
          } else if (audioFormat === 65534) {
            // Extensible WAV format: try to detect if it's float or integer
            const sampleFloat = audioData.readFloatLE(i * 4);
            if (Math.abs(sampleFloat) <= 1.0) {
              // Looks like float data
              sample16 = Math.max(-32768, Math.min(32767, Math.round(sampleFloat * 32767)));
            } else {
              // Looks like integer data
              const sample32 = audioData.readInt32LE(i * 4);
              sample16 = Math.max(-32768, Math.min(32767, Math.round(sample32 / 65536)));
            }
          } else {
            // Standard PCM (audioFormat === 1) or other integer formats
            const sample32 = audioData.readInt32LE(i * 4);
            // For 32-bit integer PCM, divide by 65536 to get proper 16-bit range
            sample16 = Math.max(-32768, Math.min(32767, Math.round(sample32 / 65536)));
          }
        }
        samples[i] = sample16;
      }
    } else {
      // Try to handle other bit depths by scaling appropriately
      const sampleCount = dataSize / (bitsPerSample / 8);
      samples = new Int16Array(sampleCount);
      
      if (bitsPerSample % 8 === 0) {
        // Standard bit depths that are multiples of 8
        const bytesPerSample = bitsPerSample / 8;
        const maxValue = Math.pow(2, bitsPerSample - 1) - 1;
        
        for (let i = 0; i < sampleCount; i++) {
          let sample = 0;
          
          // Read multi-byte sample (little-endian)
          for (let j = 0; j < bytesPerSample; j++) {
            sample |= audioData[i * bytesPerSample + j] << (j * 8);
          }
          
          // Convert to signed if needed
          if (sample > maxValue) {
            sample -= Math.pow(2, bitsPerSample);
          }
          
          // Scale to 16-bit range
          const scaleFactor = maxValue / 32767;
          samples[i] = Math.max(-32768, Math.min(32767, Math.round(sample / scaleFactor)));
        }
      } else {
        throw new Error('Unsupported bits per sample: ' + bitsPerSample + ' (not a multiple of 8)');
      }
    }
    
    // Encode to MP3
    const mp3enc = new lamejs.Mp3Encoder(channels, sampleRate, 192);
    const mp3Data = [];
    
    const blockSize = 1152; // MP3 frame size
    for (let i = 0; i < samples.length; i += blockSize * channels) {
      if (channels === 1) {
        // Mono: use the same data for both channels
        const left = samples.slice(i, i + blockSize);
        const mp3buf = mp3enc.encodeBuffer(left, left);
        if (mp3buf.length > 0) {
          mp3Data.push(Buffer.from(mp3buf));
        }
      } else {
        // Stereo: deinterleave left and right channels
        const left = new Int16Array(blockSize);
        const right = new Int16Array(blockSize);
        
        for (let j = 0; j < blockSize && (i + j * 2 + 1) < samples.length; j++) {
          left[j] = samples[i + j * 2];     // Even indices (0, 2, 4, ...)
          right[j] = samples[i + j * 2 + 1]; // Odd indices (1, 3, 5, ...)
        }
        
        const mp3buf = mp3enc.encodeBuffer(left, right);
        if (mp3buf.length > 0) {
          mp3Data.push(Buffer.from(mp3buf));
        }
      }
    }
    
    // Flush encoder
    const mp3buf = mp3enc.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(Buffer.from(mp3buf));
    }
    
    const mp3Buffer = Buffer.concat(mp3Data);
    fs.writeFileSync(finalPath, mp3Buffer);
    tlog('convertWavToMp3 done bytesWritten=', mp3Buffer.length, 'fileSize=', fs.statSync(finalPath).size);
    
    return finalPath;
  } finally {
    fs.closeSync(fd);
  }
}

async function convertAudio(srcPath, format){
  const ext = String(format||'').toLowerCase();
  const srcExt = path.extname(srcPath).toLowerCase();
  
  if (ext === 'wav') {
    if (srcExt === '.aiff' || srcExt === '.aif') {
      return await convertAiffToWav(srcPath);
    } else if (srcExt === '.wav') {
      return srcPath; // Already WAV
    } else {
      throw new Error('Cannot convert ' + srcExt + ' to WAV');
    }
  }
  
  if (ext === 'mp3') {
    if (srcExt === '.aiff' || srcExt === '.aif') {
      return await convertAiffToMp3(srcPath, null);
    } else if (srcExt === '.wav') {
      return await convertWavToMp3(srcPath, null);
    } else {
      throw new Error('Cannot convert ' + srcExt + ' to MP3');
    }
  }
  
  throw new Error('Unsupported target format: ' + format);
}

module.exports = { convertAudio, convertAiffToWav, convertAiffToMp3, convertWavToMp3 };


