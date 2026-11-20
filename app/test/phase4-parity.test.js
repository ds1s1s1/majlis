'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const { parseDeepLink } = require('../src/main/deeplink');
const { Store } = require('../src/main/store');
const { dispatchNotificationWebhooks } = require('../src/main/media/notifications');
const { downloadTest } = require('../src/main/netcheck');

test('phase4: parseDeepLink parses friend IDs, ?pk=, @handles, signed codes, room invites & addons', () => {
  assert.deepEqual(
    parseDeepLink(['majlis.exe', 'majlis://friend/123456789']),
    { kind: 'friend', target: '123456789', raw: 'majlis://friend/123456789' },
  );

  const withPk = parseDeepLink(['majlis://friend/123456789?pk=AbCdEf0123456789']);
  assert.equal(withPk.kind, 'friend');
  assert.equal(withPk.target, '123456789');
  assert.equal(withPk.pk, 'AbCdEf0123456789');

  assert.deepEqual(
    parseDeepLink(['majlis://friend/@noura_sa']),
    { kind: 'friend', target: '@noura_sa', raw: 'majlis://friend/@noura_sa' },
  );

  const signedLink = parseDeepLink(['majlis://friend/MAJLIS-F1:eyJ2IjoxfQ']);
  assert.equal(signedLink.kind, 'friend');
  assert.equal(signedLink.target, 'MAJLIS-F1:eyJ2IjoxfQ');

  assert.deepEqual(
    parseDeepLink(['majlis://join/ROOM9X']),
    { kind: 'join', target: 'ROOM9X', raw: 'majlis://join/ROOM9X' },
  );
  assert.deepEqual(
    parseDeepLink(['majlis://code/123456']),
    { kind: 'code', target: '123456', raw: 'majlis://code/123456' },
  );
  assert.deepEqual(
    parseDeepLink(['stremio://addon.example.org/manifest.json']),
    { kind: 'addon', url: 'https://addon.example.org/manifest.json' },
  );
});

test('phase4: Store sets discordPresence on opt_discord and enforces comment permissions & customProfile persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p4-store-'));
  const prefsPath = path.join(dir, 'installer_prefs.json');
  let st;
  let reloaded;
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({ optionalComponents: ['opt_discord'] }), 'utf8');
    st = new Store(path.join(dir, 'ud'), null, { installerPrefsPath: prefsPath });
    assert.equal(st.get('discordPresence'), true);
    assert.equal(st.get('discordRpc'), undefined);

    const targetId = st.identity().id;
    const c1 = st.addProfileComment(targetId, { id: 'c1', authorId: '222333444', authorName: 'Ali', body: 'Nice list!' });
    assert.ok(c1);
    assert.equal(st.profileComments(targetId).length, 1);

    // Stranger cannot delete someone else's comment
    assert.equal(st.deleteProfileComment(targetId, 'c1', '999888777'), false);
    assert.equal(st.profileComments(targetId).length, 1);

    // Wall owner can moderate and delete
    assert.equal(st.deleteProfileComment(targetId, 'c1', targetId), true);
    assert.equal(st.profileComments(targetId).length, 0);

    // Author can delete own comment
    st.addProfileComment(targetId, { id: 'c2', authorId: '222333444', authorName: 'Ali', body: 'Another note' });
    assert.equal(st.deleteProfileComment(targetId, 'c2', '222333444'), true);

    st.setSocialProfile({
      displayName: 'Tariq',
      bio: 'Night owl',
      customProfile: { status: 'Watching 4K', location: 'SA', privacy: { privateProfile: true } },
    });
    st.flush();

    reloaded = new Store(path.join(dir, 'ud'));
    const prof = reloaded.socialProfile();
    assert.equal(prof.displayName, 'Tariq');
    assert.equal(prof.customProfile?.status, 'Watching 4K');
    assert.equal(prof.customProfile?.privacy?.privateProfile, true);
  } finally {
    if (st) clearTimeout(st._timer);
    if (reloaded) clearTimeout(reloaded._timer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase4: social offline signed friend code add works without setFriendProfile crash & handles comments/profile-save', async () => {
  const socialSrc = fs.readFileSync(path.join(__dirname, '../src/main/social.js'), 'utf8');
  assert.equal(/\bsetFriendProfile\b/.test(socialSrc), false, 'stale setFriendProfile typo must not exist');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-p4-soc-'));
  const origLoad = Module._load;
  const handlers = {};
  let storeA;
  let storeB;
  let storeC;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          handle(ch, fn) { handlers[ch] = fn; },
          removeHandler(ch) { delete handlers[ch]; },
        },
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('../src/main/social')];
    const socialMod = require('../src/main/social');
    storeA = new Store(path.join(dir, 'a'));
    storeB = new Store(path.join(dir, 'b'));
    storeB.setSocialProfile({ displayName: 'PeerB', handle: 'peer_b' });

    const fakeNet = new EventEmitter();
    fakeNet.registered = false;
    fakeNet.handle = '';
    fakeNet.status = {};
    fakeNet._hello = () => {};
    fakeNet._sign = (m) => m;
    fakeNet.signal = () => false;

    const api = socialMod.setup({
      store: storeA,
      net: fakeNet,
      getHost: () => null,
      getGuest: () => null,
      getTheater: () => null,
      getMediaHub: () => null,
      emit: () => {},
      pushPresence: () => {},
    });

    const signedUrl = socialMod.encodeSignedFriendCode(storeB);
    const addRes = await handlers['social:add']({}, { idOrHandle: signedUrl });
    assert.equal(addRes.ok, true);
    assert.equal(addRes.verifiedOffline, true);
    assert.equal(storeA.friendProfile(storeB.identity().id)?.displayName, 'PeerB');

    storeC = new Store(path.join(dir, 'c'));
    storeC.setSocialProfile({ displayName: 'PeerC' });
    const compactCode = `majlis://friend/${socialMod.encodeSignedFriendCode(storeC, { compact: true })}`;
    const linkOk = await api.onFriendLink(compactCode);
    assert.equal(linkOk, true);
    assert.equal(storeA.friendProfile(storeC.identity().id)?.displayName, 'PeerC');

    const cRes = await handlers['social:comment-add']({}, { targetId: storeA.identity().id, body: 'Hello wall!' });
    assert.equal(cRes.ok, true);
    assert.equal(cRes.comments.length, 1);
    const dRes = await handlers['social:comment-del']({}, { targetId: storeA.identity().id, commentId: cRes.comment.id });
    assert.equal(dRes.ok, true);
    assert.equal(dRes.comments.length, 0);

    const saveRes = await handlers['social:profile-save']({}, { displayName: 'HostA', customProfile: { status: 'In cinema' } });
    assert.equal(saveRes.displayName, 'HostA');
    assert.equal(saveRes.customProfile?.status, 'In cinema');

    storeA.flush();
    storeB.flush();
    storeC.flush();
  } finally {
    [storeA, storeB, storeC].forEach((s) => { if (s) clearTimeout(s._timer); });
    Module._load = origLoad;
    delete require.cache[require.resolve('../src/main/social')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('phase4: dispatchNotificationWebhooks validates HTTPS endpoints and formats Discord & Telegram payloads', async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  };

  const okRes = await dispatchNotificationWebhooks({
    discordWebhookUrl: 'https://discord.com/api/webhooks/123456789012345/AbCdEfGhIjKlMnOpQrStUvWxYz',
    telegramBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345',
    telegramChatId: '-100123456789',
    items: [{ name: 'Dune', title: 'Released today', poster: 'https://example.com/p.jpg' }],
    fetchFn: mockFetch,
  });

  assert.equal(okRes.discord.attempted, true);
  assert.equal(okRes.discord.ok, true);
  assert.equal(okRes.telegram.attempted, true);
  assert.equal(okRes.telegram.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.embeds[0].title, 'Dune');
  assert.match(calls[1].body.text, /Dune/);

  // HTTP / invalid URLs are silently rejected without network calls
  calls.length = 0;
  const rejRes = await dispatchNotificationWebhooks({
    discordWebhookUrl: 'http://discord.com/api/webhooks/1/bad',
    telegramBotToken: 'bad-token',
    telegramChatId: 'not-a-chat-id',
    items: [{ name: 'X', title: 'Y' }],
    fetchFn: mockFetch,
  });
  assert.equal(rejRes.discord.attempted, false);
  assert.equal(rejRes.telegram.attempted, false);
  assert.equal(calls.length, 0);
});

