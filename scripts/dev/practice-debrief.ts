// Practice debrief from one or more captures of the same session (the app was restarted mid-session).
import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
import { buildDebrief, debriefHtml } from '../../src/debrief/debrief.ts';
import { writeFileSync } from 'node:fs';
const [out, ...files] = process.argv.slice(2);
const an = new SessionAnalyser(null); const ad = new F1Adapter();
for (const file of files) {
  const { records } = readPwcap(file);
  const take = (o: ReturnType<F1Adapter['feed']>) => { for (const f of o.frames) an.onFrame(f); for (const e of o.events) an.onEvent(e); };
  for (const r of records) take(ad.feed(r.data, r.t));
  take(ad.tick(1e12));
}
const d = buildDebrief(an, null)!;
writeFileSync(out!, debriefHtml(d));
const u = an.lastUpdate!;
console.log(`model ${an.model!.length} m ${an.model!.corners.length} corners; laps ${u.laps.map((l) => (l.timeMs / 1000).toFixed(3)).join(' ')}; pb ${u.pbMs} theo ${Math.round(u.theoreticalMs ?? 0)}; traced ${an.collector.laps.filter((l) => l.ch).length}`);
console.log('drill', JSON.stringify((d as any).drill), 'top3', (d as any).topCorners?.map((c: any) => c.name).join(','));
