// M4 demo: debrief + Q&A from a replayed session (synthetic by default, or a .pwcap).
// Prints the summary, the three corners, the drill, answers ten scripted questions, and writes
// docs/milestones/m4-debrief.html (self-contained export).
//   npm run demo:m4 -- [capture.pwcap]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Engine } from '../src/server/engine.ts';
import { SessionAnalyser } from '../src/analysis/session.ts';
import { Store } from '../src/analysis/store.ts';
import { buildDebrief, debriefHtml } from '../src/debrief/debrief.ts';
import { answerQuestion, factSheet } from '../src/llm/qa.ts';
import { AnthropicPhraser, TemplatePhraser, hasAnthropicCredentials } from '../src/llm/phrase.ts';
import { readPwcap } from '../src/capture/pwcap.ts';
import { defaultTrack } from '../src/synth/track.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';
import type { NormalisedFrame } from '../src/core/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
const records = arg ? readPwcap(resolve(arg)).records : synthRecords(generateSession(defaultTrack(), 5, { seed: 23, brakeJitterM: 15, speedJitter: 0.06 }), 'gt7', { format: '~' });

const store = new Store(':memory:');
const engine = new Engine({ mode: 'replay', lanIp: null });
const analyser = new SessionAnalyser(store);
let last: NormalisedFrame | null = null;
engine.bus.on('frame', (f) => { analyser.onFrame(f); last = f; });
engine.bus.on('event', (e) => analyser.onEvent(e));
for (const r of records) engine.ingest(r.data, r.srcPort, r.t, r.tWall);

const d = buildDebrief(analyser, store);
if (!d) { console.log('no completed laps'); process.exit(1); }
const fmt = (ms: number | null) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
console.log(`== Debrief: ${d.trackName ?? d.trackId} · ${d.laps} laps · ${d.cornerCount} corners`);
console.log(`   ${d.summary}`);
console.log(`   best ${fmt(d.bestMs)} (L${d.bestLap})  theoretical ${fmt(d.theoreticalMs)}  consistency ${d.consistencyScore?.toFixed(0) ?? '—'}/100  lockups ${d.mistakes.lockups}  wheelspins ${d.mistakes.wheelspins}`);
console.log('\n== Three corners costing the most time');
for (const [i, c] of d.topCorners.entries()) {
  console.log(`   #${i + 1} ${c.corner.name} (${c.corner.direction}, R${Math.round(c.corner.minRadius)}): lost ${(c.lostMs / 1000).toFixed(2)} s over the session, worst L${c.worstLap} +${(c.worstLapDeltaMs / 1000).toFixed(3)}`);
  console.log(`      → "${c.diagnosis.text}"   (${c.diagnosis.reason})`);
  console.log(`      lap: brake ${c.metrics.lap.brakePointM?.toFixed(0) ?? '—'} m, min ${(c.metrics.lap.minSpeed * 3.6).toFixed(0)} km/h, pickup ${c.metrics.lap.throttlePickupM?.toFixed(0) ?? '—'} m · best: brake ${c.metrics.best.brakePointM?.toFixed(0) ?? '—'} m, min ${(c.metrics.best.minSpeed * 3.6).toFixed(0)} km/h, pickup ${c.metrics.best.throttlePickupM?.toFixed(0) ?? '—'} m · trace ${c.traces.lap.s.length} points over ${Math.round(c.windowS1 - c.windowS0)} m`);
}
if (d.drill) console.log(`\n== Next session plan\n   ${d.drill.text}\n   Target: ${d.drill.target}.`);

const out = join(root, 'docs', 'milestones', 'm4-debrief.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, debriefHtml(d));
console.log(`\n   export → ${out} (${(debriefHtml(d).length / 1024).toFixed(0)} KB, self-contained)`);

const phraser = hasAnthropicCredentials() ? new AnthropicPhraser() : new TemplatePhraser();
const ctx = { update: analyser.lastUpdate, frame: last, fuelLaps: last!.fuel.lapsRemaining, lapsLeft: null, game: last!.game };
console.log(`\n== Push-to-talk Q&A (phrasing: ${phraser.name})`);
const questions = ["how's my fuel", 'where am I losing time', "what's my best", 'how was that lap', 'how are the tyres', 'am I consistent', 'what position am I', 'what track is this', 'any flags', 'radio check', 'what should I have for dinner'];
for (const q of questions) { const a = await answerQuestion(q, ctx, phraser); console.log(`   "${q}" → "${a.text}"   [${a.source}:${a.intent}]`); }
console.log(`\n   fact sheet given to the LLM (when enabled):\n   ${factSheet(ctx).split('\n').join('\n   ')}`);
store.close();
