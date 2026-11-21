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
const DEFAULT_STALL_TIMEOUT_MS = 30000;
const DEFAULT_PARALLEL_CONNECTIONS = 6;
const DEFAULT_MIN_PARALLEL_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 3;

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

// Resettable inactivity watchdog: protects connect/headers AND resets on every body chunk
function createStallGuard(stallTimeoutMs) {
  const ac = new AbortController();
  let timer = null;
  let timedOut = false;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ac.abort(new Error(`Download stalled (no data for ${Math.max(1, Math.round(stallTimeoutMs / 1000))}s)`));
    }, stallTimeoutMs);
    timer.unref?.();
  };
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  arm();
  return {
    signal: ac.signal,
    touch: arm,
    clear,
    isTimedOut: () => timedOut,
    abort: (err) => { clear(); ac.abort(err); },
  };
}

async function fetchWithAllowlistedRedirects(initialUrl, fetchImpl, headers = {}, maxHops = 5, opts = {}) {
  const method = opts.method || 'GET';
  const stallTimeoutMs = opts.stallTimeoutMs || DEFAULT_STALL_TIMEOUT_MS;
  const guard = opts.guard || createStallGuard(stallTimeoutMs);
  const ownsGuard = !opts.guard;
  let cur = String(initialUrl || '').trim();
  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      if (!isAllowedDownloadUrl(cur)) {
        throw new Error(`Disallowed update download URL: ${cur}`);
      }
      guard.touch();
      const res = await fetchImpl(cur, {
        method,
        redirect: 'manual',
        headers: { 'User-Agent': 'Majlis-Updater', ...headers },
        signal: guard.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers?.get?.('location');
        if (!loc) throw new Error(`Redirect without location from ${cur}`);
        try { await res.body?.cancel?.(); } catch {}
        cur = new URL(loc, cur).toString();
        continue;
      }
      return { res, finalUrl: cur, guard };
    }
    throw new Error('Too many redirects while downloading update');
  } catch (err) {
    if (ownsGuard) guard.clear();
    throw err;
  }
}

async function readResponseWithStallGuard(res, guard, onChunk) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    try {
      for (;;) {
        guard.touch();
        const { done, value } = await reader.read();
        if (done) break;
        guard.touch();
        if (value && value.byteLength) onChunk(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return;
  }
  guard.touch();
  const buf = Buffer.from(await res.arrayBuffer());
  guard.touch();
  if (buf.length) onChunk(buf);
}

function parseContentRangeTotal(headerVal) {
  const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(String(headerVal || ''));
  return m ? Number(m[1]) : 0;
}

async function probeDownloadTarget(initialUrl, fetchImpl, stallTimeoutMs) {
  // Prefer HEAD to resolve GitHub -> objects.githubusercontent.com without starting a full body stream
  const headGuard = createStallGuard(stallTimeoutMs);
  try {
    const { res, finalUrl } = await fetchWithAllowlistedRedirects(initialUrl, fetchImpl, {}, 5, {
      method: 'HEAD',
      guard: headGuard,
      stallTimeoutMs,
    });
    if (res && res.ok) {
      const total = Number(res.headers?.get?.('content-length')) || 0;
      const acceptRanges = /bytes/i.test(String(res.headers?.get?.('accept-ranges') || ''));
      try { await res.body?.cancel?.(); } catch {}
      if (total > 0 && acceptRanges) {
        return { finalUrl, total, acceptRanges: true };
      }
      if (total > 0) {
        // Double-check range capability with a 1-byte GET (some CDNs omit Accept-Ranges on HEAD)
        const rGuard = createStallGuard(stallTimeoutMs);
        try {
          const { res: rRes, finalUrl: rFinal } = await fetchWithAllowlistedRedirects(finalUrl, fetchImpl, { Range: 'bytes=0-0' }, 5, {
            method: 'GET',
            guard: rGuard,
            stallTimeoutMs,
          });
          const okRange = rRes?.status === 206;
          const rTotal = parseContentRangeTotal(rRes?.headers?.get?.('content-range')) || total;
          try { await rRes?.body?.cancel?.(); } catch {}
          return { finalUrl: rFinal, total: rTotal, acceptRanges: okRange };
        } finally {
          rGuard.clear();
        }
      }
      return { finalUrl, total, acceptRanges };
    }
  } catch (err) {
    // Propagate security/redirect allowlist failures immediately
    if (/Disallowed update download URL|Too many redirects/i.test(String(err?.message || ''))) throw err;
  } finally {
    headGuard.clear();
  }
  return { finalUrl: initialUrl, total: 0, acceptRanges: false };
}

function hashFileSha256Sync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
      pos += n;
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
  return hash.digest('hex').toLowerCase();
}

