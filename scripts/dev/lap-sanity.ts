// For each traced lap: the fastest 50 m stretch implied by the time channel vs the recorded speed there.
import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
const { records } = readPwcap(process.argv[2]!);
const an = new SessionAnalyser(null); const ad = new F1Adapter(); const laps: any[] = [];
const take = (o: ReturnType<F1Adapter['feed']>) => { for (const f of o.frames) an.onFrame(f); for (const e of o.events) { if (e.type === "session.start") laps.push(...an.collector.laps); an.onEvent(e); } };
for (const r of records) take(ad.feed(r.data, r.t));
laps.push(...an.collector.laps);
for (const l of laps) {
  if (!l.ch) { console.log(`L${l.number} no trace`); continue; }
  const ch = l.ch; let worst = 0, at = 0;
  for (let s = 0; s + 50 < ch.L; s += 50) { const dt = (ch.t[s + 50] - ch.t[s]) / 1000; const v = dt > 0 ? 50 / dt : Infinity; const rec = ch.speed[s + 25]; if (v / Math.max(rec, 1) > worst) { worst = v / Math.max(rec, 1); at = s; } }
  const rs = l.samples.filter((x: any) => x.lapTimeMs !== null);
  let backs = 0; for (let i = 1; i < rs.length; i++) if (rs[i].s !== null && rs[i - 1].s !== null && rs[i].s < rs[i - 1].s - 20) backs++;
  console.log(`L${l.number} ${l.timeMs} worst implied/recorded speed ${worst.toFixed(2)} at ${at} m; distance jumps back ${backs}x; samples ${l.samples.length}`);
}
const { microSectors } = await import('../../src/analysis/laps.ts');
const traced = laps.filter((l: any) => l.ch && l.timeMs > 0);
const ms = microSectors(traced, traced[0].ch.L);
const by: Record<number, number> = {};
for (let b = 0; b < ms.bins; b++) by[ms.bestLap[b]!] = (by[ms.bestLap[b]!] ?? 0) + 1;
console.log('theoretical all traced', (ms.theoreticalMs / 1000).toFixed(3), 'best bins per lap', JSON.stringify(by));
for (const excl of [[1], [1, 4, 5, 6, 7, 9]]) {
  const sub = traced.filter((l: any) => !excl.includes(l.number));
  console.log(`without laps ${excl.join(',')}:`, (microSectors(sub, traced[0].ch.L).theoreticalMs / 1000).toFixed(3));
}
// per lap: sum of bin times = lap time? (a broken trace does not add up)
for (const l of traced) { let sum = 0; for (let b = 0; b < ms.bins; b++) { const s0 = b * 50, s1 = Math.min(l.ch.L, (b + 1) * 50); sum += l.ch.t[Math.min(s1, l.ch.L - 1)] - l.ch.t[s0]; } console.log(`L${l.number} bins sum ${(sum / 1000).toFixed(3)} vs lap ${(l.timeMs / 1000).toFixed(3)} t[0]=${l.ch.t[0].toFixed(0)}`); }
