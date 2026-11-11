import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
const { records } = readPwcap(process.argv[2]!);
const ad = new F1Adapter();
let prev = ''; let count = 0; let t0 = 0;
const out = (o: ReturnType<F1Adapter['feed']>) => {
  for (const e of o.events) console.log(`  ${(e.t / 1000).toFixed(1)}s EVENT ${JSON.stringify(e)}`);
  for (const f of o.frames) {
    const key = `lap=${f.lap.number} onTrack=${f.flags.onTrack} pit=${f.flags.pitting} valid=${f.lap.valid}`;
    if (key !== prev) { if (prev) console.log(`${(t0 / 1000).toFixed(1)}s  ${prev}  x${count}  (curLapMs ${f.lap.currentTimeMs}, dist ${f.lap.distance?.toFixed(0)}, ${(f.speed! * 3.6).toFixed(0)} km/h)`); prev = key; count = 0; t0 = f.t; }
    count++;
  }
};
for (const r of records) out(ad.feed(r.data, r.t));
out(ad.tick(1e12));
console.log(`${(t0 / 1000).toFixed(1)}s  ${prev}  x${count}`);