function makeProgressTracker({ total, connections, initialBytes = 0, onProgress }) {
  let received = initialBytes;
  let lastEmit = 0;
  const samples = [{ t: Date.now(), bytes: initialBytes }];
  const emitNow = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 150) return;
    lastEmit = now;
    samples.push({ t: now, bytes: received });
    const cutoff = now - 2500;
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
    const oldest = samples[0];
    const dtSec = Math.max(0.15, (now - oldest.t) / 1000);
    const speedBps = Math.max(0, Math.round((received - oldest.bytes) / dtSec));
    const remaining = total > 0 ? Math.max(0, total - received) : 0;
    const etaSec = total > 0 && speedBps > 0 ? Math.ceil(remaining / speedBps) : null;
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    onProgress({ received, total, pct, speedBps, etaSec, connections });
  };
  return {
    add(n) {
      received += n;
      emitNow(total > 0 && received >= total);
    },
    setTotal(t) {
      if (t > 0) total = t;
    },
    getReceived: () => received,
    getTotal: () => total,
    flush: () => emitNow(true),
  };
}

function sleep(ms) {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

async function checkForUpdates({
  currentVersion = '0.1.3-beta',
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

async function downloadParallel({
  finalUrl,
  total,
  partPath,
  metaPath,
  expectedHash,
  connections,
  stallTimeoutMs,
  fetchImpl,
  onProgress,
}) {
  const numConns = Math.max(2, Math.min(6, connections));
  const chunkSize = Math.ceil(total / numConns);
  let chunks = [];
  for (let i = 0; i < numConns; i++) {
    const start = i * chunkSize;
    if (start >= total) break;
    const end = Math.min(total - 1, start + chunkSize - 1);
    chunks.push({ index: i, start, end, written: 0 });
  }

  let resuming = false;
  try {
    if (fs.existsSync(partPath) && fs.existsSync(metaPath) && fs.statSync(partPath).size === total) {
      const saved = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (
        saved &&
        saved.total === total &&
        saved.expectedHash === (expectedHash || null) &&
        Array.isArray(saved.chunks) &&
        saved.chunks.length === chunks.length
      ) {
        const valid = saved.chunks.every((c, idx) =>
          c.start === chunks[idx].start &&
          c.end === chunks[idx].end &&
          Number.isInteger(c.written) &&
          c.written >= 0 &&
          c.written <= (c.end - c.start + 1));
        if (valid) {
          chunks = saved.chunks;
          resuming = true;
        }
      }
    }
  } catch {}

  const saveMeta = () => {
    try {
      fs.writeFileSync(metaPath, JSON.stringify({ total, expectedHash: expectedHash || null, chunks }));
    } catch {}
  };

  const initialBytes = chunks.reduce((s, c) => s + c.written, 0);
  const tracker = makeProgressTracker({ total, connections: chunks.length, initialBytes, onProgress });
  if (initialBytes > 0) tracker.flush();

  const fd = fs.openSync(partPath, resuming ? 'r+' : 'w+');
  try {
    if (!resuming) {
      fs.ftruncateSync(fd, total);
      saveMeta();
    }

    const downloadChunk = async (chunk) => {
      const expectedLen = chunk.end - chunk.start + 1;
      let lastErr = null;
      for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
        if (chunk.written >= expectedLen) return;
        const rangeStart = chunk.start + chunk.written;
        const guard = createStallGuard(stallTimeoutMs);
        try {
          const { res } = await fetchWithAllowlistedRedirects(
            finalUrl,
            fetchImpl,
            { Range: `bytes=${rangeStart}-${chunk.end}` },
            5,
            { method: 'GET', guard, stallTimeoutMs },
          );
          if (res.status !== 206) {
            try { await res.body?.cancel?.(); } catch {}
            throw new Error(`Expected 206 Partial Content for chunk ${chunk.index}, got ${res.status}`);
          }
          await readResponseWithStallGuard(res, guard, (buf) => {
            const left = expectedLen - chunk.written;
            if (left <= 0) return;
            const slice = buf.length > left ? buf.subarray(0, left) : buf;
            fs.writeSync(fd, slice, 0, slice.length, chunk.start + chunk.written);
            chunk.written += slice.length;
            tracker.add(slice.length);
          });
          saveMeta();
          if (chunk.written >= expectedLen) return;
          throw new Error(`Chunk ${chunk.index} ended early (${chunk.written}/${expectedLen})`);
        } catch (err) {
          lastErr = err;
          saveMeta();
          if (/Disallowed update download URL/i.test(String(err?.message || ''))) throw err;
          if (attempt < MAX_CHUNK_RETRIES) {
            await sleep(Math.min(4000, 400 * (2 ** attempt)));
          }
        } finally {
          guard.clear();
        }
      }
      throw lastErr || new Error(`Chunk ${chunk.index} failed`);
    };

    await Promise.all(chunks.map((c) => downloadChunk(c)));
    tracker.flush();
    return tracker.getReceived();
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

async function downloadSingleStream({
  url,
  partPath,
  stallTimeoutMs,
  fetchImpl,
  onProgress,
}) {
  let existingSize = 0;
  try {
    if (fs.existsSync(partPath)) existingSize = fs.statSync(partPath).size;
  } catch {}

  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    const reqHeaders = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {};
    const guard = createStallGuard(stallTimeoutMs);
    try {
      const { res } = await fetchWithAllowlistedRedirects(url, fetchImpl, reqHeaders, 5, {
        method: 'GET',
        guard,
        stallTimeoutMs,
      });
      if (!res.ok && res.status !== 206) {
        if (res.status === 416 && existingSize > 0) {
          // Existing .part is already >= remote size; restart clean
          existingSize = 0;
          try { fs.unlinkSync(partPath); } catch {}
          continue;
        }
        throw new Error(`Download failed (${res.status})`);
      }

      const isResumed = res.status === 206 && existingSize > 0;
      const contentLen = Number(res.headers?.get?.('content-length')) || 0;
      const rangeTotal = parseContentRangeTotal(res.headers?.get?.('content-range'));
      const total = rangeTotal || (isResumed ? existingSize + contentLen : contentLen);
      const tracker = makeProgressTracker({
        total,
        connections: 1,
        initialBytes: isResumed ? existingSize : 0,
        onProgress,
      });

      const fd = fs.openSync(partPath, isResumed ? 'a' : 'w');
      try {
        await readResponseWithStallGuard(res, guard, (buf) => {
          fs.writeSync(fd, buf);
          tracker.add(buf.length);
        });
      } finally {
        try { fs.closeSync(fd); } catch {}
      }

      const finalReceived = tracker.getReceived();
      if (total > 0 && finalReceived < total) {
        existingSize = finalReceived;
        throw new Error(`Download ended early (${finalReceived}/${total})`);
      }
      tracker.setTotal(total || finalReceived);
      tracker.flush();
      return finalReceived;
    } catch (err) {
      lastErr = err;
      if (/Disallowed update download URL|Too many redirects/i.test(String(err?.message || ''))) throw err;
      try {
        if (fs.existsSync(partPath)) existingSize = fs.statSync(partPath).size;
      } catch {}
      if (attempt < MAX_CHUNK_RETRIES) {
        await sleep(Math.min(4000, 400 * (2 ** attempt)));
      }
    } finally {
      guard.clear();
    }
  }
  throw lastErr || new Error('Download failed');
}

async function downloadUpdate({
  url,
  sha256Url = null,
  destDir,
  fileName = 'Majlis-Setup.exe',
  onProgress = () => {},
  fetchImpl = fetch,
  stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  connections = DEFAULT_PARALLEL_CONNECTIONS,
  minParallelBytes = DEFAULT_MIN_PARALLEL_BYTES,
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
  const metaPath = `${partPath}.meta.json`;

  let expectedHash = null;
  if (sha256Url) {
    const sumGuard = createStallGuard(stallTimeoutMs);
    try {
      const { res: sumsRes } = await fetchWithAllowlistedRedirects(sha256Url, fetchImpl, {}, 5, {
        method: 'GET',
        guard: sumGuard,
        stallTimeoutMs,
      });
      if (!sumsRes.ok) throw new Error(`Failed to fetch SHA256SUMS.txt (${sumsRes.status})`);
      const sumsText = await sumsRes.text();
      expectedHash = parseSha256Sums(sumsText, safeName);
      if (!expectedHash) throw new Error(`Missing checksum entry for ${safeName}`);
    } finally {
      sumGuard.clear();
    }
  }

  const probe = await probeDownloadTarget(url, fetchImpl, stallTimeoutMs);
  let received = 0;
  let usedParallel = false;

  if (probe.acceptRanges && probe.total >= minParallelBytes && connections > 1) {
    try {
      received = await downloadParallel({
        finalUrl: probe.finalUrl,
        total: probe.total,
        partPath,
        metaPath,
        expectedHash,
        connections,
        stallTimeoutMs,
        fetchImpl,
        onProgress,
      });
      usedParallel = true;
    } catch (err) {
      if (/Disallowed update download URL/i.test(String(err?.message || ''))) throw err;
      // Clean partial parallel state and fall back to resumable single-stream download
      try { fs.unlinkSync(metaPath); } catch {}
      try { fs.unlinkSync(partPath); } catch {}
    }
  }

  if (!usedParallel) {
    received = await downloadSingleStream({
      url: probe.finalUrl || url,
      partPath,
      stallTimeoutMs,
      fetchImpl,
      onProgress,
    });
  }

  // Verify Windows PE header ("MZ") before trusting or moving the installer
  const magic = Buffer.alloc(2);
  const checkFd = fs.openSync(partPath, 'r');
  try {
    const n = fs.readSync(checkFd, magic, 0, 2, 0);
    if (n < 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
      try { fs.unlinkSync(partPath); } catch {}
      try { fs.unlinkSync(metaPath); } catch {}
      throw new Error('Downloaded installer is not a valid Windows PE executable');
    }
  } finally {
    try { fs.closeSync(checkFd); } catch {}
  }

  const actualHash = hashFileSha256Sync(partPath);
  if (expectedHash && actualHash !== expectedHash) {
    try { fs.unlinkSync(partPath); } catch {}
    try { fs.unlinkSync(metaPath); } catch {}
    throw new Error(`SHA-256 verification failed (${actualHash} != ${expectedHash})`);
  }

  try { fs.unlinkSync(metaPath); } catch {}
  fs.renameSync(partPath, finalPath);
  onProgress({ received, total: probe.total || received, pct: 100, speedBps: 0, etaSec: 0, connections: usedParallel ? Math.max(2, Math.min(6, connections)) : 1 });
  return {
    ok: true,
    filePath: finalPath,
    sha256: actualHash,
    verified: !!expectedHash,
    size: received,
    parallel: usedParallel,
  };
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
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_PARALLEL_CONNECTIONS,
  parseSemver,
  compareSemver,
  isAllowedDownloadUrl,
  parseSha256Sums,
  checkForUpdates,
  downloadUpdate,
  installDownloadedUpdate,
};
