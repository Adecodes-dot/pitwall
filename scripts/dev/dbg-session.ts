import { defaultTrack } from '../../src/synth/track.ts';
import { generateSession } from '../../src/synth/driver.ts';
import { synthRecords } from '../../src/synth/emit.ts';
import { Gt7Adapter } from '../../src/adapters/gt7/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
import { buildTrackModel } from '../../src/analysis/track.ts';
const track = defaultTrack();
const sess = generateSession(track, 4, { seed: 9, brakeJitterM: 12, speedJitter: 0.05 });
const recs = synthRecords(sess, 'gt7', { format: '~' });
const adapter = new Gt7Adapter();
const an = new SessionAnalyser(null);
let evs: string[] = [];
for (const r of recs) {
  const o = adapter.feed(r.data, r.t);
  for (const f of o.frames) an.onFrame(f);
  for (const e of o.events) { evs.push(e.type + ('lapNumber' in e ? e.lapNumber + ':' + e.timeMs : '')); an.onEvent(e); }
}
console.log('events', evs.join(' '));
console.log('laps', an.collector.laps.map((l) => `${l.number}:${l.timeMs}:${l.samples.length}:${l.ch ? 'ch' : 'noch'}`).join(' '));
console.log('model', an.model ? an.model.corners.length : null);
const l1 = an.collector.laps[0];
if (l1) {
  const pts = l1.samples.filter((s) => s.x !== null).map((s) => ({ x: s.x!, z: s.z! }));
  console.log('pts', pts.length, 'first', pts[0], 'last', pts[pts.length - 1]);
  try { const m = buildTrackModel(pts, { game: 'gt7' }); console.log('built ok', m.length, m.corners.length); } catch (e) { console.log('build error', (e as Error).message); }
}
