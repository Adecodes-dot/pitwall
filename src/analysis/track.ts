// Track model: centre-line learned from one clean lap of positions, with curvature-based corner
// detection and a projection from world xz to lap distance. See ARCHITECTURE.md §6.
// Method after curvature-peak segmentation (SciTePress 2024) and Perantoni & Limebeer (2015), simplified:
// resample by arc length at 1 m → smooth → heading → curvature → thresholded regions with hysteresis.

export interface Corner {
  index: number;        // 1-based, in driving order from start/finish
  name: string;         // "T1"
  sStart: number;       // metres along lap
  sEnd: number;
  sApex: number;        // max |curvature|
  minRadius: number;    // metres
  direction: 'left' | 'right';
}

export interface TrackModel {
  id: string;           // "f1:suzuka" or "gt7:fp-<hash>"
  game: 'f1' | 'gt7';
  name: string | null;
  length: number;       // metres (1 m grid, points.length === round(length))
  xs: Float32Array;     // centre-line x per metre
  zs: Float32Array;
  curvature: Float32Array; // signed, 1/m (positive = left in a right-handed xz frame with heading atan2(dz,dx))
  corners: Corner[];
  /** lap-length in metres, bounding box and lap direction: used to recognise the track again */
  fingerprint: { length: number; bbox: [number, number, number, number]; clockwise: boolean };
  lapsUsed: number;
  version: number;
}

export interface TrackBuildOptions {
  /** curvature to enter a corner, 1/m (default 1/320, i.e. radius under 320 m) */
  kEnter?: number;
  /** curvature to leave a corner, fraction of kEnter (default 0.6) */
  kExitRatio?: number;
  /** merge same-direction corners whose below-threshold gap is shorter than this, m (double apex) */
  mergeGapM?: number;
  /** drop corners shorter than this, m */
  minLengthM?: number;
  /** gaussian smoothing sigma for heading, m */
  smoothSigmaM?: number;
}

const DEF: Required<TrackBuildOptions> = { kEnter: 1 / 320, kExitRatio: 0.6, mergeGapM: 25, minLengthM: 12, smoothSigmaM: 7 };

export interface PositionSample { x: number; z: number }

/**
 * Build a model from the positions of one lap (first sample just after the line, last just before it).
 * Positions need not be evenly spaced; they are resampled by chord length.
 */
export function buildTrackModel(samples: PositionSample[], meta: { game: 'f1' | 'gt7'; name?: string | null; id?: string }, opts: TrackBuildOptions = {}): TrackModel {
  const o = { ...DEF, ...opts };
  if (samples.length < 50) throw new Error('buildTrackModel: too few samples');
  // 1. cumulative chord length, closing the loop back to the first sample
  const pts = samples.concat([samples[0]!]);
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z);
  const L = Math.round(cum[pts.length - 1]!);
  if (L < 200) throw new Error('buildTrackModel: lap too short');
  // 2. resample at 1 m
  const xs = new Float32Array(L), zs = new Float32Array(L);
  let j = 0;
  for (let s = 0; s < L; s++) {
    while (j < pts.length - 2 && cum[j + 1]! < s) j++;
    const a = pts[j]!, b = pts[j + 1]!;
    const span = cum[j + 1]! - cum[j]!;
    const f = span > 0 ? (s - cum[j]!) / span : 0;
    xs[s] = a.x + (b.x - a.x) * f; zs[s] = a.z + (b.z - a.z) * f;
  }
  // 3. smooth positions (circular gaussian) so heading differences are not dominated by sampling noise
  const sx = gaussCircular(xs, o.smoothSigmaM), sz = gaussCircular(zs, o.smoothSigmaM);
  // 4. heading from central differences over ±3 m, unwrapped; curvature = dθ/ds over ±3 m
  const h = 3;
  const theta = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    const a = (i - h + L) % L, b = (i + h) % L;
    theta[i] = Math.atan2(sz[b]! - sz[a]!, sx[b]! - sx[a]!);
  }
  for (let i = 1; i < L; i++) { let d = theta[i]! - theta[i - 1]!; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; theta[i] = theta[i - 1]! + d; }
  const curvature = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const a = i - h, b = i + h;
    const ta = a < 0 ? theta[a + L]! - 2 * Math.PI * Math.sign(theta[L - 1]! - theta[0]!) : theta[a]!;
    const tb = b >= L ? theta[b - L]! + 2 * Math.PI * Math.sign(theta[L - 1]! - theta[0]!) : theta[b]!;
    curvature[i] = (tb - ta) / (2 * h);
  }
  const kSm = gaussCircular(curvature, o.smoothSigmaM);
  // 5. corners: hysteresis threshold on |κ|, split on sign change, merge small gaps, drop stubs
  const corners = detectCorners(kSm, L, o);
  const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  const clockwise = theta[L - 1]! - theta[0]! < 0;
  const fp = { length: L, bbox, clockwise };
  const id = meta.id ?? `${meta.game}:${meta.name ?? 'fp-' + fpHash(fp)}`;
  return { id, game: meta.game, name: meta.name ?? null, length: L, xs, zs, curvature: kSm, corners, fingerprint: fp, lapsUsed: 1, version: 1 };
}

