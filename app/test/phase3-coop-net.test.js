'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');
const { buildArgs } = require('../src/main/encoder');
const { Host } = require('../src/main/host');
const { detectSaudiIsp, rankPathsByJitter } = require('../src/main/netcheck');
const { Link } = require('../src/main/net');
const { facts, rank } = require('../src/main/media/ranking');
const { parseTorrentBuffer } = require('../src/main/media/torrent-parse');
const { AddonClient } = require('../src/main/media/addon-client');
const { Downloads } = require('../src/main/media/downloads');

test('phase3 encoder: preset lookup falls back safely for unknown quality', () => {
  const args = buildArgs({
    enc: { fam: 'nvenc', codec: 'h264', encoder: 'h264_nvenc' },
    w: 1280,
    h: 720,
    fps: 60,
    kbps: 4500,
    quality: 'competitive',
  });
  assert.ok(Array.isArray(args));
  const presetIdx = args.indexOf('-preset');
  const tuneIdx = args.indexOf('-tune');
  assert.notEqual(presetIdx, -1);
  assert.equal(args[presetIdx + 1], 'p4');
  assert.notEqual(tuneIdx, -1);
  assert.equal(args[tuneIdx + 1], 'll');
});

test('phase3 host: privacy curtain (fg + setPrivacy + keyframe), resetPads, spectatorQuality, idle _tick skip', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p3-host-'));
  const store = new Store(dir);
  const net = new EventEmitter();
  net.id = { id: '111222333' };
  const helper = new EventEmitter();
  const helperCmds = [];
  helper.cmd = (c) => helperCmds.push(c);
  helper.request = async (c) => ({ ok: true, cmd: c.cmd });
  helper.p = true;

  const host = new Host({
    store,
    net,
    helper,
    encoders: [{ fam: 'nvenc', codec: 'h264', encoder: 'h264_nvenc' }],
    ffmpeg: 'ffmpeg',
  });

  t.after(() => {
    clearTimeout(host.cdTimer);
    host.dispose();
    store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Defaults present
  assert.equal(store.get('privacyCurtain'), false);
  assert.equal(store.get('controllerHud'), false);
  assert.equal(store.get('spectatorQuality'), 0.35);
  assert.equal(store.get('isp'), 'auto');
  assert.equal(store.get('preferredRelay'), 'auto');

  // Idle _tick should skip emitting stats when 0 guests and no movie
  let statsEmitted = 0;
  host.on('stats', () => { statsEmitted++; });
  host._tick();
  assert.equal(statsEmitted, 0);

  // Add a fake watch guest + tier encoder
  const link = new EventEmitter();
  link.sentCtrl = [];
  link.ctrl = (m) => link.sentCtrl.push(m);
  link.send = () => {};
  link.ping = () => {};
  link.peer = { pk: 'pk-g1' };
  link.stats = { tx: 0 };
  link.rtt = 20;
  link.safety = 'ok';
  link.pathInfo = () => 'direct';
  host.guests.set('s1', {
    sid: 's1', id: '222333444', nick: 'Fahad', role: 'watch', slot: 0, tier: 'watch',
    hand: false, muted: false, link, configSent: {}, joined: Date.now(), ready: false,
    fb: null, rc: null, tx: { flush() {}, setClock() {}, sendRaw() {}, send() {} },
  });

  host._tick();
  assert.equal(statsEmitted, 1);

  let keyframes = 0;
  host.tiers.play = { enc: { requestKeyframe() { keyframes++; }, stop() {} }, opts: { enc: { name: 'nv' }, fps: 60 }, kbps: 4000, codec: 'h264' };

  // Manual privacy toggle
  const rPriv = host.setPrivacy(true, true);
  assert.equal(rPriv.on, true);
  assert.equal(host.stats().privacy, true);
  assert.deepStrictEqual(link.sentCtrl.at(-1), { t: 'privacy', on: true });

  // While manual privacy is active, fg active must not auto-unveil
  store.set('privacyCurtain', true);
  store.set('captureWindow', { hwnd: 5150 });
  helper.emit('fg', { hwnd: 5150, active: true });
  assert.equal(host.stats().privacy, true);

  // Clearing manual privacy lets fg control it + requests keyframe on unveil
  host.setPrivacy(false, false);
  assert.equal(host.stats().privacy, false);
  assert.equal(keyframes, 1);
  helper.emit('fg', { hwnd: 5150, active: false });
  assert.equal(host.stats().privacy, true);
  helper.emit('fg', { hwnd: 5150, active: true });
  assert.equal(host.stats().privacy, false);
  assert.equal(keyframes, 2);

  // resetPads triggers helper request + release_all
  const resetRes = await host.resetPads();
  assert.equal(resetRes.ok, true);
  assert.equal(resetRes.cmd, 'pads_reset');
  assert.ok(helperCmds.some((c) => c.cmd === 'release_all'));

  // spectatorQuality scales watch-tier cap vs 0.35 (without spawning ffmpeg)
  const g1 = host.guests.get('s1');
  let capSeen = 0;
  g1.rc = { target: 8000, setMax(v) { capSeen = v; }, setStability() {} };
  g1.caps = { codecs: ['h264'] };
  host.store.set('maxMbps', 40);
  host.store.set('lightSpectators', true);
  host.store.set('spectatorQuality', 0.5);
  host._ensureHelper = async () => {};
  host._ensureWindowCapture = async () => {};
  host._sourceOpts = () => ({ w: 1280, h: 720, fps: 30, scale: 0.75 });
  host._pickCodec = () => 'h264';
  const curSig = host._sig({ enc: host._encFor('h264'), kbps: 8000, w: 1280, h: 720, fps: 30, scale: 0.75, lan: false, quality: 'balanced' });
  host.tiers.watch = {
    enc: { setBitrate() {}, stop() {} },
    opts: { enc: { fam: 'nvenc', name: 'nv' }, fps: 30, scale: 0.75 },
    kbps: 8000,
    codec: 'h264',
    sig: curSig,
    lastSwap: Date.now(),
  };
  await host._retierNow();
  assert.equal(capSeen, 20000);
  host.store.set('spectatorQuality', 0.25);
  await host._retierNow();
  assert.equal(capSeen, 10000);
});

test('phase3 netcheck & net: Saudi ISP detection, jitter path ranking, Link EWMA jitter & preferredRelay', async () => {
  assert.equal(detectSaudiIsp('STC Fiber 500Mbps'), 'stc');
  assert.equal(detectSaudiIsp('Etihad Etisalat Mobily'), 'mobily');
  assert.equal(detectSaudiIsp('Zain KSA 5G'), 'zain');
  assert.equal(detectSaudiIsp('Salam Integrated Telecom'), 'salam');
  assert.equal(detectSaudiIsp('Cloudflare Warp'), 'other');

  const rankedAsync = await rankPathsByJitter(
    [{ name: 'noisy-gw' }, { name: 'clean-ruh' }],
    { probeFn: async (p) => (p.name === 'noisy-gw' ? [18, 82, 20, 79] : [25, 26, 25, 26]) },
  );
  assert.equal(rankedAsync[0].name, 'clean-ruh');
  assert.ok(rankedAsync[0].jitter < rankedAsync[1].jitter);
  assert.ok(rankedAsync[0].score < rankedAsync[1].score);

  const rankedSync = rankPathsByJitter([
    { name: 'spiky', rtts: [20, 90, 22] },
    { name: 'steady', rtts: [30, 31, 30] },
  ]);
  assert.equal(rankedSync[0].name, 'steady');

  // Link EWMA jitter & preferredRelay scoring
  const linkCtx = {
    ch: { probeMac: () => Buffer.alloc(16, 0xaa) },
    active: { name: 'dummy' },
    _select() {},
    _reselect() {},
    emit() {},
    net: { settings: { preferredRelay: 'ruh-relay' } },
  };
  const nonce = Buffer.from('0102030405060708', 'hex');
  const pPath = { kind: 'relay', name: 'ruh-relay', sentProbes: new Map() };
  const makeResp = (t0) => {
    pPath.sentProbes.set(nonce.toString('hex'), t0);
    const b = Buffer.alloc(33);
    b[0] = 0x02;
    nonce.copy(b, 5);
    b.fill(0xaa, 17, 33);
    return b;
  };
  Link.prototype.onProbe.call(linkCtx, makeResp(performance.now() - 20), pPath);
  assert.equal(pPath.jitter, 0);
  Link.prototype.onProbe.call(linkCtx, makeResp(performance.now() - 36), pPath);
  assert.ok(pPath.jitter > 0);

  const sPreferred = Link.prototype._score.call(linkCtx, { kind: 'relay', name: 'ruh-relay', rtt: 30, jitter: 2, okAt: Date.now() });
  const sOther = Link.prototype._score.call(linkCtx, { kind: 'relay', name: 'dxb-relay', rtt: 30, jitter: 2, okAt: Date.now() });
  assert.equal(sOther - sPreferred, 6);
});

test('phase3 media ranking, torrent-parse & addon health monitor', () => {
  // HEVC / AV1 regex fallback even if release title omits standard tags
  const fHevc = facts({ title: 'Anime.S01E01.1080p.h265-SUB.mkv' });
  assert.ok(/hevc|265/.test(fHevc.codec));
  const fAv1 = facts({ title: 'Movie.2025.2160p.AV1.HDR10-GRP.mp4' });
  assert.equal(fAv1.codec, 'av1');

  const rules = { blockCamTs: true, maxSizeGb: 10, excludeKeywords: 'DUB', preferHevc: true, prefer4kHdr: true };
  const list = [
    { stream: { name: 'CAM', title: 'Movie.2025.1080p.HDCAM.mp4', url: 'https://cdn.example/cam.mp4' }, addon: { url: 'https://a', name: 'A' }, addonRank: 0 },
    { stream: { name: 'Huge', title: 'Movie.2025.2160p.BluRay.x265.mkv', behaviorHints: { videoSize: 25 * 2 ** 30 }, infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, addon: { url: 'https://a', name: 'A' }, addonRank: 0 },
    { stream: { name: 'Dubbed', title: 'Movie.2025.1080p.DUB.x264.mkv', url: 'https://cdn.example/dub.mp4' }, addon: { url: 'https://a', name: 'A' }, addonRank: 0 },
    { stream: { name: 'Good', title: 'Movie.2025.2160p.HDR10.x265.mkv', behaviorHints: { videoSize: 5 * 2 ** 30 }, url: 'https://cdn.example/good.mkv' }, addon: { url: 'https://a', name: 'A' }, addonRank: 0 },
  ];
  const ranked = rank(list, { rules });
  assert.equal(ranked[0].stream.name, 'Good');
  assert.ok(ranked[0].reasons.some(([k]) => k === 'rule:prefer-hevc'));
  assert.ok(ranked[0].reasons.some(([k]) => k === 'rule:prefer-4k-hdr'));
  assert.equal(ranked.find((x) => x.stream.name === 'CAM').tier, 'excluded');
  assert.equal(ranked.find((x) => x.stream.name === 'Huge').tier, 'excluded');
  assert.equal(ranked.find((x) => x.stream.name === 'Dubbed').tier, 'excluded');

  // torrent-parse selects largest video fileIdx & computes totalSize
  const bstr = (s) => `${Buffer.byteLength(s)}:${s}`;
  const torrentBuf = Buffer.from(
    'd'
    + bstr('announce') + bstr('udp://tracker.example:6969/announce')
    + bstr('info') + 'd'
    + bstr('files') + 'l'
    + 'd' + bstr('length') + 'i512e' + bstr('path') + 'l' + bstr('readme.nfo') + 'ee'
    + 'd' + bstr('length') + 'i800000000e' + bstr('path') + 'l' + bstr('Movie.2025.1080p.mkv') + 'ee'
    + 'd' + bstr('length') + 'i12000000e' + bstr('path') + 'l' + bstr('sample.mp4') + 'ee'
    + 'e'
    + bstr('name') + bstr('Movie.2025')
    + bstr('piece length') + 'i16384e'
    + bstr('pieces') + '20:01234567890123456789'
    + 'ee'
  );
  const parsed = parseTorrentBuffer(torrentBuf);
  assert.equal(parsed.fileIdx, 1);
  assert.equal(parsed.totalSize, 812000512);
  assert.match(parsed.infoHash, /^[0-9a-f]{40}$/);

  // Addon health monitor
  const client = new AddonClient();
  const u = 'https://addon.example/manifest.json';
  client.recordSuccess(u, 140);
  let snap = client.healthSnapshot(u);
  assert.equal(snap.status, 'up');
  assert.equal(snap.avgMs, 140);
  client.recordLatency(u, 3200);
  client.recordLatency(u, 3200);
  client.recordLatency(u, 3200);
  snap = client.healthSnapshot(u);
  assert.equal(snap.status, 'slow');
  for (let i = 0; i < 4; i++) client.recordFailure(u, new Error('timeout'));
  snap = client.healthSnapshot(u);
  assert.equal(snap.dead, true);
  assert.equal(snap.status, 'down');
  assert.equal(snap.lastError, 'timeout');
  client.resetHealth(u);
  snap = client.healthSnapshot(u);
  assert.equal(snap.dead, false);
  assert.equal(snap.lastError, null);
});

test('phase3 downloads: maxConcurrent limit, reorder, pauseAll, resumeAll, clearDone', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p3-dl-'));
  let gates = [];
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-length': 4 });
    gates.push(() => res.end('done'));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dl = new Downloads({
    file: path.join(dir, 'list.json'),
    folder: () => dir,
    allowPrivateHosts: true,
    maxConcurrent: 1,
  });
  t.after(() => {
    clearTimeout(dl.saveT);
    clearInterval(dl._torrentPoll);
    for (const ac of dl.active.values()) ac.abort();
    srv.closeAllConnections?.();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${srv.address().port}/v.mkv`;
  const d1 = dl.add({ meta: { id: 'm1', name: 'First' }, type: 'movie', videoId: 'm1', stream: { url, behaviorHints: { filename: 'first.mkv' } } });
  const d2 = dl.add({ meta: { id: 'm2', name: 'Second' }, type: 'movie', videoId: 'm2', stream: { url, behaviorHints: { filename: 'second.mkv' } } });

  assert.equal(d1.state, 'downloading');
  assert.equal(d2.state, 'queued');

  // Reorder puts d2 ahead of d1? d2 was unshifted to index 0, so moving d2 down (+1) swaps with d1
  dl.reorder(d2.id, 1);
  assert.equal(dl.items[1].id, d2.id);

  await dl.pauseAll();
  assert.equal(d1.state, 'paused');
  assert.equal(d2.state, 'paused');

  dl.resumeAll();
  assert.equal(d1.state, 'downloading');
  assert.equal(d2.state, 'queued');

  dl.clearDone();
  d2.state = 'done';
  dl.clearDone();
  assert.ok(!dl.items.some((x) => x.id === d2.id));

  while (gates.length) gates.shift()();
});
