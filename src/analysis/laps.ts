// Lap splitting, distance-resampled channels, references (PB, theoretical best), per-corner metrics.
// Everything here is a pure function of frames + lap.complete events + an optional TrackModel.
import type { NormalisedFrame } from '../core/types.ts';
import type { Corner, TrackModel } from './track.ts';
import { Projector } from './track.ts';

/** Reduced frame kept per lap (raw samples). */
export interface LapSample {
  t: number;              // frame.t (monotonic ms)
  lapTimeMs: number | null;
  s: number | null;       // lap distance, m (game-provided or projected)
  x: number | null; z: number | null;
  speed: number | null; throttle: number | null; brake: number | null; steer: number | null; gear: number | null;
  wheelSpeed: [number, number, number, number] | null;
  slipRatio: [number, number, number, number] | null;
  throttleRaw: number | null; brakeRaw: number | null;
  tcActive: boolean | null;
}

/** Channels resampled on a 1 m grid 0..L-1 (t at s = L equals the lap time). */
export interface LapChannels {
  L: number;
  t: Float32Array;        // ms since lap start at each metre
  speed: Float32Array; throttle: Float32Array; brake: Float32Array; steer: Float32Array; gear: Float32Array;
}

export interface Lap {
  number: number;
  /** longest hole between consecutive frames, ms (stream outage or heavy loss inside the lap) */
  maxGapMs: number;
  timeMs: number;         // -1 if unknown
  valid: boolean | null;
  samples: LapSample[];
  ch: LapChannels | null;
  /** cut back by a flashback: driven for real and good for "where am I losing time", but kept out of the reference, the
   *  theoretical best and the debrief ranking until rewound traces are proven exact */
  rewound?: boolean;
  /** part of it was in the pit lane (in-lap, out-lap): limiter speeds and another line, so it gets no trace */
  pit?: boolean;
}

export function toLapSample(f: NormalisedFrame): LapSample {
  return {
    t: f.t, lapTimeMs: f.lap.currentTimeMs, s: f.lap.distance, x: f.pos?.x ?? null, z: f.pos?.z ?? null,
    speed: f.speed, throttle: f.input.throttle, brake: f.input.brake, steer: f.input.steer, gear: f.drivetrain.gear,
    wheelSpeed: f.wheels.speed, slipRatio: f.wheels.slipRatio, throttleRaw: f.input.throttleRaw, brakeRaw: f.input.brakeRaw, tcActive: f.assists.tcActive,
  };
}

/** Collects frames into laps keyed by lap number; a lap is finalised by its lap.complete event. */
export class LapCollector {
  private buffers = new Map<number, LapSample[]>();
  laps: Lap[] = [];
  currentLapNumber: number | null = null;
  /** frames ignored because the car was not on track / had no lap number (diagnostics) */
  skipped = { offTrack: 0, noLap: 0, outLap: 0 };
  accepted = 0;
  /** laps cut back by a flashback (diagnostics) */
  rewinds = 0;
  private rewound = new Set<number>();
  private pitted = new Set<number>();

  feed(f: NormalisedFrame): void {
    const n = f.lap.number;
    if (n === null) { this.skipped.noLap++; return; }
    if (f.flags.onTrack === false) { this.skipped.offTrack++; return; }
    // F1 out laps share their lap number with the flying lap that follows: the game's timer reads 0 until the line, and
    // the lap distance is negative (qualifying, from the pits) or already far along (practice). Not part of the lap.
    const d = f.lap.distance;
    if (d !== null && (d < 0 || (f.lap.currentTimeMs === 0 && d > 100))) { this.skipped.outLap++; return; }
    this.accepted++;
    if (f.flags.pitting === true) this.pitted.add(n); // after the out-lap skip: a qualifying run leaves the pits on the lap before
    this.currentLapNumber = n;
    let b = this.buffers.get(n);
    if (!b) { b = []; this.buffers.set(n, b); }
    // the lap timer went back within the same lap number: a flashback rewinds the car and its timer together, so cut the lap
    // back to that moment and keep it (a restart at the line cuts back to nothing, which starts the lap again)
    const cur = f.lap.currentTimeMs, last = b[b.length - 1];
    if (cur !== null && last && last.lapTimeMs !== null && cur < last.lapTimeMs - 200) { while (b.length && b[b.length - 1]!.lapTimeMs !== null && b[b.length - 1]!.lapTimeMs! >= cur) b.pop(); this.rewinds++; this.rewound.add(n); }
    b.push(toLapSample(f));
    // forget buffers older than 3 laps that never completed (restarts, pit)
    for (const k of this.buffers.keys()) if (k < n - 3) this.buffers.delete(k);
  }

