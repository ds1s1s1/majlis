'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/ds1s1s1/majlis/releases?per_page=10';
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function parseSemver(raw) {
  const clean = String(raw || '').trim().replace(/^v/i, '').split('+')[0];
  const dashIdx = clean.indexOf('-');
  const coreStr = dashIdx >= 0 ? clean.slice(0, dashIdx) : clean;
  const preStr = dashIdx >= 0 ? clean.slice(dashIdx + 1) : '';
  const coreParts = coreStr.split('.').map((n) => parseInt(n, 10));
  if (coreParts.length < 3 || coreParts.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  const pre = preStr
    ? preStr.split('.').filter(Boolean).map((p) => (/^\d+$/.test(p) ? Number(p) : p.toLowerCase()))
    : [];
  return { major: coreParts[0], minor: coreParts[1], patch: coreParts[2], pre };
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === y) continue;
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return x > y ? 1 : -1;
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function isAllowedDownloadUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    if (u.protocol !== 'https:') return false;
    return ALLOWED_DOWNLOAD_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseSha256Sums(text, filename = 'Majlis-Setup.exe') {
  const target = String(filename || '').trim().toLowerCase();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const file = path.basename(m[2].trim()).toLowerCase();
    if (!target || file === target) return m[1].toLowerCase();
  }
  return null;
}

async function fetchWithAllowlistedRedirects(initialUrl, fetchImpl, headers = {}, maxHops = 5) {
  let cur = String(initialUrl || '').trim();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isAllowedDownloadUrl(cur)) {
      throw new Error(`Disallowed update download URL: ${cur}`);
    }
    const res = await fetchImpl(cur, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'Majlis-Updater', ...headers },
      signal: AbortSignal.timeout(120000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers?.get?.('location');
      if (!loc) throw new Error(`Redirect without location from ${cur}`);
      cur = new URL(loc, cur).toString();
      continue;
    }
    return { res, finalUrl: cur };
  }
  throw new Error('Too many redirects while downloading update');
}

async function checkForUpdates({
  currentVersion = '0.1.2-beta',
  betaChannel = true,
  fetchImpl = fetch,
  releasesUrl = GITHUB_RELEASES_URL,
} = {}) {
  const res = await fetchImpl(releasesUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Majlis-Updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`GitHub releases check failed (${res.status})`);
  }
  const rawList = await res.json();
  const eligible = (Array.isArray(rawList) ? rawList : [])
    .filter((r) => r && !r.draft && parseSemver(r.tag_name) && (betaChannel || !r.prerelease))
    .sort((a, b) => compareSemver(b.tag_name, a.tag_name));

  const latest = eligible[0] || null;
  const assets = Array.isArray(latest?.assets) ? latest.assets : [];
  const setupAsset = assets.find((a) => /^Majlis-Setup\.exe$/i.test(a?.name || ''))
    || assets.find((a) => /\.exe$/i.test(a?.name || ''))
    || null;
  const sumsAsset = assets.find((a) => /^SHA256SUMS\.txt$/i.test(a?.name || '')) || null;

  const downloadUrl = setupAsset?.browser_download_url && isAllowedDownloadUrl(setupAsset.browser_download_url)
    ? setupAsset.browser_download_url
    : null;
  const sha256Url = sumsAsset?.browser_download_url && isAllowedDownloadUrl(sumsAsset.browser_download_url)
    ? sumsAsset.browser_download_url
    : null;

  const latestTag = latest?.tag_name || null;
  const latestVersion = latestTag ? String(latestTag).replace(/^v/i, '') : null;
  const updateAvailable = !!(latestTag && compareSemver(latestTag, currentVersion) > 0);

  return {
    ok: true,
    version: currentVersion,
    currentVersion,
    latestTag,
    latestVersion,
    updateAvailable,
    prerelease: !!latest?.prerelease,
    releaseUrl: latest?.html_url || 'https://github.com/ds1s1s1/majlis/releases',
    releaseNotes: String(latest?.body || '').slice(0, 4000),
    publishedAt: latest?.published_at || null,
    downloadUrl,
    sha256Url,
    assetName: setupAsset?.name || 'Majlis-Setup.exe',
    assetSize: Number(setupAsset?.size) || 0,
    releases: eligible.slice(0, 6).map((r) => ({
      tag: r.tag_name,
      version: String(r.tag_name).replace(/^v/i, ''),
      name: r.name || r.tag_name,
      prerelease: !!r.prerelease,
      publishedAt: r.published_at || null,
      url: r.html_url || 'https://github.com/ds1s1s1/majlis/releases',
      current: compareSemver(r.tag_name, currentVersion) === 0,
    })),
    checkedAt: Date.now(),
  };
}

