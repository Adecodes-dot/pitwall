// Regressions from the Miami sprint weekend (2026-11-07): the fuel display figure, answers that were too long to be
// spoken, replies queued behind other calls, an empty Analysis tab at every new session, and the debrief starting over.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { encodeF1 } from '../adapters/f1/codec.ts';
import { PacketId } from '../adapters/f1/layouts.ts';
import { emptyFrame } from '../core/types.ts';
import { Bus } from '../core/bus.ts';
import { SessionAnalyser, type AnalysisUpdate } from './session.ts';
import { Store } from './store.ts';
import { answerByRule } from '../llm/qa.ts';
import { checkCall } from '../radio/rules.ts';
import { fuelCall, lapCalls } from '../radio/calls.ts';
import { RadioQueue, type Call } from '../radio/queue.ts';
import { Radio } from '../radio/radio.ts';
import { NullSink } from '../radio/audio.ts';
import { buildDebrief } from '../debrief/debrief.ts';

describe('fuel: the F1 figure is the margin over race distance', () => {
  // values from the Miami sprint: 10 laps, +2.93 on the fuel display at the start of lap 1
  const frameAt = (sessionType: number, lap: number, dist: number, mfd: number) => {
    const a = new F1Adapter();
    const h = { frameIdentifier: 1, sessionTime: 1 };
    a.feed(encodeF1({ format: 2026, packetId: PacketId.Session, header: h, body: { sessionType, totalLaps: 10, trackLength: 5412, trackId: 30 } }), 0);
    a.feed(encodeF1({ format: 2026, packetId: PacketId.LapData, header: h, car: { currentLapNum: lap, lapDistance: dist, driverStatus: 4, resultStatus: 2 } }), 0);
    a.feed(encodeF1({ format: 2026, packetId: PacketId.CarTelemetry, header: h, car: { speed: 200 } }), 0);
    a.feed(encodeF1({ format: 2026, packetId: PacketId.CarStatus, header: h, car: { fuelInTank: 14.8, fuelRemainingLaps: mfd } }), 0);
    return a.tick(1e9).frames[0]!;
  };
  it('race: laps of fuel = margin + laps still to run', () => {
    expect(frameAt(15, 1, 0, 2.93).fuel.lapsRemaining).toBeCloseTo(12.93, 1);
    expect(frameAt(15, 6, 2706, 3.2).fuel.lapsRemaining).toBeCloseTo(3.2 + 4.5, 1); // half way round lap 6
    expect(frameAt(13, 1, 0, 2.93).fuel.lapsRemaining).toBeNull(); // qualifying: no finish to measure against
  });
  it('three laps spare is never called short', () => {
    expect(fuelCall(12.93, 10, { now: 0, triggerT: 0 })?.text).toBe('Fuel is good, push.');
    expect(fuelCall(9.4, 10, { now: 0, triggerT: 0 })?.text).toBe('Fuel, one lap short, lift and coast.');
  });
});

describe('every spoken answer fits the radio rules (12 words): longer ones were dropped without a sound', () => {
  const f = emptyFrame('f1', 0, 0);
  f.fuel = { level: 6.3, capacity: 110, lapsRemaining: 4.4 };
  f.wheels.wear = [34.3, 45.6, 39.9, 43.8]; f.wheels.surfaceTemp = [77, 76, 94, 92];
  f.race.position = 3; f.lap.number = 9; f.lap.total = 10; f.lap.lastTimeMs = 91353; f.flags.fia = 'none';
  const update: AnalysisUpdate = {
    trackId: 'f1:miami', trackName: 'miami', trackLength: 5347, corners: [], pbMs: 89436, pbLap: 2, allTimeBestMs: 86816, theoreticalMs: 87110,
    laps: [{ number: 2, timeMs: 89436, valid: true, deltaToPbMs: 0, corners: [] }, { number: 9, timeMs: 91353, valid: true, deltaToPbMs: 1917, corners: [] }],
    lastLapDeltas: [], worstCorners: [{ corner: 6, deltaMs: 1210 }, { corner: 13, deltaMs: 520 }], hasReference: true, referenceMs: 89436, fingerprint: null,
  };
  const QS = ["how's my fuel", 'how are the tyres', 'tyre temps', 'where am I losing time', "what's my best", 'what was my last lap', 'what position am I',
    'how many laps to go', 'what track is this', 'any flags', 'radio check', 'thanks', "what's the gap", 'am I consistent'];
  for (const q of QS) it(q, () => {
    const a = answerByRule(q, { update, frame: f, fuelLaps: 4.4, lapsLeft: 2, game: 'f1' })!;
    expect(a, q).not.toBeNull();
    const call: Call = { text: a.text, priority: 2, key: 'qa:1', reason: 'answer', facts: a.facts, dueAfter: 0, expiresAt: 1, immediate: false, createdAt: 0, triggerT: 0 };
    expect(checkCall(call).violations, a.text).toEqual([]);
  });
  it('fuel answer uses the corrected figure', () => {
    expect(answerByRule("how's my fuel", { update, frame: f, fuelLaps: 4.4, lapsLeft: 2, game: 'f1' })!.text).toBe('Fuel is good, 2 laps spare.');
  });
  it('lap delta over a second is said in seconds', () => {
    expect(lapCalls(update, 89436, 'coach', { now: 0, triggerT: 0 }).map((c) => c.text)).toEqual(['one thirty-one point three, one point nine off.']);
  });
});

