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
