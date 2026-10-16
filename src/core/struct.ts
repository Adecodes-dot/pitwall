// Tiny declarative binary struct reader (little-endian). Used by the F1 adapter so each
// packet layout is a table that mirrors the EA spec line for line.

export type FieldType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'f32' | 'char';
export type Field = readonly [name: string, type: FieldType, count?: number];
export type Layout = readonly Field[];

const SIZE: Record<FieldType, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, f32: 4, char: 1 };

export function layoutSize(layout: Layout): number {
  let n = 0;
  for (const [, type, count] of layout) n += SIZE[type] * (count ?? 1);
  return n;
}

function readOne(dv: DataView, off: number, type: FieldType): number | bigint {
  switch (type) {
    case 'u8': case 'char': return dv.getUint8(off);
    case 'i8': return dv.getInt8(off);
    case 'u16': return dv.getUint16(off, true);
    case 'i16': return dv.getInt16(off, true);
    case 'u32': return dv.getUint32(off, true);
    case 'i32': return dv.getInt32(off, true);
    case 'u64': return dv.getBigUint64(off, true);
    case 'f32': return dv.getFloat32(off, true);
  }
}

export type StructValue = Record<string, number | bigint | number[] | string>;

/** Read a struct at `offset`; returns the object and the number of bytes consumed. */
export function readStruct(dv: DataView, offset: number, layout: Layout): [StructValue, number] {
  const out: StructValue = {};
  let off = offset;
  for (const [name, type, count] of layout) {
    const size = SIZE[type];
    if (count === undefined) {
      out[name] = readOne(dv, off, type);
      off += size;
    } else if (type === 'char') {
      let s = '';
      for (let i = 0; i < count; i++) { const c = dv.getUint8(off + i); if (c === 0) break; s += String.fromCharCode(c); }
      out[name] = s;
      off += count;
    } else {
      const arr: number[] = new Array(count);
      for (let i = 0; i < count; i++) { arr[i] = readOne(dv, off, type) as number; off += size; }
      out[name] = arr;
    }
  }
  return [out, off - offset];
}

/** Write a struct (used by the synthetic generator and tests). Missing fields are written as 0. */
export function writeStruct(dv: DataView, offset: number, layout: Layout, value: Partial<StructValue>): number {
  let off = offset;
  for (const [name, type, count] of layout) {
    const size = SIZE[type];
    const v = value[name];
    if (count === undefined) {
      writeOne(dv, off, type, (v as number | bigint | undefined) ?? 0);
      off += size;
    } else if (type === 'char') {
      const s = (v as string | undefined) ?? '';
      for (let i = 0; i < count; i++) dv.setUint8(off + i, i < s.length ? s.charCodeAt(i) : 0);
      off += count;
    } else {
      const arr = (v as number[] | undefined) ?? [];
      for (let i = 0; i < count; i++) { writeOne(dv, off, type, arr[i] ?? 0); off += size; }
    }
  }
  return off - offset;
}

function writeOne(dv: DataView, off: number, type: FieldType, v: number | bigint): void {
  switch (type) {
    case 'u8': case 'char': dv.setUint8(off, Number(v)); break;
    case 'i8': dv.setInt8(off, Number(v)); break;
    case 'u16': dv.setUint16(off, Number(v), true); break;
    case 'i16': dv.setInt16(off, Number(v), true); break;
    case 'u32': dv.setUint32(off, Number(v), true); break;
    case 'i32': dv.setInt32(off, Number(v), true); break;
    case 'u64': dv.setBigUint64(off, BigInt(v), true); break;
    case 'f32': dv.setFloat32(off, Number(v), true); break;
  }
}
