import fs from 'fs';
import path from 'path';
import os from 'os';

// Minimal AIFF (AIFF/AIFC PCM) -> WAV converter implemented in pure Node.
const DEBUG_LOG = (process.platform === 'win32')
  ? path.join(os.tmpdir(), 'sync_ae_debug.log')
  : '/tmp/sync_ae_debug.log';
function tlog(){
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

export async function convertAiffToWav(srcPath, destPath){
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

export async function convertAiffToMp3(srcPath, destPath){
  tlog('convertAiffToMp3 start', srcPath, '->', destPath||'(auto)');
  // Prefer encoding directly from AIFF sample stream using lamejs (pure JS)
  let lamejs = null;
  try { const mod = await import('lamejs'); lamejs = mod && (mod.default || mod); } catch(_){ }
  if (!lamejs) throw new Error('MP3 encoder not available (lamejs not installed)');

  const fd = fs.openSync(srcPath, 'r');
  try{
    const meta = parseAiffHeader(fd);
    if (!(meta.compressionType === 'NONE' || meta.compressionType === 'sowt')){
      throw new Error('Unsupported AIFF compression: ' + meta.compressionType);
    }
    const out = destPath || srcPath.replace(/\.[^.]+$/, '.mp3');
    const ofd = fs.openSync(out, 'w');
    try{
      const { numChannels, sampleRate, bytesPerSample } = meta;
      if (!(bytesPerSample === 1 || bytesPerSample === 2)){
        throw new Error('MP3 encoder supports 8/16-bit PCM only');
      }
      const mp3enc = new lamejs.Mp3Encoder(numChannels, Math.round(sampleRate), 128);
      const chunkSize = 32 * 1024;
      let remaining = meta.dataBytes;
      let pos = meta.ssndDataStart;
      let leftover = Buffer.alloc(0);
      function pcmToInt16LE(buf){
        if (bytesPerSample === 2) return buf;
        // 8-bit unsigned PCM to 16-bit signed
        const out = Buffer.alloc(buf.length * 2);
        for (let i=0;i<buf.length;i++){
          const v = (buf[i] - 128) << 8; // scale
          out.writeInt16LE(v, i*2);
        }
        return out;
      }
      let totalFrames = 0; let totalBytes = 0;
      while (remaining > 0){
        const toRead = Math.min(remaining, chunkSize);
        const buf = Buffer.alloc(toRead);
        const n = fs.readSync(fd, buf, 0, toRead, pos);
        if (!n) break;
        pos += n; remaining -= n;
        let work = buf.slice(0, n);
        if (leftover.length){ work = Buffer.concat([leftover, buf]); leftover = Buffer.alloc(0); }
        const aligned = Math.floor(work.length / bytesPerSample) * bytesPerSample;
        const body = work.slice(0, aligned);
        leftover = work.slice(aligned);
        const le = (meta.compressionType === 'NONE') ? swapEndianInPlace(body, bytesPerSample) : body;
        const pcm16 = pcmToInt16LE(le);
        // Interleave handling: AIFF PCM is already interleaved per channels.
        // lamejs expects Int16Array per channel or interleaved? Using encodeBuffer expects left/right Int16Array.
        const samples = new Int16Array(pcm16.buffer, pcm16.byteOffset, Math.floor(pcm16.length / 2));
        if (numChannels === 2){
          // deinterleave
          const L = new Int16Array(samples.length/2);
          const R = new Int16Array(samples.length/2);
          for (let i=0,j=0;i<samples.length;i+=2,j++){ L[j]=samples[i]; R[j]=samples[i+1]; }
          const mp3buf = mp3enc.encodeBuffer(L, R);
          if (mp3buf && mp3buf.length) { fs.writeSync(ofd, Buffer.from(mp3buf)); totalBytes += mp3buf.length; totalFrames += L.length; }
        } else {
          const mp3buf = mp3enc.encodeBuffer(samples);
          if (mp3buf && mp3buf.length) { fs.writeSync(ofd, Buffer.from(mp3buf)); totalBytes += mp3buf.length; totalFrames += samples.length; }
        }
      }
      const end = mp3enc.flush();
      if (end && end.length) { fs.writeSync(ofd, Buffer.from(end)); totalBytes += end.length; }
      try { const sz = fs.statSync(out).size; tlog('convertAiffToMp3 done frames=', totalFrames, 'bytes=', totalBytes, 'fileSize=', sz); } catch(_){ }
    } finally { fs.closeSync(ofd); }
    return out;
  } finally { fs.closeSync(fd); }
}

export async function convertAudio(srcPath, format){
  const ext = String(format||'').toLowerCase();
  if (ext === 'wav') return await convertAiffToWav(srcPath);
  if (ext === 'mp3') return await convertAiffToMp3(srcPath);
  throw new Error('Unsupported target format: ' + format);
}


