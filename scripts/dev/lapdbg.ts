import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { SessionAnalyser, coversLap, fitsLap } from '../../src/analysis/session.ts';
const { records } = readPwcap(process.argv[2]!);
const an = new SessionAnalyser(null); const ad = new F1Adapter();
const take = (o: ReturnType<F1Adapter['feed']>) => { for (const f of o.frames) an.onFrame(f); for (const e of o.events) { an.onEvent(e); if (e.type === 'lap.complete') { const l = an.collector.laps.at(-1); if (!l) { console.log('L', e.lapNumber, 'no lap'); continue; } const timed = l.samples.filter((s) => s.lapTimeMs !== null); const ss = l.samples.map((s) => s.s ?? NaN); console.log(`L${l.number} ${l.timeMs} samples ${l.samples.length} gap ${l.maxGapMs.toFixed(0)} covers ${coversLap(l)} firstT ${timed[0]?.lapTimeMs} lastT ${timed.at(-1)?.lapTimeMs} s ${Math.min(...ss).toFixed(0)}..${Math.max(...ss).toFixed(0)} fits ${an.model ? fitsLap(an.model, l) : '-'} ch ${!!l.ch} model ${an.model?.length}`); } } };
for (const r of records) take(ad.feed(r.data, r.t));