function detectCorners(k: Float32Array, L: number, o: Required<TrackBuildOptions>): Corner[] {
  const kExit = o.kEnter * o.kExitRatio;
  // find a start index on a straight so no corner wraps across the array boundary
  let start = 0;
  for (let i = 0; i < L; i++) if (Math.abs(k[i]!) < kExit) { start = i; break; }
  type Raw = { s0: number; s1: number; sign: number };
  const raw: Raw[] = [];
  let cur: Raw | null = null;
  for (let n = 0; n < L; n++) {
    const i = (start + n) % L;
    const v = k[i]!;
    const sign = Math.sign(v);
    if (!cur) {
      if (Math.abs(v) >= o.kEnter) cur = { s0: n, s1: n, sign };
    } else if (Math.abs(v) < kExit || (sign !== cur.sign && Math.abs(v) >= o.kEnter)) {
      cur.s1 = n; raw.push(cur); cur = null;
      if (Math.abs(v) >= o.kEnter) cur = { s0: n, s1: n, sign };
    }
  }
  if (cur) { cur.s1 = L; raw.push(cur); }
  // merge same-direction neighbours separated by a short gap
  const merged: Raw[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && last.sign === r.sign && r.s0 - last.s1 < o.mergeGapM) last.s1 = r.s1; else merged.push({ ...r });
  }
  const out: Corner[] = [];
  for (const r of merged) {
    if (r.s1 - r.s0 < o.minLengthM) continue;
    let apex = r.s0, kmax = 0;
    for (let n = r.s0; n < r.s1; n++) { const v = Math.abs(k[(start + n) % L]!); if (v > kmax) { kmax = v; apex = n; } }
    out.push({ index: 0, name: '', sStart: (start + r.s0) % L, sEnd: (start + r.s1) % L, sApex: (start + apex) % L, minRadius: kmax > 0 ? 1 / kmax : Infinity, direction: r.sign > 0 ? 'left' : 'right' });
  }
  // number in driving order from s = 0
  out.sort((a, b) => a.sStart - b.sStart);
  out.forEach((c, i) => { c.index = i + 1; c.name = `T${i + 1}`; });
  return out;
}

export function gaussCircular(v: ArrayLike<number>, sigma: number): Float32Array {
  const L = v.length, out = new Float32Array(L);
  if (sigma <= 0) { for (let i = 0; i < L; i++) out[i] = v[i]!; return out; }
  const r = Math.ceil(sigma * 3);
  const w = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let d = -r; d <= r; d++) { w[d + r] = Math.exp(-(d * d) / (2 * sigma * sigma)); sum += w[d + r]!; }
  for (let i = 0; i < L; i++) {
    let acc = 0;
    for (let d = -r; d <= r; d++) acc += w[d + r]! * v[(i + d + L) % L]!;
    out[i] = acc / sum;
  }
  return out;
}

