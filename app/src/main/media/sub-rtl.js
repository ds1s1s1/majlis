'use strict';
// Arabic RTL bidi shaping for SRT/VTT subtitles before feeding libmpv/libass.
// Isolates Arabic lines with RLE/PDF and anchors RLM around leading dialogue dashes and trailing
// punctuation so libass/FriBidi never flips dashes or commas onto the wrong side.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const AR_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const VTT_TIME_RE = /-->/;
const LEAD_TAGS_RE = /^((?:\{[^}]*\}|<[^>]+>|\s)*)(.*?)((?:\s|<\/[^>]+>)*)$/;
const TRAIL_PUNCT_RE = /([.!?؟،,…:;—–-]+)$/;
const LEAD_DASH_RE = /^([\-–—]+)(\s+)/;

function hasArabic(text) {
  return AR_CHAR_RE.test(String(text || ''));
}

function shapeArabicLine(line) {
  if (!line || !AR_CHAR_RE.test(line)) return line;
  // Already explicitly isolated with RLE + PDF
  if (line.includes('\u202B') && line.includes('\u202C')) return line;
  const m = LEAD_TAGS_RE.exec(line);
  if (!m) return line;
  const [, head, rawCore, tail] = m;
  let core = rawCore;
  if (!core || !AR_CHAR_RE.test(core)) return line;
  if (LEAD_DASH_RE.test(core)) core = core.replace(LEAD_DASH_RE, '\u200F$1$2');
  if (TRAIL_PUNCT_RE.test(core)) core = core.replace(TRAIL_PUNCT_RE, '$1\u200F');
  return `${head}\u202B${core}\u202C${tail}`;
}

function isolateArabicSrt(content) {
  const norm = String(content || '').replace(/^\uFEFF/, '');
  const eol = norm.includes('\r\n') ? '\r\n' : '\n';
  const lines = norm.split(/\r?\n/);
  const out = [];
  let inCue = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      inCue = false;
      out.push(line);
      continue;
    }
    if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE') || trimmed.startsWith('STYLE') || trimmed.startsWith('REGION')) {
      out.push(line);
      continue;
    }
    if (!inCue && /^\d+$/.test(trimmed) && i + 1 < lines.length && VTT_TIME_RE.test(lines[i + 1])) {
      out.push(line);
      continue;
    }
    if (VTT_TIME_RE.test(line)) {
      inCue = true;
      out.push(line);
      continue;
    }
    out.push(shapeArabicLine(line));
  }
  return out.join(eol);
}

function decodeSubtitleWithInfo(buf, lang = '') {
  const u8 = buf instanceof Uint8Array ? buf : Buffer.from(buf || '');
  if (!u8.length) return { text: '', converted: false };
  if (u8[0] === 0xFF && u8[1] === 0xFE) {
    return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), converted: true };
  }
  if (u8[0] === 0xFE && u8[1] === 0xFF) {
    return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), converted: true };
  }
  const hasUtf8Bom = u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF;
  const bodyU8 = hasUtf8Bom ? u8.subarray(3) : u8;
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bodyU8);
    // Recover double-encoded Arabic (UTF-8 bytes misread as Windows-1252/Latin-1 and re-saved as UTF-8)
    if (/[\u00D8\u00D9][\u0080-\u00BF]/.test(utf8)) {
      let onlyByteRange = true;
      for (let i = 0; i < utf8.length; i++) {
        if (utf8.charCodeAt(i) > 255) { onlyByteRange = false; break; }
      }
      if (onlyByteRange) {
        const bytes = new Uint8Array(utf8.length);
        for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
        const fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (hasArabic(fixed)) return { text: fixed, converted: true };
      }
    }
    return { text: utf8, converted: false };
  } catch {
    const cp1256 = new TextDecoder('windows-1256').decode(bodyU8);
    if (hasArabic(cp1256) || /^ar/i.test(String(lang || ''))) {
      return { text: cp1256, converted: true };
    }
    return { text: new TextDecoder('windows-1252').decode(bodyU8), converted: true };
  }
}