  /** Called on lap.complete; returns the finalised lap (or null if we have no samples for it). */
  complete(lapNumber: number, timeMs: number, valid: boolean | null): Lap | null {
    const samples = this.buffers.get(lapNumber);
    this.buffers.delete(lapNumber);
    if (!samples || samples.length < 10) return null;
    let maxGapMs = 0;
    // a hole in the lap is measured on the game's lap timer where there is one: after a flashback the wall clock jumps
    // (time spent rewinding) while the lap itself is continuous; an outage moves both
    for (let i = 1; i < samples.length; i++) { const a = samples[i - 1]!, c = samples[i]!; maxGapMs = Math.max(maxGapMs, a.lapTimeMs !== null && c.lapTimeMs !== null ? c.lapTimeMs - a.lapTimeMs : c.t - a.t); }
    const lap: Lap = { number: lapNumber, maxGapMs, timeMs, valid, samples, ch: null, ...(this.rewound.delete(lapNumber) ? { rewound: true } : {}), ...(this.pitted.delete(lapNumber) ? { pit: true } : {}) };
    this.laps.push(lap);
    return lap;
  }

  /** Samples of the lap in progress (for live per-corner feedback later). */
  current(): LapSample[] { return this.currentLapNumber === null ? [] : this.buffers.get(this.currentLapNumber) ?? []; }

  reset(): void { this.buffers.clear(); this.laps = []; this.currentLapNumber = null; this.rewound.clear(); this.pitted.clear(); }
}

/** Fill `s` for samples that lack it by projecting xz onto the track model. */
export function projectLap(lap: Lap, proj: Projector): void {
  let hint: number | null = null;
  for (const sm of lap.samples) {
    if (sm.s !== null) { hint = sm.s; continue; }
    if (sm.x === null || sm.z === null) continue;
    const r = proj.project(sm.x, sm.z, hint);
    sm.s = r.s; hint = r.s;
  }
}

/** Resample a lap's samples onto the 1 m grid. Requires s and lapTimeMs on most samples. */
export function buildChannels(lap: Lap, L: number): LapChannels | null {
  // keep samples with s and time, enforce monotonic s (allowing the wrap at the very end)
  const pts = lap.samples.filter((p) => p.s !== null && p.lapTimeMs !== null) as (LapSample & { s: number; lapTimeMs: number })[];
  if (pts.length < 10) return null;
  // unwrap s into a continuous run: the first samples may sit just before the model's origin (s ≈ L),
  // and the last ones just past the next crossing (s ≈ 0 again)
  const mono: typeof pts = [];
  let lastS = -Infinity;
  let offset = pts[0]!.s > L * 0.9 ? -L : 0;
  for (const p of pts) {
    let s = p.s + offset;
    if (lastS !== -Infinity && s < lastS - L * 0.5) { offset += L; s += L; }
    if (s < lastS) continue; // small reversal (projection noise) → skip
    if (s >= L + 50) break;   // well past the line: next lap's samples
    mono.push({ ...p, s });
    lastS = s;
  }
  if (mono.length < 10) return null;
  const n = mono.length;
  const out: LapChannels = { L, t: new Float32Array(L), speed: new Float32Array(L), throttle: new Float32Array(L), brake: new Float32Array(L), steer: new Float32Array(L), gear: new Float32Array(L) };
  const first = mono[0]!, last = mono[n - 1]!;
  let j = 0;
  for (let s = 0; s < L; s++) {
    while (j < n - 2 && mono[j + 1]!.s < s) j++;
    let a = mono[j]!, b = mono[j + 1]! ?? mono[j]!;
    let f: number;
    if (s < first.s) { a = first; b = first; f = 0; }
    else if (s > last.s) { a = last; b = last; f = 0; }
    else { const span = b.s - a.s; f = span > 0 ? (s - a.s) / span : 0; }
    const lerp = (x: number | null, y: number | null) => (x === null ? (y ?? 0) : y === null ? x : x + (y - x) * f);
    // time: extrapolate before the first sample towards 0 and after the last towards the lap time
    if (s < first.s) out.t[s] = first.lapTimeMs * (s / Math.max(first.s, 1e-6));
    else if (s > last.s && lap.timeMs > 0) out.t[s] = last.lapTimeMs + (lap.timeMs - last.lapTimeMs) * ((s - last.s) / Math.max(L - last.s, 1e-6));
    else out.t[s] = lerp(a.lapTimeMs, b.lapTimeMs);
    out.speed[s] = lerp(a.speed, b.speed); out.throttle[s] = lerp(a.throttle, b.throttle); out.brake[s] = lerp(a.brake, b.brake);
    out.steer[s] = lerp(a.steer, b.steer); out.gear[s] = lerp(a.gear, b.gear);
  }
  return out;
}