function fpHash(fp: TrackModel['fingerprint']): string {
  const s = `${Math.round(fp.length / 10)}:${fp.bbox.map((v) => Math.round(v / 20)).join(',')}:${fp.clockwise ? 'cw' : 'ccw'}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Recognise a track: same length within 3 %, overlapping bounding box (centre within 50 m), same direction. */
export function matchTrack(models: TrackModel[], fp: TrackModel['fingerprint']): TrackModel | null {
  for (const m of models) {
    const f = m.fingerprint;
    if (Math.abs(f.length - fp.length) / fp.length > 0.03) continue;
    if (f.clockwise !== fp.clockwise) continue;
    const cx = (f.bbox[0] + f.bbox[2]) / 2, cz = (f.bbox[1] + f.bbox[3]) / 2;
    const dx = (fp.bbox[0] + fp.bbox[2]) / 2, dz = (fp.bbox[1] + fp.bbox[3]) / 2;
    if (Math.hypot(cx - dx, cz - dz) > 50) continue;
    return m;
  }
  return null;
}

/** Projection of world xz onto the centre-line → lap distance s and lateral offset. Uses a windowed search around a hint. */
export class Projector {
  private grid = new Map<string, number[]>();
  private cell = 25;
  readonly model: TrackModel;
  constructor(model: TrackModel) {
    this.model = model;
    for (let i = 0; i < model.length; i++) {
      const key = this.key(model.xs[i]!, model.zs[i]!);
      let arr = this.grid.get(key); if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(i);
    }
  }
  private key(x: number, z: number): string { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }

  /** @returns s in [0, L) and the distance from the line; hint = last known s for a fast local search */
  project(x: number, z: number, hint: number | null): { s: number; dist: number } {
    const L = this.model.length;
    let best = -1, bestD = Infinity;
    const consider = (i: number) => { const d = (this.model.xs[i]! - x) ** 2 + (this.model.zs[i]! - z) ** 2; if (d < bestD) { bestD = d; best = i; } };
    if (hint !== null) {
      const h = Math.round(hint);
      for (let d = -60; d <= 150; d++) consider(((h + d) % L + L) % L);
    }
    if (best < 0 || bestD > 30 * 30) {
      bestD = Infinity; best = -1;
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of this.grid.get(`${cx + a},${cz + b}`) ?? []) consider(i);
      if (best < 0) for (let i = 0; i < L; i += 5) consider(i);
    }
    // refine: project onto the segment between best and its better neighbour
    const i0 = best, i1 = (best + 1) % L, im = (best - 1 + L) % L;
    const seg = (a: number, b: number) => {
      const ax = this.model.xs[a]!, az = this.model.zs[a]!, bx = this.model.xs[b]!, bz = this.model.zs[b]!;
      const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
      const px = ax + vx * t, pz = az + vz * t;
      return { t, d: Math.hypot(x - px, z - pz) };
    };
    const f = seg(i0, i1), g = seg(im, i0);
    if (g.d < f.d) return { s: (im + g.t) % L, dist: g.d };
    return { s: (i0 + f.t) % L, dist: f.d };
  }
}

export function serializeTrack(m: TrackModel): string {
  return JSON.stringify({ ...m, xs: Array.from(m.xs), zs: Array.from(m.zs), curvature: Array.from(m.curvature) });
}
export function deserializeTrack(json: string): TrackModel {
  const o = JSON.parse(json) as Omit<TrackModel, 'xs' | 'zs' | 'curvature'> & { xs: number[]; zs: number[]; curvature: number[] };
  return { ...o, xs: Float32Array.from(o.xs), zs: Float32Array.from(o.zs), curvature: Float32Array.from(o.curvature) };
}

/** SVG track map with numbered corners (used by the demo and the UI). */
export function trackMapSvg(m: TrackModel, opts: { width?: number; highlight?: number[] } = {}): string {
  const W = opts.width ?? 600;
  const [x0, z0, x1, z1] = m.fingerprint.bbox;
  const pad = 30;
  const scale = (W - 2 * pad) / Math.max(x1 - x0, z1 - z0, 1);
  const H = Math.round((z1 - z0) * scale + 2 * pad);
  const px = (x: number) => pad + (x - x0) * scale, pz = (z: number) => pad + (z - z0) * scale;
  let d = '';
  for (let i = 0; i < m.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${px(m.xs[i]!).toFixed(1)} ${pz(m.zs[i]!).toFixed(1)} `;
  d += 'Z';
  const corners = m.corners.map((c) => {
    const i = Math.round(c.sApex) % m.length;
    const hl = opts.highlight?.includes(c.index);
    return `<circle cx="${px(m.xs[i]!).toFixed(1)}" cy="${pz(m.zs[i]!).toFixed(1)}" r="9" fill="${hl ? '#ff4d4f' : '#171a1f'}" stroke="#4da3ff" stroke-width="1.5"/><text x="${px(m.xs[i]!).toFixed(1)}" y="${(pz(m.zs[i]!) + 3.5).toFixed(1)}" font-size="9" text-anchor="middle" fill="#e8eaed" font-family="Inter, sans-serif">${c.index}</text>`;
  }).join('');
  const sf = `<circle cx="${px(m.xs[0]!).toFixed(1)}" cy="${pz(m.zs[0]!).toFixed(1)}" r="4" fill="#2ecc71"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0f1114"/><path d="${d}" fill="none" stroke="#9aa3ad" stroke-width="3" stroke-linejoin="round"/>${sf}${corners}</svg>`;
}
