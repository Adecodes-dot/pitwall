// Decode/encode F1 datagrams against the per-format layout tables.
// decodeF1 returns the header plus the player's car struct (and session-wide data) — enough for Pit Wall.
// encodeF1 builds a full datagram (all cars) for the synthetic generator and tests.
import { readStruct, writeStruct, layoutSize, type StructValue, type Layout } from '../../core/struct.ts';
import { FORMATS, HEADER, HEADER_SIZE, PacketId, LAP_DATA_TRAILER, CAR_TELEMETRY_TRAILER, EVENT, type F1Format, type FormatTable } from './layouts.ts';

export interface F1Header {
  packetFormat: number; gameYear: number; packetVersion: number; packetId: number; sessionUID: bigint;
  sessionTime: number; frameIdentifier: number; overallFrameIdentifier: number; playerCarIndex: number;
}

export type F1Decoded =
  | { kind: 'motion'; header: F1Header; car: StructValue }
  | { kind: 'session'; header: F1Header; data: StructValue }
  | { kind: 'lapData'; header: F1Header; car: StructValue }
  | { kind: 'event'; header: F1Header; code: string; details: DataView }
  | { kind: 'carTelemetry'; header: F1Header; car: StructValue; trailer: StructValue }
  | { kind: 'carStatus'; header: F1Header; car: StructValue }
  | { kind: 'carDamage'; header: F1Header; car: StructValue }
  | { kind: 'motionEx'; header: F1Header; data: StructValue }
  | { kind: 'carTelemetry2'; header: F1Header; car: StructValue }
  | { kind: 'ignored'; header: F1Header };

export type F1DecodeError = { error: 'too-short' | 'unknown-format' | 'bad-length' | 'unknown-packet'; format?: number; packetId?: number; length: number };

export function readHeader(dv: DataView): F1Header {
  const [h] = readStruct(dv, 0, HEADER);
  return {
    packetFormat: h.packetFormat as number, gameYear: h.gameYear as number, packetVersion: h.packetVersion as number,
    packetId: h.packetId as number, sessionUID: h.sessionUID as bigint, sessionTime: h.sessionTime as number,
    frameIdentifier: h.frameIdentifier as number, overallFrameIdentifier: h.overallFrameIdentifier as number,
    playerCarIndex: h.playerCarIndex as number,
  };
}

export function isF1Format(n: number): n is F1Format { return n === 2024 || n === 2025 || n === 2026; }

export function decodeF1(data: Uint8Array): F1Decoded | F1DecodeError {
  if (data.length < HEADER_SIZE) return { error: 'too-short', length: data.length };
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = readHeader(dv);
  if (!isF1Format(header.packetFormat)) return { error: 'unknown-format', format: header.packetFormat, length: data.length };
  const T = FORMATS[header.packetFormat];
  const expected = T.sizes[header.packetId];
  if (expected === undefined) {
    // Packets we do not consume (participants, setups, history...). Accept any length; the game is the authority.
    return { kind: 'ignored', header };
  }
  if (data.length !== expected) return { error: 'bad-length', format: header.packetFormat, packetId: header.packetId, length: data.length };
  const car = (layout: Layout): StructValue => {
    const idx = Math.min(header.playerCarIndex, T.cars - 1);
    return readStruct(dv, HEADER_SIZE + idx * layoutSize(layout), layout)[0];
  };
  switch (header.packetId) {
    case PacketId.Motion: return { kind: 'motion', header, car: car(T.motion) };
    case PacketId.Session: return { kind: 'session', header, data: readStruct(dv, HEADER_SIZE, T.session)[0] };
    case PacketId.LapData: return { kind: 'lapData', header, car: car(T.lapData) };
    case PacketId.Event: {
      const [e] = readStruct(dv, HEADER_SIZE, EVENT);
      return { kind: 'event', header, code: e.eventStringCode as string, details: new DataView(data.buffer, data.byteOffset + HEADER_SIZE + 4, 12) };
    }
    case PacketId.CarTelemetry: {
      const trailerOff = HEADER_SIZE + T.cars * layoutSize(T.carTelemetry);
      return { kind: 'carTelemetry', header, car: car(T.carTelemetry), trailer: readStruct(dv, trailerOff, CAR_TELEMETRY_TRAILER)[0] };
    }
    case PacketId.CarStatus: return { kind: 'carStatus', header, car: car(T.carStatus) };
    case PacketId.CarDamage: return { kind: 'carDamage', header, car: car(T.carDamage) };
    case PacketId.MotionEx: return { kind: 'motionEx', header, data: readStruct(dv, HEADER_SIZE, T.motionEx)[0] };
    case PacketId.CarTelemetry2: return { kind: 'carTelemetry2', header, car: car(T.carTelemetry2!) };
    default: return { kind: 'ignored', header };
  }
}