function decodeSubtitleBuffer(buf, lang = '') {
  return decodeSubtitleWithInfo(buf, lang).text;
}

function stripSdhLine(line) {
  let s = String(line || '');
  // Remove music notes, bracketed/parenthesized English & Arabic SDH cues, and speaker prefixes
  s = s.replace(/[♪♫][^♪♫\r\n]*[♪♫]/g, ' ');
  s = s.replace(/^[♪♫\s]+$/g, '');
  s = s.replace(/\[[^\]\r\n]{1,120}\]/g, ' ');
  s = s.replace(/\([^)\r\n]{1,120}\)/g, ' ');
  s = s.replace(/^((?:<[^>]+>|\s)*)(?:[A-Z0-9][A-Z0-9\s.'-]{0,24}|(?:Man|Woman|Narrator|Announcer|Voice)\s*\d*|الرجل|المرأة|الراوي|صوت|المذيع|معلق)\s*:\s+/i, '$1');
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

function stripSdhTags(content) {
  const norm = String(content || '').replace(/^\uFEFF/, '');
  const eol = norm.includes('\r\n') ? '\r\n' : '\n';
  const lines = norm.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  // Preserve WebVTT header / NOTE / STYLE blocks intact
  if (lines[0]?.trim().startsWith('WEBVTT')) {
    const head = [];
    while (i < lines.length && lines[i].trim() !== '') head.push(lines[i++]);
    blocks.push(head.join(eol));
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const block = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    const timeIdx = block.findIndex((l) => VTT_TIME_RE.test(l));
    if (timeIdx < 0) {
      blocks.push(block.join(eol));
      continue;
    }
    const prefix = block.slice(0, timeIdx + 1);
    const strippedText = block.slice(timeIdx + 1).map(stripSdhLine).filter(Boolean);
    if (!strippedText.length) continue;
    blocks.push([...prefix, ...strippedText].join(eol));
  }
  return blocks.join(eol + eol) + (norm.endsWith('\n') ? eol : '');
}

async function prepareSubtitleFile(urlOrPath, lang = '', tempDir = path.join(os.tmpdir(), 'majlis-subs'), opts = {}) {
  const src = String(urlOrPath || '').trim();
  const stripSdh = !!opts?.stripSdh;
  if (!src) return src;
  const cleanPath = src.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(ass|ssa)$/i.test(cleanPath)) return src;
  const looksSrtVtt = /\.(srt|vtt|sub)$/i.test(cleanPath) || !/^https?:\/\//i.test(src);
  if (!looksSrtVtt && !/^ar/i.test(String(lang || '')) && !stripSdh) return src;

  try {
    let rawBuf = null;
    if (/^https?:\/\//i.test(src)) {
      const r = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return src;
      rawBuf = Buffer.from(await r.arrayBuffer());
    } else if (fs.existsSync(src)) {
      rawBuf = fs.readFileSync(src);
    } else {
      return src;
    }
    if (!rawBuf || !rawBuf.length || rawBuf.length > 8 * 1024 * 1024) return src;
    const { text: raw, converted } = decodeSubtitleWithInfo(rawBuf, lang);
    if (!raw || /\[Script Info\]/i.test(raw.slice(0, 512))) return src;
    const isAr = /^ar/i.test(String(lang || '')) || hasArabic(raw);
    if (!isAr && !stripSdh && !converted) return src;

    let body = stripSdh ? stripSdhTags(raw) : raw;
    if (isAr) body = isolateArabicSrt(body);

    fs.mkdirSync(tempDir, { recursive: true });
    const ext = /\.vtt$/i.test(cleanPath) || raw.trimStart().startsWith('WEBVTT') ? '.vtt' : '.srt';
    const hash = crypto.createHash('sha1').update(`${src}|sdh:${stripSdh ? 1 : 0}`).digest('hex').slice(0, 12);
    const prefix = isAr ? 'ar' : 'sub';
    const outFile = path.join(tempDir, `${prefix}-${hash}${ext}`);
    fs.writeFileSync(outFile, '\uFEFF' + body, 'utf8');
    return outFile;
  } catch {
    return src;
  }
}

const ISO_LABELS = {
  ar: 'العربية', ara: 'العربية', arabic: 'العربية',
  en: 'English', eng: 'English',
  fr: 'Français', fre: 'Français', fra: 'Français',
  de: 'Deutsch', ger: 'Deutsch', deu: 'Deutsch',
  es: 'Español', spa: 'Español',
  it: 'Italiano', ita: 'Italiano',
  pt: 'Português', por: 'Português', pob: 'Português (BR)',
  ru: 'Русский', rus: 'Русский',
  ja: '日本語', jpn: '日本語',
  ko: '한국어', kor: '한국어',
  tr: 'Türkçe', tur: 'Türkçe',
  zh: '中文', zho: '中文', chi: '中文',
  hi: 'हिन्दी', hin: 'हिन्दी',
  id: 'Bahasa Indonesia', ind: 'Bahasa Indonesia',
  pl: 'Polski', pol: 'Polski',
  nl: 'Nederlands', dut: 'Nederlands', nld: 'Nederlands',
  fa: 'فارسی', fas: 'فارسی', per: 'فارسی',
};

function langDisplay(code) {
  const c = String(code || '').trim().toLowerCase();
  return ISO_LABELS[c] || (c ? c.toUpperCase() : 'Subtitle');
}

function formatAddonSubTitle(s, idx = 0) {
  if (!s || typeof s !== 'object') return `Subtitle #${idx + 1}`;
  const raw = [s.filename, s.SubFileName, s.release, s.title, s.name]
    .map((v) => String(v || '').trim())
    .find((v) => v && !/^(ara|eng|fre|fra|ger|deu|spa|jpn|kor|tur|sub|subtitles?|\d+)$/i.test(v));
  let clean = raw ? raw.replace(/\.(srt|vtt|ass|ssa|sub)$/i, '').replace(/\s+/g, ' ').trim() : '';
  if (!clean && typeof s.url === 'string') {
    try {
      const seg = decodeURIComponent(new URL(s.url).pathname.split('/').pop() || '');
      const base = seg.replace(/\.(srt|vtt|ass|ssa|sub)$/i, '').trim();
      if (base && !/^\d+$/.test(base) && base.length > 4) clean = base;
    } catch {}
  }
  if (!clean) {
    const langName = langDisplay(s.lang);
    clean = s.addon ? `${langName} (${s.addon})` : `${langName} #${idx + 1}`;
  }
  const tags = [];
  if (s.hi || s.sdh || s.hearing_impaired || /\b(sdh|cc|hi)\b/i.test(clean)) tags.push('SDH');
  if (s.forced || /\bforced\b/i.test(clean)) tags.push('Forced');
  if (tags.length && !new RegExp(`\\b(${tags.join('|')})\\b`, 'i').test(clean)) {
    clean = `${clean} [${tags.join('·')}]`;
  }
  return clean.slice(0, 120);
}

function parseSrtCueStarts(content) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const starts = [];
  const re = /^(?:\d{1,2}:)?(\d{1,2}):(\d{1,2})[,.](\d{3})\s*-->/;
  const fullRe = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{3})\s*-->/;
  for (const raw of lines) {
    const line = raw.trim();
    const fm = fullRe.exec(line);
    if (fm) {
      starts.push((+fm[1]) * 3600 + (+fm[2]) * 60 + (+fm[3]) + (+fm[4]) / 1000);
      continue;
    }
    const sm = re.exec(line);
    if (sm) starts.push((+sm[1]) * 60 + (+sm[2]) + (+sm[3]) / 1000);
  }
  return starts;
}

module.exports = { hasArabic, isolateArabicSrt, shapeArabicLine, stripSdhTags, prepareSubtitleFile, langDisplay, formatAddonSubTitle, parseSrtCueStarts, decodeSubtitleBuffer, decodeSubtitleWithInfo };
