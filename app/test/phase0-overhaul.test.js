'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/main/store');
const { Mpv, launchExternalPlayer } = require('../src/main/mpv');
const { LibMpv } = require('../src/main/libmpv');
const { Downloads, safeFetch } = require('../src/main/media/downloads');
const { BackupManager, sanitizeStoreData } = require('../src/main/backup');

function walkFiles(dir, exts, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'target') continue;
    const p = path.join(dir, ent.name);
    if (p.endsWith(path.join('renderer', 'media'))) continue;
    if (ent.isDirectory()) walkFiles(p, exts, out);
    else if (exts.some((ext) => ent.name.endsWith(ext))) out.push(p);
  }
  return out;
}

test('phase0: Store unifies Display Name without @player_one and defaults Discord privacy keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p0-store-'));
  let st;
  try {
    st = new Store(dir);
    st.set('nick', 'أبو اللبن');
    assert.equal(st.socialProfile().displayName, 'أبو اللبن');

    st.setSocialProfile({ displayName: 'Khaled' });
    assert.equal(st.get('nick'), 'Khaled');

    assert.equal(st.get('discordHideTitle'), false);
    assert.equal(st.get('discordShowWhenPaused'), true);
    assert.equal(st.get('discordShowPoster'), true);
    assert.equal(st.get('discordShowTimestamp'), true);
    assert.equal(st.get('discordShowPartyJoin'), true);
    assert.equal(st.get('playerToneMapping'), 'bt.2446a');
  } finally {
    if (st) clearTimeout(st._timer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase0 security: mpv & libmpv block leading-dash flags, CRLF/NUL, and invalid schemes', async () => {
  for (const bad of ['', '--hwdec=no', '  --run=calc', 'https://a.com/x\r\n--evil', 'javascript:alert(1)', 'file:///C:/nonexistent-xyz.mkv']) {
    const r = launchExternalPlayer({ kind: 'mpv', url: bad });
    assert.equal(r.ok, false, `Expected launchExternalPlayer to reject: ${bad}`);
  }

  const fakeCli = Object.create(Mpv.prototype);
  fakeCli.resetPlaybackProps = () => {};
  fakeCli._watch = () => {};
  fakeCli.command = async () => true;
  await assert.rejects(() => fakeCli.load('--input-ipc-server=evil'), /invalid_url/);
  await assert.rejects(() => fakeCli.load('https://x.com/a\n--run=calc'), /invalid_url/);

  const fakeEmb = Object.create(LibMpv.prototype);
  fakeEmb.resetPlaybackProps = () => {};
  fakeEmb._watch = () => {};
  fakeEmb.set = async () => true;
  fakeEmb.command = async () => true;
  await assert.rejects(() => fakeEmb.load('--profile=evil'), /invalid_url/);
});

test('phase0 security: Downloads safeFetch blocks private IPs & escapes out of download folder', async () => {
  for (const bad of [
    'http://127.0.0.1:8080/a.mkv',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/video.mp4',
    'http://192.168.1.10/v.mp4',
    'http://[::1]/v.mp4',
    'ftp://example.org/file.mkv',
  ]) {
    await assert.rejects(() => safeFetch(bad), /private_host_blocked|unsupported download URL scheme/);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p0-dl-'));
  try {
    const dl = new Downloads({ file: path.join(dir, 'dl.json'), folder: () => path.join(dir, 'sub'), svc: null, debrid: () => null });
    await assert.rejects(
      () => dl.http({ id: '1', name: 'x', file: path.join(dir, 'outside.mkv'), stream: {} }, 'https://example.com/a.mkv', 'a.mkv'),
      /invalid_download_path/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase0 security: BackupManager scrubs mediaKeys/homeServers/aiApiKey secrets & blocks traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p0-bak-'));
  let st;
  try {
    st = new Store(path.join(dir, 'ud'));
    st.set('mediaKeys', { tmdb: 'secret-tmdb', aiApiKey: 'sk-secret-ai' });
    st.set('homeServers', [{ id: 's1', kind: 'jellyfin', url: 'https://jf.local', apiKeyEnc: 'dpapi:abc', apiKey: 'raw-key' }]);

    const clean = sanitizeStoreData(st.d);
    assert.equal(clean.settings.mediaKeys, undefined);
    assert.equal(clean.settings.homeServers[0].apiKeyEnc, undefined);
    assert.equal(clean.settings.homeServers[0].apiKey, undefined);

    const bm = new BackupManager({ store: st, dataDir: path.join(dir, 'ud') });
    bm.mirror({
      settingsV2: {
        sources: { search: { aiApiKey: 'sk-mirror-leak' } },
        system: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/2', telegramBotToken: '123:ABC' },
      },
    });
    const mirrored = bm.readMirror();
    assert.equal(mirrored.settingsV2.sources.search.aiApiKey, '');
    assert.equal(mirrored.settingsV2.system.discordWebhookUrl, '');
    assert.equal(mirrored.settingsV2.system.telegramBotToken, '');

    assert.throws(() => bm.restore('../../outside.json.gz'), /invalid_backup_id/);
    assert.throws(() => bm.restore('nested/backup.json.gz'), /invalid_backup_id/);
    assert.equal(bm.delete('../outside.json.gz'), false);
  } finally {
    if (st) clearTimeout(st._timer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase0 security & parity: strict CSP and zero WhatsApp or @player_one in runtime UI', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert.ok(html.includes("object-src 'none'"));
  assert.ok(html.includes("base-uri 'none'"));
  assert.ok(html.includes("form-action 'none'"));

  const files = [
    ...walkFiles(path.join(__dirname, '../src'), ['.js', '.html']),
    ...walkFiles(path.join(__dirname, '../media/src'), ['.ts', '.tsx']),
    ...walkFiles(path.join(__dirname, '../../installer/src'), ['.ts', '.tsx']),
  ];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    assert.equal(/(whatsapp|wa\.me|واتس)/i.test(content), false, `WhatsApp reference found in ${f}`);
    assert.equal(/@player_one/i.test(content), false, `Mock @player_one found in ${f}`);
    if (!f.endsWith('useProfileStore.ts')) {
      assert.equal(/player_one/i.test(content), false, `Mock player_one found in ${f}`);
    }
  }
});
