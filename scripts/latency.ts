// Measured radio latency: replays a capture in real time, injects safety events while the car is on a
// straight, and reports trigger → audio-start per stage (p50/p95). Uses the real TTS bank and, if the
// audio addon loads, the real output device (you will hear the calls).
//   npm run latency -- [capture.pwcap] [--seconds 60] [--silent]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Engine } from '../src/server/engine.ts';
import { SessionAnalyser } from '../src/analysis/session.ts';
import { Radio } from '../src/radio/radio.ts';
import { TtsEngine, BANK_PHRASES, defaultModelDir, modelAvailable } from '../src/radio/tts.ts';
import { DeviceSink, NullSink, type AudioSink } from '../src/radio/audio.ts';
import { readPwcap } from '../src/capture/pwcap.ts';
import { replay } from '../src/capture/replay.ts';
import { defaultTrack } from '../src/synth/track.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { seconds: { type: 'string', default: '60' }, silent: { type: 'boolean', default: false } } });
const records = positionals[0] ? readPwcap(resolve(positionals[0])).records : synthRecords(generateSession(defaultTrack(), 3, { seed: 5 }), 'gt7', { format: '~' });

const engine = new Engine({ mode: 'replay', lanIp: null });
const analyser = new SessionAnalyser(null);
engine.bus.on('frame', (f) => analyser.onFrame(f));
engine.bus.on('event', (e) => analyser.onEvent(e));
analyser.listeners.push((u) => engine.bus.emit('analysis', { ...u, svg: null }));

let tts: TtsEngine | null = null;
if (modelAvailable()) { tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 4 }); await tts.start(); const t0 = performance.now(); const n = await tts.prime(BANK_PHRASES); console.log(`TTS bank: ${n} phrases in ${Math.round(performance.now() - t0)} ms`); }
else console.log('no voice model: run `npm run voice:get`; using silent placeholders');

let sink: AudioSink = new NullSink();
if (!v.silent) { try { const d = new DeviceSink(22050, 40); await d.start(); sink = d; console.log('audio: device (MME), buffer 40 ms'); } catch (e) { console.log(`audio: device unavailable (${(e as Error).message}); silent`); } }

const radio = new Radio(engine.bus, analyser, { mode: 'coach', tts, sinks: [sink] });
radio.attach();
engine.bus.on('radio', (c) => console.log(`  [${(c.latencyMs).toFixed(0).padStart(4)} ms] P${c.priority} ${c.zone.padEnd(9)} s=${c.s?.toFixed(0).padStart(5) ?? '    ?'} L${c.lap ?? '?'}  "${c.text}"   (${c.reason}${c.fromBank ? ', bank' : ''})`));

// inject a flag every 6 s of wall time; cleared 2.5 s later
let flagOn = false;
const inj = setInterval(() => { engine.bus.emit('event', { type: 'flag.change', t: performance.now(), fia: flagOn ? 'green' : 'yellow' }); flagOn = !flagOn; }, flagOn ? 2500 : 6000);

const seconds = Number(v.seconds);
console.log(`replaying ${records.length} packets in real time for ${seconds} s …`);
const h = replay(records, { speed: 1, sink: (r) => engine.ingest(r.data, r.srcPort, r.t, r.tWall) });
await new Promise((r) => setTimeout(r, seconds * 1000));
h.stop(); clearInterval(inj);

const safety = radio.transcript.filter((c) => c.priority === 1);
const p = (arr: number[], q: number) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN; };
const stage = (f: (c: typeof safety[number]) => number) => `p50 ${p(safety.map(f), 0.5).toFixed(1)} / p95 ${p(safety.map(f), 0.95).toFixed(1)} ms`;
console.log(`\nSafety calls spoken: ${safety.length} (of ${radio.transcript.length} total; ${radio.queue.pending} still queued)`);
if (safety.length) {
  console.log(`  trigger → call built : ${stage((c) => c.t.created - c.t.trigger)}`);
  console.log(`  built → chosen (zone) : ${stage((c) => c.t.chosen - c.t.created)}   (waiting for a safe zone is excluded from the budget)`);
  console.log(`  chosen → TTS ready    : ${stage((c) => Math.max(0, c.t.ttsReady - c.t.chosen))}`);
  console.log(`  chosen → audio start  : ${stage((c) => c.t.audioStart - c.t.chosen)}`);
  console.log(`  + device buffer       : ${sink.latencyMs ?? '?'} ms`);
  const total = safety.map((c) => c.t.audioStart - c.t.chosen + (sink.latencyMs ?? 0));
  console.log(`  BUDGET (decision → sound, incl. device buffer): p50 ${p(total, 0.5).toFixed(1)} ms / p95 ${p(total, 0.95).toFixed(1)} ms  → ${p(total, 0.95) <= 300 ? 'PASS' : 'FAIL'} (≤ 300 ms)`);
}
await sink.stop(); await tts?.stop();
process.exit(0);