/** Layout for one car / the packet body, per packet id. */
function bodyLayout(T: FormatTable, packetId: number): { per: Layout | null; whole: Layout | null; trailer: Layout | null } {
  switch (packetId) {
    case PacketId.Motion: return { per: T.motion, whole: null, trailer: null };
    case PacketId.Session: return { per: null, whole: T.session, trailer: null };
    case PacketId.LapData: return { per: T.lapData, whole: null, trailer: LAP_DATA_TRAILER };
    case PacketId.Event: return { per: null, whole: EVENT, trailer: null };
    case PacketId.CarTelemetry: return { per: T.carTelemetry, whole: null, trailer: CAR_TELEMETRY_TRAILER };
    case PacketId.CarStatus: return { per: T.carStatus, whole: null, trailer: null };
    case PacketId.CarDamage: return { per: T.carDamage, whole: null, trailer: null };
    case PacketId.MotionEx: return { per: null, whole: T.motionEx, trailer: null };
    case PacketId.CarTelemetry2: return { per: null, whole: null, trailer: null, ...(T.carTelemetry2 ? { per: T.carTelemetry2 } : {}) };
    default: throw new Error(`encodeF1: unsupported packet id ${packetId}`);
  }
}

export interface EncodeOptions {
  format: F1Format;
  packetId: number;
  header?: Partial<Omit<F1Header, 'packetFormat' | 'packetId'>>;
  /** player car struct (written at playerCarIndex); other cars are zero */
  car?: Partial<StructValue>;
  /** whole-packet body (session, motionEx, event) */
  body?: Partial<StructValue>;
  trailer?: Partial<StructValue>;
}

export function encodeF1(o: EncodeOptions): Uint8Array {
  const T = FORMATS[o.format];
  const size = T.sizes[o.packetId];
  if (size === undefined) throw new Error(`encodeF1: no size for packet ${o.packetId} in format ${o.format}`);
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  const playerCarIndex = o.header?.playerCarIndex ?? 0;
  writeStruct(dv, 0, HEADER, {
    packetFormat: o.format, gameYear: o.format === 2024 ? 24 : 25, gameMajorVersion: 1, gameMinorVersion: 0, packetVersion: 1,
    packetId: o.packetId, sessionUID: o.header?.sessionUID ?? 1n, sessionTime: o.header?.sessionTime ?? 0,
    frameIdentifier: o.header?.frameIdentifier ?? 0, overallFrameIdentifier: o.header?.overallFrameIdentifier ?? o.header?.frameIdentifier ?? 0,
    playerCarIndex, secondaryPlayerCarIndex: 255,
  });
  const { per, whole, trailer } = bodyLayout(T, o.packetId);
  if (per) {
    writeStruct(dv, HEADER_SIZE + playerCarIndex * layoutSize(per), per, o.car ?? {});
    if (trailer) writeStruct(dv, HEADER_SIZE + T.cars * layoutSize(per), trailer, o.trailer ?? {});
  } else if (whole) {
    writeStruct(dv, HEADER_SIZE, whole, o.body ?? {});
  }
  return buf;
}
