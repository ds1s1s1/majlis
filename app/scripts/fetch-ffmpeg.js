'use strict';
// Downloads BtbN Windows x64 GPL FFmpeg + FFprobe (shared build first, static fallback)
// directly into engine/vendor/ffmpeg so zero first-run downloads are needed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CANDIDATE_URLS = [
  process.env.MAJLIS_FFMPEG_URL,
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
].filter(Boolean);

const DIR = path.join(__dirname, '../../engine/vendor/ffmpeg');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

function works(exe) {
  try {
    execFileSync(exe, ['-hide_banner', '-version'], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findBinFiles(root) {
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) out.push(...findBinFiles(abs));
    else if (ent.isFile() && /\.(exe|dll)$/i.test(ent.name)) out.push(abs);
  }
  return out;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const ff = path.join(DIR, 'ffmpeg.exe');
  const fp = path.join(DIR, 'ffprobe.exe');
  if (fs.existsSync(ff) && fs.existsSync(fp) && works(ff) && works(fp)) {
    console.log(`ffmpeg & ffprobe ready in ${DIR}`);
    return;
  }

  let downloaded = false;
  const stageDir = path.join(DIR, '.tmp-extract');
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const zipPath = path.join(stageDir, 'ffmpeg.zip');

  try {
    for (const url of CANDIDATE_URLS) {
      const r = await fetch(url, { headers: { 'User-Agent': 'Majlis-Sidecar-Fetch' }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(zipPath, buf);
      execFileSync(TAR, ['-xf', zipPath, '-C', stageDir], { windowsHide: true, timeout: 120000 });
      const files = findBinFiles(stageDir);
      const hasFf = files.find((f) => path.basename(f).toLowerCase() === 'ffmpeg.exe');
      const hasFp = files.find((f) => path.basename(f).toLowerCase() === 'ffprobe.exe');
      if (!hasFf || !hasFp) continue;

      for (const f of files) {
        const base = path.basename(f);
        if (/^(ffmpeg|ffprobe)\.exe$/i.test(base) || /\.dll$/i.test(base)) {
          fs.copyFileSync(f, path.join(DIR, base));
        }
      }
      downloaded = true;
      break;
    }
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  if (!downloaded || !works(ff) || !works(fp)) {
    throw new Error('Failed to fetch/verify ffmpeg.exe & ffprobe.exe');
  }

  fs.writeFileSync(path.join(DIR, 'LICENSE-ffmpeg.txt'), [
    'FFmpeg & FFprobe Windows GPL builds by BtbN (https://github.com/BtbN/FFmpeg-Builds).',
    'Licensed under the GNU General Public License v3+ (https://www.gnu.org/licenses/gpl-3.0.html).',
    'Source code: https://git.ffmpeg.org/ffmpeg.git',
  ].join('\r\n'));

  console.log(`ffmpeg & ffprobe installed in ${DIR}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
