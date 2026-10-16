import { describe, expect, it } from 'vitest';
import { FORMATS, OFFICIAL_SIZES, PacketId, type F1Format } from './layouts.ts';
import { decodeF1, encodeF1 } from './codec.ts';
import { F1Adapter } from './adapter.ts';

describe('f1 layouts are byte-exact against the EA spec sizes', () => {
  for (const format of [2024, 2025, 2026] as F1Format[]) {
    it(`format ${format}`, () => {
      for (const [id, size] of Object.entries(OFFICIAL_SIZES[format])) {
        expect(FORMATS[format].sizes[Number(id)], `packet ${id}`).toBe(size);
      }
    });
  }
});

describe('f1 codec', () => {
  it('rejects wrong lengths and unknown formats', () => {
    const ok = encodeF1({ format: 2025, packetId: PacketId.CarTelemetry, car: { speed: 300 } });
    expect(decodeF1(ok)).toMatchObject({ kind: 'carTelemetry' });
    expect(decodeF1(ok.subarray(0, ok.length - 1))).toMatchObject({ error: 'bad-length' });
    const bad = new Uint8Array(ok); new DataView(bad.buffer).setUint16(0, 2019, true);
    expect(decodeF1(bad)).toMatchObject({ error: 'unknown-format' });
    expect(decodeF1(new Uint8Array(5))).toMatchObject({ error: 'too-short' });
  });

  it('reads the player car at playerCarIndex for every format', () => {
    for (const format of [2024, 2025, 2026] as F1Format[]) {
      const pkt = encodeF1({ format, packetId: PacketId.CarTelemetry, header: { playerCarIndex: 7 }, car: { speed: 123, gear: 5, throttle: 0.5, tyresSurfaceTemperature: [90, 91, 92, 93] } });
      const d = decodeF1(pkt);
      expect(d).toMatchObject({ kind: 'carTelemetry' });
      if ('kind' in d && d.kind === 'carTelemetry') { expect(d.car.speed).toBe(123); expect(d.car.gear).toBe(5); expect(d.car.throttle).toBeCloseTo(0.5); expect(d.car.tyresSurfaceTemperature).toEqual([90, 91, 92, 93]); }
    }
  });

  it('2026 session carries the new assist fields; 2025 does not', () => {
    const p26 = encodeF1({ format: 2026, packetId: PacketId.Session, body: { trackId: 42, sessionType: 15, tractionControlAssist: 2, sector2LapDistanceStart: 1500.5 } });
    const d26 = decodeF1(p26);
    if (!('kind' in d26) || d26.kind !== 'session') throw new Error('expected session');
    expect(d26.data.trackId).toBe(42); expect(d26.data.tractionControlAssist).toBe(2); expect(d26.data.sector2LapDistanceStart).toBeCloseTo(1500.5);
    const d25 = decodeF1(encodeF1({ format: 2025, packetId: PacketId.Session, body: { trackId: 13 } }));
    if (!('kind' in d25) || d25.kind !== 'session') throw new Error('expected session');
    expect(d25.data.tractionControlAssist).toBeUndefined();
  });
});

function frameBurst(a: F1Adapter, format: F1Format, frameId: number, t: number, o: { speed?: number; lapNum?: number; lapDist?: number; lastLap?: number; curLap?: number; invalid?: number; pos?: [number, number, number]; wheelSpeed?: number[] }) {
  const h = { frameIdentifier: frameId, sessionTime: frameId / 60 };
  const out = { frames: [] as ReturnType<F1Adapter['feed']>['frames'], events: [] as ReturnType<F1Adapter['feed']>['events'] };
  const feed = (pkt: Uint8Array) => { const r = a.feed(pkt, t); out.frames.push(...r.frames); out.events.push(...r.events); };
  feed(encodeF1({ format, packetId: PacketId.LapData, header: h, car: { currentLapNum: o.lapNum ?? 1, lapDistance: o.lapDist ?? 0, lastLapTimeInMS: o.lastLap ?? 0, currentLapTimeInMS: o.curLap ?? 0, currentLapInvalid: o.invalid ?? 0, driverStatus: 4, resultStatus: 2, carPosition: 3, sector: 1 } }));
  feed(encodeF1({ format, packetId: PacketId.Motion, header: h, car: { worldPositionX: o.pos?.[0] ?? 0, worldPositionY: o.pos?.[1] ?? 0, worldPositionZ: o.pos?.[2] ?? 0 } }));
  feed(encodeF1({ format, packetId: PacketId.CarTelemetry, header: h, car: { speed: o.speed ?? 0, throttle: 1, brake: 0, steer: -0.2, gear: 7, engineRPM: 11000, tyresSurfaceTemperature: [1, 2, 3, 4], tyresInnerTemperature: [5, 6, 7, 8], surfaceType: [0, 0, 0, 0] } }));
  feed(encodeF1({ format, packetId: PacketId.CarStatus, header: h, car: { tractionControl: 1, antiLockBrakes: 1, fuelInTank: 40, fuelRemainingLaps: 3.5, maxRPM: 13000, vehicleFiaFlags: 0 } }));
  feed(encodeF1({ format, packetId: PacketId.MotionEx, header: h, body: { wheelSpeed: o.wheelSpeed ?? [80, 80, 82, 82], wheelSlipRatio: [0, 0, 0.1, 0.1] } }));
  return out;
}

