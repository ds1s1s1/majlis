'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { AddonClient } = require('../src/main/media/addon-client');
const mediaHttp = require('../src/main/media/http');

test('addon-client: circuit breaker fast-fails dead localhost and skips cooldown', async () => {
  const client = new AddonClient();
  // closed ephemeral port on 127.0.0.1
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const deadUrl = `http://127.0.0.1:${s.address().port}/manifest.json`;
  await new Promise((r) => s.close(r));

  let reqs = 0;
  const live = http.createServer((req, res) => {
    reqs++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/manifest.json') {
      res.end(JSON.stringify({ id: 'live', name: 'Live', version: '1.0.0', types: ['movie'], resources: ['stream'], catalogs: [] }));
    } else {
      res.end(JSON.stringify({ streams: [{ url: 'https://example.com/v.mp4', title: 'OK' }] }));
    }
  });
  await new Promise((r) => live.listen(0, '127.0.0.1', r));
  const liveUrl = `http://127.0.0.1:${live.address().port}/manifest.json`;

  try {
    const t0 = Date.now();
    await assert.rejects(() => client.manifest(deadUrl));
    assert.ok(client.isDead(deadUrl), 'localhost failure trips breaker');
    assert.ok(Date.now() - t0 < 1500, 'localhost fails fast within 1.2s');

    const res = await client.progressive([deadUrl, liveUrl], { resource: 'stream', type: 'movie', id: 'tt1' });
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].manifest.id, 'live');
    assert.strictEqual(reqs, 2);

    client.resetHealth(deadUrl);
    assert.ok(!client.isDead(deadUrl));
  } finally {
    mediaHttp.closeAgents();
    live.closeAllConnections?.();
    await new Promise((r) => live.close(r));
  }
});