test('phase4: netcheck.downloadTest computes Mbps throughput & theater.detectSourceMismatch detects duration/edition mismatch', async () => {
  const buf = new Uint8Array(500000).buffer;
  const dl = await downloadTest(500000, 4000, async () => ({
    ok: true,
    arrayBuffer: async () => buf,
  }));
  assert.ok(dl && dl.mbps > 0 && dl.bytes === 500000);

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { BrowserWindow: {}, ipcMain: { handle() {} }, screen: {}, dialog: {}, powerSaveBlocker: {}, app: {}, clipboard: {}, nativeImage: {} };
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../src/main/theater')];
    const { detectSourceMismatch } = require('../src/main/theater');
    assert.deepEqual(
      detectSourceMismatch({ hostDur: 7200, localDur: 7245 }),
      { reason: 'duration', diffSec: 45, hostDur: 7200, localDur: 7245 },
    );
    assert.equal(detectSourceMismatch({ hostDur: 7200, localDur: 7208 }), null);
    assert.deepEqual(
      detectSourceMismatch({
        hostDur: 7200, localDur: 7205,
        hostFilename: 'Film.2024.Extended.Cut.2160p.mkv',
        localFilename: 'Film.2024.Theatrical.1080p.mkv',
      }),
      { reason: 'edition', hostEdition: 'Extended', localEdition: 'Theatrical' },
    );
  } finally {
    Module._load = origLoad;
    delete require.cache[require.resolve('../src/main/theater')];
  }
});

test('phase4: i18n.ts preserves exact 1:1 ar/en parity, Western digits only, zero <> in ar, and zero custom domains in UI', () => {
  const i18nPath = path.join(__dirname, '../media/src/i18n.ts');
  const src = fs.readFileSync(i18nPath, 'utf8');
  assert.equal(/[٠-٩]/.test(src), false, 'no Eastern Arabic-Indic digits permitted');

  const arBlock = src.slice(src.indexOf('ar: {') + 5, src.indexOf('en: {'));
  const enBlock = src.slice(src.indexOf('en: {') + 5, src.indexOf('} as const;'));
  const extractKeys = (block) => [...block.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)].map((m) => m[1]);
  const arKeys = extractKeys(arBlock);
  const enKeys = extractKeys(enBlock);
  assert.deepEqual(arKeys.slice().sort(), enKeys.slice().sort(), 'exact 1:1 ar/en key parity');

  for (const m of arBlock.matchAll(/'([^']*)'/g)) {
    assert.equal(/[<>]/.test(m[1]), false, `Arabic string must not contain < or >: ${m[1]}`);
  }

  // Scan all UI source files under app/media/src for prohibited custom domains
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css)$/.test(ent.name)) {
        const txt = fs.readFileSync(p, 'utf8');
        assert.equal(/majlis\.(app|gg)/i.test(txt), false, `custom domain prohibited in ${p}`);
      }
    }
  };
  walk(path.join(__dirname, '../media/src'));
});
