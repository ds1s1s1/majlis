'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  compareSemver,
  isAllowedDownloadUrl,
  parseSha256Sums,
  checkForUpdates,
  downloadUpdate,
} = require('../src/main/updater');
const { scrubDiagnosticsReport } = require('../src/main/media/hub');

test('phase4 updater: compareSemver handles prerelease tags correctly', () => {
  assert.equal(compareSemver('v0.1.0-beta', '0.1.1-beta'), -1);
  assert.equal(compareSemver('0.1.1-beta', '0.1.1'), -1);
  assert.equal(compareSemver('0.1.1-beta.2', '0.1.1-beta.1'), 1);
  assert.equal(compareSemver('0.2.0-alpha.1', '0.1.9'), 1);
  assert.equal(compareSemver('v0.1.1-beta', '0.1.1-beta'), 0);
});

test('phase4 updater: isAllowedDownloadUrl strictly allowlists GitHub HTTPS release hosts', () => {
  assert.equal(isAllowedDownloadUrl('https://github.com/ds1s1s1/majlis/releases/download/v0.1.1-beta/Majlis-Setup.exe'), true);
  assert.equal(isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/123'), true);
  assert.equal(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/file.exe'), true);
  assert.equal(isAllowedDownloadUrl('http://github.com/ds1s1s1/majlis/Majlis-Setup.exe'), false);
  assert.equal(isAllowedDownloadUrl('https://evil.example.com/Majlis-Setup.exe'), false);
});

test('phase4 updater: checkForUpdates respects betaChannel and detects newer releases', async () => {
  const mockReleases = [
    {
      tag_name: 'v0.1.2-beta',
      prerelease: true,
      draft: false,
      html_url: 'https://github.com/ds1s1s1/majlis/releases/tag/v0.1.2-beta',
      body: 'Beta notes',
      assets: [
        { name: 'Majlis-Setup.exe', size: 123456, browser_download_url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.2-beta/Majlis-Setup.exe' },
        { name: 'SHA256SUMS.txt', size: 90, browser_download_url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.2-beta/SHA256SUMS.txt' },
      ],
    },
    {
      tag_name: 'v0.1.0',
      prerelease: false,
      draft: false,
      html_url: 'https://github.com/ds1s1s1/majlis/releases/tag/v0.1.0',
      body: 'Stable notes',
      assets: [],
    },
  ];
  const fakeFetch = async () => ({ ok: true, json: async () => mockReleases });

  const withBeta = await checkForUpdates({ currentVersion: '0.1.0-beta', betaChannel: true, fetchImpl: fakeFetch });
  assert.equal(withBeta.updateAvailable, true);
  assert.equal(withBeta.latestTag, 'v0.1.2-beta');
  assert.ok(withBeta.downloadUrl);

  const stableOnly = await checkForUpdates({ currentVersion: '0.1.0-beta', betaChannel: false, fetchImpl: fakeFetch });
  assert.equal(stableOnly.updateAvailable, true);
  assert.equal(stableOnly.latestTag, 'v0.1.0');
});

test('phase4 updater: downloadUpdate verifies MZ PE header, SHA-256 checksum, and blocks disallowed redirect hosts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-upd-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fakeExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
  const expectedSha = crypto.createHash('sha256').update(fakeExe).digest('hex');
  assert.equal(parseSha256Sums(`${expectedSha}  Majlis-Setup.exe\n`, 'Majlis-Setup.exe'), expectedSha);

  const okFetch = async (u) => {
    if (String(u).endsWith('SHA256SUMS.txt')) {
      return { ok: true, status: 200, headers: new Headers(), text: async () => `${expectedSha}  Majlis-Setup.exe\n` };
    }
    return { ok: true, status: 200, headers: new Headers({ 'content-length': String(fakeExe.length) }), arrayBuffer: async () => fakeExe };
  };

  const out = await downloadUpdate({
    url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.1-beta/Majlis-Setup.exe',
    sha256Url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.1-beta/SHA256SUMS.txt',
    destDir: dir,
    fetchImpl: okFetch,
  });
  assert.equal(out.ok, true);
  assert.equal(out.verified, true);
  assert.equal(out.sha256, expectedSha);

  await assert.rejects(
    downloadUpdate({
      url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.1-beta/Majlis-Setup.exe',
      destDir: dir,
      fetchImpl: async () => ({
        status: 302,
        headers: new Headers({ location: 'https://evil.example.com/bad.exe' }),
      }),
    }),
    /Disallowed update download URL/,
  );
});

test('updater: multi-connection Range chunking retries transient chunk drop, streams speed/ETA, and verifies SHA-256', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-upd-par-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const payload = Buffer.alloc(128 * 1024);
  payload[0] = 0x4d; // 'M'
  payload[1] = 0x5a; // 'Z'
  for (let i = 2; i < payload.length; i++) payload[i] = (i * 31) & 0xff;
  const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

  let rangeCalls = 0;
  let droppedOnce = false;
  const progressEvents = [];

  const mockFetch = async (u, init = {}) => {
    const urlStr = String(u);
    if (urlStr.endsWith('SHA256SUMS.txt')) {
      return { ok: true, status: 200, headers: new Headers(), text: async () => `${expectedSha}  Majlis-Setup.exe\n` };
    }
    if (urlStr.includes('github.com/')) {
      return {
        ok: false,
        status: 302,
        headers: new Headers({ location: 'https://objects.githubusercontent.com/assets/Majlis-Setup.exe' }),
      };
    }
    if ((init.method || 'GET').toUpperCase() === 'HEAD') {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(payload.length), 'accept-ranges': 'bytes' }),
      };
    }
    const rangeHdr = init.headers?.Range || init.headers?.range || '';
    const m = /^bytes=(\d+)-(\d+)$/i.exec(rangeHdr);
    if (m) {
      rangeCalls++;
      const start = Number(m[1]);
      const end = Number(m[2]);
      // Simulate one mid-chunk network drop on the 2nd chunk to verify per-chunk retry + resume
      if (!droppedOnce && rangeCalls === 2) {
        droppedOnce = true;
        const partial = payload.subarray(start, Math.min(end + 1, start + 1024));
        let sent = false;
        return {
          ok: true,
          status: 206,
          headers: new Headers({ 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${payload.length}` }),
          body: {
            getReader() {
              return {
                async read() {
                  if (!sent) { sent = true; return { done: false, value: partial }; }
                  throw new Error('ECONNRESET');
                },
                releaseLock() {},
              };
            },
          },
        };
      }
      const slice = payload.subarray(start, end + 1);
      return {
        ok: true,
        status: 206,
        headers: new Headers({ 'content-length': String(slice.length), 'content-range': `bytes ${start}-${end}/${payload.length}` }),
        arrayBuffer: async () => slice,
      };
    }
    return { ok: true, status: 200, headers: new Headers({ 'content-length': String(payload.length) }), arrayBuffer: async () => payload };
  };

  const out = await downloadUpdate({
    url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.2-beta/Majlis-Setup.exe',
    sha256Url: 'https://github.com/ds1s1s1/majlis/releases/download/v0.1.2-beta/SHA256SUMS.txt',
    destDir: dir,
    fetchImpl: mockFetch,
    connections: 4,
    minParallelBytes: 16 * 1024,
    onProgress: (p) => progressEvents.push(p),
  });

  assert.equal(out.ok, true);
  assert.equal(out.parallel, true);
  assert.equal(out.verified, true);
  assert.equal(out.sha256, expectedSha);
  assert.equal(out.size, payload.length);
  assert.ok(rangeCalls >= 5, `expected >= 5 Range calls (4 chunks + 1 retry), got ${rangeCalls}`);
  assert.equal(fs.readFileSync(out.filePath).equals(payload), true);
  assert.ok(progressEvents.some((p) => typeof p.speedBps === 'number' && p.connections === 4));
});

test('updater: per-chunk inactivity timeout resets while data flows (no fixed total timeout)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-upd-flow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const chunks = [Buffer.from([0x4d, 0x5a, 1, 2]), Buffer.from([3, 4, 5, 6]), Buffer.from([7, 8, 9, 10]), Buffer.from([11, 12, 13, 14])];
  const full = Buffer.concat(chunks);
  // Total duration ~280ms > stallTimeoutMs (120ms), proving timer resets per chunk instead of fixed total duration
  const slowSteadyFetch = async (_u, init = {}) => {
    if ((init.method || 'GET').toUpperCase() === 'HEAD') return { ok: false, status: 405, headers: new Headers() };
    let idx = 0;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(full.length) }),
      body: {
        getReader() {
          return {
            async read() {
              if (idx >= chunks.length) return { done: true };
              await new Promise((r) => setTimeout(r, 70));
              if (init.signal?.aborted) throw init.signal.reason || new Error('aborted');
              return { done: false, value: chunks[idx++] };
            },
            releaseLock() {},
          };
        },
      },
    };
  };

  const out = await downloadUpdate({
    url: 'https://objects.githubusercontent.com/assets/Majlis-Setup.exe',
    destDir: dir,
    fetchImpl: slowSteadyFetch,
    stallTimeoutMs: 160,
    minParallelBytes: 1024 * 1024,
  });
  assert.equal(out.ok, true);
  assert.equal(out.size, full.length);
});

test('phase4 security: scrubDiagnosticsReport redacts home dirs, Windows/POSIX paths, emails, and URL credentials', () => {
  const dirty = {
    pathWin: 'C:\\Users\\AliceUser\\AppData\\Roaming\\Majlis\\config.json',
    pathFwd: 'C:/Users/AliceUser/Videos/test.mkv',
    posixPath: '/Users/alice/test.mp4',
    relay: 'https://alice:supersecretpass@relay.example.org/ws',
    mail: 'alice@example.org',
    accessKey: 'secret_token_value',
    nestedSecret: 'Bearer abcdefghijklmnop and MY_SECRET_KEY',
  };
  const clean = scrubDiagnosticsReport(dirty, ['MY_SECRET_KEY']);
  const dump = JSON.stringify(clean);
  assert.equal(dump.includes('AliceUser'), false);
  assert.equal(dump.includes('supersecretpass'), false);
  assert.equal(dump.includes('alice@example.org'), false);
  assert.equal(dump.includes('secret_token_value'), false);
  assert.equal(dump.includes('MY_SECRET_KEY'), false);
  assert.equal(dump.includes('abcdefghijklmnop'), false);
});
