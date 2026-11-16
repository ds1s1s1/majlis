'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Store } = require('../src/main/store');
const { Net } = require('../src/main/net');

const PORT = 17700;
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-'));
  const p = spawn(process.execPath, [path.join(__dirname, '../../server/index.js')], {
    env: { ...process.env, SIGNAL_PORT: PORT, RELAY_PORT: PORT + 1, HTTP_PORT: PORT + 80, DATA_DIR: dir, RELAY_SECRET: 'x'.repeat(40), RELAY_HOST: '127.0.0.1' },
    stdio: 'pipe',
  });
  return new Promise((res) => p.stdout.on('data', (d) => { if (/majlis server/.test(d)) res(p); }));
}
function mkNet(name) {
  const st = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'mj-' + name)));
  st.set('server', `127.0.0.1:${PORT}`); st.set('nick', name);
  return { st, net: new Net(st.identity(), st) };
}
const once = (em, ev) => new Promise((r) => em.once(ev, r));

test('guest reaches host by number, keys agree, control + raw data flow', async (t) => {
  const srv = await startServer();
  t.after(() => srv.kill());
  const H = mkNet('host'), G = mkNet('guest');
  const reg = Promise.all([once(H.net, 'registered'), once(G.net, 'registered')]);
  await H.net.start(); await G.net.start();
  await reg;
  assert.ok(H.net.relays.length >= 1);

  H.net.on('knock', async (k) => {
    assert.equal(k.from, G.st.identity().id);
    const link = await k.decide(true);
    link.on('ctrl', (m) => link.ctrl({ echo: m.hello }));
    link.on('raw', (b) => link.send(Buffer.concat([Buffer.from([0x99]), b.subarray(1)])));
  });
  const link = await G.net.connect(H.st.identity().id);
  await once(link, 'path');
  const big = 'x'.repeat(5000);
  link.ctrl({ hello: big });
  const m = await once(link, 'ctrl');
  assert.equal(m.echo, big);
  link.send(Buffer.from([0x30, 1, 2, 3]));
  const r = await once(link, 'raw');
  assert.deepEqual([...r], [0x99, 1, 2, 3]);
  // wait until a relay path gets measured too
  await new Promise((r) => setTimeout(r, 1500));
  const paths = link.allPaths();
  console.log(paths.map((p) => `${p.kind}/${p.fam}/${p.label} rtt=${p.rtt} ${p.active ? '*' : ''}`).join('\n'));
  assert.ok(paths.some((p) => p.kind === 'relay' && p.rtt != null), 'relay path measured');
  const up = await G.net.uploadTest(G.net.relays[0], 20, 500);
  console.log('upload test', up);
  assert.ok(up && up.mbps > 5);
  link.close(); H.net.stop(); G.net.stop();
});

test('unknown numbers look the same as offline ones', async (t) => {
  const srv = await startServer();
  t.after(() => srv.kill());
  const G = mkNet('g2');
  const reg = once(G.net, 'registered');
  await G.net.start(); await reg;
  await assert.rejects(G.net.connect('123456789'), (e) => e.code === 'offline');
  G.net.stop();
});
