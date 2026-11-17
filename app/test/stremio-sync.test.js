'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { StremioAccount } = require('../src/main/media/stremio-sync');
const { Library } = require('../src/main/media/library');

test('stremio sync: pulls newer remote items, pushes newer local ones, never type other', async (t) => {
  const old = '2020-01-01T00:00:00.000Z', fresh = '2030-01-01T00:00:00.000Z';
  const remote = {
    tt1: { _id: 'tt1', name: 'Remote newer', type: 'movie', removed: false, temp: false, _mtime: fresh, state: { timeOffset: 5 } },
    tt2: { _id: 'tt2', name: 'Remote older', type: 'movie', removed: false, temp: false, _mtime: old, state: {} },
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, o) => {
    const method = url.split('/').pop(), body = JSON.parse(o.body);
    calls.push([method, body]);
    const result = method === 'datastoreMeta' ? Object.values(remote).map((r) => [r._id, Date.parse(r._mtime)])
      : method === 'datastoreGet' ? body.ids.map((id) => remote[id]) : { success: true };
    return { status: 200, json: async () => ({ result }) };
  });
  const lib = new Library({ load: () => null, save: () => {} });
  lib.add({ id: 'tt1', type: 'movie', name: 'Local older' });
  lib.items.tt1._mtime = old;
  lib.add({ id: 'tt2', type: 'movie', name: 'Local newer' });
  lib.add({ id: 'tt3', type: 'movie', name: 'Only here' });
  lib.add({ id: 'local:file', type: 'other', name: 'A file' });
  const r = await new StremioAccount('k').syncLibrary(lib);
  assert.strictEqual(lib.get('tt1').name, 'Remote newer');
  assert.deepStrictEqual(calls.find((c) => c[0] === 'datastoreGet')[1].ids, ['tt1']);
  assert.deepStrictEqual(calls.find((c) => c[0] === 'datastorePut')[1].changes.map((x) => x._id).sort(), ['tt2', 'tt3']);
  assert.deepStrictEqual(r, { pulled: 1, pushed: 2 });
});
