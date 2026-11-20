'use strict';
const crypto = require('crypto');

// Minimal strict bencode decoder that also tracks the byte range of top-level `info` so we compute SHA-1 infoHash identically to BitTorrent specs.
function parseBencode(buf, offset = 0, captureInfo = false, infoSpan = null) {
  if (offset >= buf.length) throw new Error('unexpected eof');
  const ch = buf[offset];
  if (ch === 0x69) { // 'i' integer
    const end = buf.indexOf(0x65, offset + 1);
    if (end < 0) throw new Error('unterminated int');
    const num = Number(buf.toString('ascii', offset + 1, end));
    if (!Number.isFinite(num)) throw new Error('invalid int');
    return { val: num, next: end + 1 };
  }
  if (ch === 0x6c) { // 'l' list
    const arr = [];
    let cur = offset + 1;
    while (cur < buf.length && buf[cur] !== 0x65) {
      const r = parseBencode(buf, cur);
      arr.push(r.val);
      cur = r.next;
    }
    if (buf[cur] !== 0x65) throw new Error('unterminated list');
    return { val: arr, next: cur + 1 };
  }
  if (ch === 0x64) { // 'd' dict
    const obj = {};
    let cur = offset + 1;
    while (cur < buf.length && buf[cur] !== 0x65) {
      const kr = parseBencode(buf, cur);
      if (!Buffer.isBuffer(kr.val)) throw new Error('non-string dict key');
      const key = kr.val.toString('utf8');
      const valStart = kr.next;
      const vr = parseBencode(buf, valStart);
      if (captureInfo && key === 'info' && infoSpan) {
        infoSpan.start = valStart;
        infoSpan.end = vr.next;
      }
      obj[key] = vr.val;
      cur = vr.next;
    }
    if (buf[cur] !== 0x65) throw new Error('unterminated dict');
    return { val: obj, next: cur + 1 };
  }
  if (ch >= 0x30 && ch <= 0x39) { // byte string <len>:<bytes>
    const colon = buf.indexOf(0x3a, offset);
    if (colon < 0) throw new Error('missing string colon');
    const len = parseInt(buf.toString('ascii', offset, colon), 10);
    if (!Number.isInteger(len) || len < 0 || colon + 1 + len > buf.length) throw new Error('invalid string length');
    return { val: buf.subarray(colon + 1, colon + 1 + len), next: colon + 1 + len };
  }
  throw new Error(`unexpected bencode byte 0x${ch.toString(16)}`);
}

function parseTorrentBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16 || buf[0] !== 0x64) {
    throw new Error('invalid_torrent');
  }
  const infoSpan = { start: -1, end: -1 };
  const parsed = parseBencode(buf, 0, true, infoSpan);
  const root = parsed.val;
  if (!root || typeof root !== 'object' || infoSpan.start < 0 || infoSpan.end <= infoSpan.start || !root.info || typeof root.info !== 'object') {
    throw new Error('missing_info_dict');
  }
  const infoSlice = buf.subarray(infoSpan.start, infoSpan.end);
  const infoHash = crypto.createHash('sha1').update(infoSlice).digest('hex').toLowerCase();
  const rawName = Buffer.isBuffer(root.info['name.utf-8'])
    ? root.info['name.utf-8'].toString('utf8')
    : (Buffer.isBuffer(root.info.name) ? root.info.name.toString('utf8') : `Torrent ${infoHash.slice(0, 8)}`);

  let fileIdx = 0;
  let totalSize = Number(root.info.length) || 0;
  if (Array.isArray(root.info.files) && root.info.files.length) {
    const VIDEO_RE = /\.(mkv|mp4|avi|mov|webm|m4v|ts)$/i;
    let bestVidIdx = -1;
    let bestVidSize = -1;
    let bestAnyIdx = 0;
    let bestAnySize = -1;
    totalSize = 0;
    root.info.files.forEach((f, idx) => {
      const sz = Number(f?.length) || 0;
      totalSize += sz;
      const parts = Array.isArray(f?.['path.utf-8']) ? f['path.utf-8'] : (Array.isArray(f?.path) ? f.path : []);
      const nameStr = parts.map((b) => (Buffer.isBuffer(b) ? b.toString('utf8') : String(b || ''))).join('/');
      if (VIDEO_RE.test(nameStr) && sz > bestVidSize) {
        bestVidSize = sz;
        bestVidIdx = idx;
      }
      if (sz > bestAnySize) {
        bestAnySize = sz;
        bestAnyIdx = idx;
      }
    });
    fileIdx = bestVidIdx >= 0 ? bestVidIdx : bestAnyIdx;
  }
  const trackers = new Set();
  if (Buffer.isBuffer(root.announce)) {
    const u = root.announce.toString('utf8').trim();
    if (u) trackers.add(u);
  }
  if (Array.isArray(root['announce-list'])) {
    for (const tier of root['announce-list']) {
      for (const entry of Array.isArray(tier) ? tier : [tier]) {
        if (Buffer.isBuffer(entry)) {
          const u = entry.toString('utf8').trim();
          if (u) trackers.add(u);
        }
      }
    }
  }
  return {
    infoHash,
    name: rawName.slice(0, 240),
    fileIdx,
    totalSize,
    sources: [...trackers].slice(0, 20).map((t) => `tracker:${t}`),
  };
}

module.exports = { parseTorrentBuffer };
