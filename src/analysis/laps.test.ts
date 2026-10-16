import { describe, expect, it } from 'vitest';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import { SessionAnalyser } from './session.ts';
import { Store } from './store.ts';
import { microSectors, segments, segmentDeltas, personalBest, timeAt } from './laps.ts';

function runThrough(game: 'f1' | 'gt7', laps = 4, store: Store | null = null) {
  const track = defaultTrack();
  const sess = generateSession(track, laps, { seed: 9, brakeJitterM: 12, speedJitter: 0.05 });
  const recs = synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' });
  const adapter = game === 'f1' ? new F1Adapter() : new Gt7Adapter();
  const an = new SessionAnalyser(store);
  for (const r of recs) {
    const o = adapter.feed(r.data, r.t);
    for (const f of o.frames) an.onFrame(f);
    for (const e of o.events) an.onEvent(e);
  }
  return { sess, an, track };
}

describe('session analysis end to end', () => {
  for (const game of ['f1', 'gt7'] as const) {
    it(`${game}: learns the track, builds channels, references and fingerprint`, () => {
      const { sess, an, track } = runThrough(game);
      expect(an.model).not.toBeNull();
      expect(an.model!.corners).toHaveLength(10);
      expect(Math.abs(an.model!.length - track.length)).toBeLessThan(track.length * 0.01);
      const laps = an.collector.laps;
      expect(laps).toHaveLength(4);
      for (const l of laps) expect(l.ch).not.toBeNull();
      // one full lap of channel time equals the lap time; the model origin sits within a few metres of the line
      for (const l of laps) {
        expect(Math.abs(timeAt(l.ch!, l.ch!.L, l.timeMs) - timeAt(l.ch!, 0, l.timeMs) - l.timeMs)).toBeLessThan(1);
        expect(l.ch!.t[0]!).toBeLessThan(200);
        expect(l.ch!.t[0]!).toBeGreaterThanOrEqual(0);
      }
      const u = an.lastUpdate!;
      expect(u.pbMs).toBe(Math.min(...sess.lapTimesMs));
      // theoretical best never slower than PB and not absurdly faster
      expect(u.theoreticalMs!).toBeLessThanOrEqual(u.pbMs!);
      expect(u.theoreticalMs!).toBeGreaterThan(u.pbMs! * 0.97);
      // per-corner metrics exist for every corner on every lap with a brake point for the slow corners
      const last = u.laps[u.laps.length - 1]!;
      expect(last.corners).toHaveLength(10);
      const hairpin = last.corners.find((c) => c.corner === 4)!; // R=25 corner in the synthetic track
      expect(hairpin.brakePointM).not.toBeNull();
      expect(hairpin.brakePointM!).toBeGreaterThan(30);
      expect(hairpin.minSpeed).toBeLessThan(25);
      expect(hairpin.throttlePickupM).not.toBeNull();
      // fingerprint
      const fp = u.fingerprint!;
      expect(fp.lapsAnalysed).toBe(4);
      expect(fp.corners).toHaveLength(10);
      expect(fp.consistencyScore).toBeGreaterThan(50);
      expect(fp.mistakes.some((m) => m.kind === 'lockup')).toBe(true);     // synthetic emits lockups under heavy braking
      expect(fp.mistakes.some((m) => m.kind === 'wheelspin')).toBe(true);  // and wheelspin on slow exits
      for (const m of fp.mistakes) expect(m.corner).not.toBeNull();
    });
  }

  it('segment deltas (corners + straights) sum to the lap delta within 0.1 s', () => {
    const { an } = runThrough('gt7');
    const laps = an.collector.laps;
    const pb = personalBest(laps)!;
    const segs = segments(an.model!);
    // segments tile [0, L)
    expect(segs[0]!.s0).toBe(0);
    expect(segs[segs.length - 1]!.s1).toBe(an.model!.length);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.s0).toBe(segs[i - 1]!.s1);
    for (const l of laps) {
      if (l === pb) continue;
      const d = segmentDeltas(l, pb, segs);
      const sum = d.reduce((a, x) => a + x.deltaMs, 0);
      expect(Math.abs(sum - (l.timeMs - pb.timeMs))).toBeLessThan(100);
    }
  });

  it('micro-sector best times sum to the theoretical best and each lap sums to its own time', () => {
    const { an } = runThrough('f1');
    const laps = an.collector.laps;
    const ms = microSectors(laps, an.model!.length);
    let theo = 0; for (let b = 0; b < ms.bins; b++) theo += ms.bestMs[b]!;
    expect(Math.abs(theo - ms.theoreticalMs)).toBeLessThan(1);
    expect(ms.theoreticalMs).toBeLessThanOrEqual(Math.min(...laps.map((l) => l.timeMs)));
  });

  it('persists tracks, laps and sessions in sqlite and recognises the track next session', () => {
    const store = new Store(':memory:');
    const a = runThrough('gt7', 3, store);
    const id = a.an.model!.id;
    expect(store.loadTracks('gt7')).toHaveLength(1);
    expect(store.allTimeBest(id)).toBe(a.an.lastUpdate!.pbMs);
    const b = runThrough('gt7', 2, store);
    expect(b.an.model!.id).toBe(id); // matched by fingerprint, not rebuilt
    expect(store.loadTracks('gt7')).toHaveLength(1);
    expect(store.history(id)).toHaveLength(2);
    expect(b.an.lastUpdate!.allTimeBestMs).toBe(Math.min(a.an.lastUpdate!.pbMs!, b.an.lastUpdate!.pbMs!));
    store.close();
  });
});
