'use strict';
// Profile song helper: fetches YouTube audio via pinned yt-dlp and clips <= 30 s Opus <= 500 KB
// with ffmpeg into userData/profiles/<id>/song.opus (and caches friends' clips separately).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { findFfmpeg } = require('../encoder');
const { validatePlayUrl } = require('./http');

const MAX_BYTES = 500 * 1024;
const CLIP_SEC = 30;
const BITRATES = [96, 64, 48, 32];
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

function safeId(id) {
  return String(id || 'default').replace(/[^\w-]/g, '_') || 'default';
}

function isYouTubeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (!YT_HOSTS.has(u.hostname.toLowerCase())) return false;
    if (u.hostname.toLowerCase() === 'youtu.be') return /^\/[A-Za-z0-9_-]{6,}$/.test(u.pathname);
    return u.pathname === '/watch' ? /^[A-Za-z0-9_-]{6,}$/.test(u.searchParams.get('v') || '') : /^\/(shorts|live)\/[A-Za-z0-9_-]{6,}/.test(u.pathname);
  } catch { return false; }
}

function findYtdlp() {
  for (const p of [
    process.resourcesPath ? path.join(process.resourcesPath, 'ytdlp', 'yt-dlp.exe') : null,
    path.join(__dirname, '../../../../engine/vendor/ytdlp/yt-dlp.exe'),
  ]) {
    if (p && fs.existsSync(p)) return p;
  }
  return 'yt-dlp';
}

function execAsync(bin, args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve({ stdout, stderr });
    });
  });
}

// Pure bitrate selector: takes a size probe function(kbps) -> bytes and finds first <= MAX_BYTES
async function pickBitrate(encodeAt, maxBytes = MAX_BYTES) {
  let lastSize = 0;
  for (const kbps of BITRATES) {
    lastSize = await encodeAt(kbps);
    if (lastSize > 0 && lastSize <= maxBytes) return { kbps, bytes: lastSize };
  }
  throw new Error(`profile song exceeds ${Math.round(maxBytes / 1024)} KB (${lastSize} bytes)`);
}

function ownSongPath(dataDir, profile) {
  return path.join(dataDir, 'profiles', safeId(profile), 'song.opus');
}

function friendSongPath(dataDir, friendId) {
  return path.join(dataDir, 'media', 'friend-songs', `${safeId(friendId)}.opus`);
}

async function setSong({ dataDir, profile = 'default', url, start = 0, getFfmpeg, exec = execAsync }) {
  const cleanUrl = String(url || '').trim();
  if (!isYouTubeUrl(cleanUrl)) throw new Error('enter a valid YouTube link');
  const ffmpeg = (typeof getFfmpeg === 'function' ? getFfmpeg() : null) || findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is needed to trim profile songs');
  const ytdlp = findYtdlp();
  const dest = ownSongPath(dataDir, profile);
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  const tmpBase = path.join(dir, `.dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const outTmp = dest + '.tmp.opus';
  const offset = Math.max(0, Math.min(36000, Math.round(Number(start) || 0)));
  try {
    await exec(ytdlp, ['--no-playlist', '--no-warnings', '-f', 'bestaudio/best', '-o', `${tmpBase}.%(ext)s`, '--', cleanUrl], 60000);
    const dlName = fs.readdirSync(dir).find((f) => f.startsWith(path.basename(tmpBase) + '.'));
    if (!dlName) throw new Error('yt-dlp produced no audio file');
    const srcFile = path.join(dir, dlName);
    const picked = await pickBitrate(async (kbps) => {
      await exec(ffmpeg, [
        '-y', '-v', 'error', '-ss', String(offset), '-t', String(CLIP_SEC),
        '-i', srcFile, '-vn', '-ac', '2', '-ar', '48000',
        '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-f', 'ogg', outTmp,
      ], 45000);
      return fs.statSync(outTmp).size;
    });
    fs.renameSync(outTmp, dest);
    return { ok: true, file: dest, bytes: picked.bytes, kbps: picked.kbps, url: cleanUrl, start: offset };
  } finally {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(path.basename(tmpBase) + '.')) fs.unlinkSync(path.join(dir, f));
      }
    } catch {}
    try { if (fs.existsSync(outTmp)) fs.unlinkSync(outTmp); } catch {}
  }
}

function clearSong({ dataDir, profile = 'default' }) {
  const f = ownSongPath(dataDir, profile);
  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  return true;
}

function getSong({ dataDir, profile = 'default', friendId = null, maxBytes = Infinity }) {
  const f = friendId ? friendSongPath(dataDir, friendId) : ownSongPath(dataDir, profile);
  try {
    if (!fs.existsSync(f)) return null;
    const buf = fs.readFileSync(f);
    if (!buf.length || buf.length > maxBytes) return null;
    return { dataUrl: `data:audio/ogg;base64,${buf.toString('base64')}`, bytes: buf.length, file: f };
  } catch { return null; }
}

function cacheFriendSong({ dataDir, friendId, dataUrl }) {
  if (!friendId || typeof dataUrl !== 'string') return false;
  const m = /^data:audio\/(?:ogg|opus|webm)(?:;codecs=[^;]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return false;
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length || buf.length > MAX_BYTES) return false;
  const f = friendSongPath(dataDir, friendId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  return true;
}

async function resolveVideoStream(rawUrl, { exec = execAsync } = {}) {
  const cleanUrl = String(rawUrl || '').trim();
  if (!isYouTubeUrl(cleanUrl)) throw new Error('enter a valid YouTube link');
  const ytdlp = findYtdlp();
  const { stdout } = await exec(
    ytdlp,
    [
      '--no-playlist',
      '--no-warnings',
      '--dump-single-json',
      '-f',
      'best[height<=1080][acodec!=none][vcodec!=none]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--',
      cleanUrl,
    ],
    18000,
  );
  let info;
  try { info = JSON.parse(String(stdout || '{}')); } catch { throw new Error('invalid yt-dlp output'); }
  const pickUrls = [];
  if (typeof info.url === 'string' && info.url) pickUrls.push(info.url);
  if (Array.isArray(info.requested_formats)) {
    for (const rf of info.requested_formats) if (rf?.url) pickUrls.push(rf.url);
  }
  const primary = pickUrls[0] ? validatePlayUrl(pickUrls[0]) : null;
  if (!primary?.ok || primary.kind !== 'http') throw new Error('no playable YouTube stream found');
  let audioUrl = null;
  if (pickUrls[1] && pickUrls[1] !== pickUrls[0]) {
    const av = validatePlayUrl(pickUrls[1]);
    if (av.ok && av.kind === 'http') audioUrl = av.url;
  }
  return {
    ytUrl: cleanUrl,
    url: primary.url,
    audioUrl,
    title: String(info.title || 'YouTube').slice(0, 160),
    duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : 0,
    thumbnail: typeof info.thumbnail === 'string' && /^https:\/\//i.test(info.thumbnail) ? info.thumbnail : null,
  };
}

module.exports = {
  MAX_BYTES,
  CLIP_SEC,
  BITRATES,
  isYouTubeUrl,
  findYtdlp,
  pickBitrate,
  setSong,
  clearSong,
  getSong,
  cacheFriendSong,
  resolveVideoStream,
};
