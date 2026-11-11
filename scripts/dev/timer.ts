import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
const { records } = readPwcap(process.argv[2]!);
const ad = new F1Adapter(); let next = 0;
for (const r of records) for (const f of ad.feed(r.data, r.t).frames) {
  if (f.lap.number === null || f.t < next || f.t < Number(process.argv[3] ?? 0) || f.t > Number(process.argv[4] ?? 1e12)) continue; next = f.t + Number(process.argv[5] ?? 5000);
  console.log(`${(f.t / 1000).toFixed(0)}s lap ${f.lap.number} cur ${f.lap.currentTimeMs} dist ${f.lap.distance?.toFixed(0)} onTrack ${f.flags.onTrack} pit ${f.flags.pitting} ${(f.speed! * 3.6).toFixed(0)}km/h`);
}
