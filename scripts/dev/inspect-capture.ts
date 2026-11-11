import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { decodeF1 } from '../../src/adapters/f1/codec.ts';
const path = process.argv[2]!;
const { meta, records } = readPwcap(path);
console.log('meta', JSON.stringify(meta), 'records', records.length);
const ad = new F1Adapter();
const idCount: Record<string, number> = {}; const kinds: Record<string, number> = {}; const errs: Record<string, number> = {};
let frames = 0, lapNull = 0, onTrackNull = 0, firstFrame: unknown = null, firstWithLap: unknown = null; const events: string[] = [];
for (const r of records) {
  const d = decodeF1(r.data);
  if ('error' in d) { const k = `${d.error}:${'packetId' in d ? d.packetId : ''}:len${d.length}`; errs[k] = (errs[k] ?? 0) + 1; }
  else { const k = d.kind; kinds[k] = (kinds[k] ?? 0) + 1; }
  const o = ad.feed(r.data, r.t);
  for (const e of o.events) if (events.length < 40) events.push(`${(r.t/1000).toFixed(1)}s ${JSON.stringify(e)}`);
  for (const f of o.frames) { frames++; if (f.lap.number === null) lapNull++; if (f.flags.onTrack === null) onTrackNull++; if (!firstFrame) firstFrame = f; if (!firstWithLap && f.lap.number !== null) firstWithLap = f; }
}
console.log('kinds', JSON.stringify(kinds)); console.log('errors', JSON.stringify(errs));
console.log('frames', frames, 'lapNull', lapNull, 'onTrackNull', onTrackNull, 'adapter stats', JSON.stringify(ad.stats));
console.log('events', events.join('\n'));
console.log('first frame lap', JSON.stringify((firstFrame as any)?.lap), 'flags', JSON.stringify((firstFrame as any)?.flags));
console.log('first with lap', JSON.stringify((firstWithLap as any)?.lap));
