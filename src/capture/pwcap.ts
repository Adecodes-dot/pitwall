// .pwcap capture file: raw datagrams with timestamps. See ARCHITECTURE.md §5.
// File:   magic "PWCAP1\0\0" | u32 metaLen | meta JSON (utf8) | records...
// Record: u32 len | f64 tMonotonicMs | f64 tWallMs | u16 srcPort | u8 game | bytes[len]
// GT7 payloads are stored encrypted exactly as received so replay exercises the real decoder.
import { openSync, writeSync, closeSync, readFileSync, fsyncSync } from 'node:fs';
import type { GameId } from '../core/types.ts';

export const PWCAP_MAGIC = 'PWCAP1\0\0';
const GAME_CODE: Record<GameId | 'unknown', number> = { unknown: 0, f1: 1, gt7: 2 };
const CODE_GAME: Record<number, GameId | 'unknown'> = { 0: 'unknown', 1: 'f1', 2: 'gt7' };
const RECORD_HEADER = 4 + 8 + 8 + 2 + 1;

export interface CaptureMeta {
  createdAt: string;
  game: GameId | 'unknown';
  lanIp?: string;
  notes?: string;
  /** in-game lap times typed in by the user for verification, ms */
  referenceLapTimesMs?: number[];
  adapterVersion: string;
  [k: string]: unknown;
}

export interface CaptureRecord {
  /** monotonic ms at receive, from the capturing process */
  t: number;
  tWall: number;
  srcPort: number;
  game: GameId | 'unknown';
  data: Uint8Array;
}

export class PwcapWriter {
  private fd: number;
  private chunks: Uint8Array[] = [];
  private bytesBuffered = 0;
  count = 0;

  readonly path: string;

  constructor(path: string, meta: CaptureMeta) {
    this.path = path;
    this.fd = openSync(path, 'w');
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const head = new Uint8Array(8 + 4 + metaBytes.length);
    head.set(new TextEncoder().encode(PWCAP_MAGIC), 0);
    new DataView(head.buffer).setUint32(8, metaBytes.length, true);
    head.set(metaBytes, 12);
    writeSync(this.fd, head);
  }

  write(rec: CaptureRecord): void {
    const buf = new Uint8Array(RECORD_HEADER + rec.data.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, rec.data.length, true);
    dv.setFloat64(4, rec.t, true);
    dv.setFloat64(12, rec.tWall, true);
    dv.setUint16(20, rec.srcPort, true);
    dv.setUint8(22, GAME_CODE[rec.game]);
    buf.set(rec.data, RECORD_HEADER);
    this.chunks.push(buf);
    this.bytesBuffered += buf.length;
    this.count++;
    if (this.bytesBuffered > 256 * 1024) this.flush();
  }

  flush(): void {
    if (this.chunks.length === 0) return;
    for (const c of this.chunks) writeSync(this.fd, c);
    this.chunks = []; this.bytesBuffered = 0;
  }

  close(): void {
    this.flush();
    try { fsyncSync(this.fd); } catch { /* best effort */ }
    closeSync(this.fd);
  }
}

export function readPwcap(path: string): { meta: CaptureMeta; records: CaptureRecord[] } {
  const buf = readFileSync(path);
  return parsePwcap(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

export function parsePwcap(bytes: Uint8Array): { meta: CaptureMeta; records: CaptureRecord[] } {
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic !== PWCAP_MAGIC) throw new Error('not a .pwcap file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + metaLen))) as CaptureMeta;
  const records: CaptureRecord[] = [];
  let off = 12 + metaLen;
  while (off + RECORD_HEADER <= bytes.length) {
    const len = dv.getUint32(off, true);
    if (off + RECORD_HEADER + len > bytes.length) break; // truncated tail (process killed mid-write)
    records.push({
      t: dv.getFloat64(off + 4, true),
      tWall: dv.getFloat64(off + 12, true),
      srcPort: dv.getUint16(off + 20, true),
      game: CODE_GAME[dv.getUint8(off + 22)] ?? 'unknown',
      data: bytes.slice(off + RECORD_HEADER, off + RECORD_HEADER + len),
    });
    off += RECORD_HEADER + len;
  }
  return { meta, records };
}