/** t at fractional s (wrapping); t(L) = lap time. */
export function timeAt(ch: LapChannels, s: number, lapTimeMs: number): number {
  if (s >= ch.L) return lapTimeMs + timeAt(ch, s - ch.L, lapTimeMs);
  if (s < 0) return timeAt(ch, s + ch.L, lapTimeMs) - lapTimeMs;
  const i = Math.floor(s), f = s - i;
  const a = ch.t[i]!, b = i + 1 < ch.L ? ch.t[i + 1]! : lapTimeMs;
  return a + (b - a) * f;
}

export function personalBest(laps: Lap[]): Lap | null {
  let best: Lap | null = null;
  for (const l of laps) if (l.ch && !l.rewound && l.timeMs > 0 && l.valid !== false && (!best || l.timeMs < best.timeMs)) best = l;
  return best;
}

export interface MicroSectors { binM: number; bins: number; bestMs: Float32Array; bestLap: Int32Array; theoreticalMs: number }

/** Best time per 50 m bin across valid laps → theoretical best. */
export function microSectors(laps: Lap[], L: number, binM = 50): MicroSectors {
  const bins = Math.ceil(L / binM);
  const bestMs = new Float32Array(bins).fill(Infinity), bestLap = new Int32Array(bins).fill(-1);
  for (const l of laps) {
    if (!l.ch || l.rewound || l.timeMs <= 0 || l.valid === false) continue;
    for (let b = 0; b < bins; b++) {
      const s0 = b * binM, s1 = Math.min(L, (b + 1) * binM);
      const dt = timeAt(l.ch, s1, l.timeMs) - timeAt(l.ch, s0, l.timeMs);
      if (dt < bestMs[b]!) { bestMs[b] = dt; bestLap[b] = l.number; }
    }
  }
  let theoretical = 0;
  for (let b = 0; b < bins; b++) theoretical += Number.isFinite(bestMs[b]!) ? bestMs[b]! : 0;
  return { binM, bins, bestMs, bestLap, theoreticalMs: theoretical };
}

/** Segment the lap into corner windows and the straights between them; windows cover [0, L) exactly. */
export interface Segment { kind: 'corner' | 'straight'; corner: Corner | null; s0: number; s1: number }
export function segments(model: TrackModel, approachM = 150, exitM = 100): Segment[] {
  const L = model.length;
  const cs = model.corners;
  if (cs.length === 0) return [{ kind: 'straight', corner: null, s0: 0, s1: L }];
  // corner window = [sStart - approach, sEnd + exit], clipped so windows do not overlap
  const win = cs.map((c) => ({ c, s0: c.sStart - approachM, s1: c.sEnd + exitM }));
  for (let i = 0; i < win.length; i++) {
    const prev = win[(i - 1 + win.length) % win.length]!, w = win[i]!;
    const prevEnd = i === 0 ? prev.s1 - L : prev.s1;
    if (w.s0 < prevEnd) { const mid = (prevEnd + w.s0) / 2 + (w.s0 - prevEnd) / 2; w.s0 = Math.max(mid, prevEnd); }
  }
  const out: Segment[] = [];
  // walk from 0 to L; the first corner window may start before 0 (wrap) — handle by shifting
  const sorted = win.map((w) => ({ ...w, s0: ((w.s0 % L) + L) % L, s1: ((w.s1 % L) + L) % L }));
  // if a window wraps across 0, split it
  const pieces: { kind: Segment['kind']; corner: Corner | null; s0: number; s1: number }[] = [];
  for (const w of sorted) {
    if (w.s0 <= w.s1) pieces.push({ kind: 'corner', corner: w.c, s0: w.s0, s1: w.s1 });
    else { pieces.push({ kind: 'corner', corner: w.c, s0: w.s0, s1: L }); pieces.push({ kind: 'corner', corner: w.c, s0: 0, s1: w.s1 }); }
  }
  pieces.sort((a, b) => a.s0 - b.s0);
  let cursor = 0;
  for (const p of pieces) {
    if (p.s0 > cursor) out.push({ kind: 'straight', corner: null, s0: cursor, s1: p.s0 });
    out.push(p); cursor = Math.max(cursor, p.s1);
  }
  if (cursor < L) out.push({ kind: 'straight', corner: null, s0: cursor, s1: L });
  return out;
}

