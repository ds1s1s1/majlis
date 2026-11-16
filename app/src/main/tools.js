'use strict';
// ffmpeg is only needed to host. Rather than ship ~400 MB with every copy, it's fetched the
// first time someone hosts (a shared GPL build, ~90 MB) and kept in the app's data folder.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASES = 'https://api.github.com/repos/FFmpeg-Builds/FFmpeg-Builds/releases/latest';

const works = (exe) => new Promise((res) => execFile(exe, ['-hide_banner', '-version'], { windowsHide: true, timeout: 8000 }, (e) => res(!e)));

function findIn(dir) {
  try {
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return null;
}

async function resolveFfmpeg({ custom, dataDir, resources }) {
  const cands = [custom, resources && path.join(resources, 'ffmpeg', 'ffmpeg.exe'), findIn(path.join(dataDir, 'ffmpeg')), 'ffmpeg'];
  for (const c of cands) if (c && (c === 'ffmpeg' || fs.existsSync(c)) && (await works(c))) return c;
  return null;
}

async function pickAsset() {
  const r = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'majlis' } });
  if (!r.ok) throw new Error(`github ${r.status}`);
  const j = await r.json();
  const list = j.assets || [];
  // newest numbered release, shared build (smaller: ffmpeg and ffprobe share the DLLs)
  const numbered = list.filter((a) => /^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-shared-[\d.]+\.zip$/.test(a.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  // stay on 8.x (what this was built and tested against) while it's offered
  return numbered.find((a) => /^ffmpeg-n8\./.test(a.name)) || numbered[0] || list.find((a) => a.name === 'ffmpeg-master-latest-win64-gpl-shared.zip');
}

async function downloadFfmpeg(dataDir, onProgress) {
  const dir = path.join(dataDir, 'ffmpeg');
  fs.mkdirSync(dir, { recursive: true });
  const asset = await pickAsset();
  if (!asset) throw new Error('no build found');
  const zip = path.join(dir, 'ffmpeg.zip');
  const res = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'majlis' } });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const total = +res.headers.get('content-length') || asset.size || 0;
  const out = fs.createWriteStream(zip);
  let got = 0, last = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    const now = Date.now();
    if (now - last > 250) { last = now; onProgress?.({ got, total }); }
  }
  await new Promise((r) => out.end(r));
  onProgress?.({ got, total, extracting: true });
  // Windows 10+ ships bsdtar, which reads zip files
  await new Promise((resolve, reject) => execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 180000 }, (e) => (e ? reject(e) : resolve())));
  fs.rmSync(zip, { force: true });
  const exe = findIn(dir);
  if (!exe || !(await works(exe))) throw new Error('extract failed');
  return exe;
}

module.exports = { resolveFfmpeg, downloadFfmpeg };
