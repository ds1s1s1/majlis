'use strict';
// Identity helpers shared by the server and the app (the app keeps an identical copy).
// A player number is derived from the Ed25519 public key, so nobody has to sign up:
// the key is the account, the number is just a friendly handle for it.
const crypto = require('crypto');

const ID_MIN = 100000000n;
const ID_SPAN = 900000000n;

function deriveId(pkRaw, salt = 0) {
  const h = crypto.createHash('sha256')
    .update('majlis-id-v1')
    .update(pkRaw)
    .update(String(salt))
    .digest();
  return (h.readBigUInt64BE(0) % ID_SPAN + ID_MIN).toString();
}

function publicKeyFromRaw(pkRaw) {
  return crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pkRaw).toString('base64url') },
    format: 'jwk',
  });
}

// Signed messages are plain objects; the signature covers JSON of everything except `sig`.
function signedBytes(msg) {
  return Buffer.from(JSON.stringify({ ...msg, sig: undefined }));
}

function verifyMsg(msg, pkB64) {
  try {
    if (typeof msg.sig !== 'string' || typeof pkB64 !== 'string') return false;
    const pk = Buffer.from(pkB64, 'base64');
    if (pk.length !== 32) return false;
    return crypto.verify(null, signedBytes(msg), publicKeyFromRaw(pk), Buffer.from(msg.sig, 'base64'));
  } catch {
    return false;
  }
}

function isId(s) { return typeof s === 'string' && /^[1-9]\d{8}$/.test(s); }
function isCode(s) { return typeof s === 'string' && /^\d{6}$/.test(s); }

module.exports = { deriveId, publicKeyFromRaw, signedBytes, verifyMsg, isId, isCode };
