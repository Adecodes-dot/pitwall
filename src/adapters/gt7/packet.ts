// GT7 decrypted packet layout. Offsets from docs/research/gt7-protocol.md §2.
import type { Gt7Format } from './crypto.ts';

export interface Gt7Packet {
  format: Gt7Format;
  position: [number, number, number];
  velocity: [number, number, number];
  rotation: [number, number, number, number];
  angularVelocity: [number, number, number];
  bodyHeight: number;
  rpm: number;
  fuelLevel: number;
  fuelCapacity: number;
  /** m/s */
  speed: number;
  boost: number;
  oilPressure: number;
  waterTemp: number;
  oilTemp: number;
  /** FL, FR, RL, RR */
  tyreTemp: [number, number, number, number];
  packetId: number;
  lapCount: number;
  lapsInRace: number;
  bestLapMs: number; // -1 = none
  lastLapMs: number; // -1 = none
  timeOfDayMs: number;
  preRacePosition: number;
  preRaceNumCars: number;
  minAlertRpm: number;
  maxAlertRpm: number;
  calculatedMaxSpeedKph: number;
  flags: number;
  gear: number; // 0 = R/N
  suggestedGear: number; // 15 = none
  throttle: number; // 0..255
  brake: number; // 0..255
  roadPlane: [number, number, number, number];
  /** rad/s per wheel, FL FR RL RR */
  wheelRevs: [number, number, number, number];
  tyreRadius: [number, number, number, number];
  suspensionHeight: [number, number, number, number];
  clutch: number;
  clutchEngagement: number;
  rpmAfterClutch: number;
  transmissionTopSpeed: number;
  gearRatios: number[];
  carCode: number;
  // B+
  wheelRotationRad: number | null;
  steeringVelocity: number | null;
  sway: number | null;
  heave: number | null;
  surge: number | null;
  // ~+
  throttleRaw: number | null; // 0..255
  brakeRaw: number | null;
  energyRecovery: number | null;
  // C
  surfaceTypes: [string, string, string, string] | null;
  currentLapMs: number | null;
  wheelSteerAngle: [number, number] | null;
  wheelbase: number | null;
  carCategory: string | null;
}

export const GT7_FLAG = {
  carOnTrack: 1 << 0,
  paused: 1 << 1,
  loading: 1 << 2,
  inGear: 1 << 3,
  hasTurbo: 1 << 4,
  revLimiter: 1 << 5,
  handbrake: 1 << 6,
  lights: 1 << 7,
  highBeam: 1 << 8,
  lowBeam: 1 << 9,
  asmActive: 1 << 10,
  tcsActive: 1 << 11,
} as const;

const f = (dv: DataView, o: number) => dv.getFloat32(o, true);
const f3 = (dv: DataView, o: number): [number, number, number] => [f(dv, o), f(dv, o + 4), f(dv, o + 8)];
const f4 = (dv: DataView, o: number): [number, number, number, number] => [f(dv, o), f(dv, o + 4), f(dv, o + 8), f(dv, o + 12)];
const chars = (dv: DataView, o: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (c === 0) break; s += String.fromCharCode(c); }
  return s;
};

export function parseGt7(plain: Uint8Array, format: Gt7Format): Gt7Packet {
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const len = plain.byteLength;
  const gears = dv.getUint8(0x90);
  const ratios: number[] = [];
  for (let i = 0; i < 8; i++) ratios.push(f(dv, 0x104 + i * 4));
  const hasB = len >= 316, hasTilde = len >= 344, hasC = len >= 368;
  return {
    format,
    position: f3(dv, 0x04),
    velocity: f3(dv, 0x10),
    rotation: f4(dv, 0x1c),
    angularVelocity: f3(dv, 0x2c),
    bodyHeight: f(dv, 0x38),
    rpm: f(dv, 0x3c),
    fuelLevel: f(dv, 0x44),
    fuelCapacity: f(dv, 0x48),
    speed: f(dv, 0x4c),
    boost: f(dv, 0x50),
    oilPressure: f(dv, 0x54),
    waterTemp: f(dv, 0x58),
    oilTemp: f(dv, 0x5c),
    tyreTemp: f4(dv, 0x60),
    packetId: dv.getInt32(0x70, true),
    lapCount: dv.getInt16(0x74, true),
    lapsInRace: dv.getInt16(0x76, true),
    bestLapMs: dv.getInt32(0x78, true),
    lastLapMs: dv.getInt32(0x7c, true),
    timeOfDayMs: dv.getInt32(0x80, true),
    preRacePosition: dv.getInt16(0x84, true),
    preRaceNumCars: dv.getInt16(0x86, true),
    minAlertRpm: dv.getInt16(0x88, true),
    maxAlertRpm: dv.getInt16(0x8a, true),
    calculatedMaxSpeedKph: dv.getInt16(0x8c, true),
    flags: dv.getInt16(0x8e, true),
    gear: gears & 0x0f,
    suggestedGear: gears >> 4,
    throttle: dv.getUint8(0x91),
    brake: dv.getUint8(0x92),
    roadPlane: [f(dv, 0x94), f(dv, 0x98), f(dv, 0x9c), f(dv, 0xa0)],
    wheelRevs: f4(dv, 0xa4),
    tyreRadius: f4(dv, 0xb4),
    suspensionHeight: f4(dv, 0xc4),
    clutch: f(dv, 0xf4),
    clutchEngagement: f(dv, 0xf8),
    rpmAfterClutch: f(dv, 0xfc),
    transmissionTopSpeed: f(dv, 0x100),
    gearRatios: ratios,
    carCode: dv.getInt32(0x124, true),
    wheelRotationRad: hasB ? f(dv, 0x128) : null,
    steeringVelocity: hasB ? f(dv, 0x12c) : null,
    sway: hasB ? f(dv, 0x130) : null,
    heave: hasB ? f(dv, 0x134) : null,
    surge: hasB ? f(dv, 0x138) : null,
    throttleRaw: hasTilde ? dv.getUint8(0x13c) : null,
    brakeRaw: hasTilde ? dv.getUint8(0x13d) : null,
    energyRecovery: hasTilde ? f(dv, 0x150) : null,
    surfaceTypes: hasC ? [chars(dv, 0x158, 1), chars(dv, 0x159, 1), chars(dv, 0x15a, 1), chars(dv, 0x15b, 1)] : null,
    currentLapMs: hasC ? dv.getInt32(0x15c, true) : null,
    wheelSteerAngle: hasC ? [f(dv, 0x160), f(dv, 0x164)] : null,
    wheelbase: hasC ? f(dv, 0x168) : null,
    carCategory: hasC ? chars(dv, 0x16c, 4) : null,
  };
}

