'use strict';
// Portable AES-256-GCM encrypted `.majlis-profile` exporter / importer.
// Pure Node `crypto` + `zlib` (zero extra deps, zero machine-bound DPAPI secrets).
const crypto = require('crypto');
const zlib = require('zlib');

const FORMAT = 'majlis-profile';
const VERSION = 1;
const CIPHER = 'aes-256-gcm';
const AAD = Buffer.from('majlis-profile:v1', 'utf8');
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const BLOCKED_SETTING_KEYS = new Set(['accessKey', 'server', 'access']);

function deriveKey(passphrase, salt, params = SCRYPT_OPTS) {
  return new Promise((resolve, reject) => {
    const p = String(passphrase || '');
    if (!p) return reject(new Error('passphrase_required'));
    const N = Math.min(65536, Math.max(1024, Number(params?.N) || SCRYPT_OPTS.N));
    const r = Math.min(16, Math.max(1, Number(params?.r) || SCRYPT_OPTS.r));
    const par = Math.min(4, Math.max(1, Number(params?.p) || SCRYPT_OPTS.p));
    crypto.scrypt(p, salt, 32, { N, r, p: par, maxmem: 128 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function sanitizeBundlePayload(input = {}, { includeKeys = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const cleanSettings = {};
  if (src.settings && typeof src.settings === 'object') {
    for (const [k, v] of Object.entries(src.settings)) {
      if (BLOCKED_SETTING_KEYS.has(k) || k.startsWith('oauth_') || k.startsWith('stremioKey')) continue;
      if (k === 'mediaKeys' && !includeKeys) continue;
      cleanSettings[k] = v;
    }
  }
  const out = {
    v: VERSION,
    exportedAt: Number(src.exportedAt) || Date.now(),
    profileName: String(src.profileName || 'default').slice(0, 32),
    sections: Array.isArray(src.sections) ? src.sections.map((s) => String(s)) : ['addons', 'themes', 'library', 'settings'],
    addons: Array.isArray(src.addons) ? src.addons.filter((u) => typeof u === 'string').slice(0, 200) : undefined,
    disabledAddons: Array.isArray(src.disabledAddons) ? src.disabledAddons.filter((u) => typeof u === 'string').slice(0, 200) : undefined,
    look: src.look && typeof src.look === 'object' ? src.look : undefined,
    cinemaTheme: typeof src.cinemaTheme === 'string' ? src.cinemaTheme : undefined,
    socialProfile: src.socialProfile && typeof src.socialProfile === 'object' ? src.socialProfile : undefined,
    homePrefs: src.homePrefs && typeof src.homePrefs === 'object' ? src.homePrefs : undefined,
    mediaTune: src.mediaTune && typeof src.mediaTune === 'object' ? src.mediaTune : undefined,
    letterboxd: src.letterboxd && typeof src.letterboxd === 'object' ? src.letterboxd : undefined,
    library: src.library && typeof src.library === 'object' ? src.library : undefined,
    settings: Object.keys(cleanSettings).length ? cleanSettings : undefined,
    settingsV2: src.settingsV2 && typeof src.settingsV2 === 'object' ? src.settingsV2 : undefined,
    profileV1: src.profileV1 && typeof src.profileV1 === 'object' ? src.profileV1 : undefined,
    mediaKeys: includeKeys && src.mediaKeys && typeof src.mediaKeys === 'object'
      ? Object.fromEntries(Object.entries(src.mediaKeys).filter(([, v]) => typeof v === 'string' && v && !v.startsWith('dpapi:')))
      : undefined,
  };
  return out;
}

async function encryptProfileBundle(payload, passphrase, opts = {}) {
  const clean = sanitizeBundlePayload(payload, opts);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(clean), 'utf8'));
  if (compressed.length > MAX_BUNDLE_BYTES) throw new Error('bundle_too_large');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt, SCRYPT_OPTS);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    format: FORMAT,
    v: VERSION,
    cipher: CIPHER,
    kdf: 'scrypt',
    kdfParams: { N: SCRYPT_OPTS.N, r: SCRYPT_OPTS.r, p: SCRYPT_OPTS.p },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    aad: AAD.toString('base64'),
    payload: ct.toString('base64'),
  }, null, 2);
}

async function decryptProfileBundle(rawTextOrBuf, passphrase) {
  const rawBuf = Buffer.isBuffer(rawTextOrBuf) ? rawTextOrBuf : Buffer.from(String(rawTextOrBuf || ''), 'utf8');
  if (!rawBuf.length || rawBuf.length > MAX_BUNDLE_BYTES * 2) throw new Error('invalid_bundle_size');
  let env;
  try { env = JSON.parse(rawBuf.toString('utf8')); } catch { throw new Error('invalid_bundle_json'); }
  if (!env || env.format !== FORMAT || env.v !== VERSION || env.cipher !== CIPHER || env.kdf !== 'scrypt') {
    throw new Error('unsupported_bundle_format');
  }
  const salt = Buffer.from(String(env.salt || ''), 'base64');
  const iv = Buffer.from(String(env.iv || ''), 'base64');
  const tag = Buffer.from(String(env.tag || ''), 'base64');
  const ct = Buffer.from(String(env.payload || ''), 'base64');
  const aad = Buffer.from(String(env.aad || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !ct.length || !aad.equals(AAD)) {
    throw new Error('invalid_bundle_header');
  }
  const key = await deriveKey(passphrase, salt, env.kdfParams || SCRYPT_OPTS);
  let plainGz;
  try {
    const decipher = crypto.createDecipheriv(CIPHER, key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plainGz = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('wrong_passphrase_or_corrupted');
  }
  const jsonBuf = zlib.gunzipSync(plainGz, { maxOutputLength: MAX_BUNDLE_BYTES });
  const parsed = JSON.parse(jsonBuf.toString('utf8'));
  return sanitizeBundlePayload(parsed, { includeKeys: true });
}

module.exports = {
  FORMAT,
  VERSION,
  MAX_BUNDLE_BYTES,
  sanitizeBundlePayload,
  encryptProfileBundle,
  decryptProfileBundle,
};
