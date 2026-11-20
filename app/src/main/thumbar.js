'use strict';
const zlib = require('node:zlib');
const { nativeImage } = require('electron');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodeRgbaPng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillRect(rgba, w, h, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const i = (y * w + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
    }
  }
}

function fillTriangleRight(rgba, w, h, x0, y0, width, height, color) {
  const half = height / 2;
  for (let dy = 0; dy < height; dy++) {
    const ratio = 1 - Math.abs(dy + 0.5 - half) / half;
    const span = Math.max(1, Math.round(width * ratio));
    for (let dx = 0; dx < span; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const i = (y * w + x) * 4;
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
      }
    }
  }
}

function fillTriangleLeft(rgba, w, h, xRight, y0, width, height, color) {
  const half = height / 2;
  for (let dy = 0; dy < height; dy++) {
    const ratio = 1 - Math.abs(dy + 0.5 - half) / half;
    const span = Math.max(1, Math.round(width * ratio));
    for (let dx = 0; dx < span; dx++) {
      const x = xRight - dx, y = y0 + dy;
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const i = (y * w + x) * 4;
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
      }
    }
  }
}

const PNG_CACHE = new Map();
const IMG_CACHE = new Map();

function createIconPng(kind) {
  if (PNG_CACHE.has(kind)) return PNG_CACHE.get(kind);
  const w = 24, h = 24;
  const rgba = Buffer.alloc(w * h * 4);
  const fg = [244, 239, 230, 255];
  if (kind === 'play') {
    fillTriangleRight(rgba, w, h, 7, 4, 12, 16, fg);
  } else if (kind === 'pause') {
    fillRect(rgba, w, h, 6, 5, 10, 19, fg);
    fillRect(rgba, w, h, 14, 5, 18, 19, fg);
  } else if (kind === 'prev') {
    fillRect(rgba, w, h, 4, 6, 6, 18, fg);
    fillTriangleLeft(rgba, w, h, 19, 6, 11, 12, fg);
  } else if (kind === 'next') {
    fillTriangleRight(rgba, w, h, 5, 6, 11, 12, fg);
    fillRect(rgba, w, h, 18, 6, 20, 18, fg);
  }
  const buf = encodeRgbaPng(w, h, rgba);
  PNG_CACHE.set(kind, buf);
  return buf;
}

function getNativeIcon(kind) {
  if (!nativeImage?.createFromBuffer) return null;
  if (IMG_CACHE.has(kind)) return IMG_CACHE.get(kind);
  const img = nativeImage.createFromBuffer(createIconPng(kind));
  IMG_CACHE.set(kind, img);
  return img;
}

const lastSigByWin = new WeakMap();

function resetCache(win) {
  if (win) lastSigByWin.delete(win);
}

function updateThumbar(win, state, handlers = {}) {
  if (process.platform !== 'win32' || !win || win.isDestroyed?.() || typeof win.setThumbarButtons !== 'function') {
    return false;
  }
  const { open = false, paused = false, hasNext = false, lang = 'ar' } = state || {};
  const sig = open ? `${!!paused}|${!!hasNext}|${lang}` : 'closed';
  if (lastSigByWin.get(win) === sig) return false;
  lastSigByWin.set(win, sig);

  if (!open) {
    try { return !!win.setThumbarButtons([]); } catch { return false; }
  }
  const ar = lang === 'ar';
  try {
    return !!win.setThumbarButtons([
      {
        tooltip: ar ? 'رجوع 10 ثواني' : 'Rewind 10s',
        icon: getNativeIcon('prev'),
        click: () => { try { handlers.onSeekBack?.(); } catch {} },
      },
      {
        tooltip: paused ? (ar ? 'تشغيل' : 'Play') : (ar ? 'إيقاف مؤقت' : 'Pause'),
        icon: getNativeIcon(paused ? 'play' : 'pause'),
        click: () => { try { handlers.onToggle?.(); } catch {} },
      },
      {
        tooltip: hasNext ? (ar ? 'الحلقة التالية' : 'Next Episode') : (ar ? 'تقديم 10 ثواني' : 'Forward 10s'),
        icon: getNativeIcon('next'),
        click: () => { try { handlers.onSeekFwdOrNext?.(); } catch {} },
      },
    ]);
  } catch {
    return false;
  }
}

module.exports = { createIconPng, getNativeIcon, updateThumbar, resetCache };
