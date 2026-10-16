// Parametric closed track for the synthetic generator: a list of straights and arcs, sampled at 1 m.
// The loop is closed by construction when the arc angles sum to 2π and the geometry returns to the origin;
// we do not require exact closure (the generator wraps on total length), only a sensible shape.

export type Segment = { kind: 'straight'; length: number } | { kind: 'arc'; radius: number; angleDeg: number; name?: string };

export interface TrackPoint { s: number; x: number; z: number; heading: number; curvature: number }

export interface SynthTrack {
  name: string;
  length: number;
  points: TrackPoint[]; // one per metre
  corners: { name: string; sStart: number; sEnd: number; radius: number; sApex: number }[];
  /** map arc-length (any real) → point, wrapping */
  at(s: number): TrackPoint;
}

export function buildTrack(name: string, segments: Segment[]): SynthTrack {
  const points: TrackPoint[] = [];
  const corners: SynthTrack['corners'] = [];
  let x = 0, z = 0, heading = 0, s = 0;
  let cornerIdx = 0;
  const push = (curv: number) => { points.push({ s, x, z, heading, curvature: curv }); };
  for (const seg of segments) {
    if (seg.kind === 'straight') {
      for (let i = 0; i < seg.length; i++) { push(0); x += Math.cos(heading); z += Math.sin(heading); s += 1; }
    } else {
      const sign = Math.sign(seg.angleDeg) || 1;
      const total = Math.abs(seg.angleDeg) * Math.PI / 180;
      const len = Math.round(total * seg.radius);
      const dTheta = total / len;
      const sStart = s;
      for (let i = 0; i < len; i++) {
        push(sign / seg.radius);
        // advance along the arc by 1 m: rotate heading by half step, move, rotate other half
        heading += sign * dTheta / 2; x += Math.cos(heading); z += Math.sin(heading); heading += sign * dTheta / 2; s += 1;
      }
      cornerIdx++;
      corners.push({ name: seg.name ?? `T${cornerIdx}`, sStart, sEnd: s, radius: seg.radius, sApex: (sStart + s) / 2 });
    }
  }
  // Close the loop exactly: distribute the end-to-start gap linearly over the lap (a slight shear),
  // then re-parametrise by true arc length so `s` is geometric distance again.
  const n0 = points.length;
  const end = points[n0 - 1]!;
  const gx = -(end.x + Math.cos(end.heading)), gz = -(end.z + Math.sin(end.heading));
  for (let i = 0; i < n0; i++) { const f = (i + 1) / n0; points[i]!.x += gx * f; points[i]!.z += gz * f; }
  const cum = new Float64Array(n0 + 1);
  for (let i = 1; i <= n0; i++) { const a = points[i - 1]!, b = points[i % n0]!; cum[i] = cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z); }
  const length = Math.round(cum[n0]!);
  const re: TrackPoint[] = [];
  let j = 0;
  for (let si = 0; si < length; si++) {
    while (j < n0 - 1 && cum[j + 1]! <= si) j++;
    const a = points[j]!, b = points[(j + 1) % n0]!;
    const f = (si - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
    re.push({ s: si, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(b.z - a.z, b.x - a.x), curvature: a.curvature });
  }
  const remap = (sOld: number) => cum[Math.min(n0, Math.max(0, Math.round(sOld)))]!;
  for (const c of corners) { c.sStart = remap(c.sStart); c.sEnd = remap(c.sEnd); c.sApex = (c.sStart + c.sEnd) / 2; }
  points.length = 0; points.push(...re);
  return {
    name, length, points, corners,
    at(sq: number) {
      let m = sq % length; if (m < 0) m += length;
      const i = Math.floor(m);
      const p = points[i]!, q = points[(i + 1) % length]!;
      const f = m - i;
      return { s: m, x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, heading: p.heading, curvature: p.curvature };
    },
  };
}

/** A 4.2 km test circuit with 10 corners of varied radius, roughly closed. */
export function defaultTrack(): SynthTrack {
  return buildTrack('synth-gp', [
    { kind: 'straight', length: 700 },
    { kind: 'arc', radius: 60, angleDeg: 95 },      // T1 medium right-hander
    { kind: 'straight', length: 250 },
    { kind: 'arc', radius: 35, angleDeg: 80 },      // T2 slow
    { kind: 'straight', length: 180 },
    { kind: 'arc', radius: 150, angleDeg: -60 },    // T3 fast left
    { kind: 'straight', length: 400 },
    { kind: 'arc', radius: 25, angleDeg: 110 },     // T4 hairpin-ish
    { kind: 'straight', length: 300 },
    { kind: 'arc', radius: 90, angleDeg: -70 },     // T5
    { kind: 'straight', length: 150 },
    { kind: 'arc', radius: 45, angleDeg: 75 },      // T6
    { kind: 'straight', length: 500 },
    { kind: 'arc', radius: 200, angleDeg: -45 },    // T7 very fast kink
    { kind: 'straight', length: 200 },
    { kind: 'arc', radius: 30, angleDeg: 90 },      // T8
    { kind: 'straight', length: 220 },
    { kind: 'arc', radius: 70, angleDeg: 60 },      // T9
    { kind: 'straight', length: 260 },
    { kind: 'arc', radius: 55, angleDeg: 25 },      // T10 onto the straight (angles sum to 360)
  ]);
}