describe('a reply goes before other strategy calls of the same priority', () => {
  it('the driver asked: answer first', () => {
    const q = new RadioQueue(); q.newLap(1);
    const mk = (key: string, createdAt: number): Call => ({ text: key, priority: 2, key, reason: 't', facts: {}, dueAfter: 0, expiresAt: 1e9, immediate: false, createdAt, triggerT: 0 });
    q.push(mk('fuel:ok', 1)); q.push(mk('tyre:front-hot', 2)); q.push(mk('qa:3', 3));
    expect(q.next(10)!.key).toBe('qa:3');
  });
});

describe('a new session on a known track', () => {
  const track = defaultTrack();
  const feed = (an: SessionAnalyser, laps: number, seed: number, bus?: Bus) => {
    const sess = generateSession(track, laps, { seed, brakeJitterM: 12, speedJitter: 0.05 });
    const ad = new F1Adapter();
    for (const r of synthRecords(sess, 'f1', { format: 2026 })) {
      const o = ad.feed(r.data, r.t);
      for (const fr of o.frames) { an.onFrame(fr); bus?.emit('frame', fr); }
      for (const e of o.events) { an.onEvent(e); bus?.emit('event', e); }
    }
  };
  it('shows the map at once, and the debrief stays on the last session until a lap is done', () => {
    const an = new SessionAnalyser(null);
    const updates: AnalysisUpdate[] = [];
    an.listeners.push((u) => updates.push(u));
    feed(an, 3, 9);
    expect(buildDebrief(an, null)!.previousSession).toBe(false);
    updates.length = 0;
    an.onEvent({ type: 'session.start', t: 0, sessionUid: '2' });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.corners.length).toBe(an.model!.corners.length);
    expect(updates[0]!.laps).toEqual([]);
    expect(updates[0]!.referenceMs).not.toBeNull();
    const d = buildDebrief(an, null)!;
    expect(d.previousSession).toBe(true);
    expect(d.laps).toBe(3);
    feed(an, 1, 21);
    expect(buildDebrief(an, null)!.previousSession).toBe(false);
  });
  it('no lap with a trace means no safe-zone map: nothing may count as safe road', () => {
    // a known track but no saved reference lap, as after a restart: the map is shown, braking zones are unknown
    const store = new Store(':memory:');
    feed(new SessionAnalyser(store), 2, 9);
    store.db.exec('delete from refs');
    const bus = new Bus(); const an = new SessionAnalyser(store);
    const shown: AnalysisUpdate[] = [];
    an.listeners.push((u) => { shown.push(u); bus.emit('analysis', { ...u, svg: null }); });
    const radio = new Radio(bus, an, { mode: 'coach', tts: null, sinks: [new NullSink()], now: () => 0 });
    radio.attach();
    const sess = generateSession(track, 1, { seed: 5 }); const ad = new F1Adapter();
    for (const r of synthRecords(sess, 'f1', { format: 2026 }).slice(0, 3000)) { const o = ad.feed(r.data, r.t); for (const fr of o.frames) { an.onFrame(fr); bus.emit('frame', fr); } for (const e of o.events) { an.onEvent(e); bus.emit('event', e); } }
    expect(shown.length).toBeGreaterThan(0);          // the map came up before any lap
    expect(an.tracedLaps()).toHaveLength(0);
    expect((radio as unknown as { zones: unknown }).zones).toBeNull();
    store.close();
  });
});

