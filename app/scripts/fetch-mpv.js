'use strict';
// Puts the film player (mpv, shinchiro's Windows build) in engine/vendor/mpv: a pinned release,
// checked against its SHA-256 before it's unpacked. Run once before building: npm run mpv
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const URL = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261111/mpv-x86_64-20261111-git-bcde6b93cc.7z';
const SHA256 = 'f259b5fd4b5c395617c948a4fadcdf55bba1c5282fb7c13e88626b3f71072baf';
const DIR = path.join(__dirname, '../../engine/vendor/mpv');

(async () => {
  if (fs.existsSync(path.join(DIR, 'mpv.exe'))) { console.log('mpv already in', DIR); return; }
  fs.mkdirSync(DIR, { recursive: true });
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== SHA256) throw new Error(`checksum mismatch: ${sum}`);
  const arc = path.join(DIR, 'mpv.7z');
  fs.writeFileSync(arc, buf);
  // Windows 10+ ships bsdtar, which reads 7z
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', arc, '-C', DIR]);
  fs.unlinkSync(arc);
  fs.writeFileSync(path.join(DIR, 'LICENSE-mpv.txt'), [
    'mpv (https://mpv.io) is free software, licensed under the GNU General Public License v2 or later.',
    'This build: shinchiro/mpv-winbuild-cmake release 20261111 (https://github.com/shinchiro/mpv-winbuild-cmake).',
    'Source code: https://github.com/mpv-player/mpv and the build scripts in the repository above.',
    'Majlis runs mpv as a separate program; it is not linked into Majlis.',
  ].join('\r\n'));
  console.log('mpv ready in', DIR);
})().catch((e) => { console.error(e.message); process.exit(1); });
