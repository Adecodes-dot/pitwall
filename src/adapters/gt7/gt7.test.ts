import { describe, expect, it } from 'vitest';
import { decryptGt7, encryptGt7, GT7_MAGIC, SIZE_BY_FORMAT, type Gt7Format } from './crypto.ts';
import { buildGt7, parseGt7, GT7_FLAG } from './packet.ts';
import { Gt7Adapter } from './adapter.ts';

describe('gt7 crypto', () => {
  for (const format of ['A', 'B', '~', 'C'] as Gt7Format[]) {
    it(`round-trips format ${format} (${SIZE_BY_FORMAT[format]} bytes)`, () => {
      const plain = buildGt7({ format, speed: 42.5, packetId: 1234, lapCount: 3 });
      const enc = encryptGt7(plain, format, 0x1234abcd);
      expect(enc.length).toBe(SIZE_BY_FORMAT[format]);
      // ciphertext must not expose the magic
      expect(new DataView(enc.buffer).getUint32(0, true)).not.toBe(GT7_MAGIC);
      const dec = decryptGt7(enc);
      expect(dec).not.toBeNull();
      expect(dec!.format).toBe(format);
      const p = parseGt7(dec!.plain, dec!.format);
      expect(p.speed).toBeCloseTo(42.5, 4);
      expect(p.packetId).toBe(1234);
      expect(p.lapCount).toBe(3);
    });
  }
  it('rejects garbage', () => {
    const junk = new Uint8Array(296); for (let i = 0; i < junk.length; i++) junk[i] = (i * 31) & 0xff;
    expect(decryptGt7(junk)).toBeNull();
  });
  it('B and C share a nonce constant: a C packet truncated to 316 bytes decrypts as B', () => {
    const plain = buildGt7({ format: 'C', speed: 10, wheelRotationRad: 0.5 });
    const enc = encryptGt7(plain, 'C', 99);
    const dec = decryptGt7(enc.subarray(0, 316));
    expect(dec?.format).toBe('B');
    expect(parseGt7(dec!.plain, 'B').wheelRotationRad).toBeCloseTo(0.5, 5);
  });
});

describe('gt7 packet fields', () => {
  it('parses gear nibbles, pedals, flags and extended fields', () => {
    const plain = buildGt7({
      format: '~', gear: 4, suggestedGear: 5, throttle: 255, brake: 128, flags: GT7_FLAG.carOnTrack | GT7_FLAG.tcsActive,
      wheelRevs: [10, 10, 11, 11], tyreRadius: [0.33, 0.33, 0.34, 0.34], throttleRaw: 200, brakeRaw: 0,
      wheelRotationRad: -0.25, bestLapMs: 92345, lastLapMs: 93000,
    });
    const p = parseGt7(plain, '~');
    expect(p.gear).toBe(4); expect(p.suggestedGear).toBe(5);
    expect(p.throttle).toBe(255); expect(p.brake).toBe(128);
    expect(p.flags & GT7_FLAG.tcsActive).toBeTruthy();
    expect(p.throttleRaw).toBe(200); expect(p.wheelRotationRad).toBeCloseTo(-0.25, 5);
    expect(p.currentLapMs).toBeNull(); // only in C
    expect(p.bestLapMs).toBe(92345);
  });
});

describe('gt7 adapter', () => {
  function stream(adapter: Gt7Adapter, packets: Parameters<typeof buildGt7>[0][], format: Gt7Format = 'A') {
    const frames = [], events = [];
    let t = 0;
    for (const pk of packets) {
      const enc = encryptGt7(buildGt7({ ...pk, format }), format, 1000 + (pk.packetId ?? 0));
      const out = adapter.feed(enc, t);
      frames.push(...out.frames); events.push(...out.events);
      t += 1000 / 60;
    }
    return { frames, events };
  }

  it('normalises units and marks unavailable fields null', () => {
    const a = new Gt7Adapter();
    const { frames } = stream(a, [{ format: 'A', packetId: 1, speed: 50, throttle: 51, brake: 0, flags: GT7_FLAG.carOnTrack, lapCount: 1, fuelLevel: 30, fuelCapacity: 100 }]);
    const f = frames[0]!;
    expect(f.game).toBe('gt7');
    expect(f.speed).toBe(50);
    expect(f.input.throttle).toBeCloseTo(0.2, 3);
    expect(f.input.steer).toBeNull(); // format A has no steering
    expect(f.lap.distance).toBeNull();
    expect(f.wheels.wear).toBeNull();
    expect(f.flags.fia).toBeNull();
    expect(f.fuel.level).toBe(30);
    expect(f.flags.onTrack).toBe(true);
  });

  it('emits lap.complete with the game lap time and re-syncs the tick timer', () => {
    const a = new Gt7Adapter();
    const pk: Parameters<typeof buildGt7>[0][] = [];
    const flags = GT7_FLAG.carOnTrack;
    // lap 1 for 120 packets (2 s), then lap 2 with last lap time published 3 packets later
    for (let i = 0; i < 120; i++) pk.push({ format: 'A', packetId: i, lapCount: 1, flags, lastLapMs: -1 });
    for (let i = 120; i < 130; i++) pk.push({ format: 'A', packetId: i, lapCount: 2, flags, lastLapMs: i >= 123 ? 2010 : -1 });
    const { frames, events } = stream(a, pk);
    const laps = events.filter((e) => e.type === 'lap.complete');
    expect(laps).toHaveLength(1);
    expect(laps[0]).toMatchObject({ lapNumber: 1, timeMs: 2010 });
    // tick timer: 119 ticks into lap 1 ≈ 1983 ms
    expect(frames[119]!.lap.currentTimeMs).toBe(Math.round(119 * 1000 / 60));
    expect(frames[120]!.lap.currentTimeMs).toBe(0);
    expect(events.filter((e) => e.type === 'session.start')).toHaveLength(1);
  });

  it('drops duplicate packet ids and reports a stream restart', () => {
    const a = new Gt7Adapter();
    const flags = GT7_FLAG.carOnTrack;
    const { frames, events } = stream(a, [
      { format: 'A', packetId: 5000, flags, lapCount: 1 }, { format: 'A', packetId: 5000, flags, lapCount: 1 },
      { format: 'A', packetId: 5001, flags, lapCount: 1 }, { format: 'A', packetId: 3, flags, lapCount: 1 },
    ]);
    expect(frames).toHaveLength(3);
    expect(events.filter((e) => e.type === 'session.start')).toHaveLength(2);
  });

  it('reports format changes and raw pedals in ~', () => {
    const a = new Gt7Adapter();
    const flags = GT7_FLAG.carOnTrack;
    const r1 = stream(a, [{ format: 'A', packetId: 1, flags }], 'A');
    const r2 = stream(a, [{ format: '~', packetId: 2, flags, throttle: 100, throttleRaw: 255 }], '~');
    expect(r1.frames[0]!.input.throttleRaw).toBeNull();
    expect(r2.events.some((e) => e.type === 'format.change')).toBe(true);
    expect(r2.frames[0]!.input.throttleRaw).toBe(1);
    expect(a.capabilities.rawPedals).toBe(true);
  });
});
