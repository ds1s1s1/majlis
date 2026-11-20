'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { Host } = require('../src/main/host');
const { parseDeepLink, parseJoinTarget } = require('../src/main/deeplink');

function mockHostDeps() {
  const settings = new Map([
    ['nick', 'AbuLaban'],
    ['mode', 'watch'],
    ['watchControl', 'host'],
  ]);
  const store = {
    get: (k) => settings.get(k),
    set: (k, v) => settings.set(k, v),
    identity: () => ({ id: '123456789' }),
    friend: () => null,
    upsertFriend: (f) => f,
  };
  const net = Object.assign(new EventEmitter(), {
    id: { id: '123456789' },
    signal: () => {},
    _sign: (m) => m,
    setPresence: () => {},
  });
  const helper = Object.assign(new EventEmitter(), { cmd: () => {}, p: null });
  return new Host({ store, net, helper, encoders: [], ffmpeg: null });
}

test('phase3: Ready Check broadcasts ready_state and auto-starts 3-2-1 countdown when host + all guests ready', (t) => {
  const host = mockHostDeps();
  t.after(() => {
    clearTimeout(host.cdTimer);
    host.dispose();
  });
  const sent = [];
  const makeLink = () => {
    const link = new EventEmitter();
    link.ctrl = (m) => sent.push(m);
    link.peer = { pk: 'pk1' };
    link.close = () => {};
    return link;
  };
  const g1 = { sid: 's1', id: '222222222', nick: 'Omar', role: 'watch', ready: false, link: makeLink() };
  host.guests.set('s1', g1);

  const countdowns = [];
  host.on('countdown', (c) => countdowns.push(c));

  const startSnap = host.readyCheck();
  assert.strictEqual(startSnap.active, true);
  assert.strictEqual(startSnap.hostReady, false);
  assert.ok(sent.some((m) => m.t === 'ready?'));
  assert.ok(sent.some((m) => m.t === 'ready_state' && m.active === true));

  // Guest marks ready -> quorum not met until host is also ready
  host._onCtrl(g1, { t: 'ready', on: true });
  assert.strictEqual(countdowns.length, 0);
  assert.strictEqual(host.readySnapshot().active, true);

  // Host marks ready -> quorum complete, active becomes false, 3000ms countdown triggers automatically
  const doneSnap = host.setHostReady(true);
  assert.strictEqual(doneSnap.active, false);
  assert.strictEqual(doneSnap.hostReady, true);
  assert.strictEqual(countdowns.length, 1);
  assert.strictEqual(countdowns[0].ms, 3000);
  assert.ok(sent.some((m) => m.t === 'countdown' && m.ms === 3000));
  clearTimeout(host.cdTimer);
});

test('phase3: parseJoinTarget and parseDeepLink handle protocols, HTTPS links, room codes, IDs, and Arabic numerals', () => {
  assert.deepStrictEqual(parseJoinTarget('majlis://join/123456789'), { kind: 'join', target: '123456789', raw: 'majlis://join/123456789' });
  assert.deepStrictEqual(parseJoinTarget('majlis://code/AB12CD'), { kind: 'code', target: 'AB12CD', raw: 'majlis://code/AB12CD' });
  assert.deepStrictEqual(parseJoinTarget('https://example.org/j/987654321'), { kind: 'join', target: '987654321', raw: 'https://example.org/j/987654321' });
  assert.deepStrictEqual(parseJoinTarget('https://example.org/c/ROOM9X'), { kind: 'code', target: 'ROOM9X', raw: 'https://example.org/c/ROOM9X' });
  assert.deepStrictEqual(parseJoinTarget('١٢٣ ٤٥٦ ٧٨٩'), { kind: 'join', target: '123456789', raw: '١٢٣ ٤٥٦ ٧٨٩' });
  assert.deepStrictEqual(parseJoinTarget('ab-12-cd'), { kind: 'code', target: 'AB12CD', raw: 'ab-12-cd' });
  assert.strictEqual(parseJoinTarget('bad'), null);

  assert.deepStrictEqual(parseDeepLink(['majlis.exe', 'https://relay.example.org/c/XYZ123']), {
    kind: 'code',
    target: 'XYZ123',
    raw: 'https://relay.example.org/c/XYZ123',
  });
});
