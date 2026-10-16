// Synthetic driver: a point-mass lap model with per-corner parameters, producing 60 Hz samples.
// Deterministic for a given seed so tests are reproducible. Lap times are returned as ground truth.
import type { SynthTrack } from './track.ts';

export interface DriverParams {
  /** lateral grip limit, m/s² (sets corner speed = sqrt(aLat * R)) */
  aLat: number;
  /** braking decel, m/s² */
  aBrake: number;
  /** peak longitudinal accel at low speed, m/s² */
  aAccel: number;
  /** top speed, m/s */
  vMax: number;
  /** per-lap randomness: brake point jitter (m) and corner-speed jitter (fraction) */
  brakeJitterM: number;
  speedJitter: number;
  /** coasting between brake release and throttle, seconds */
  coastS: number;
  seed: number;
}

export const defaultDriver: DriverParams = { aLat: 14, aBrake: 28, aAccel: 11, vMax: 88, brakeJitterM: 8, speedJitter: 0.03, coastS: 0.15, seed: 1 };

export interface Sample {
  /** seconds since session start */
  t: number;
  lap: number;         // 1-based, 0 = out lap before the line
  s: number;           // lap distance, m
  x: number; z: number; heading: number;
  v: number;           // m/s
  throttle: number;    // 0..1
  brake: number;       // 0..1
  steer: number;       // -1..1
  gear: number;
  rpm: number;
  lapTimeMs: number;   // current lap time
  curvature: number;
}

export interface SynthSession {
  samples: Sample[];
  /** ground-truth lap times for laps 1..N, ms */
  lapTimesMs: number[];
  track: SynthTrack;
  hz: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Compute the speed profile v(s) for one lap: forward accel pass and backward braking pass over the 1 m grid. */
function speedProfile(track: SynthTrack, p: DriverParams, rnd: () => number): Float64Array {
  const L = track.length;
  const vLimit = new Float64Array(L);
  // corner speed limits with per-lap jitter per corner
  const jitter = track.corners.map(() => 1 + (rnd() * 2 - 1) * p.speedJitter);
  for (let i = 0; i < L; i++) {
    const k = Math.abs(track.points[i]!.curvature);
    let v = k > 0 ? Math.sqrt(p.aLat / k) : p.vMax;
    const ci = track.corners.findIndex((c) => i >= c.sStart && i < c.sEnd);
    if (ci >= 0) v *= jitter[ci]!;
    vLimit[i] = Math.min(v, p.vMax);
  }
  // brake-point jitter: shift limits of each corner entry by a few metres
  const shift = track.corners.map(() => Math.round((rnd() * 2 - 1) * p.brakeJitterM));
  const v = new Float64Array(L);
  // backward pass: braking limit, iterate twice around the loop so wrap-around is consistent
  for (let i = 0; i < L; i++) v[i] = vLimit[i]!;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = L - 1; i >= 0; i--) {
      const next = v[(i + 1) % L]!;
      const ci = track.corners.findIndex((c) => (i + 1) % L === c.sStart);
      const extra = ci >= 0 ? shift[ci]! : 0; // positive = brake later (less margin) handled via effective decel
      const aB = p.aBrake * (1 + extra / 200);
      v[i] = Math.min(v[i]!, Math.sqrt(next * next + 2 * aB));
    }
  }
  // forward pass: acceleration limit (decreasing with speed)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < L; i++) {
      const prev = v[(i - 1 + L) % L]!;
      const a = p.aAccel * Math.max(0.15, 1 - prev / p.vMax);
      v[i] = Math.min(v[i]!, Math.sqrt(prev * prev + 2 * a));
    }
  }
  return v;
}

export function generateSession(track: SynthTrack, laps: number, params: Partial<DriverParams> = {}, hz = 60): SynthSession {
  const p = { ...defaultDriver, ...params };
  const rnd = mulberry32(p.seed);
  const samples: Sample[] = [];
  const lapTimesMs: number[] = [];
  const dt = 1 / hz;
  let t = 0;
  // start on the main straight 100 m before the line, rolling
  let s = track.length - 100;
  let lap = 0;
  let lapStartT = 0;
  let profile = speedProfile(track, p, rnd);
  let v = profile[Math.floor(s)]! * 0.8;
  let tailSamples = -1; // after the final crossing, keep emitting for 2 s so adapters see the last lap complete
  while (tailSamples !== 0) {
    const i = Math.floor(s) % track.length;
    const vTarget = profile[i]!;
    const vNext = profile[(i + 1) % track.length]!;
    // longitudinal: aim at profile
    let a = (vTarget - v) / dt;
    const aAccelMax = p.aAccel * Math.max(0.15, 1 - v / p.vMax);
    a = Math.max(-p.aBrake, Math.min(aAccelMax, a));
    const throttle = a > 0.2 ? Math.min(1, a / aAccelMax) : vNext >= v && a > -0.2 ? 0.2 : 0;
    const brake = a < -0.5 ? Math.min(1, -a / p.aBrake) : 0;
    v = Math.max(5, v + a * dt);
    const ds = v * dt;
    const prevS = s;
    s += ds;
    if (s >= track.length) {
      s -= track.length;
      // crossed the line
      const crossFrac = (track.length - prevS) / ds;
      const tCross = t + crossFrac * dt;
      if (lap >= 1) lapTimesMs.push(Math.round((tCross - lapStartT) * 1000));
      lap++;
      lapStartT = tCross;
      profile = speedProfile(track, p, rnd); // new lap, new jitter
      if (lap > laps) tailSamples = 2 * hz;
    }
    const pt = track.at(s);
    const steer = Math.max(-1, Math.min(1, pt.curvature * 40));
    const gear = Math.max(1, Math.min(8, Math.ceil(v / 11)));
    const rpm = 4000 + ((v - (gear - 1) * 11) / 11) * 8000;
    t += dt;
    if (tailSamples > 0) tailSamples--;
    samples.push({ t, lap, s, x: pt.x, z: pt.z, heading: pt.heading, v, throttle, brake, steer, gear, rpm: Math.round(rpm), lapTimeMs: Math.round((t - lapStartT) * 1000), curvature: pt.curvature });
  }
  return { samples, lapTimesMs, track, hz };
}
