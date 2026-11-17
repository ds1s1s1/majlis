'use strict';
// Checks built copies before they're shared (run after electron-builder):
//  - no build-config.json in the public copy (friends copy must have it)
//  - no local paths / Windows user name inside our own binaries
//  - the hardening fuses really are flipped in the packaged exe
// usage: node scripts/check-release.js [dist-friends] [dist-public]
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');

const WANT_FUSES = {
  RunAsNode: FuseState.DISABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
};

function ours(dir) {
  const res = path.join(dir, 'resources');
  const out = [];
  for (const sub of ['engine', 'app.asar.unpacked/native']) {
    const d = path.join(res, sub);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (/\.(exe|node|dll)$/i.test(f)) out.push(path.join(d, f));
  }
  return out;
}

async function check(dist, wantConfig) {
  const dir = path.join(__dirname, '..', dist, 'win-unpacked');
  const errs = [];
  if (!fs.existsSync(dir)) return [`${dist}: not built`];
  const files = asar.listPackage(path.join(dir, 'resources', 'app.asar'));
  const cfg = files.filter((f) => /build-config/.test(f)).length;
  if (cfg !== wantConfig) errs.push(`${dist}: build-config.json found ${cfg}x, want ${wantConfig}`);
  // the account name and the profile folder can differ (an Arabic account name, a Latin folder)
  const names = [...new Set([os.userInfo().username, path.basename(os.homedir())].map((x) => x.toLowerCase()))];
  for (const f of ours(dir)) {
    const s = fs.readFileSync(f).toString('latin1').toLowerCase();
    const n = names.reduce((a, x) => a + s.split(x).length - 1, 0), u = s.split('c:\\users\\').length - 1;
    if (n || u) errs.push(`${dist}: ${path.relative(dir, f)} holds the user name ${n}x, C:\\Users\\ ${u}x`);
  }
  const exe = fs.readdirSync(dir).find((f) => /\.exe$/i.test(f) && !/uninst/i.test(f));
  const wire = await getCurrentFuseWire(path.join(dir, exe));
  for (const [k, want] of Object.entries(WANT_FUSES)) if (wire[FuseV1Options[k]] !== want) errs.push(`${dist}: fuse ${k} is not set`);
  return errs;
}

(async () => {
  const [friends = 'dist-friends', pub = 'dist-public'] = process.argv.slice(2);
  const errs = [...await check(friends, 1), ...await check(pub, 0)];
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log('release check ok: config placement, no local paths, fuses set');
})();
