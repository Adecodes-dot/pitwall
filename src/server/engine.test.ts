import { describe, expect, it } from 'vitest';
import { Engine } from './engine.ts';
import { SessionAnalyser, GAP_LIMIT_MS } from '../analysis/session.ts';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import type { CaptureRecord } from '../capture/pwcap.ts';

function run(game: 'f1' | 'gt7', keep: (r: CaptureRecord, i: number) => boolean, laps = 5) {
  const sess = generateSession(defaultTrack(), laps, { seed: 31, brakeJitterM: 12, speedJitter: 0.05 });
  const recs = synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' });
  let clock = 0;
  const engine = new Engine({ mode: 'replay', lanIp: null, now: () => clock });
  const an = new SessionAnalyser(null);
  engine.bus.on('frame', (f) => an.onFrame(f));
  engine.bus.on('event', (e) => an.onEvent(e));
  const maxLoss: number[] = [];
  recs.forEach((r, i) => {
    clock = r.t;
    if (!keep(r, i)) return;
    engine.ingest(r.data, r.srcPort, r.t, r.tWall);
    if (i % 600 === 0) maxLoss.push(engine.status(clock).lossPct);
  });
  return { engine, an, sess, clock, finalLoss: engine.status(clock).lossPct, maxLoss };
}

// frame index of a record: f1 sends ~5 datagrams per frame, so drop by time instead
const t0 = 1000;

describe('rolling loss', () => {
  for (const game of ['f1', 'gt7'] as const) {
    it(`${game}: clean stream reads 0 % loss`, () => {
      const r = run(game, () => true);
      expect(r.finalLoss).toBe(0);
    });
    it(`${game}: dropping 20 % of frames reads about 20 %`, () => {
      // deterministic: drop every 5th frame (the median step stays 1, so each hole counts as one lost frame)
      const r = run(game, (rec) => Math.round((rec.t - t0) / (1000 / 60)) % 5 !== 0);
      expect(r.finalLoss).toBeGreaterThan(14);
      expect(r.finalLoss).toBeLessThan(26);
    });
    it(`${game}: a 5 s outage is not counted as loss`, () => {
      const r = run(game, (rec) => rec.t - t0 < 60000 || rec.t - t0 > 65000);
      expect(r.finalLoss).toBe(0);
      expect(r.engine.gaps).toBe(1);
    });
  }
  it('a 30 Hz send rate (every other frame) is not reported as loss', () => {
    const r = run('f1', (rec) => Math.round((rec.t - t0) / (1000 / 60)) % 2 === 0);
    expect(r.finalLoss).toBeLessThan(2);
  });
});

describe('a lap with a hole in it', () => {
  it('keeps its game lap time but gets no trace and cannot become the reference', () => {
    // cut 3 s out of the middle of lap 3 (laps are ~89 s; session starts 100 m before the line)
    const cutFrom = t0 + 89000 * 2 + 30000, cutTo = cutFrom + 3000;
    const r = run('f1', (rec) => rec.t < cutFrom || rec.t > cutTo, 5);
    const laps = r.an.collector.laps;
    const holed = laps.filter((l) => l.maxGapMs > GAP_LIMIT_MS);
    expect(holed.length).toBe(1);
    expect(holed[0]!.ch).toBeNull();
    expect(holed[0]!.timeMs).toBeGreaterThan(80000);          // the game still reported its lap time
    const u = r.an.lastUpdate!;
    expect(u.pbLap).not.toBe(holed[0]!.number);
    expect(u.laps.some((l) => l.number === holed[0]!.number)).toBe(true);
    // every other lap is analysed normally and the theoretical best stays sane
    expect(laps.filter((l) => l.ch).length).toBe(laps.length - 1);
    expect(u.theoreticalMs!).toBeLessThanOrEqual(u.pbMs!);
    expect(u.theoreticalMs!).toBeGreaterThan(u.pbMs! * 0.97);
  });
});
