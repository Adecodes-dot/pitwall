// GT7 "Simulator Interface" packet encryption. See docs/research/gt7-protocol.md §1.
// Salsa20/20, 32-byte key = first 32 bytes of "Simulator Interface Packet GT7 ver 0.0",
// 8-byte nonce = LE(iv1 ^ K) || LE(iv1) where iv1 is the little-endian int32 at offset 0x40
// (the only unencrypted bytes) and K depends on the packet format chosen by the heartbeat byte.
// Layout and constants after Nenkai/PDTools (MIT) and MacManley/gt7-udp (MIT); cipher from tweetnacl (Unlicense).
import nacl from 'tweetnacl';

// tweetnacl's typings omit the lowlevel namespace; the raw Salsa20 stream is what GT7 uses.
const lowlevel = (nacl as unknown as { lowlevel: { crypto_stream_salsa20_xor(c: Uint8Array, cpos: number, m: Uint8Array, mpos: number, b: number, n: Uint8Array, k: Uint8Array): number } }).lowlevel;

export type Gt7Format = 'A' | 'B' | '~' | 'C';

export const GT7_KEY = new TextEncoder().encode('Simulator Interface Packet GT7 ver 0.0').subarray(0, 32);
export const GT7_MAGIC = 0x47375330; // "G7S0" little-endian

export const FORMAT_BY_SIZE: Record<number, Gt7Format> = { 296: 'A', 316: 'B', 344: '~', 368: 'C' };
export const SIZE_BY_FORMAT: Record<Gt7Format, number> = { A: 296, B: 316, '~': 344, C: 368 };
export const XOR_BY_FORMAT: Record<Gt7Format, number> = { A: 0xdeadbeaf, B: 0xdeadbeef, '~': 0x55fabb4f, C: 0xdeadbeef };
const IV_OFFSET = 0x40;

function nonceFor(iv1: number, xor: number): Uint8Array {
  const n = new Uint8Array(8);
  const dv = new DataView(n.buffer);
  dv.setUint32(0, (iv1 ^ xor) >>> 0, true);
  dv.setUint32(4, iv1 >>> 0, true);
  return n;
}

function salsa20Xor(data: Uint8Array, nonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  lowlevel.crypto_stream_salsa20_xor(out, 0, data, 0, data.length, nonce, GT7_KEY);
  return out;
}

/** Decrypt a datagram. Tries the XOR constant for the format implied by the length first, then the others. */
export function decryptGt7(data: Uint8Array): { format: Gt7Format; plain: Uint8Array } | null {
  if (data.length < 0x44) return null;
  const iv1 = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(IV_OFFSET, true);
  const bySize = FORMAT_BY_SIZE[data.length];
  const candidates: Gt7Format[] = bySize ? [bySize, ...(['A', 'B', '~', 'C'] as Gt7Format[]).filter((f) => f !== bySize)] : ['A', 'B', '~', 'C'];
  const tried = new Set<number>();
  for (const format of candidates) {
    const xor = XOR_BY_FORMAT[format];
    if (tried.has(xor)) continue;
    tried.add(xor);
    const plain = salsa20Xor(data, nonceFor(iv1, xor));
    const magic = new DataView(plain.buffer).getUint32(0, true);
    if (magic === GT7_MAGIC) {
      // B and C share a constant; disambiguate by length.
      const f = bySize ?? format;
      return { format: f, plain };
    }
  }
  return null;
}

/**
 * Encrypt a plaintext packet the way the console does (used by the synthetic generator and tests).
 * The 4 bytes at 0x40 are the IV seed and stay in clear text.
 */
export function encryptGt7(plain: Uint8Array, format: Gt7Format, iv1: number): Uint8Array {
  const buf = new Uint8Array(plain);
  new DataView(buf.buffer).setUint32(IV_OFFSET, iv1 >>> 0, true);
  const enc = salsa20Xor(buf, nonceFor(iv1, XOR_BY_FORMAT[format]));
  // Restore the clear-text IV bytes (the console leaves them unencrypted).
  enc.set(buf.subarray(IV_OFFSET, IV_OFFSET + 4), IV_OFFSET);
  return enc;
}
