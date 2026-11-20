// Pure ISO/IEC 18004 byte-mode QR matrix encoder (Versions 1..14, ECC Level L).
// Zero external dependencies; renders offline & CSP-safe anywhere.

const QR_VERSIONS = [
  // [ver, totalDataCw, ecPerBlock, g1Count, g1Data, g2Count, g2Data, alignCenters]
  [1, 19, 7, 1, 19, 0, 0, []],
  [2, 34, 10, 1, 34, 0, 0, [6, 18]],
  [3, 55, 15, 1, 55, 0, 0, [6, 22]],
  [4, 80, 20, 1, 80, 0, 0, [6, 26]],
  [5, 108, 26, 1, 108, 0, 0, [6, 30]],
  [6, 136, 18, 2, 68, 0, 0, [6, 34]],
  [7, 156, 20, 2, 78, 0, 0, [6, 22, 38]],
  [8, 194, 24, 2, 97, 0, 0, [6, 24, 42]],
  [9, 232, 30, 2, 116, 0, 0, [6, 26, 46]],
  [10, 274, 18, 2, 68, 2, 69, [6, 28, 50]],
  [11, 324, 20, 4, 81, 0, 0, [6, 30, 54]],
  [12, 370, 24, 2, 92, 2, 93, [6, 32, 58]],
  [13, 428, 26, 4, 107, 0, 0, [6, 34, 62]],
  [14, 461, 30, 3, 115, 1, 116, [6, 26, 46, 66]],
] as const;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): Uint8Array {
  let g: number[] = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], root);
    }
    g = next;
  }
  return Uint8Array.from(g);
}

function rsEncode(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGenerator(ecCount);
  const res = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) res[j] ^= gfMul(gen[j + 1], factor);
  }
  return res;
}

function bchFormatBits(mask: number): number {
  const data = (0b01 << 3) | (mask & 7); // ECC L = 01
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function golayVersionBits(ver: number): number {
  let d = ver << 12;
  for (let i = 17; i >= 12; i--) {
    if ((d >>> i) & 1) d ^= 0x1f25 << (i - 12);
  }
  return (ver << 12) | d;
}

function makeMatrix(size: number, ver: number, alignCenters: readonly number[]) {
  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const fn = Array.from({ length: size }, () => new Uint8Array(size));
  const setFn = (r: number, c: number, v: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mod[r][c] = v ? 1 : 0;
      fn[r][c] = 1;
    }
  };
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const in7 = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = in7 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setFn(r0 + r, c0 + c, dark ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0 ? 1 : 0);
    setFn(i, 6, i % 2 === 0 ? 1 : 0);
  }
  setFn(size - 8, 8, 1);

  for (const r of alignCenters) {
    for (const c of alignCenters) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFn(r + dr, c + dc, dark ? 1 : 0);
        }
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFn(8, i, 0);
      setFn(i, 8, 0);
    }
  }
  for (let i = size - 8; i < size; i++) setFn(8, i, 0);
  for (let i = size - 7; i < size; i++) setFn(i, 8, 0);

  if (ver >= 7) {
    const bits = golayVersionBits(ver);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }
  return { mod, fn };
}

function drawDataBits(mod: Uint8Array[], fn: Uint8Array[], codewords: Uint8Array) {
  const size = mod.length;
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let dirUp = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = dirUp ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (fn[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        mod[r][c] = bit;
      }
    }
    dirUp = !dirUp;
  }
}

function applyMaskAndFormat(mod: Uint8Array[], fn: Uint8Array[], mask: number) {
  const size = mod.length;
  const out = mod.map((row) => new Uint8Array(row));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (fn[r][c]) continue;
      let inv = false;
      switch (mask) {
        case 0: inv = (r + c) % 2 === 0; break;
        case 1: inv = r % 2 === 0; break;
        case 2: inv = c % 3 === 0; break;
        case 3: inv = (r + c) % 3 === 0; break;
        case 4: inv = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: inv = ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: inv = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        case 7: inv = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      }
      if (inv) out[r][c] ^= 1;
    }
  }
  const fmt = bchFormatBits(mask);
  for (let i = 0; i <= 5; i++) out[8][i] = (fmt >>> i) & 1;
  out[8][7] = (fmt >>> 6) & 1;
  out[8][8] = (fmt >>> 7) & 1;
  out[7][8] = (fmt >>> 8) & 1;
  for (let i = 9; i < 15; i++) out[14 - i][8] = (fmt >>> i) & 1;
  for (let i = 0; i < 8; i++) out[8][size - 1 - i] = (fmt >>> i) & 1;
  for (let i = 8; i < 15; i++) out[size - 15 + i][8] = (fmt >>> i) & 1;
  out[size - 8][8] = 1;
  return out;
}

function penaltyScore(m: Uint8Array[]): number {
  const n = m.length;
  let score = 0;
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
      else run = 1;
    }
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
      else run = 1;
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1];
      if (s === 0 || s === 4) score += 3;
    }
  }
  return score;
}

export function encodeQrMatrix(text: string): { size: number; rows: boolean[][] } {
  const bytes = new TextEncoder().encode(String(text || ''));
  const entry = QR_VERSIONS.find(([ver, cap]) => {
    const hdrBits = 4 + (ver >= 10 ? 16 : 8);
    return Math.ceil((hdrBits + bytes.length * 8) / 8) <= cap;
  }) || QR_VERSIONS[QR_VERSIONS.length - 1];

  const [ver, totalDataCw, ecPerBlock, g1Count, g1Data, g2Count, g2Data, alignCenters] = entry;
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, totalDataCw * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCw.push(byte);
  }
  const pads = [0xec, 0x11];
  for (let p = 0; dataCw.length < totalDataCw; p++) dataCw.push(pads[p & 1]);

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let off = 0;
  for (let i = 0; i < g1Count; i++) {
    const blk = Uint8Array.from(dataCw.slice(off, off + g1Data));
    off += g1Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }
  for (let i = 0; i < g2Count; i++) {
    const blk = Uint8Array.from(dataCw.slice(off, off + g2Data));
    off += g2Data;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of ecBlocks) if (i < b.length) interleaved.push(b[i]);
  }

  const size = ver * 4 + 17;
  const { mod, fn } = makeMatrix(size, ver, alignCenters);
  drawDataBits(mod, fn, Uint8Array.from(interleaved));

  let bestMask = 0;
  let bestScore = Infinity;
  let bestMat = mod;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMaskAndFormat(mod, fn, mask);
    const s = penaltyScore(masked);
    if (s < bestScore) { bestScore = s; bestMask = mask; bestMat = masked; }
  }
  void bestMask;

  return {
    size,
    rows: bestMat.map((r) => Array.from(r, (v) => v === 1)),
  };
}
