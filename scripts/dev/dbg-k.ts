import { buildTrackModel } from '../../src/analysis/track.ts';
import { streetTrack } from '../../src/synth/tracks.ts';
import { generateSession } from '../../src/synth/driver.ts';
const tr = streetTrack();
const sess = generateSession(tr, 2, { seed: 4 });
const lap2 = sess.samples.filter((s) => s.lap === 2);
const m = buildTrackModel(lap2.map((s) => ({ x: s.x, z: s.z })), { game: 'gt7' });
let line = '';
for (let s = 2100; s < 2340; s += 10) line += `${s}:${(m.curvature[s]! * 1000).toFixed(2)} `;
console.log('k*1000 model:', line);
line = '';
for (let s = 2100; s < 2340; s += 10) line += `${s}:${(tr.points[s]!.curvature * 1000).toFixed(2)} `;
console.log('k*1000 gen  :', line);
// spacing of samples in that region
const seg = lap2.filter((p) => p.s > 2100 && p.s < 2340);
console.log('samples in region', seg.length, 'mean spacing', ((2340 - 2100) / seg.length).toFixed(2), 'speed', seg.map(p=>p.v.toFixed(0)).slice(0,30).join(' '));
