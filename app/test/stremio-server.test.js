'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  StremioServerService,
  sidecarPaths,
  pickVideoFileIdx,
  trackersFromSources,
} = require('../src/main/stremio-server');

const paths = sidecarPaths();

test('stremio-server helpers: pickVideoFileIdx & trackersFromSources work deterministically', () => {
  const files = [
    { name: 'sample.mkv', length: 50000000 },
    { name: 'Feature.Film.2025.2160p.mkv', length: 12000000000 },
    { name: 'Feature.Film.2025.ar.srt', length: 90000 },
  ];
  assert.equal(pickVideoFileIdx(files), 1);
  assert.equal(pickVideoFileIdx(files, 0), 0);
  assert.equal(pickVideoFileIdx(files, null, 2), 2);
  assert.deepEqual(
    trackersFromSources(['dht:abc', 'tracker:udp://t.example:1337/announce', 'https://t2.example/announce']),
    ['udp://t.example:1337/announce', 'https://t2.example/announce'],
  );
});

test('stremio-server sidecar: boots on isolated 127.0.0.1:11475+, serves /settings, generates /hlsv2/ URL, and stops cleanly', {
  skip: !(paths.nodeExe && paths.serverJs && paths.launcherJs) && 'stremio-server sidecars unavailable',
}, async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-stremio-test-'));
  const svc = new StremioServerService({
    getCacheDir: () => cacheDir,
    basePort: 11485,
  });
  let spawnedPid = null;
  try {
    const hls = await svc.hlsTranscodeUrl('http://127.0.0.1:1/test.mkv');
    spawnedPid = svc.p?.pid || null;
    assert.ok(spawnedPid > 0, 'expected spawned node sidecar pid');
    assert.ok(svc.port >= 11485 && svc.port !== 12470, `unexpected port ${svc.port}`);
    assert.equal(svc.base, `http://127.0.0.1:${svc.port}`);
    assert.ok(hls.url.startsWith(`${svc.base}/hlsv2/`), `unexpected hls url: ${hls.url}`);

    const r = await fetch(`${svc.base}/settings`, { signal: AbortSignal.timeout(2500) });
    assert.equal(r.status, 200);
    const st = svc.status();
    assert.equal(st.running, true);
    assert.equal(st.ready, true);
    assert.equal(st.port, svc.port);
  } finally {
    svc.stop(true);
    if (spawnedPid) {
      let alive = false;
      for (let i = 0; i < 15; i++) {
        try { process.kill(spawnedPid, 0); alive = true; } catch { alive = false; break; }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(alive, false, `stremio-server pid ${spawnedPid} survived stop(true)`);
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
