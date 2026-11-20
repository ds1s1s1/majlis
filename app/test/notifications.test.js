'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Notifications, diffNewEpisodes } = require('../src/main/media/notifications');

test('notifications: baseline does not flood, newly aired episodes trigger notifications and markRead works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-notif-'));
  try {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const base = diffNewEpisodes({
      id: 'tt100',
      name: 'Show',
      videos: [
        { id: 'tt100:1:1', season: 1, episode: 1, name: 'Ep 1', released: '2026-11-10T00:00:00Z' },
        { id: 'tt100:1:2', season: 1, episode: 2, name: 'Ep 2', released: '2026-11-25T00:00:00Z' },
      ],
    }, undefined, now);
    assert.deepStrictEqual(base.nextIds, ['tt100:1:1']);
    assert.strictEqual(base.added.length, 0);

    const events = [];
    const notifs = new Notifications({
      fileFor: (p) => path.join(dir, `${p}.json`),
      onAdded: (ev) => events.push(ev),
    });
    const lib = { library: () => [{ _id: 'tt100', type: 'series', name: 'Show' }] };
    let ep2Released = '2026-11-25T00:00:00Z';
    const fetchMeta = async () => ({
      id: 'tt100', type: 'series', name: 'Show', poster: 'https://x/p.jpg',
      videos: [
        { id: 'tt100:1:1', season: 1, episode: 1, name: 'Pilot', released: '2026-11-10T00:00:00Z' },
        { id: 'tt100:1:2', season: 1, episode: 2, name: 'Second', released: ep2Released },
      ],
    });

    await notifs.check({ prof: 'default', library: lib, fetchMeta, nowMs: now, force: true });
    assert.strictEqual(notifs.list('default').unread, 0);

    ep2Released = '2026-11-18T11:00:00Z';
    await notifs.check({ prof: 'default', library: lib, fetchMeta, nowMs: now, force: true });
    const l = notifs.list('default');
    assert.strictEqual(l.unread, 1);
    assert.strictEqual(l.items[0].videoId, 'tt100:1:2');
    assert.strictEqual(events.length, 1);

    const afterRead = notifs.markRead('default', { all: true });
    assert.strictEqual(afterRead.unread, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
