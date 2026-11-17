'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolve, pickFile, magnet } = require('../src/main/media/debrid');

const H = 'a'.repeat(40);
const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body == null ? '' : JSON.stringify(body)) });

test('debrid: Real-Debrid picks the addon file (fileIdx + 1), selects it, unrestricts the link', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, o) => {
    calls.push([o.method || 'GET', url.replace('https://api.real-debrid.com/rest/1.0', ''), o.body ? String(o.body) : '']);
    if (url.endsWith('/addMagnet')) return reply(201, { id: 'T1' });
    if (url.includes('/info/T1')) {
      const selected = calls.some((c) => c[1].includes('selectFiles'));
      return reply(200, { status: selected ? 'downloaded' : 'waiting_files_selection', links: selected ? ['https://rd/l1'] : [], files: [{ id: 1, path: '/Show.S01E01.mkv', bytes: 9 }, { id: 2, path: '/Show.S01E02.mkv', bytes: 8 }, { id: 3, path: '/sample.txt', bytes: 1 }] });
    }
    if (url.includes('/selectFiles/T1')) return reply(204, null);
    if (url.endsWith('/unrestrict/link')) return reply(200, { download: 'https://dl/Show.S01E02.mkv' });
    return reply(404, { error: 'unexpected' });
  });
  const r = await resolve('realdebrid', 'K', { infoHash: H.toUpperCase(), fileIdx: 1 });
  assert.deepStrictEqual(r, { url: 'https://dl/Show.S01E02.mkv', name: 'Show.S01E02.mkv', size: 8 });
  assert.match(calls[0][2], new RegExp(`magnet=magnet%3A%3Fxt%3Durn%3Abtih%3A${H}`), 'lower-case hash in the magnet');
  assert.strictEqual(calls.find((c) => c[1].includes('selectFiles'))[2], 'files=2');
});

test('debrid: not cached is reported as such (and RD cleans up), a bad key as auth', async (t) => {
  const del = [];
  t.mock.method(globalThis, 'fetch', async (url, o) => {
    if (url.endsWith('/addMagnet')) return reply(201, { id: 'T2' });
    if (url.includes('/info/T2')) return reply(200, { status: 'downloading', links: [], files: [{ id: 1, path: '/a.mkv', bytes: 5 }] });
    if (url.includes('/delete/T2')) { del.push(o.method); return reply(204, null); }
    if (url.includes('premiumize')) return reply(200, { status: 'error', message: 'Not logged in.' });
    return reply(204, null);
  });
  await assert.rejects(resolve('realdebrid', 'K', { infoHash: H }), { kind: 'not-cached' });
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(del, ['DELETE']);
  await assert.rejects(resolve('premiumize', 'K', { infoHash: H }), { kind: 'auth' });
});

test('debrid: file choice and magnet trackers', () => {
  const files = [{ name: 'a/Film.mkv', size: 5 }, { name: 'a/Film.Extras.mkv', size: 9 }, { name: 'a/x.nfo', size: 99 }];
  assert.strictEqual(pickFile(files, 'Film.mkv').name, 'a/Film.mkv');
  assert.strictEqual(pickFile(files, null).name, 'a/Film.Extras.mkv');
  assert.strictEqual(magnet(H, ['tracker:udp://t.example:1337/announce', 'dht:' + H]), `magnet:?xt=urn:btih:${H}&tr=udp%3A%2F%2Ft.example%3A1337%2Fannounce`);
});
