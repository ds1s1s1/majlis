'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Downloads } = require('../src/main/media/downloads');

const DATA = Buffer.from(Array.from({ length: 1_500_000 }, (_, i) => i % 251));

test('downloads: an http copy resumes from its .part file with a Range request', async (t) => {
  const ranges = [];
  const srv = http.createServer((req, res) => {
    ranges.push(req.headers.range || null);
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const from = m ? +m[1] : 0;
    res.writeHead(m ? 206 : 200, { 'content-length': DATA.length - from, ...(m ? { 'content-range': `bytes ${from}-${DATA.length - 1}/${DATA.length}` } : {}) });
    res.end(DATA.subarray(from));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-dl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dl = new Downloads({ file: path.join(dir, 'list.json'), folder: () => dir, svc: null, debrid: () => null, allowPrivateHosts: true });
  // half of it is already there from last time
  fs.writeFileSync(path.join(dir, 'Heat.mkv.part'), DATA.subarray(0, 600_000));
  const d = dl.add({ meta: { id: 'tt0113277', name: 'Heat' }, type: 'movie', videoId: 'tt0113277', stream: { url: `http://127.0.0.1:${srv.address().port}/heat.mkv`, behaviorHints: { filename: 'Heat.mkv' } } });
  for (let i = 0; i < 100 && d.state !== 'done' && d.state !== 'failed'; i++) await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(d.state, 'done', d.error);
  assert.deepStrictEqual(ranges, ['bytes=600000-']);
  assert.ok(fs.readFileSync(path.join(dir, 'Heat.mkv')).equals(DATA));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'list.json'), 'utf8'))[0].state, 'done');

  // a restart brings back what was mid-download as paused
  fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify([{ ...d, id: 'x', state: 'downloading' }]));
  assert.strictEqual(new Downloads({ file: path.join(dir, 'list.json'), folder: () => dir }).items[0].state, 'paused');
});