/** Build a plaintext packet buffer from a partial packet (synthetic generator / tests). */
export function buildGt7(p: Partial<Gt7Packet> & { format: Gt7Format }): Uint8Array {
  const size = { A: 296, B: 316, '~': 344, C: 368 }[p.format];
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  const w = (o: number, v: number) => dv.setFloat32(o, v, true);
  const w3 = (o: number, v?: [number, number, number]) => { if (v) { w(o, v[0]); w(o + 4, v[1]); w(o + 8, v[2]); } };
  const w4 = (o: number, v?: [number, number, number, number]) => { if (v) { w(o, v[0]); w(o + 4, v[1]); w(o + 8, v[2]); w(o + 12, v[3]); } };
  dv.setUint32(0, 0x47375330, true);
  w3(0x04, p.position); w3(0x10, p.velocity); w4(0x1c, p.rotation); w3(0x2c, p.angularVelocity);
  w(0x38, p.bodyHeight ?? 0); w(0x3c, p.rpm ?? 0);
  w(0x44, p.fuelLevel ?? 0); w(0x48, p.fuelCapacity ?? 0); w(0x4c, p.speed ?? 0);
  w(0x50, p.boost ?? 1); w(0x54, p.oilPressure ?? 0); w(0x58, p.waterTemp ?? 85); w(0x5c, p.oilTemp ?? 110);
  w4(0x60, p.tyreTemp);
  dv.setInt32(0x70, p.packetId ?? 0, true);
  dv.setInt16(0x74, p.lapCount ?? 0, true);
  dv.setInt16(0x76, p.lapsInRace ?? 0, true);
  dv.setInt32(0x78, p.bestLapMs ?? -1, true);
  dv.setInt32(0x7c, p.lastLapMs ?? -1, true);
  dv.setInt32(0x80, p.timeOfDayMs ?? 0, true);
  dv.setInt16(0x84, p.preRacePosition ?? -1, true);
  dv.setInt16(0x86, p.preRaceNumCars ?? -1, true);
  dv.setInt16(0x88, p.minAlertRpm ?? 0, true);
  dv.setInt16(0x8a, p.maxAlertRpm ?? 0, true);
  dv.setInt16(0x8c, p.calculatedMaxSpeedKph ?? 0, true);
  dv.setInt16(0x8e, p.flags ?? 0, true);
  dv.setUint8(0x90, ((p.suggestedGear ?? 15) << 4) | ((p.gear ?? 0) & 0x0f));
  dv.setUint8(0x91, p.throttle ?? 0);
  dv.setUint8(0x92, p.brake ?? 0);
  if (p.roadPlane) { w(0x94, p.roadPlane[0]); w(0x98, p.roadPlane[1]); w(0x9c, p.roadPlane[2]); w(0xa0, p.roadPlane[3]); }
  w4(0xa4, p.wheelRevs); w4(0xb4, p.tyreRadius); w4(0xc4, p.suspensionHeight);
  w(0xf4, p.clutch ?? 0); w(0xf8, p.clutchEngagement ?? 0); w(0xfc, p.rpmAfterClutch ?? 0); w(0x100, p.transmissionTopSpeed ?? 0);
  (p.gearRatios ?? []).forEach((r, i) => { if (i < 8) w(0x104 + i * 4, r); });
  dv.setInt32(0x124, p.carCode ?? 0, true);
  if (size >= 316) { w(0x128, p.wheelRotationRad ?? 0); w(0x12c, p.steeringVelocity ?? 0); w(0x130, p.sway ?? 0); w(0x134, p.heave ?? 0); w(0x138, p.surge ?? 0); }
  if (size >= 344) { dv.setUint8(0x13c, p.throttleRaw ?? p.throttle ?? 0); dv.setUint8(0x13d, p.brakeRaw ?? p.brake ?? 0); w(0x150, p.energyRecovery ?? 0); }
  if (size >= 368) {
    const st = p.surfaceTypes ?? ['T', 'T', 'T', 'T'];
    for (let i = 0; i < 4; i++) dv.setUint8(0x158 + i, st[i]!.charCodeAt(0));
    dv.setInt32(0x15c, p.currentLapMs ?? 0, true);
    w(0x160, p.wheelSteerAngle?.[0] ?? 0); w(0x164, p.wheelSteerAngle?.[1] ?? 0);
    w(0x168, p.wheelbase ?? 2.7);
    const cat = p.carCategory ?? 'GR3';
    for (let i = 0; i < 4; i++) dv.setUint8(0x16c + i, i < cat.length ? cat.charCodeAt(i) : 0);
  }
  return buf;
}
