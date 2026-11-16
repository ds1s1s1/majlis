'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fec = require('../src/main/fec');
const { newEphemeral, deriveKeys, Channel } = require('../src/main/seal');

test('reed-solomon rebuilds any k of k+m', () => {
  for (const [k, m] of [[1, 1], [5, 2], [32, 8], [20, 10]]) {
    const data = Array.from({ length: k }, () => crypto.randomBytes(1100));
    const parity = fec.encode(data, m);
    const all = [...data, ...parity];
    for (let trial = 0; trial < 20; trial++) {
      const shards = all.slice();
      const drop = new Set();
      while (drop.size < m) drop.add(crypto.randomInt(0, k + m));
      for (const d of drop) shards[d] = null;
      const out = fec.decode(shards, k);
      assert.ok(out, 'decoded');
      for (let i = 0; i < k; i++) assert.ok(Buffer.from(out[i]).equals(data[i]));
    }
    const tooMany = all.slice(); for (let i = 0; i <= m; i++) tooMany[i] = null;
    assert.equal(fec.decode(tooMany, k), null);
  }
});

test('channel encrypts both ways and rejects replays and tampering', () => {
  const a = newEphemeral(), b = newEphemeral();
  const sid = crypto.randomBytes(16).toString('hex');
  const ka = deriveKeys(a, b.pub, sid, 'G', 'H');
  const kb = deriveKeys(b, a.pub, sid, 'G', 'H');
  const g = new Channel(ka, 'guest', sid), h = new Channel(kb, 'host', sid);
  const p = g.seal(Buffer.from('salam'));
  assert.equal(h.open(p).toString(), 'salam');
  assert.equal(h.open(p), null, 'replay rejected');
  const q = h.seal(Buffer.from('ahlan'));
  q[20] ^= 1;
  assert.equal(g.open(q), null, 'tamper rejected');
  assert.equal(g.open(h.seal(Buffer.from('x'))).toString(), 'x');
});
