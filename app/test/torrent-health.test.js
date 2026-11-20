'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeInfoHash,
  encodeUdpConnect,
  decodeUdpConnect,
  encodeUdpScrape,
  decodeUdpScrape,
  classifyHealth,
  extractUdpTrackers,
  checkBatch,
} = require('../src/main/media/torrent-health');

test('BEP-15 UDP connect/scrape encode and decode round-trip', () => {
  const ih1 = '0123456789abcdef0123456789abcdef01234567';
  const ih2 = 'fedcba9876543210fedcba9876543210fedcba98';
  assert.strictEqual(normalizeInfoHash(`  ${ih1.toUpperCase()}  `), ih1);
  assert.strictEqual(normalizeInfoHash('not-a-hash'), null);

  const req = encodeUdpConnect(0x12345678);
  assert.strictEqual(req.length, 16);
  assert.strictEqual(req.readUInt32BE(8), 0);
  assert.strictEqual(req.readUInt32BE(12), 0x12345678);

  const connResp = Buffer.alloc(16);
  connResp.writeUInt32BE(0, 0);
  connResp.writeUInt32BE(0x12345678, 4);
  Buffer.from('aabbccddeeff0011', 'hex').copy(connResp, 8);
  const conn = decodeUdpConnect(connResp);
  assert.strictEqual(conn.txId, 0x12345678);
  assert.strictEqual(conn.connId.toString('hex'), 'aabbccddeeff0011');

  const scrapeReq = encodeUdpScrape(conn.connId, 0x99887766, [ih1, ih2]);
  assert.strictEqual(scrapeReq.count, 2);
  assert.strictEqual(scrapeReq.buf.length, 16 + 40);
  assert.strictEqual(scrapeReq.buf.readUInt32BE(8), 2);

  const scrapeResp = Buffer.alloc(8 + 24);
  scrapeResp.writeUInt32BE(2, 0);
  scrapeResp.writeUInt32BE(0x99887766, 4);
  scrapeResp.writeUInt32BE(42, 8);
  scrapeResp.writeUInt32BE(100, 12);
  scrapeResp.writeUInt32BE(7, 16);
  scrapeResp.writeUInt32BE(0, 20);
  scrapeResp.writeUInt32BE(5, 24);
  scrapeResp.writeUInt32BE(3, 28);
  const dec = decodeUdpScrape(scrapeResp, [ih1, ih2]);
  assert.deepStrictEqual(dec.out[ih1], { seeders: 42, completed: 100, leechers: 7 });
  assert.deepStrictEqual(dec.out[ih2], { seeders: 0, completed: 5, leechers: 3 });
});

test('classifyHealth enforces green/yellow/red thresholds and instant bypass', () => {
  assert.strictEqual(classifyHealth({ instant: true, seeders: 0 }).level, 'green');
  assert.strictEqual(classifyHealth({ cached: true, seeders: 0 }).level, 'green');
  assert.strictEqual(classifyHealth({ seeders: 25, hasMeta: true }).level, 'green');
  assert.strictEqual(classifyHealth({ seeders: 5, hasMeta: true }).level, 'yellow');
  assert.strictEqual(classifyHealth({ seeders: null, hasMeta: false }).level, 'yellow');
  assert.strictEqual(classifyHealth({ seeders: 0, hasMeta: true }).level, 'red');
});

test('extractUdpTrackers and non-blocking checkBatch handle unreachable trackers gracefully', async () => {
  const trks = extractUdpTrackers(['tracker:udp://tracker.example.com:1337/announce', 'dht:abc', 'http://ignored']);
  assert.strictEqual(trks[0], 'udp://tracker.example.com:1337/announce');

  const hGreen = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hZero = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const hInstant = 'cccccccccccccccccccccccccccccccccccccccc';

  const res = await checkBatch(
    [
      { infoHash: hInstant, instant: true, sources: ['tracker:udp://bad.invalid:9999'] },
      { infoHash: hGreen, hasMeta: true, sources: ['tracker:udp://mock1:1337'] },
      { infoHash: hZero, hasMeta: true, fallbackSeeders: 0, sources: ['tracker:udp://unreachable:1337'] },
    ],
    {
      scrapeUdpFn: async (tracker, hashes) => {
        if (tracker.includes('mock1')) {
          return Object.fromEntries(hashes.map((h) => [h, h === hGreen ? { seeders: 38, leechers: 4 } : null]));
        }
        return null; // simulates network failure/timeout
      },
    }
  );

  assert.strictEqual(res[hInstant].level, 'green');
  assert.strictEqual(res[hGreen].level, 'green');
  assert.strictEqual(res[hGreen].verified, true);
  assert.strictEqual(res[hGreen].seeders, 38);
  assert.strictEqual(res[hZero].level, 'red');
  assert.strictEqual(res[hZero].verified, false);
});