export interface SegmentDelta { seg: Segment; lapMs: number; refMs: number; deltaMs: number }
export function segmentDeltas(lap: Lap, ref: Lap, segs: Segment[]): SegmentDelta[] {
  if (!lap.ch || !ref.ch) return [];
  return segs.map((seg) => {
    const lapMs = timeAt(lap.ch!, seg.s1, lap.timeMs) - timeAt(lap.ch!, seg.s0, lap.timeMs);
    const refMs = timeAt(ref.ch!, seg.s1, ref.timeMs) - timeAt(ref.ch!, seg.s0, ref.timeMs);
    return { seg, lapMs, refMs, deltaMs: lapMs - refMs };
  });
}

/** Delta trace t_lap(s) - t_ref(s) per metre. */
export function deltaTrace(lap: Lap, ref: Lap): Float32Array | null {
  if (!lap.ch || !ref.ch || lap.ch.L !== ref.ch.L) return null;
  const out = new Float32Array(lap.ch.L);
  for (let s = 0; s < lap.ch.L; s++) out[s] = lap.ch.t[s]! - ref.ch.t[s]!;
  return out;
}

export interface CornerMetrics {
  corner: number;
  /** metres before sStart where braking began (positive = earlier); null if no braking */
  brakePointM: number | null;
  peakBrake: number;
  /** metres past sStart where the brake was fully released (positive = trail braking into the corner) */
  brakeReleaseM: number | null;
  minSpeed: number;        // m/s
  minSpeedS: number;
  /** metres past apex where throttle exceeded 20 % (negative = before apex) */
  throttlePickupM: number | null;
  /** mean |Δthrottle| per metre on exit (lower = smoother) */
  throttleSmoothness: number | null;
  coastingM: number;       // metres with neither pedal
  timeMs: number;          // time through the window
  windowS0: number; windowS1: number;
}

export function cornerMetrics(lap: Lap, corner: Corner, L: number, approachM = 200, exitM = 150): CornerMetrics | null {
  const ch = lap.ch; if (!ch) return null;
  // a corner may wrap the start line: unwrap its end and apex past L so every scan below is a simple range
  const sEnd = corner.sEnd < corner.sStart ? corner.sEnd + L : corner.sEnd;
  const sApex = corner.sApex < corner.sStart ? corner.sApex + L : corner.sApex;
  const c = { ...corner, sEnd, sApex };
  const s0 = corner.sStart - approachM, s1 = sEnd + exitM;
  const at = (arr: Float32Array, s: number) => arr[((Math.round(s) % L) + L) % L]!;
  // The braking run that belongs to this corner is the last one before the apex: walk back from the apex
  // to its release point, then further back to where it began. Clipped at the window start → null
  // (the driver was still braking for the previous corner, so there is no distinct brake point).
  let brakePoint: number | null = null, release: number | null = null, peak = 0;
  let s = c.sApex;
  while (s > s0 && at(ch.brake, s) <= 0.1) s--;
  if (s > s0) {
    release = s + 1;
    while (s > s0 && at(ch.brake, s) > 0.1) { peak = Math.max(peak, at(ch.brake, s)); s--; }
    brakePoint = s > s0 ? s + 1 : null;
    if (brakePoint === null) peak = 0;
  }
  let minSpeed = Infinity, minS = c.sStart;
  for (let s = c.sStart - 20; s <= c.sEnd + 20; s++) { const v = at(ch.speed, s); if (v < minSpeed) { minSpeed = v; minS = s; } }
  let pickup: number | null = null;
  for (let s = minS - 30; s < s1; s++) if (at(ch.throttle, s) > 0.2) { pickup = s; break; }
  let smooth: number | null = null;
  if (pickup !== null) { let acc = 0, n = 0; for (let s = pickup; s < s1 - 1; s++) { acc += Math.abs(at(ch.throttle, s + 1) - at(ch.throttle, s)); n++; } smooth = n ? acc / n : null; }
  let coast = 0;
  for (let s = s0; s < s1; s++) if (at(ch.throttle, s) < 0.05 && at(ch.brake, s) < 0.05) coast++;
  const timeMs = timeAt(ch, s1, lap.timeMs) - timeAt(ch, s0, lap.timeMs);
  return {
    corner: corner.index,
    brakePointM: brakePoint === null ? null : c.sStart - brakePoint,
    peakBrake: peak,
    brakeReleaseM: release === null ? null : release - c.sStart,
    minSpeed, minSpeedS: minS,
    throttlePickupM: pickup === null ? null : pickup - c.sApex,
    throttleSmoothness: smooth,
    coastingM: coast, timeMs, windowS0: s0, windowS1: s1,
  };
}
