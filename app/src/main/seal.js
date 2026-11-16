'use strict';
// Session crypto. Each side signs a fresh X25519 key with its long-term Ed25519 identity,
// the shared secret goes through HKDF, and every packet is AES-256-GCM with a counter nonce.
// The rendezvous server only relays the signed public halves, so it can't read or forge traffic.
const crypto = require('crypto');

const HDR = 13; // [0x10][sidShort u32][counter u64]
const TAG = 16;
const T_DATA = 0x10;

function newEphemeral() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { pub: raw, priv: privateKey };
}

function x25519Pub(raw) {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(raw).toString('base64url') }, format: 'jwk' });
}

function deriveKeys(eph, peerPubRaw, sidHex, guestPkB64, hostPkB64) {
  const dh = crypto.diffieHellman({ privateKey: eph.priv, publicKey: x25519Pub(peerPubRaw) });
  const okm = Buffer.from(crypto.hkdfSync('sha256', dh, Buffer.from(sidHex, 'hex'), `majlis-v1|${guestPkB64}|${hostPkB64}`, 96));
  return { g2h: okm.subarray(0, 32), h2g: okm.subarray(32, 64), probe: okm.subarray(64, 96) };
}

// Short code both people can read out loud to be sure nobody sits in the middle.
function safetyCode(keys) {
  const h = crypto.createHash('sha256').update(keys.probe).update('safety').digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

class ReplayWindow {
  constructor() { this.max = -1n; this.bits = new Uint32Array(64); }
  check(c) { // returns true if fresh (and records it)
    const W = 2048n;
    if (c > this.max) {
      const shift = this.max < 0n ? W : c - this.max;
      if (shift >= W) this.bits.fill(0);
      else for (let i = this.max + 1n; i <= c; i++) this._clr(i);
      this.max = c; this._set(c); return true;
    }
    if (this.max - c >= W) return false;
    if (this._get(c)) return false;
    this._set(c); return true;
  }
  _pos(c) { const p = Number(c % 2048n); return [p >> 5, 1 << (p & 31)]; }
  _get(c) { const [w, b] = this._pos(c); return (this.bits[w] & b) !== 0; }
  _set(c) { const [w, b] = this._pos(c); this.bits[w] |= b; }
  _clr(c) { const [w, b] = this._pos(c); this.bits[w] &= ~b; }
}

class Channel {
  /** @param {'host'|'guest'} role */
  constructor(keys, role, sidHex) {
    this.txKey = role === 'host' ? keys.h2g : keys.g2h;
    this.rxKey = role === 'host' ? keys.g2h : keys.h2g;
    this.txDir = role === 'host' ? 2 : 1;
    this.rxDir = role === 'host' ? 1 : 2;
    this.probeKey = keys.probe;
    this.sidShort = Buffer.from(sidHex, 'hex').readUInt32BE(0);
    this.ctr = 0n;
    this.replay = new ReplayWindow();
  }
  seal(plain) {
    const out = Buffer.allocUnsafe(HDR + plain.length + TAG);
    out[0] = T_DATA; out.writeUInt32BE(this.sidShort, 1); out.writeBigUInt64BE(this.ctr, 5);
    const nonce = Buffer.allocUnsafe(12); nonce.writeUInt32BE(this.txDir, 0); nonce.writeBigUInt64BE(this.ctr, 4);
    this.ctr++;
    const c = crypto.createCipheriv('aes-256-gcm', this.txKey, nonce);
    c.setAAD(out.subarray(0, HDR));
    const n1 = c.update(plain).copy(out, HDR);
    c.final();
    c.getAuthTag().copy(out, HDR + n1);
    return out;
  }
  open(pkt) {
    if (pkt.length < HDR + TAG || pkt[0] !== T_DATA) return null;
    const ctr = pkt.readBigUInt64BE(5);
    const nonce = Buffer.allocUnsafe(12); nonce.writeUInt32BE(this.rxDir, 0); nonce.writeBigUInt64BE(ctr, 4);
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', this.rxKey, nonce);
      d.setAAD(pkt.subarray(0, HDR));
      d.setAuthTag(pkt.subarray(pkt.length - TAG));
      const body = d.update(pkt.subarray(HDR, pkt.length - TAG));
      d.final();
      if (!this.replay.check(ctr)) return null;
      this.lastRxCtr = Number(ctr);
      return body;
    } catch { return null; }
  }
  probeMac(buf) { return crypto.createHmac('sha256', this.probeKey).update(buf).digest().subarray(0, 16); }
}

module.exports = { newEphemeral, deriveKeys, safetyCode, Channel, HDR, TAG, T_DATA };
