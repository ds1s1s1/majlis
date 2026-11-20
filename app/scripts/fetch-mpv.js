'use strict';
// Puts the film player (mpv + libmpv-2.dll, shinchiro's Windows build) in engine/vendor/mpv:
// pinned releases, checked against SHA-256 before unpacking. Run once before building: npm run mpv
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const URL = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261111/mpv-x86_64-20261111-git-bcde6b93cc.7z';
const SHA256 = 'f259b5fd4b5c395617c948a4fadcdf55bba1c5282fb7c13e88626b3f71072baf';
const DEV_URL = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261111/mpv-dev-x86_64-20261111-git-bcde6b93cc.7z';
const DEV_SHA256 = '273c079b11ea5575822f972756f4c9a71149a5c10130353abeb8586738938452';
const DIR = path.join(__dirname, '../../engine/vendor/mpv');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

async function fetchVerified(url, sha256, archiveName) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${archiveName}): ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== sha256) throw new Error(`checksum mismatch (${archiveName}): ${sum}`);
  const arc = path.join(DIR, archiveName);
  fs.writeFileSync(arc, buf);
  return arc;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const hasExe = fs.existsSync(path.join(DIR, 'mpv.exe'));
  const hasDll = fs.existsSync(path.join(DIR, 'libmpv-2.dll'));
  if (!hasExe) {
    const arc = await fetchVerified(URL, SHA256, 'mpv.7z');
    execFileSync(TAR, ['-xf', arc, '-C', DIR]);
    fs.unlinkSync(arc);
  }
  if (!hasDll) {
    const arc = await fetchVerified(DEV_URL, DEV_SHA256, 'mpv-dev.7z');
    execFileSync(TAR, ['-xf', arc, '-C', DIR, 'libmpv-2.dll']);
    fs.unlinkSync(arc);
  }
  fs.writeFileSync(path.join(DIR, 'LICENSE-mpv.txt'), [
    'mpv and libmpv-2.dll (https://mpv.io) are free software, licensed under the GNU Lesser/General Public License (LGPLv2.1+ / GPLv2+).',
    'This build: shinchiro/mpv-winbuild-cmake release 20261111 (https://github.com/shinchiro/mpv-winbuild-cmake).',
    'Source code: https://github.com/mpv-player/mpv and the build scripts in the repository above.',
    'Majlis dynamically loads libmpv-2.dll at runtime for in-process video rendering and can invoke mpv.exe in tests.',
  ].join('\r\n'));
  console.log(hasExe && hasDll ? `mpv & libmpv-2.dll ready in ${DIR}` : `mpv ready in ${DIR}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
