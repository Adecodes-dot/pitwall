// Safe-to-talk zones. A call may start only where the driver is not braking and not mid-corner,
// and must finish before the zone ends at the current speed. Zones come from the track model
// (corner spans) and the driver's own laps (braking zones), per ARCHITECTURE.md §6.
import type { TrackModel } from '../analysis/track.ts';
import type { Lap } from '../analysis/laps.ts';

export interface ZoneMap {
  L: number;
  /** per metre: 1 = braking zone (driver brakes here on some lap, +margin before) */
  braking: Uint8Array;
  /** per metre: 1 = inside a corner span */
  corner: Uint8Array;
  /** per metre: 1 = safe to start a call */
  safe: Uint8Array;
  /** contiguous safe ranges [s0, s1) in metres, driving order */
  safeRanges: { s0: number; s1: number }[];
  lapsUsed: number;
}

export interface ZoneOptions {
  brakeThreshold?: number;   // pedal fraction that counts as braking (default 0.1)
  brakeMarginM?: number;     // extend braking zones earlier by this (default 10)
  cornerMarginM?: number;    // extend corner spans both ways (default 5)
  minSafeM?: number;         // drop safe ranges shorter than this (default 60)
}

const DEF: Required<ZoneOptions> = { brakeThreshold: 0.1, brakeMarginM: 10, cornerMarginM: 5, minSafeM: 60 };

/** Build the zone map from the track model and every lap that has channels. */
export function buildZones(model: TrackModel, laps: Lap[], opts: ZoneOptions = {}): ZoneMap {
  const o = { ...DEF, ...opts };
  const L = model.length;
  const braking = new Uint8Array(L), corner = new Uint8Array(L), safe = new Uint8Array(L);
  let used = 0;
  for (const lap of laps) {
    if (!lap.ch) continue;
    used++;
    for (let s = 0; s < L; s++) if (lap.ch.brake[s]! > o.brakeThreshold) braking[s] = 1;
  }
  // margin before each braking run (driver variance), applied after the union
  const grown = new Uint8Array(braking);
  for (let s = 0; s < L; s++) if (braking[s]) for (let d = 1; d <= o.brakeMarginM; d++) grown[((s - d) % L + L) % L] = 1;
  for (const c of model.corners) {
    const end = c.sEnd < c.sStart ? c.sEnd + L : c.sEnd;
    for (let s = c.sStart - o.cornerMarginM; s < end + o.cornerMarginM; s++) corner[((Math.round(s) % L) + L) % L] = 1;
  }
  for (let s = 0; s < L; s++) safe[s] = grown[s] || corner[s] ? 0 : 1;
  // contiguous ranges, merging across the start line
  const ranges: { s0: number; s1: number }[] = [];
  let start = -1;
  for (let s = 0; s <= L; s++) {
    const v = s < L ? safe[s]! : 0;
    if (v && start < 0) start = s;
    if (!v && start >= 0) { ranges.push({ s0: start, s1: s }); start = -1; }
  }
  if (ranges.length >= 2 && ranges[0]!.s0 === 0 && ranges[ranges.length - 1]!.s1 === L) {
    const last = ranges.pop()!; ranges[0]!.s0 = last.s0 - L; // first range now starts before 0 (wraps)
  }
  const kept = ranges.filter((r) => r.s1 - r.s0 >= o.minSafeM);
  for (let s = 0; s < L; s++) safe[s] = 0;
  for (const r of kept) for (let s = r.s0; s < r.s1; s++) safe[((s % L) + L) % L] = 1;
  return { L, braking: grown, corner, safe, safeRanges: kept, lapsUsed: used };
}

/** Is a call of `durationS` seconds allowed to start at lap distance `s` at `speed` m/s? Returns metres of safe road ahead. */
export function safeRoadAhead(z: ZoneMap, s: number): number {
  const L = z.L;
  const i = ((Math.round(s) % L) + L) % L;
  if (!z.safe[i]) return 0;
  let n = 0;
  while (n < L && z.safe[(i + n) % L]) n++;
  return n;
}

export function canStartCall(z: ZoneMap | null, s: number | null, speed: number | null, durationS: number, marginS = 0.4): boolean {
  if (!z || s === null || speed === null) return false;
  const ahead = safeRoadAhead(z, s);
  if (ahead === 0) return false;
  const needM = (durationS + marginS) * Math.max(speed, 5);
  return ahead >= needM;
}

/** Fallback when there is no track model yet: "on a straight" heuristic from recent inputs. */
export class StraightHeuristic {
  private sinceMs = 0;
  private lastT: number | null = null;
  update(t: number, throttle: number | null, brake: number | null, steer: number | null, slow = false): void {
    // behind the safety car or below 145 km/h nobody is flat out on a straight: off the brake and wheel straight is enough
    const ok = (brake ?? 1) < 0.02 && ((throttle ?? 0) > 0.8 || slow) && Math.abs(steer ?? 1) < 0.12;
    if (this.lastT === null) this.lastT = t;
    this.sinceMs = ok ? this.sinceMs + (t - this.lastT) : 0;
    this.lastT = t;
  }
  /** safe if the driver has been flat out and straight for a while */
  get safe(): boolean { return this.sinceMs > 1500; }
}
