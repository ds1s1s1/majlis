'use strict';
// Reed-Solomon erasure coding over GF(2^8) with a Cauchy matrix.
// Any k of the k+m shards rebuild the k data shards, so a frame survives up to m lost packets
// without waiting a round trip for a resend.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const inv = (a) => EXP[255 - LOG[a]];

// 256x256 multiplication table rows, built lazily: MT[c][x] = c*x
const MT = new Array(256);
function row(c) {
  let r = MT[c];
  if (!r) { r = new Uint8Array(256); for (let x = 0; x < 256; x++) r[x] = mul(c, x); MT[c] = r; }
  return r;
}

// Cauchy coefficient for parity row i, data column j (x_i = k+i, y_j = j, all distinct).
const coef = (k, i, j) => inv((k + i) ^ j);

function addMul(dst, src, c) {
  if (c === 0) return;
  const r = row(c);
  for (let x = 0; x < dst.length; x++) dst[x] ^= r[src[x]];
}

/** @param {Uint8Array[]} data k equal-length shards @returns {Uint8Array[]} m parity shards */
function encode(data, m) {
  const k = data.length, len = data[0].length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const p = new Uint8Array(len);
    for (let j = 0; j < k; j++) addMul(p, data[j], coef(k, i, j));
    out.push(p);
  }
  return out;
}

/**
 * @param {(Uint8Array|null)[]} shards length k+m, null = missing
 * @returns {Uint8Array[]|null} the k data shards, or null if not enough survived
 */
function decode(shards, k) {
  const have = [];
  for (let i = 0; i < shards.length && have.length < k; i++) if (shards[i]) have.push(i);
  if (have.length < k) return null;
  const missing = [];
  for (let j = 0; j < k; j++) if (!shards[j]) missing.push(j);
  if (!missing.length) return shards.slice(0, k);
  const len = shards[have[0]].length;

  // Rows of the generator matrix for the shards we have, then invert.
  const n = k;
  const a = [];
  for (const idx of have) {
    const r = new Uint8Array(n);
    if (idx < k) r[idx] = 1; else for (let j = 0; j < k; j++) r[j] = coef(k, idx - k, j);
    a.push(r);
  }
  const b = [];
  for (let i = 0; i < n; i++) { const r = new Uint8Array(n); r[i] = 1; b.push(r); }
  for (let c = 0; c < n; c++) {
    let p = c; while (p < n && !a[p][c]) p++;
    if (p === n) return null;
    [a[c], a[p]] = [a[p], a[c]]; [b[c], b[p]] = [b[p], b[c]];
    const iv = inv(a[c][c]);
    const ri = row(iv);
    for (let x = 0; x < n; x++) { a[c][x] = ri[a[c][x]]; b[c][x] = ri[b[c][x]]; }
    for (let r = 0; r < n; r++) {
      if (r === c || !a[r][c]) continue;
      const f = row(a[r][c]);
      for (let x = 0; x < n; x++) { a[r][x] ^= f[a[c][x]]; b[r][x] ^= f[b[c][x]]; }
    }
  }
  const out = shards.slice(0, k);
  for (const j of missing) {
    const d = new Uint8Array(len);
    for (let t = 0; t < n; t++) addMul(d, shards[have[t]], b[j][t]);
    out[j] = d;
  }
  return out;
}

module.exports = { encode, decode };