describe('f1 adapter', () => {
  it('assembles one frame per game frame with normalised units and reordered wheels', () => {
    const a = new F1Adapter();
    const r0 = a.feed(encodeF1({ format: 2025, packetId: PacketId.Session, body: { trackId: 13, sessionType: 18, totalLaps: 5, gearboxAssist: 1, dynamicRacingLine: 2 } }), 0);
    expect(r0.events.some((e) => e.type === 'session.start')).toBe(true);
    const r = frameBurst(a, 2025, 10, 100, { speed: 288, lapNum: 2, lapDist: 1234.5, pos: [1, 2, 3], wheelSpeed: [80, 81, 82, 83] });
    expect(r.frames).toHaveLength(1);
    const f = r.frames[0]!;
    expect(f.speed).toBeCloseTo(80, 5); // 288 km/h
    expect(f.lap.number).toBe(2); expect(f.lap.distance).toBeCloseTo(1234.5);
    expect(f.race.trackId).toBe('suzuka'); expect(f.race.sessionType).toBe('time-trial');
    expect(f.wheels.surfaceTemp).toEqual([3, 4, 1, 2]); // RL RR FL FR → FL FR RL RR
    expect(f.wheels.speed).toEqual([82, 83, 80, 81]);
    expect(f.assists).toMatchObject({ tc: 1, abs: true, gearbox: 'manual', racingLine: 2 });
    expect(f.fuel.lapsRemaining).toBeCloseTo(3.5);
    expect(f.input.steer).toBeCloseTo(-0.2);
    expect(f.flags.onTrack).toBe(true);
    expect(f.seq).toBe(10);
  });

  it('emits lap.complete when currentLapNum increments, carrying lastLapTime and validity', () => {
    const a = new F1Adapter();
    frameBurst(a, 2025, 1, 0, { lapNum: 1, invalid: 1 });
    frameBurst(a, 2025, 2, 16, { lapNum: 1, invalid: 1 });
    const r = frameBurst(a, 2025, 3, 33, { lapNum: 2, lastLap: 92345 });
    const laps = r.events.filter((e) => e.type === 'lap.complete');
    expect(laps).toEqual([expect.objectContaining({ lapNumber: 1, timeMs: 92345, valid: false })]);
  });

  it('flushes a frame without Motion Ex when the next frame starts', () => {
    const a = new F1Adapter();
    const h = { frameIdentifier: 5 };
    a.feed(encodeF1({ format: 2026, packetId: PacketId.CarTelemetry, header: h, car: { speed: 100, tyresSurfaceTemperature: [0, 0, 0, 0], tyresInnerTemperature: [0, 0, 0, 0], surfaceType: [0, 0, 0, 0] } }), 0);
    const r = a.feed(encodeF1({ format: 2026, packetId: PacketId.CarTelemetry, header: { frameIdentifier: 6 }, car: { speed: 101, tyresSurfaceTemperature: [0, 0, 0, 0], tyresInnerTemperature: [0, 0, 0, 0], surfaceType: [0, 0, 0, 0] } }), 16);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]!.speed).toBeCloseTo(100 / 3.6);
    expect(r.frames[0]!.wheels.speed).toBeNull();
  });

  it('handles safety car and flashback events', () => {
    const a = new F1Adapter();
    const scar = new Uint8Array(12); scar[0] = 1; scar[1] = 0; // full SC deployed
    const r1 = a.feed(encodeF1({ format: 2025, packetId: PacketId.Event, body: { eventStringCode: 'SCAR', details: Array.from(scar) } }), 0);
    expect(r1.events).toContainEqual(expect.objectContaining({ type: 'safetycar', status: 'full', phase: 'deployed' }));
    const flbk = new Uint8Array(12); new DataView(flbk.buffer).setFloat32(4, 12.5, true);
    const r2 = a.feed(encodeF1({ format: 2025, packetId: PacketId.Event, body: { eventStringCode: 'FLBK', details: Array.from(flbk) } }), 1);
    expect(r2.events).toContainEqual(expect.objectContaining({ type: 'flashback', toSessionTime: 12.5 }));
  });
});
