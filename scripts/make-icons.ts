/**
 * Generates the monochrome extension icons (ink rounded square, paper "reading line" glyph).
 * Run with `pnpm icons`. Pure Node: draws with 4×4 supersampling and writes PNGs via zlib.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const INK = [0x0b, 0x0b, 0x0b] as const;
const PAPER = [0xf6, 0xf4, 0xef] as const;

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Returns 0 = transparent, 1 = ink, 2 = paper for a point in the unit square. */
function sample(x: number, y: number): 0 | 1 | 2 {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return 0;
  // Three text lines; the middle one is the "current word" block with a cursor bar under it.
  const line = (y0: number, x0: number, x1: number, h: number) =>
    y >= y0 && y <= y0 + h && x >= x0 && x <= x1;
  if (line(0.28, 0.24, 0.76, 0.07)) return 2;
  if (line(0.44, 0.24, 0.46, 0.07)) return 2;
  if (line(0.42, 0.52, 0.76, 0.11)) return 2;
  if (line(0.58, 0.52, 0.76, 0.035)) return 2;
  if (line(0.68, 0.24, 0.6, 0.07)) return 2;
  return 1;
}

mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const ss = 4;
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0;
      let rgb = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (s === 0) continue;
          a++;
          const c = s === 1 ? INK : PAPER;
          rgb = rgb.map((v, i) => v + (c[i] ?? 0));
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        out[o] = Math.round((rgb[0] ?? 0) / a);
        out[o + 1] = Math.round((rgb[1] ?? 0) / a);
        out[o + 2] = Math.round((rgb[2] ?? 0) / a);
      }
      out[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  writeFileSync(`public/icon/${size}.png`, png(size, out));
}
console.log('icons written to public/icon');
