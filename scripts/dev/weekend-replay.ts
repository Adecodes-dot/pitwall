// Replays captures in order through one analyser + store, as the app would see a race weekend.
import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
import { Store } from '../../src/analysis/store.ts';
import { answerByRule } from '../../src/llm/qa.ts';
const [dbPath, ...files] = process.argv.slice(2);
const store = new Store(dbPath!);
const an = new SessionAnalyser(store);
const ad = new F1Adapter();
const fmt = (ms: number | null) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
for (const file of files) {
  const { records } = readPwcap(file);
  const take = (o: ReturnType<F1Adapter['feed']>) => {
    for (const f of o.frames) an.onFrame(f);
    for (const e of o.events) {
      an.onEvent(e);
      if (e.type === 'session.start') console.log(`  session.start ${e.sessionUid}: model ${an.model ? `${an.model.id} ${an.model.length} m` : 'none'}, reference ${fmt(an.reference?.timeMs ?? null)}`);
      if (e.type === 'lap.complete') {
        const u = an.lastUpdate;
        const losing = answerByRule('where am I losing time', { update: u, frame: null, fuelLaps: null, lapsLeft: null, game: 'f1' } as never);
        console.log(`  L${e.lapNumber} ${fmt(e.timeMs)} → model ${an.model ? `${an.model.length} m ${an.model.corners.length} corners` : 'none'}, laps ${u?.laps.length ?? 0}, ref ${fmt(u?.referenceMs ?? null)}, "${losing?.text}"`);
      }
    }
  };
  console.log(`== ${file.split(/[\/]/).pop()} (${records.length} packets)`);
  for (const r of records) take(ad.feed(r.data, r.t));
  take(ad.tick(1e12));
  console.log(`  end: collector laps ${an.collector.laps.length}, skipped ${JSON.stringify(an.collector.skipped)}`);
}
console.log('stored ref:', JSON.stringify((store.db.prepare('select track_id, time_ms, length from refs').all())));
console.log('stored tracks:', JSON.stringify(store.db.prepare('select id, length from tracks').all()));
