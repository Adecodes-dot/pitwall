// Generate the app icon (256 px PNG) and tray icon (32 px PNG) without any image library:
// a dark rounded square with a green "receiving" dot and a white chevron (the Pit Wall mark).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function crc32(buf: Uint8Array): number { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x, y); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, size); dv.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const total = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function mark(size: number) {
  const r = size * 0.19;
  return (x: number, y: number): [number, number, number, number] => {
    // rounded square
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0];
    // green dot top-right
    if (Math.hypot(x - size * 0.72, y - size * 0.3) < size * 0.1) return [46, 204, 113, 255];
    // chevron: two thick lines forming a peak at (0.38, 0.3) down to (0.2, 0.7) and (0.56, 0.7)
    const d1 = Math.abs((x - size * 0.38) * 0.4 / 0.18 + (y - size * 0.3)) / Math.hypot(1, 0.4 / 0.18 * 1) ; void d1;
    const t = (y - size * 0.3) / (size * 0.4); // 0 at peak, 1 at base
    if (t >= 0 && t <= 1) { const w = size * 0.07; const lx = size * 0.38 - t * size * 0.18, rx = size * 0.38 + t * size * 0.18; if (Math.abs(x - lx) < w || Math.abs(x - rx) < w) return [232, 234, 237, 255]; }
    // blue bar bottom right
    if (y > size * 0.62 && y < size * 0.72 && x > size * 0.6 && x < size * 0.84) return [77, 163, 255, 255];
    return [23, 26, 31, 255];
  };
}
mkdirSync('app', { recursive: true });
writeFileSync(join('app', 'icon.png'), png(256, mark(256)));
writeFileSync(join('app', 'tray.png'), png(32, mark(32)));
console.log('icons written: app/icon.png (256), app/tray.png (32)');
