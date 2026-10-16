import { buildTrackModel } from '../../src/analysis/track.ts';
import { defaultTrack } from '../../src/synth/track.ts';
import { streetTrack, fastTrack } from '../../src/synth/tracks.ts';
import { generateSession } from '../../src/synth/driver.ts';
for (const tr of [defaultTrack(), streetTrack(), fastTrack()]) {
  const sess = generateSession(tr, 2, { seed: 4 });
  const lap2 = sess.samples.filter((s) => s.lap === 2);
  const m = buildTrackModel(lap2.map((s) => ({ x: s.x, z: s.z })), { game: 'gt7' });
  console.log(tr.name, 'L', tr.length, m.length);
  console.log(' gen:', tr.corners.map((c) => `${c.name}@${Math.round(c.sStart)}-${Math.round(c.sEnd)}R${c.radius}`).join(' '));
  console.log(' det:', m.corners.map((c) => `${c.name}@${Math.round(c.sStart)}-${Math.round(c.sEnd)}R${c.minRadius.toFixed(0)}${c.direction[0]}`).join(' '));
}
