// Driver fingerprint: per-corner statistics across laps, consistency, and mistake detection.
import type { Lap, CornerMetrics } from './laps.ts';
import { cornerMetrics } from './laps.ts';
import type { TrackModel } from './track.ts';

export interface Mistake { kind: 'lockup' | 'wheelspin'; lap: number; s: number; corner: number | null; severity: number; t: number }

export interface CornerStats {
  corner: number;
  laps: number;
  /** metrics of the lap that was fastest through this corner */
  best: CornerMetrics;
  meanTimeMs: number;
  stdTimeMs: number;
  meanBrakePointM: number | null;
  stdBrakePointM: number | null;
  meanMinSpeed: number;
  meanCoastingM: number;
  trailBraking: boolean;   // brake typically released after turn-in
  lockups: number;
  wheelspins: number;
}

export interface Fingerprint {
  trackId: string;
  lapsAnalysed: number;
  lapTimeStdMs: number | null;
  consistencyScore: number | null;   // 0..100, 100 = every lap within 0.1 % of best
  corners: CornerStats[];
  mistakes: Mistake[];
  assists: { tc: number | null; abs: boolean | null; tcInterventions: number };
}

function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function std(a: number[]): number { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }

/** Lockups: front wheels markedly slower than the car under braking. Wheelspin: rears faster under throttle. */
export function detectMistakes(lap: Lap, model: TrackModel | null): Mistake[] {
  const out: Mistake[] = [];
  let lastKind: Mistake['kind'] | null = null, lastT = -Infinity;
  for (const p of lap.samples) {
    if (p.speed === null || p.speed < 8 || p.wheelSpeed === null) continue;
    const [fl, fr, rl, rr] = p.wheelSpeed;
    const front = Math.min(fl, fr) / p.speed, rear = Math.max(rl, rr) / p.speed;
    let kind: Mistake['kind'] | null = null, severity = 0;
    if ((p.brake ?? 0) > 0.3 && front < 0.85) { kind = 'lockup'; severity = 1 - front; }
    else if (p.slipRatio && (p.brake ?? 0) > 0.3 && Math.min(p.slipRatio[0], p.slipRatio[1]) < -0.15) { kind = 'lockup'; severity = -Math.min(p.slipRatio[0], p.slipRatio[1]); }
    else if ((p.throttle ?? 0) > 0.5 && rear > 1.12) { kind = 'wheelspin'; severity = rear - 1; }
    if (!kind) { if (p.t - lastT > 500) lastKind = null; continue; }
    if (kind === lastKind && p.t - lastT < 800) { lastT = p.t; continue; } // same event continuing
    lastKind = kind; lastT = p.t;
    const s = p.s ?? -1;
    const corner = model && s >= 0 ? nearestCorner(model, s) : null;
    out.push({ kind, lap: lap.number, s, corner, severity, t: p.t });
  }
  return out;
}

export function nearestCorner(model: TrackModel, s: number): number | null {
  let best: number | null = null, bestD = Infinity;
  const L = model.length;
  for (const c of model.corners) {
    const sEnd = c.sEnd < c.sStart ? c.sEnd + L : c.sEnd;           // corner wrapping the start line
    const sq = s < c.sStart - 150 && sEnd >= L ? s + L : s;          // sample just past the line belongs to it
    const d = sq >= c.sStart - 150 && sq <= sEnd + 100 ? 0 : Math.min(Math.abs(sq - c.sStart), Math.abs(sq - sEnd));
    if (d < bestD) { bestD = d; best = c.index; }
  }
  return bestD < 120 ? best : null;
}

export function buildFingerprint(laps: Lap[], model: TrackModel, assists: { tc: number | null; abs: boolean | null }): Fingerprint {
  const usable = laps.filter((l) => l.ch && l.timeMs > 0 && l.valid !== false);
  const mistakes = laps.flatMap((l) => detectMistakes(l, model));
  const corners: CornerStats[] = [];
  for (const c of model.corners) {
    const ms = usable.map((l) => ({ lap: l, m: cornerMetrics(l, c, model.length) })).filter((x): x is { lap: Lap; m: CornerMetrics } => x.m !== null);
    if (ms.length === 0) continue;
    const best = ms.reduce((a, b) => (b.m.timeMs < a.m.timeMs ? b : a)).m;
    const bp = ms.map((x) => x.m.brakePointM).filter((v): v is number => v !== null);
    const rel = ms.map((x) => x.m.brakeReleaseM).filter((v): v is number => v !== null);
    corners.push({
      corner: c.index, laps: ms.length, best,
      meanTimeMs: mean(ms.map((x) => x.m.timeMs)), stdTimeMs: std(ms.map((x) => x.m.timeMs)),
      meanBrakePointM: bp.length ? mean(bp) : null, stdBrakePointM: bp.length ? std(bp) : null,
      meanMinSpeed: mean(ms.map((x) => x.m.minSpeed)), meanCoastingM: mean(ms.map((x) => x.m.coastingM)),
      trailBraking: rel.length > 0 && mean(rel) > 5,
      lockups: mistakes.filter((m) => m.kind === 'lockup' && m.corner === c.index).length,
      wheelspins: mistakes.filter((m) => m.kind === 'wheelspin' && m.corner === c.index).length,
    });
  }
  const times = usable.map((l) => l.timeMs);
  const best = times.length ? Math.min(...times) : null;
  const lapStd = times.length >= 2 ? std(times) : null;
  // 100 at std = 0; 0 at std = 1 % of the best lap
  const consistency = best !== null && lapStd !== null ? Math.max(0, Math.min(100, 100 * (1 - lapStd / (best * 0.01)))) : null;
  const tcInterventions = laps.reduce((n, l) => n + l.samples.filter((p) => p.tcActive === true || (p.throttleRaw !== null && p.throttle !== null && p.throttleRaw - p.throttle > 0.15)).length, 0);
  return { trackId: model.id, lapsAnalysed: usable.length, lapTimeStdMs: lapStd, consistencyScore: consistency, corners, mistakes, assists: { ...assists, tcInterventions } };
}
