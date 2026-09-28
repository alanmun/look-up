import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2];
if (!['chrome', 'firefox', 'source'].includes(target)) {
  throw new Error('Usage: node tools/package.mjs chrome|firefox|source');
}

const base = target === 'source' ? root : join(root, 'dist', target);
const inputs = target === 'source'
  ? ['src', 'tools', 'build.mjs', 'package.json', 'README.md', 'LICENSE']
  : ['.'];
const output = join(root, 'web-ext-artifacts', `look-up-${target}.zip`);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDate(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return [(date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()];
}

async function collect(path, files) {
  const full = join(base, path);
  const info = await stat(full);
  if (info.isDirectory()) {
    for (const name of (await readdir(full)).sort()) {
      if (!name.startsWith('.')) await collect(join(path, name), files);
    }
  } else if (info.isFile()) {
    files.push({ full, name: relative(base, full).split(sep).join('/'), date: info.mtime });
  }
}

const files = [];
for (const input of inputs) await collect(input, files);

const chunks = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(file.name);
  const data = await readFile(file.full);
  const compressed = deflateRawSync(data);
  const checksum = crc32(data);
  const [time, date] = zipDate(file.date);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  chunks.push(local, name, compressed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(date, 14);
  entry.writeUInt32LE(checksum, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += local.length + name.length + compressed.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([...chunks, directory, end]));
console.log(`packaged ${relative(root, output)} (${files.length} files)`);
