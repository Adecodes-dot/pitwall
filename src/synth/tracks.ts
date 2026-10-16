// Additional synthetic circuits with known corner counts for the M2 corner-detection check.
import { buildTrack, type SynthTrack } from './track.ts';

/** Street circuit: tight chicanes (opposite-sign arcs back to back) and 90° blocks. 14 corners. */
export function streetTrack(): SynthTrack {
  return buildTrack('synth-street', [
    { kind: 'straight', length: 550 },
    { kind: 'arc', radius: 40, angleDeg: 90 },       // T1
    { kind: 'straight', length: 220 },
    { kind: 'arc', radius: 30, angleDeg: -45 },      // T2 chicane
    { kind: 'arc', radius: 30, angleDeg: 45 },       // T3
    { kind: 'straight', length: 300 },
    { kind: 'arc', radius: 35, angleDeg: 90 },       // T4
    { kind: 'straight', length: 180 },
    { kind: 'arc', radius: 20, angleDeg: 180 },      // T5 hairpin
    { kind: 'straight', length: 260 },
    { kind: 'arc', radius: 45, angleDeg: -90 },      // T6
    { kind: 'straight', length: 150 },
    { kind: 'arc', radius: 28, angleDeg: 50 },       // T7 chicane
    { kind: 'arc', radius: 28, angleDeg: -50 },      // T8
    { kind: 'straight', length: 320 },
    { kind: 'arc', radius: 60, angleDeg: 90 },       // T9
    { kind: 'straight', length: 120 },
    { kind: 'arc', radius: 40, angleDeg: 90 },       // T10
    { kind: 'straight', length: 400 },
    { kind: 'arc', radius: 25, angleDeg: -120 },     // T11
    { kind: 'straight', length: 140 },
    { kind: 'arc', radius: 50, angleDeg: 60 },       // T12
    { kind: 'straight', length: 200 },
    { kind: 'arc', radius: 35, angleDeg: -80 },      // T13
    { kind: 'straight', length: 90 },
    { kind: 'arc', radius: 70, angleDeg: 50 },       // T14 (angles: 90-45+45+90+180-90+50-50+90+90-120+60-80+50 = 360)
    { kind: 'straight', length: 300 },
  ]);
}

/** Fast flowing circuit: long straights, big radii; one 260 m sweeper that must still count. 6 corners. */
export function fastTrack(): SynthTrack {
  return buildTrack('synth-fast', [
    { kind: 'straight', length: 1100 },
    { kind: 'arc', radius: 80, angleDeg: 100 },      // T1
    { kind: 'straight', length: 600 },
    { kind: 'arc', radius: 260, angleDeg: 40 },      // T2 sweeper
    { kind: 'straight', length: 400 },
    { kind: 'arc', radius: 55, angleDeg: 120 },      // T3
    { kind: 'straight', length: 700 },
    { kind: 'arc', radius: 120, angleDeg: -60 },     // T4
    { kind: 'straight', length: 500 },
    { kind: 'arc', radius: 45, angleDeg: 90 },       // T5
    { kind: 'straight', length: 350 },
    { kind: 'arc', radius: 90, angleDeg: 70 },       // T6 (100+40+120-60+90+70 = 360)
    { kind: 'straight', length: 400 },
  ]);
}
