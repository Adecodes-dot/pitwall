// Race-weekend behaviour found on the first real F1 25 (2026 pack) weekend at Shanghai, 2026-10-26:
// out laps share the flying lap's number, the menus send sessionUID 0, and qualifying gives one lap per session.
import { describe, expect, it } from 'vitest';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { encodeF1 } from '../adapters/f1/codec.ts';
import { PacketId } from '../adapters/f1/layouts.ts';
import { emptyFrame } from '../core/types.ts';
import { SessionAnalyser, coversLap, fitsLap } from './session.ts';
import { LapCollector, type Lap } from './laps.ts';
import { Store } from './store.ts';
import { answerByRule } from '../llm/qa.ts';
import type { TrackModel } from './track.ts';

function frame(t: number, lap: number, dist: number, cur: number) {
  const f = emptyFrame('f1', t, t);
  f.lap.number = lap; f.lap.distance = dist; f.lap.currentTimeMs = cur; f.flags.onTrack = true; f.speed = 50;
  return f;
}

describe('lap collector: out laps and timer restarts', () => {
  it('drops the qualifying out lap (negative distance, timer 0) and the practice out lap (timer 0 far along)', () => {
    const c = new LapCollector();
    for (let i = 0; i < 20; i++) c.feed(frame(i, 1, -2000 + i * 50, 0));       // from the pits, before the line
    for (let i = 0; i < 20; i++) c.feed(frame(100 + i, 1, 3700 + i * 50, 0));  // practice: put on track mid-lap, timer not running
    for (let i = 0; i < 30; i++) c.feed(frame(200 + i, 1, i * 100, i * 1000));  // the flying lap
    const lap = c.complete(1, 30000, true)!;
    expect(lap.samples).toHaveLength(30);
    expect(lap.samples[0]!.lapTimeMs).toBe(0);
    expect(c.skipped.outLap).toBe(40);
    expect(coversLap({ ...lap, timeMs: 30000 })).toBe(true);
  });
  it('starts the lap again when the timer goes back within the same lap number', () => {
    const c = new LapCollector();
    for (let i = 0; i < 20; i++) c.feed(frame(i, 3, 100 + i * 100, 5000 + i * 1000));
    for (let i = 0; i < 15; i++) c.feed(frame(100 + i, 3, i * 100, i * 1000));
    expect(c.complete(3, 15000, true)!.samples).toHaveLength(15);
  });
  it('a lap that starts mid-way (after a flashback) does not cover the lap', () => {
    const l: Lap = { number: 2, maxGapMs: 16, timeMs: 96000, valid: true, ch: null, samples: [{ ...frameSample(31000) }, { ...frameSample(95990) }] };
    expect(coversLap(l)).toBe(false);
  });
  it('a track model must match the distance the game reports for a full lap', () => {
    const l: Lap = { number: 1, maxGapMs: 16, timeMs: 95000, valid: true, ch: null, samples: [{ ...frameSample(0), s: 1 }, { ...frameSample(94990), s: 5441 }] };
    expect(fitsLap({ length: 5381 } as TrackModel, l)).toBe(true);
    expect(fitsLap({ length: 8022 } as TrackModel, l)).toBe(false); // out lap + flying lap learned as one
  });
});

function frameSample(lapTimeMs: number) {
  return { t: lapTimeMs, lapTimeMs, s: null, x: null, z: null, speed: null, throttle: null, brake: null, steer: null, gear: null, wheelSpeed: null, slipRatio: null, throttleRaw: null, brakeRaw: null, tcActive: null };
}

describe('f1 adapter: menus between sessions', () => {
  it('sessionUID 0 starts nothing; the same session resumes; a new one starts', () => {
    const a = new F1Adapter();
    const starts: string[] = [];
    for (const uid of [7n, 0n, 7n, 0n, 9n]) {
      for (const e of a.feed(encodeF1({ format: 2026, packetId: PacketId.Session, header: { sessionUID: uid }, body: { trackId: 2 } }), 0).events) if (e.type === 'session.start') starts.push(e.sessionUid ?? '');
    }
    expect(starts).toEqual(['7', '9']);
  });
});

describe('race weekend: the next session keeps the track and compares against the best lap so far', () => {
  const track = defaultTrack();
  const feed = (an: SessionAnalyser, laps: number, seed: number) => {
    const sess = generateSession(track, laps, { seed, brakeJitterM: 12, speedJitter: 0.05 });
    const ad = new F1Adapter();
    for (const r of synthRecords(sess, 'f1', { format: 2026 })) { const o = ad.feed(r.data, r.t); for (const f of o.frames) an.onFrame(f); for (const e of o.events) an.onEvent(e); }
  };
  const losing = (an: SessionAnalyser) => answerByRule('where am I losing time', { update: an.lastUpdate, frame: null, fuelLaps: null, lapsLeft: null, game: 'f1' } as never)!.text;

  it('practice, then a one-lap qualifying session: model and reference carry over, also after an app restart', () => {
    const store = new Store(':memory:');
    const an = new SessionAnalyser(store);
    feed(an, 4, 9);
    const model = an.model!, practiceBest = an.lastUpdate!.pbMs!;
    expect(an.lastUpdate!.hasReference).toBe(true);
    // the last lap of a session can be the best one and still has somewhere to improve
    expect(losing(an)).not.toBe('No reference lap yet, keep lapping.');

    an.onEvent({ type: 'session.start', t: 0, sessionUid: '2' });
    expect(an.model).toBe(model);
    expect(an.collector.laps).toHaveLength(0);
    feed(an, 1, 21); // out lap + one flying lap
    expect(an.collector.laps.filter((l) => l.timeMs > 0)).toHaveLength(1);
    expect(an.lastUpdate!.hasReference).toBe(true);
    expect(an.lastUpdate!.referenceMs).toBe(practiceBest);
    expect(losing(an)).not.toBe('No reference lap yet, keep lapping.');

    // the reference survives a restart of the app: a fresh analyser on the same store
    const again = new SessionAnalyser(store);
    feed(again, 1, 33);
    expect(again.lastUpdate!.hasReference).toBe(true);
    expect(again.lastUpdate!.referenceMs).toBe(Math.min(practiceBest, an.collector.laps.find((l) => l.timeMs > 0)!.timeMs));
    store.close();
  });

  it('the saved reference round-trips through sqlite and is ignored for a model of another length', () => {
    const store = new Store(':memory:');
    const an = new SessionAnalyser(store);
    feed(an, 3, 9);
    const id = an.model!.id, L = an.model!.length;
    const ref = store.loadRef(id, L)!;
    const pb = an.collector.laps.find((l) => l.timeMs === ref.timeMs)!;
    expect(Array.from(ref.ch!.t.subarray(0, 50))).toEqual(Array.from(pb.ch!.t.subarray(0, 50)));
    expect(ref.ch!.brake[L - 1]).toBe(pb.ch!.brake[L - 1]);
    expect(store.loadRef(id, L + 10)).toBeNull();
    store.close();
  });
});

describe('"where am I losing time" after a lap with no trace', () => {
  it('says the lap lost data instead of claiming there is no reference', () => {
    const ask = (update: object) => answerByRule('where am I losing time', { update, frame: null, fuelLaps: null, lapsLeft: null, game: 'f1' } as never)!.text;
    expect(ask({ hasReference: false, referenceMs: 92657, worstCorners: [] })).toBe('No clean trace of that lap, ask after the next one.');
    expect(ask({ hasReference: false, referenceMs: null, worstCorners: [] })).toBe('No reference lap yet, keep lapping.');
  });
});
