import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTrack } from './track.ts';
import { generateSession } from './driver.ts';
import { synthRecords } from './emit.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import { PwcapWriter, readPwcap } from '../capture/pwcap.ts';
import { replay } from '../capture/replay.ts';
import type { AdapterEvent } from '../core/types.ts';

const track = defaultTrack();

describe('synthetic track and driver', () => {
  it('builds a ~4 km loop with 10 corners that nearly closes', () => {
    expect(track.corners).toHaveLength(10);
    expect(track.length).toBeGreaterThan(3500);
    const last = track.points[track.length - 1]!;
    expect(Math.hypot(last.x, last.z)).toBeLessThan(400); // rough closure is enough for a synthetic loop
  });
  it('produces plausible laps with consistent lap times', () => {
    const sess = generateSession(track, 3, { seed: 7 });
    expect(sess.lapTimesMs).toHaveLength(3);
    for (const lt of sess.lapTimesMs) { expect(lt).toBeGreaterThan(60000); expect(lt).toBeLessThan(120000); }
    const spread = Math.max(...sess.lapTimesMs) - Math.min(...sess.lapTimesMs);
    expect(spread).toBeLessThan(3000);
    expect(sess.samples.some((s) => s.brake > 0.5)).toBe(true);
    expect(sess.samples.some((s) => s.throttle > 0.9)).toBe(true);
  });
});

function lapEvents(events: AdapterEvent[]) { return events.filter((e): e is Extract<AdapterEvent, { type: 'lap.complete' }> => e.type === 'lap.complete'); }

describe('end to end: synthetic datagrams → adapters', () => {
  const sess = generateSession(track, 3, { seed: 3 });

  for (const format of [2024, 2025, 2026] as const) {
    it(`F1 format ${format}: lap.complete times equal ground truth exactly`, () => {
      const recs = synthRecords(sess, 'f1', { format });
      const a = new F1Adapter();
      const events: AdapterEvent[] = []; let frames = 0;
      for (const r of recs) { const o = a.feed(r.data, r.t); events.push(...o.events); frames += o.frames.length; }
      frames += a.tick(1e12).frames.length; // the last frame is emitted when the next would begin
      expect(a.stats.badLength).toBe(0);
      expect(frames).toBe(sess.samples.length);
      // F1 numbers the out lap as lap 1 (time 0 here); flying laps are 2..4
      const laps = lapEvents(events).filter((l) => l.timeMs > 0);
      expect(laps.map((l) => l.timeMs)).toEqual(sess.lapTimesMs);
      expect(laps.map((l) => l.lapNumber)).toEqual([2, 3, 4]);
    });
  }

  it('GT7 (~): lap.complete times equal ground truth; tick timer within one frame of game time', () => {
    const recs = synthRecords(sess, 'gt7', { format: '~' });
    const a = new Gt7Adapter();
    const events: AdapterEvent[] = []; const frames = [];
    for (const r of recs) { const o = a.feed(r.data, r.t); events.push(...o.events); frames.push(...o.frames); }
    expect(frames).toHaveLength(sess.samples.length);
    const laps = lapEvents(events);
    expect(laps.map((l) => l.timeMs)).toEqual(sess.lapTimesMs);
    // tick-derived current lap time vs the generator's own lap clock (format ~ has no native lap time)
    let maxErr = 0;
    frames.forEach((f, i) => { const sm = sess.samples[i]!; if (sm.lap >= 2 && f.lap.currentTimeMs !== null) maxErr = Math.max(maxErr, Math.abs(f.lap.currentTimeMs - sm.lapTimeMs)); });
    expect(maxErr).toBeLessThanOrEqual(34); // ≤ 2 ticks at 60 Hz
    expect(frames[100]!.input.steer).not.toBeNull();
    expect(frames[100]!.input.throttleRaw).not.toBeNull();
  });

  it('GT7 (C): native current lap time is used', () => {
    const recs = synthRecords(sess, 'gt7', { format: 'C' });
    const a = new Gt7Adapter();
    const frames = recs.flatMap((r) => a.feed(r.data, r.t).frames);
    const i = frames.findIndex((f) => (f.lap.number ?? 0) >= 2) + 50;
    expect(frames[i]!.lap.currentTimeMs).toBe(sess.samples[i]!.lapTimeMs);
    expect(frames[i]!.wheels.surface).toEqual(['T', 'T', 'T', 'T']);
  });
});

describe('pwcap + replay', () => {
  it('round-trips records through a file and replays them in order at max speed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pwcap-'));
    const path = join(dir, 'test.pwcap');
    const sess = generateSession(track, 1, { seed: 5 });
    const recs = synthRecords(sess, 'gt7').slice(0, 500);
    const w = new PwcapWriter(path, { createdAt: new Date().toISOString(), game: 'gt7', adapterVersion: 'test', notes: 'synthetic' });
    for (const r of recs) w.write(r);
    w.close();
    const { meta, records } = readPwcap(path);
    expect(meta.game).toBe('gt7'); expect(meta.notes).toBe('synthetic');
    expect(records).toHaveLength(500);
    expect(records[7]!.t).toBe(recs[7]!.t);
    expect(Buffer.from(records[7]!.data).equals(Buffer.from(recs[7]!.data))).toBe(true);
    const seen: number[] = [];
    replay(records, { speed: Infinity, sink: (r) => seen.push(r.t) });
    expect(seen).toEqual(recs.map((r) => r.t));
    rmSync(dir, { recursive: true, force: true });
  });

  it('replays with timing at 20x speed', async () => {
    const sess = generateSession(track, 1, { seed: 5 });
    const recs = synthRecords(sess, 'gt7').slice(0, 120); // 2 s of data
    const start = performance.now();
    const seen: number[] = [];
    await new Promise<void>((resolve) => replay(recs, { speed: 20, sink: (r) => seen.push(r.t), onDone: resolve }));
    const elapsed = performance.now() - start;
    expect(seen).toHaveLength(120);
    expect(elapsed).toBeGreaterThan(60);   // 2 s / 20 = 100 ms nominal
    expect(elapsed).toBeLessThan(400);
  });
});
