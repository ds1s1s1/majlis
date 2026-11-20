'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CacheManager } = require('../src/main/cache-manager');

test('cache-manager: evicts expired & oldest LRU files down to cap while protecting active streams and downloads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-cache-test-'));
  try {
    const dataDir = path.join(root, 'data');
    const tempDir = path.join(root, 'temp');
    const dlDir = path.join(root, 'downloads');
    const streamDir = path.join(tempDir, 'majlis-media');
    const httpDir = path.join(dataDir, 'media-cache');
    fs.mkdirSync(streamDir, { recursive: true });
    fs.mkdirSync(httpDir, { recursive: true });
    fs.mkdirSync(dlDir, { recursive: true });

    const activeFile = path.join(streamDir, 'active-movie.mkv');
    const oldStreamFile = path.join(streamDir, 'old-movie.mkv');
    const midHttpFile = path.join(httpDir, 'mid.json');
    const newHttpFile = path.join(httpDir, 'new.json');
    const permDownload = path.join(dlDir, 'permanent.mkv');

    const nowMs = Date.now();
    const mk = (fp, bytes, ageMs) => {
      fs.writeFileSync(fp, Buffer.alloc(bytes, 7));
      const t = new Date(nowMs - ageMs);
      fs.utimesSync(fp, t, t);
    };

    mk(activeFile, 1200, 10 * 86400000);   // even though old, it is active!
    mk(oldStreamFile, 1200, 9 * 86400000); // > keepCachedDays (7d) -> Phase 1 expiry
    mk(midHttpFile, 1500, 2 * 3600000);    // 2h old -> Phase 2 oldest LRU
    mk(newHttpFile, 800, 60000);           // 1m old -> stays
    mk(permDownload, 5000, 30 * 86400000); // permanent download -> NEVER evicted

    // ~0.0000023 GB cap (~2469 bytes) so activeFile(1200) + newHttpFile(800) = 2000 <= cap, forcing midHttpFile(1500) eviction
    const mgr = new CacheManager({
      dataDir,
      tempDir,
      getDownloadDir: () => dlDir,
      getActiveFiles: async () => [activeFile],
      getSettings: () => ({ keepCachedDays: 7, maxCacheGb: 2400 / (1024 ** 3) }),
    });

    const before = await mgr.stats();
    assert.strictEqual(before.categories.stream.bytes, 2400);
    assert.strictEqual(before.categories.http.bytes, 2300);

    const res = await mgr.enforce({ nowMs });
    assert.ok(res.removedFiles >= 2);
    assert.strictEqual(fs.existsSync(oldStreamFile), false, 'expired file evicted');
    assert.strictEqual(fs.existsSync(midHttpFile), false, 'older LRU file evicted');
    assert.strictEqual(fs.existsSync(newHttpFile), true, 'newest file kept');
    assert.strictEqual(fs.existsSync(activeFile), true, 'active playing file strictly protected');
    assert.strictEqual(fs.existsSync(permDownload), true, 'permanent download strictly protected');

    // Category clear only deletes target category & keeps active files
    await mgr.clear('http');
    assert.strictEqual(fs.existsSync(newHttpFile), false);
    assert.strictEqual(fs.existsSync(activeFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
