'use strict';
// OpenSubtitles standard 64-bit movie hash (64KB head + 64KB tail + byte size in uint64 LE mod 2^64).
// Works for both local video files and HTTP(S) Range-capable direct/debrid streams.
const fs = require('fs');
const CHUNK = 65536;
const MASK64 = 0xffffffffffffffffn;

function addChunkU64(acc, buf) {
  const usable = buf.length - (buf.length % 8);
  for (let i = 0; i < usable; i += 8) {
    acc = (acc + buf.readBigUInt64LE(i)) & MASK64;
  }
  return acc;
}

function hashFromChunks(headBuf, tailBuf, fileSize) {
  let sum = BigInt(fileSize) & MASK64;
  sum = addChunkU64(sum, headBuf);
  sum = addChunkU64(sum, tailBuf);
  return sum.toString(16).padStart(16, '0');
}

async function computeFileVideoHash(filePath) {
  try {
    const st = await fs.promises.stat(filePath);
    if (!st.isFile() || st.size < CHUNK * 2) return null;
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const head = Buffer.alloc(CHUNK);
      const tail = Buffer.alloc(CHUNK);
      await fh.read(head, 0, CHUNK, 0);
      await fh.read(tail, 0, CHUNK, st.size - CHUNK);
      return { videoHash: hashFromChunks(head, tail, st.size), videoSize: st.size };
    } finally {
      await fh.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

async function computeHttpVideoHash(url, headers = {}) {
  try {
    const u = new URL(String(url || ''));
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const hReq = await fetch(u.toString(), {
      headers: { ...headers, range: `bytes=0-${CHUNK - 1}` },
      signal: AbortSignal.timeout(4000),
    });
    if (hReq.status !== 206) return null;
    const cr = hReq.headers.get('content-range') || '';
    const m = /\/(\d+)$/.exec(cr);
    const total = m ? parseInt(m[1], 10) : 0;
    if (!total || total < CHUNK * 2) return null;
    const head = Buffer.from(await hReq.arrayBuffer());
    const tReq = await fetch(u.toString(), {
      headers: { ...headers, range: `bytes=${total - CHUNK}-${total - 1}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!tReq.ok) return null;
    const tail = Buffer.from(await tReq.arrayBuffer());
    return { videoHash: hashFromChunks(head, tail, total), videoSize: total };
  } catch {
    return null;
  }
}

async function computeVideoHash(source, headers = {}) {
  if (!source || typeof source !== 'string') return null;
  if (/^https?:\/\//i.test(source)) return computeHttpVideoHash(source, headers);
  return computeFileVideoHash(source);
}

module.exports = { computeVideoHash, computeFileVideoHash, computeHttpVideoHash, hashFromChunks, CHUNK };
