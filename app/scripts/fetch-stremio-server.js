'use strict';
// Downloads official stremio-server (server.js v4.20.16) + Node 22 LTS win-x64 runtime
// into engine/vendor/stremio and syncs stremio-launcher.js, all verified via SHA-256.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const STREMIO_VERSION = 'v4.20.16';
const STREMIO_URL = `https://dl.strem.io/server/${STREMIO_VERSION}/desktop/server.js`;
const STREMIO_SHA256 = '88e887f058765f0e3dbc636829e7687ab80759c392eb9a64df457c8f9fc86e28';

const NODE_VERSION = 'v22.23.5';
const NODE_ARCHIVE_NAME = `node-${NODE_VERSION}-win-x64`;
const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE_NAME}.zip`;
const NODE_ZIP_SHA256 = '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3';

const DIR = path.join(__dirname, '../../engine/vendor/stremio');
const LAUNCHER_SRC = path.join(__dirname, '../src/main/stremio-launcher.js');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

function fileSha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toLowerCase();
}

async function fetchVerifiedBuffer(url, expectedSha256, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Majlis-Sidecar-Fetch' }, signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Download failed (${label}): ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
  if (expectedSha256 && actual !== expectedSha256) {
    throw new Error(`SHA-256 mismatch (${label}): expected ${expectedSha256}, got ${actual}`);
  }
  return buf;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const serverDst = path.join(DIR, 'server.js');
  const nodeDst = path.join(DIR, 'node.exe');
  const launcherDst = path.join(DIR, 'stremio-launcher.js');

  let updated = 0;

  if (!fs.existsSync(serverDst) || fileSha256(serverDst) !== STREMIO_SHA256) {
    const buf = await fetchVerifiedBuffer(STREMIO_URL, STREMIO_SHA256, `stremio-server ${STREMIO_VERSION}`);
    fs.writeFileSync(serverDst, buf);
    updated++;
  }

  let nodeOk = fs.existsSync(nodeDst);
  if (nodeOk) {
    try {
      const ver = execFileSync(nodeDst, ['-v'], { windowsHide: true, timeout: 5000, encoding: 'utf8' }).trim();
      nodeOk = ver === NODE_VERSION;
    } catch {
      nodeOk = false;
    }
  }
  if (!nodeOk) {
    const zipBuf = await fetchVerifiedBuffer(NODE_ZIP_URL, NODE_ZIP_SHA256, NODE_ARCHIVE_NAME);
    const stageDir = path.join(DIR, '.tmp-node');
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    try {
      const zipPath = path.join(stageDir, 'node.zip');
      fs.writeFileSync(zipPath, zipBuf);
      execFileSync(
        TAR,
        ['-xf', zipPath, '-C', stageDir, `${NODE_ARCHIVE_NAME}/node.exe`, `${NODE_ARCHIVE_NAME}/LICENSE`],
        { windowsHide: true, timeout: 90000 },
      );
      fs.copyFileSync(path.join(stageDir, NODE_ARCHIVE_NAME, 'node.exe'), nodeDst);
      fs.copyFileSync(path.join(stageDir, NODE_ARCHIVE_NAME, 'LICENSE'), path.join(DIR, 'LICENSE-node.txt'));
      const ver = execFileSync(nodeDst, ['-v'], { windowsHide: true, timeout: 5000, encoding: 'utf8' }).trim();
      if (ver !== NODE_VERSION) throw new Error(`Extracted node.exe version mismatch: ${ver}`);
      updated++;
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }

  if (fs.existsSync(LAUNCHER_SRC)) {
    const srcText = fs.readFileSync(LAUNCHER_SRC);
    const curText = fs.existsSync(launcherDst) ? fs.readFileSync(launcherDst) : null;
    if (!curText || !srcText.equals(curText)) {
      fs.writeFileSync(launcherDst, srcText);
    }
  } else {
    throw new Error(`Missing stremio-launcher.js source at ${LAUNCHER_SRC}`);
  }

  fs.writeFileSync(path.join(DIR, 'LICENSE-stremio-server.txt'), [
    `Stremio local streaming server (${STREMIO_VERSION}) distributed from ${STREMIO_URL}.`,
    'Executed in isolated sidecar Node.js process bound strictly to 127.0.0.1 for local Cinema playback.',
  ].join('\r\n'));

  console.log(updated > 0 ? `stremio-server (${STREMIO_VERSION}) & Node ${NODE_VERSION} ready in ${DIR}` : `stremio-server & Node ${NODE_VERSION} already up to date in ${DIR}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
