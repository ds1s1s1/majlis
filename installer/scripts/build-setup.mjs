import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [, , unpackedDirArg, outExeArg] = process.argv;
if (!unpackedDirArg || !outExeArg) {
  console.error('Usage: node build-setup.mjs <win-unpacked-dir> <output-setup-exe>');
  process.exit(1);
}

const rootDir = path.resolve(unpackedDirArg);
const outExe = path.resolve(outExeArg);
const baseExe = path.resolve(import.meta.dirname, '..', 'src-tauri', 'target', 'release', 'majlis-setup.exe');

if (!fs.existsSync(baseExe)) {
  console.error('Missing compiled Tauri setup stub:', baseExe);
  process.exit(1);
}
if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
  console.error('Missing win-unpacked directory:', rootDir);
  process.exit(1);
}

// Standard CRC32 table for ZIP generation (zero external deps)
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(dir, prefix = '') {
  const list = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) list.push(...collectFiles(abs, rel));
    else if (ent.isFile()) list.push({ abs, rel });
  }
  return list;
}

const files = collectFiles(rootDir);
const stubBuf = fs.readFileSync(baseExe);
fs.mkdirSync(path.dirname(outExe), { recursive: true });
const fd = fs.openSync(outExe, 'w');
const cdRecords = [];
let offset = 0;

try {
  fs.writeSync(fd, stubBuf);

  for (const { abs, rel } of files) {
    const raw = fs.readFileSync(abs);
    const crc = crc32(raw);
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(rel, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);

    fs.writeSync(fd, lfh);
    fs.writeSync(fd, nameBuf);
    fs.writeSync(fd, payload);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);

    cdRecords.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(cdRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const zipLength = BigInt(offset) + BigInt(cdBuf.length) + BigInt(eocd.length);
  const trailer = Buffer.alloc(24);
  trailer.writeBigUInt64LE(BigInt(stubBuf.length), 0);
  trailer.writeBigUInt64LE(zipLength, 8);
  trailer.write('MJLSSFX1', 16, 'ascii');

  fs.writeSync(fd, cdBuf);
  fs.writeSync(fd, eocd);
  fs.writeSync(fd, trailer);
  console.log(`Built ${outExe} (${files.length} files, ${Math.round(Number(zipLength) / (1024 * 1024))} MB ZIP payload)`);
} finally {
  fs.closeSync(fd);
}
