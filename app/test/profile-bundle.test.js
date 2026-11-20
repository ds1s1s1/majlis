'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { encryptProfileBundle, decryptProfileBundle, sanitizeBundlePayload } = require('../src/main/profile-bundle');

test('profile-bundle: AES-256-GCM round-trip, redacts sensitive keys, and rejects wrong passphrase or tampering', async () => {
  const input = {
    profileName: 'main',
    sections: ['addons', 'themes', 'library', 'settings'],
    addons: ['https://v3-cinemeta.strem.io/manifest.json'],
    cinemaTheme: 'oled',
    settings: {
      maxCacheGb: 5,
      desktopNotifications: true,
      accessKey: 'TOP_SECRET_ACCESS_KEY',
      server: 'https://private.invalid',
      oauth_trakt: 'SECRET_TOKEN',
      stremioKey: 'dpapi:abc',
    },
    mediaKeys: { tmdb: 'tmdb_key_123', realdebrid: 'rd_key_456' },
    library: { items: { tt0133093: { _id: 'tt0133093', name: 'The Matrix' } }, favorites: [], watchlist: [], history: [] },
    settingsV2: { system: { maxCacheGb: 5 } },
    profileV1: { id: 'p1', general: { alias: 'Faisal' } },
  };

  // Secrets stripped unconditionally; mediaKeys stripped unless includeKeys: true
  const withoutKeysJson = await encryptProfileBundle(input, 'strong-pass-99', { includeKeys: false });
  const envNoKeys = JSON.parse(withoutKeysJson);
  assert.strictEqual(envNoKeys.format, 'majlis-profile');
  assert.strictEqual(envNoKeys.cipher, 'aes-256-gcm');

  const decNoKeys = await decryptProfileBundle(withoutKeysJson, 'strong-pass-99');
  assert.deepStrictEqual(decNoKeys.addons, ['https://v3-cinemeta.strem.io/manifest.json']);
  assert.strictEqual(decNoKeys.cinemaTheme, 'oled');
  assert.strictEqual(decNoKeys.settings.accessKey, undefined);
  assert.strictEqual(decNoKeys.settings.server, undefined);
  assert.strictEqual(decNoKeys.settings.oauth_trakt, undefined);
  assert.strictEqual(decNoKeys.mediaKeys, undefined);
  assert.strictEqual(decNoKeys.library.items.tt0133093.name, 'The Matrix');
  assert.strictEqual(decNoKeys.profileV1.general.alias, 'Faisal');

  // With opt-in mediaKeys
  const withKeysJson = await encryptProfileBundle(input, 'strong-pass-99', { includeKeys: true });
  const decWithKeys = await decryptProfileBundle(withKeysJson, 'strong-pass-99');
  assert.deepStrictEqual(decWithKeys.mediaKeys, { tmdb: 'tmdb_key_123', realdebrid: 'rd_key_456' });

  // Wrong passphrase fails loudly
  await assert.rejects(() => decryptProfileBundle(withKeysJson, 'wrong-pass'), /wrong_passphrase_or_corrupted/);

  // Tampered ciphertext/tag fails authentication
  const tampered = JSON.parse(withKeysJson);
  const rawCt = Buffer.from(tampered.payload, 'base64');
  rawCt[0] ^= 0xff;
  tampered.payload = rawCt.toString('base64');
  await assert.rejects(() => decryptProfileBundle(JSON.stringify(tampered), 'strong-pass-99'), /wrong_passphrase_or_corrupted/);

  // Empty passphrase rejected
  await assert.rejects(() => encryptProfileBundle(input, ''), /passphrase_required/);
  assert.strictEqual(sanitizeBundlePayload(input, { includeKeys: false }).mediaKeys, undefined);
});
