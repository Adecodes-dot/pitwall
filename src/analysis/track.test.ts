import { describe, expect, it } from 'vitest';
import { buildTrackModel, matchTrack, Projector, serializeTrack, deserializeTrack, trackMapSvg } from './track.ts';
import { defaultTrack } from '../synth/track.ts';
import { streetTrack, fastTrack } from '../synth/tracks.ts';
import { generateSession } from '../synth/driver.ts';

const cases = [
  { name: 'synth-gp', track: defaultTrack(), corners: 10 },
  { name: 'synth-street', track: streetTrack(), corners: 14 },
  { name: 'synth-fast', track: fastTrack(), corners: 6 },
];

describe('corner detection on 3 synthetic tracks (driven at 60 Hz, lap 2 positions)', () => {
  for (const c of cases) {
    it(`${c.name}: finds ${c.corners} corners`, () => {
      const sess = generateSession(c.track, 2, { seed: 4 });
      const lap2 = sess.samples.filter((s) => s.lap === 2);
      const model = buildTrackModel(lap2.map((s) => ({ x: s.x, z: s.z })), { game: 'gt7', name: c.name });
      expect(model.corners.map((k) => k.name)).toHaveLength(c.corners);
      expect(Math.abs(model.length - c.track.length)).toBeLessThan(c.track.length * 0.01);
      // corners numbered in driving order; each detected corner overlaps the generator's arc (the synthetic
      // loop-closure shear distorts radii, so radius is only checked loosely)
      const gen = c.track.corners;
      model.corners.forEach((k, i) => {
        expect(k.index).toBe(i + 1);
        const sEnd = k.sEnd < k.sStart ? k.sEnd + model.length : k.sEnd; // corner may wrap the start line
        expect(k.sStart).toBeLessThan(gen[i]!.sEnd);
        expect(sEnd).toBeGreaterThan(gen[i]!.sStart);
        expect(Math.abs((k.sStart + sEnd) / 2 - gen[i]!.sApex)).toBeLessThan(30);
        expect(k.minRadius).toBeGreaterThan(gen[i]!.radius / 3);
        expect(k.minRadius).toBeLessThan(gen[i]!.radius * 3);
      });
    });
  }
});

describe('projection and fingerprint', () => {
  const sess = generateSession(defaultTrack(), 3, { seed: 4 });
  const lap2 = sess.samples.filter((s) => s.lap === 2);
  const model = buildTrackModel(lap2.map((s) => ({ x: s.x, z: s.z })), { game: 'gt7' });

  it('projects lap 3 positions back to lap distance within 2 m', () => {
    const proj = new Projector(model);
    let hint: number | null = null, maxErr = 0;
    for (const s of sess.samples.filter((x) => x.lap === 3)) {
      const r = proj.project(s.x, s.z, hint);
      hint = r.s;
      // the model's s=0 is lap 2's first sample, a few metres past the line; align on that offset
      const err = Math.abs(((r.s + lap2[0]!.s) % model.length) - s.s);
      maxErr = Math.max(maxErr, Math.min(err, model.length - err));
      expect(r.dist).toBeLessThan(2);
    }
    expect(maxErr).toBeLessThan(2);
  });

  it('recognises itself and rejects a different track', () => {
    const other = buildTrackModel(generateSession(streetTrack(), 2, { seed: 4 }).samples.filter((s) => s.lap === 2).map((s) => ({ x: s.x, z: s.z })), { game: 'gt7' });
    expect(matchTrack([other, model], model.fingerprint)).toBe(model);
    expect(matchTrack([model], other.fingerprint)).toBeNull();
  });

  it('serialises round-trip and renders an SVG', () => {
    const back = deserializeTrack(serializeTrack(model));
    expect(back.corners).toEqual(model.corners);
    expect(back.xs.length).toBe(model.length);
    const svg = trackMapSvg(model);
    expect(svg).toContain('<path');
    expect((svg.match(/<circle/g) ?? []).length).toBe(model.corners.length + 1);
  });
});

describe('radius accuracy on exactly closed loops (no synthetic shear)', () => {
  // positions sampled every 0.7 m along perfect geometry
  function sample(fn: (s: number) => [number, number], L: number): { x: number; z: number }[] {
    const out = []; for (let s = 0; s < L; s += 0.7) { const [x, z] = fn(s); out.push({ x, z }); } return out;
  }
  it('stadium: two 180° arcs of R=50 → 2 corners, radius within 10 %', () => {
    const R = 50, A = 600, L = 2 * A + 2 * Math.PI * R;
    const pts = sample((s) => {
      if (s < A) return [s, 0];
      if (s < A + Math.PI * R) { const a = (s - A) / R; return [A + R * Math.sin(a), R - R * Math.cos(a)]; }
      if (s < 2 * A + Math.PI * R) return [A - (s - A - Math.PI * R), 2 * R];
      const a = (s - 2 * A - Math.PI * R) / R; return [-R * Math.sin(a), R + R * Math.cos(a)];
    }, L);
    const m = buildTrackModel(pts, { game: 'f1' });
    expect(m.corners).toHaveLength(2);
    for (const c of m.corners) { expect(c.minRadius).toBeGreaterThan(R * 0.9); expect(c.minRadius).toBeLessThan(R * 1.1); expect(c.direction).toBe('left'); }
    expect(Math.abs(m.length - L)).toBeLessThan(3);
  });
  it('rounded square: four 90° arcs of R=35 → 4 corners, radius within 10 %', () => {
    const R = 35, A = 400, q = Math.PI * R / 2, L = 4 * (A + q);
    const pts = sample((s) => {
      const k = Math.floor(s / (A + q)), u = s - k * (A + q);
      // local: straight along +x then quarter-arc turning left; rotate by k*90°
      let x: number, z: number;
      if (u < A) { x = u; z = 0; } else { const a = (u - A) / R; x = A + R * Math.sin(a); z = R - R * Math.cos(a); }
      // translate so each segment starts where the previous ended, then rotate
      const cx = A + R, cz = R; // end of local segment relative to its start is (A+R, R)
      const rot = (px: number, pz: number, n: number) => { for (let i = 0; i < n; i++) { const t = px; px = -pz; pz = t; } return [px, pz] as [number, number]; };
      let [ox, oz] = [0, 0];
      for (let i = 0; i < k; i++) { const [dx, dz] = rot(cx, cz, i); ox += dx; oz += dz; }
      const [rx, rz] = rot(x, z, k);
      return [ox + rx, oz + rz];
    }, L);
    const m = buildTrackModel(pts, { game: 'f1' });
    expect(m.corners).toHaveLength(4);
    for (const c of m.corners) { expect(c.minRadius).toBeGreaterThan(R * 0.9); expect(c.minRadius).toBeLessThan(R * 1.1); }
  });
});
