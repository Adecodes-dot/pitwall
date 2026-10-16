// M3 demo: replay a session with the engineer talking. Prints every call with its reason and latency,
// then a summary. Real voice if models/ has the Piper voice, real laptop audio if the device opens.
//   npm run demo:m3 -- [capture.pwcap] [--speed 1] [--mode coach] [--silent] [--laps 3]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Engine } from '../src/server/engine.ts';
import { SessionAnalyser } from '../src/analysis/session.ts';
import { Radio } from '../src/radio/radio.ts';
import { TtsEngine, BANK_PHRASES, defaultModelDir, modelAvailable } from '../src/radio/tts.ts';
import { DeviceSink, NullSink, type AudioSink } from '../src/radio/audio.ts';
import { buildZones } from '../src/radio/safezones.ts';
import { readPwcap } from '../src/capture/pwcap.ts';
import { replay } from '../src/capture/replay.ts';
import { defaultTrack } from '../src/synth/track.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';
import type { Chattiness } from '../src/radio/queue.ts';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { speed: { type: 'string', default: '1' }, mode: { type: 'string', default: 'coach' }, silent: { type: 'boolean', default: false }, laps: { type: 'string', default: '3' } } });
const records = positionals[0] ? readPwcap(resolve(positionals[0])).records : synthRecords(generateSession(defaultTrack(), Number(v.laps), { seed: 17, brakeJitterM: 15, speedJitter: 0.06 }), 'gt7', { format: '~' });
const speed = v.speed === 'max' ? Infinity : Number(v.speed);

const engine = new Engine({ mode: 'replay', lanIp: null });
const analyser = new SessionAnalyser(null);
engine.bus.on('frame', (f) => analyser.onFrame(f));
engine.bus.on('event', (e) => analyser.onEvent(e));
analyser.listeners.push((u) => engine.bus.emit('analysis', { ...u, svg: null }));

let tts: TtsEngine | null = null;
if (modelAvailable() && Number.isFinite(speed)) { tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 4 }); await tts.start(); await tts.prime(BANK_PHRASES); console.log(`voice: Piper en_GB alba, ${tts.bankSize} phrases banked`); }
else console.log(Number.isFinite(speed) ? 'voice: none (run npm run voice:get)' : 'voice: skipped at max speed');
let sink: AudioSink = new NullSink();
if (!v.silent && Number.isFinite(speed)) { try { const d = new DeviceSink(22050, 40); await d.start(); sink = d; console.log('audio: laptop output device'); } catch (e) { console.log(`audio: silent (${(e as Error).message})`); } }

// in a replay the frame clock keeps the queue honest at any speed
let clock = 0;
engine.bus.on('frame', (f) => { clock = f.t; });
const radio = new Radio(engine.bus, analyser, { mode: v.mode as Chattiness, tts, sinks: [sink], now: Number.isFinite(speed) ? undefined : () => clock } as never);
radio.attach();
engine.bus.on('radio', (c) => console.log(`  L${String(c.lap ?? '?').padStart(2)} s=${c.s?.toFixed(0).padStart(5) ?? '    ?'} P${c.priority} ${c.zone === 'safe' ? '✓safe' : c.zone}  "${c.text}"   ← ${c.reason}`));

console.log(`replaying ${records.length} packets at ${v.speed}x, mode ${v.mode}\n`);
await new Promise<void>((done) => replay(records, { speed, sink: (r) => engine.ingest(r.data, r.srcPort, r.t, r.tWall), onDone: done }));
await new Promise((r) => setTimeout(r, 500));

const t = radio.transcript;
const zones = analyser.model ? buildZones(analyser.model, analyser.collector.laps) : null;
let inBraking = 0;
if (zones) for (const c of t) if (c.s !== null) { const i = ((Math.round(c.s) % zones.L) + zones.L) % zones.L; if (zones.braking[i] || zones.corner[i]) inBraking++; }
console.log(`\n${t.length} calls spoken: ${t.filter((c) => c.priority === 1).length} safety, ${t.filter((c) => c.priority === 2).length} strategy, ${t.filter((c) => c.priority === 3).length} coaching, ${t.filter((c) => c.priority === 4).length} info`);
console.log(`calls started inside a braking zone or corner: ${inBraking} ${inBraking === 0 ? 'PASS' : 'FAIL'}`);
console.log(`dropped by persona rules: ${radio.dropped.length}${radio.dropped.length ? ' → ' + radio.dropped.map((d) => `"${d.call.text}" (${d.why})`).join('; ') : ''}`);
if (tts) console.log(`tts: ${tts.stats.synths} dynamic syntheses, mean ${(tts.stats.synthMsTotal / Math.max(1, tts.stats.synths)).toFixed(0)} ms; ${tts.stats.bankHits} bank hits`);
await sink.stop(); await tts?.stop();
process.exit(inBraking === 0 ? 0 : 1);
