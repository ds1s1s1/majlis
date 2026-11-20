'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { BackupManager } = require('../src/main/backup');

test('backup: creates weekly snapshots, rotates excess, mirrors renderer stores, and restores with pre-restore safety net', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-backup-test-'));
  try {
    const st = new Store(dir);
    st.set('autoBackupKeep', 2);
    st.set('autoBackupIntervalDays', 7);
    st.set('server', 'https://custom-relay.local');
    st.set('accessKey', 'KEEP_LOCAL_KEY');
    st.set('discordWebhookUrl', 'https://discord.com/api/webhooks/secret');
    st.flush();
    const origId = st.identity().id;

    // Seed per-profile library + social data
    const libDir = path.join(dir, 'media', 'default');
    fs.mkdirSync(libDir, { recursive: true });
    const libPath = path.join(libDir, 'library.json');
    fs.writeFileSync(libPath, JSON.stringify({ items: { tt1: { _id: 'tt1', name: 'Original Film' } }, history: [], watchlist: [], favorites: [{ id: 'tt1', name: 'Original Film' }] }));

    let reloadCalls = 0;
    const mgr = new BackupManager({ store: st, dataDir: dir, reloadLibs: () => { reloadCalls++; } });
    mgr.mirror({
      settingsV2: { system: { maxCacheGb: 5 } },
      profileV1: { id: origId, ratings: [{ id: 'tt1', title: 'Original Film', type: 'movie', poster: null, score: 9, at: 1 }] },
    });

    const t0 = 1_700_000_000_000;
    const snap1 = mgr.maybeRunScheduled(t0);
    assert.ok(snap1, 'runs scheduled backup on first boot');
    assert.strictEqual(snap1.libraryItemsCount, 1);
    assert.strictEqual(snap1.ratingsCount, 1);
    assert.strictEqual(mgr.maybeRunScheduled(t0 + 3 * 86400000), null, 'skips before 7-day interval elapses');
    assert.ok(mgr.maybeRunScheduled(t0 + 7 * 86400000 + 1000), 'runs once weekly interval elapses');

    // Create 2 more manual backups -> rotation keeps 2
    mgr.create({ reason: 'manual', nowMs: t0 + 8 * 86400000 });
    mgr.create({ reason: 'manual', nowMs: t0 + 9 * 86400000 });
    const listed = mgr.list();
    assert.strictEqual(listed.length, 2);

    // Mutate state then restore snap2 (the older kept one) and verify safety snapshot + restore
    const restoreTarget = listed[1].id;
    fs.writeFileSync(libPath, JSON.stringify({ items: { tt2: { _id: 'tt2', name: 'Overwritten Film' } }, history: [], watchlist: [], favorites: [] }));
    st.setSocialProfile({ displayName: 'Mutated Name' });

    const res = mgr.restore(restoreTarget);
    assert.strictEqual(res.ok, true);
    assert.ok(res.preRestoreId, 'creates pre-restore safety snapshot');
    assert.strictEqual(reloadCalls, 1);
    assert.strictEqual(st.identity().id, origId, 'never overwrites local Ed25519 identity');
    assert.strictEqual(st.get('accessKey'), 'KEEP_LOCAL_KEY', 'preserves machine-local secrets');
    assert.strictEqual(st.get('discordWebhookUrl'), 'https://discord.com/api/webhooks/secret', 'preserves notification secrets');
    assert.strictEqual(res.settingsV2.system.maxCacheGb, 5);
    assert.strictEqual(res.profileV1.ratings[0].score, 9);

    const restoredLib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
    assert.ok(restoredLib.items.tt1 && !restoredLib.items.tt2, 'library.json restored from snapshot');
    st.flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
