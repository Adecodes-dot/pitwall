// Turn synthetic samples into game datagrams: F1 (per-frame packet group) and GT7 (one encrypted packet).
import { encodeF1 } from '../adapters/f1/codec.ts';
import { PacketId, type F1Format } from '../adapters/f1/layouts.ts';
import { buildGt7 } from '../adapters/gt7/packet.ts';
import { encryptGt7, type Gt7Format } from '../adapters/gt7/crypto.ts';
import { GT7_FLAG } from '../adapters/gt7/packet.ts';
import type { Sample, SynthSession } from './driver.ts';
import type { CaptureRecord } from '../capture/pwcap.ts';

export interface F1EmitOptions { format?: F1Format; trackId?: number; sessionType?: number; totalLaps?: number; playerCarIndex?: number }

/** Datagrams for one F1 frame, in the order the game sends them. Session every 30 frames, damage every 6. */
export function f1FrameDatagrams(sm: Sample, frameId: number, sess: SynthSession, o: F1EmitOptions = {}): Uint8Array[] {
  const format = o.format ?? 2025;
  const header = { frameIdentifier: frameId, overallFrameIdentifier: frameId, sessionTime: sm.t, sessionUID: 42n, playerCarIndex: o.playerCarIndex ?? 0 };
  const out: Uint8Array[] = [];
  const lastLap = sm.lap >= 2 ? sess.lapTimesMs[sm.lap - 2] ?? 0 : 0;
  if (frameId % 30 === 0) {
    out.push(encodeF1({ format, packetId: PacketId.Session, header, body: {
      trackId: o.trackId ?? 7, sessionType: o.sessionType ?? 18, totalLaps: o.totalLaps ?? 0, trackLength: Math.round(sess.track.length),
      gearboxAssist: 1, dynamicRacingLine: 0, brakingAssist: 0, sector2LapDistanceStart: sess.track.length / 3, sector3LapDistanceStart: sess.track.length * 2 / 3,
    } }));
  }
  const sector = sm.s < sess.track.length / 3 ? 0 : sm.s < sess.track.length * 2 / 3 ? 1 : 2;
  out.push(encodeF1({ format, packetId: PacketId.LapData, header, car: {
    lastLapTimeInMS: lastLap, currentLapTimeInMS: sm.lapTimeMs, lapDistance: sm.lap === 0 ? sm.s - sess.track.length : sm.s,
    totalDistance: sm.s, carPosition: 1, currentLapNum: sm.lap + 1, sector, currentLapInvalid: 0, driverStatus: 1, resultStatus: 2,
  } }));
  const vx = Math.cos(sm.heading) * sm.v, vz = Math.sin(sm.heading) * sm.v;
  out.push(encodeF1({ format, packetId: PacketId.Motion, header, car: {
    worldPositionX: sm.x, worldPositionY: 0, worldPositionZ: sm.z, worldVelocityX: vx, worldVelocityY: 0, worldVelocityZ: vz,
    yaw: sm.heading, gForceLateral: format === 2026 ? Math.round(sm.curvature * sm.v * sm.v / 9.81 * 1000) : sm.curvature * sm.v * sm.v / 9.81,
  } }));
  const temps = [95, 96, 90, 91];
  out.push(encodeF1({ format, packetId: PacketId.CarTelemetry, header, car: {
    speed: Math.round(sm.v * 3.6), throttle: sm.throttle, steer: sm.steer, brake: sm.brake, clutch: 0, gear: sm.gear, engineRPM: sm.rpm, drs: 0,
    brakesTemperature: [400, 400, 450, 450], tyresSurfaceTemperature: temps, tyresInnerTemperature: temps.map((x) => x + 5), engineTemperature: 100,
    tyresPressure: [22, 22, 23, 23], surfaceType: [0, 0, 0, 0],
  }, trailer: { suggestedGear: 0 } }));
  out.push(encodeF1({ format, packetId: PacketId.CarStatus, header, car: {
    tractionControl: 0, antiLockBrakes: 0, fuelMix: 1, frontBrakeBias: 56, fuelInTank: 50 - sm.t * 0.02, fuelCapacity: 110, fuelRemainingLaps: 20 - sm.t / 90,
    maxRPM: 13000, idleRPM: 3500, maxGears: 8, drsAllowed: 0, actualTyreCompound: 18, visualTyreCompound: 17, tyresAgeLaps: sm.lap, vehicleFiaFlags: 0, ersDeployMode: 1,
  } }));
  if (frameId % 6 === 0) out.push(encodeF1({ format, packetId: PacketId.CarDamage, header, car: { tyresWear: [sm.t * 0.01, sm.t * 0.01, sm.t * 0.012, sm.t * 0.012] } }));
  const { lock, spin } = mistakes(sm);
  // spec order RL, RR, FL, FR
  out.push(encodeF1({ format, packetId: PacketId.MotionEx, header, body: {
    wheelSpeed: [sm.v * (1 + spin), sm.v * (1 + spin), sm.v * (1 - lock), sm.v * (1 - lock)], wheelSlipRatio: [spin, spin, -lock, -lock],
    frontWheelsAngle: sm.steer * 0.35,
  } }));
  if (format === 2026) out.push(encodeF1({ format, packetId: PacketId.CarTelemetry2, header, car: { activeAeroMode: sm.throttle > 0.9 ? 1 : 0, activeAeroAvailable: 1, regulations2026: 1 } }));
  return out;
}