async function downloadUpdate({
  url,
  sha256Url = null,
  destDir,
  fileName = 'Majlis-Setup.exe',
  onProgress = () => {},
  fetchImpl = fetch,
} = {}) {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error('Blocked download URL host');
  }
  const safeName = path.basename(String(fileName || 'Majlis-Setup.exe'));
  if (!/\.exe$/i.test(safeName)) {
    throw new Error('Invalid installer file name');
  }
  fs.mkdirSync(destDir, { recursive: true });
  const finalPath = path.join(destDir, safeName);
  const partPath = `${finalPath}.part`;

  let expectedHash = null;
  if (sha256Url) {
    const { res: sumsRes } = await fetchWithAllowlistedRedirects(sha256Url, fetchImpl);
    if (!sumsRes.ok) throw new Error(`Failed to fetch SHA256SUMS.txt (${sumsRes.status})`);
    const sumsText = await sumsRes.text();
    expectedHash = parseSha256Sums(sumsText, safeName);
    if (!expectedHash) throw new Error(`Missing checksum entry for ${safeName}`);
  }

  const { res } = await fetchWithAllowlistedRedirects(url, fetchImpl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);

  const total = Number(res.headers?.get?.('content-length')) || 0;
  let received = 0;
  let lastEmit = 0;
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(partPath, 'w');
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        fs.writeSync(fd, buf);
        hash.update(buf);
        received += buf.length;
        const now = Date.now();
        if (now - lastEmit >= 120 || (total > 0 && received >= total)) {
          lastEmit = now;
          onProgress({ received, total, pct: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0 });
        }
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeSync(fd, buf);
      hash.update(buf);
      received = buf.length;
      onProgress({ received, total: total || received, pct: 100 });
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }

  // Verify Windows PE header ("MZ") before trusting or moving the installer
  const magic = Buffer.alloc(2);
  const checkFd = fs.openSync(partPath, 'r');
  try {
    const n = fs.readSync(checkFd, magic, 0, 2, 0);
    if (n < 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
      try { fs.unlinkSync(partPath); } catch {}
      throw new Error('Downloaded installer is not a valid Windows PE executable');
    }
  } finally {
    try { fs.closeSync(checkFd); } catch {}
  }

  const actualHash = hash.digest('hex').toLowerCase();
  if (expectedHash && actualHash !== expectedHash) {
    try { fs.unlinkSync(partPath); } catch {}
    throw new Error(`SHA-256 verification failed (${actualHash} != ${expectedHash})`);
  }

  fs.renameSync(partPath, finalPath);
  onProgress({ received, total: total || received, pct: 100 });
  return { ok: true, filePath: finalPath, sha256: actualHash, verified: !!expectedHash, size: received };
}

function installDownloadedUpdate(filePath, { app = null, spawnImpl = spawn } = {}) {
  const target = path.resolve(String(filePath || ''));
  if (!/\.exe$/i.test(target) || !fs.existsSync(target)) {
    throw new Error('Downloaded installer executable not found');
  }
  const magic = Buffer.alloc(2);
  const fd = fs.openSync(target, 'r');
  try {
    const n = fs.readSync(fd, magic, 0, 2, 0);
    if (n < 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
      throw new Error('Refusing to launch invalid installer binary');
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
  const child = spawnImpl(target, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(target),
  });
  child.unref?.();
  if (app?.quit) {
    const qt = setTimeout(() => app.quit(), 180);
    qt.unref?.();
  }
  return { ok: true, filePath: target };
}

module.exports = {
  GITHUB_RELEASES_URL,
  ALLOWED_DOWNLOAD_HOSTS,
  parseSemver,
  compareSemver,
  isAllowedDownloadUrl,
  parseSha256Sums,
  checkForUpdates,
  downloadUpdate,
  installDownloadedUpdate,
};