describe('store: the session type is kept, also in a database from before it existed', () => {
  it('adds the column and returns it in the history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-store-'));
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec('create table sessions (id integer primary key autoincrement, game text not null, track_id text, started_at text not null, ended_at text, best_ms integer, theoretical_ms integer, consistency real, laps integer default 0, fingerprint_json text)');
    old.exec("insert into sessions (game, track_id, started_at, best_ms, laps) values ('f1', 'f1:miami', '2026-11-03T13:00:00Z', 89210, 3)");
    old.close();
    const s = new Store(path);
    const id = s.startSession('f1');
    s.updateSession(id, { sessionType: 'sprint-shootout1', trackId: 'f1:miami', bestMs: 86816, laps: 3 });
    expect(s.history('f1:miami').map((h) => h.sessionType)).toEqual([null, 'sprint-shootout1']);
    s.close(); rmSync(dir, { recursive: true, force: true });
  });
});

describe('flashback: the lap is cut back to the rewound timer and kept', () => {
  it('keeps a complete, gap-free lap although the wall clock jumped while rewinding', async () => {
    const { LapCollector } = await import('./laps.ts');
    const { coversLap } = await import('./session.ts');
    const c = new LapCollector();
    const fr = (t: number, cur: number) => { const f = emptyFrame('f1', t, t); f.lap.number = 4; f.lap.distance = cur / 20; f.lap.currentTimeMs = cur; f.flags.onTrack = true; return f; };
    for (let cur = 0; cur <= 50000; cur += 100) c.feed(fr(1000 + cur, cur));            // drove to 50 s
    for (let cur = 30000; cur <= 90000; cur += 100) c.feed(fr(70000 + cur, cur));      // 8 s in the flashback menu, rewound to 30 s
    const lap = c.complete(4, 90000, true)!;
    expect(c.rewinds).toBe(1);
    expect(lap.samples.every((s, i) => i === 0 || s.lapTimeMs! > lap.samples[i - 1]!.lapTimeMs!)).toBe(true);
    expect(lap.maxGapMs).toBeLessThan(200);
    expect(coversLap(lap)).toBe(true);
    expect(lap.rewound).toBe(true);
  });
  it('a rewound lap is never the reference or part of the theoretical best', async () => {
    const { personalBest, microSectors } = await import('./laps.ts');
    const ch = { L: 100, t: new Float32Array(100).map((_, i) => i * 10), speed: new Float32Array(100), throttle: new Float32Array(100), brake: new Float32Array(100), steer: new Float32Array(100), gear: new Float32Array(100) };
    const clean = { number: 2, maxGapMs: 16, timeMs: 1000, valid: true, samples: [], ch };
    const rewound = { ...clean, number: 3, timeMs: 900, ch: { ...ch, t: ch.t.map((x) => x * 0.5) }, rewound: true };
    expect(personalBest([clean, rewound])!.number).toBe(2);
    expect(microSectors([clean, rewound], 100).theoreticalMs).toBeCloseTo(1000, -1);
  });
});

describe('fuel is good: said once, not every lap', () => {
  it('four race laps with three laps spare give one fuel call', () => {
    const bus = new Bus(); const an = new SessionAnalyser(null);
    let clock = 0;
    const radio = new Radio(bus, an, { mode: 'normal', tts: null, sinks: [new NullSink()], now: () => clock });
    radio.attach();
    // a known track that is all straight, so only the repeat rule decides
    (radio as unknown as { zones: unknown }).zones = { L: 2000, safe: new Uint8Array(2000).fill(1), braking: new Uint8Array(2000), corner: new Uint8Array(2000), safeRanges: [{ s0: 0, s1: 2000 }], lapsUsed: 1 };
    for (let lap = 1; lap <= 4; lap++) for (let i = 0; i < 600; i++) {
      clock = (lap * 600 + i) * 50; // 30 s per lap at 20 Hz, flat out on a straight
      const f = emptyFrame('f1', clock, clock);
      f.lap.number = lap; f.lap.total = 10; f.lap.currentTimeMs = i * 50; f.lap.distance = i * 3; f.speed = 80; f.flags.onTrack = true;
      f.input = { throttle: 1, brake: 0, steer: 0, clutch: 0, throttleRaw: null, brakeRaw: null };
      f.fuel = { level: 14, capacity: 110, lapsRemaining: 13 - lap }; // 10-lap race, three laps spare
      bus.emit('frame', f);
    }
    const said = ((radio as unknown as { transcript: { key: string; text: string }[] }).transcript).filter((c) => c.key.startsWith('fuel:'));
    expect(said.map((c) => c.text)).toEqual(['Fuel is good, push.']);
  });
});