/** Synthetic mistakes: a lockup on ~1 in 6 hard stops and wheelspin on ~1 in 6 slow exits, deterministic per lap and position. */
function mistakes(sm: Sample): { lock: number; spin: number } {
  const bin = Math.floor(sm.s / 100);
  const h = (bin * 7919 + sm.lap * 104729) % 6;
  return { lock: sm.brake > 0.9 && h === 0 ? 0.2 : 0, spin: sm.throttle > 0.95 && sm.v < 30 && h === 1 ? 0.15 : 0 };
}

export interface Gt7EmitOptions { format?: Gt7Format; carCode?: number; lapsInRace?: number }

export function gt7Datagram(sm: Sample, packetId: number, sess: SynthSession, o: Gt7EmitOptions = {}): Uint8Array {
  const format = o.format ?? '~';
  const vx = Math.cos(sm.heading) * sm.v, vz = Math.sin(sm.heading) * sm.v;
  const r = 0.33;
  const { lock, spin } = mistakes(sm);
  const best = sess.lapTimesMs.slice(0, Math.max(0, sm.lap - 1)).reduce((m, x) => (m < 0 ? x : Math.min(m, x)), -1);
  const plain = buildGt7({
    format,
    position: [sm.x, 0, sm.z], velocity: [vx, 0, vz], rotation: [0, Math.sin(sm.heading / 2), 0, Math.cos(sm.heading / 2)],
    rpm: sm.rpm, fuelLevel: 60 - sm.t * 0.02, fuelCapacity: 100, speed: sm.v, tyreTemp: [80, 81, 85, 86],
    packetId, lapCount: sm.lap, lapsInRace: o.lapsInRace ?? 0, bestLapMs: best, lastLapMs: sm.lap >= 2 ? sess.lapTimesMs[sm.lap - 2] ?? -1 : -1,
    timeOfDayMs: 12 * 3600 * 1000 + Math.round(sm.t * 1000), minAlertRpm: 7500, maxAlertRpm: 8500, calculatedMaxSpeedKph: 320,
    flags: GT7_FLAG.carOnTrack | GT7_FLAG.inGear | (sm.throttle > 0.95 && sm.v < 30 ? GT7_FLAG.tcsActive : 0),
    gear: sm.gear, suggestedGear: 15, throttle: Math.round(sm.throttle * 255), brake: Math.round(sm.brake * 255),
    wheelRevs: [sm.v * (1 - lock) / r, sm.v * (1 - lock) / r, sm.v * (1 + spin) / r, sm.v * (1 + spin) / r], tyreRadius: [r, r, r, r],
    carCode: o.carCode ?? 1234, wheelRotationRad: sm.steer * 1.2, throttleRaw: Math.round(Math.min(1, sm.throttle * 1.1) * 255), brakeRaw: Math.round(sm.brake * 255),
    currentLapMs: sm.lapTimeMs, surfaceTypes: ['T', 'T', 'T', 'T'],
  });
  return encryptGt7(plain, format, (0x1000 + packetId * 2654435761) >>> 0);
}

/** Build capture records for a whole synthetic session as either game. */
export interface SynthEmitOptions { format?: F1Format | Gt7Format; trackId?: number; sessionType?: number; totalLaps?: number; carCode?: number; lapsInRace?: number }

export function synthRecords(sess: SynthSession, game: 'f1' | 'gt7', opts: SynthEmitOptions = {}): CaptureRecord[] {
  const recs: CaptureRecord[] = [];
  const t0 = 1000;
  sess.samples.forEach((sm, i) => {
    const t = t0 + sm.t * 1000;
    if (game === 'f1') {
      for (const data of f1FrameDatagrams(sm, i, sess, opts as F1EmitOptions)) recs.push({ t, tWall: Date.now(), srcPort: 20777, game: 'f1', data });
    } else {
      recs.push({ t, tWall: Date.now(), srcPort: 33740, game: 'gt7', data: gt7Datagram(sm, i, sess, opts as Gt7EmitOptions) });
    }
  });
  return recs;
}
