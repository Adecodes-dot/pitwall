// Speech-model accuracy check for hands-free voice: 20 driver phrases through the Piper voice (clean and with
// engine-like noise at a given signal-to-noise ratio) into each installed recogniser; counts how many are both
// addressed (wake word) and mapped to the right intent. Real microphones are harder than this: treat it as a
// ranking of models, not a promise.
//   npm run asr:bench -- [--snr 12]
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { TtsEngine, defaultModelDir, modelsRoot } from '../src/radio/tts.ts';
import { SpeechRecognizer } from '../src/voice/asr.ts';
import { WakeGate } from '../src/voice/wake.ts';
import { classify, type Intent } from '../src/voice/intent.ts';

const { values: v } = parseArgs({ options: { snr: { type: 'string', default: '12' } } });
const snr = Number(v.snr);
const CASES: [string, Intent][] = [
  ["Engineer, how's my fuel?", 'fuel'], ['Engineer, do I have enough fuel to finish?', 'fuel'], ['Hey engineer, how are the tyres?', 'tyres'], ['Engineer, what is the tyre wear like?', 'tyres'],
  ['Engineer, where am I losing time?', 'losing'], ['Hey engineer, what should I work on?', 'losing'], ['Engineer, any tips?', 'losing'], ["Engineer, what's my best lap?", 'best'],
  ['Engineer, how was that lap?', 'lap'], ['Engineer, what was my last lap time?', 'lap'], ['Engineer, am I being consistent?', 'consistency'], ['Engineer, what position am I in?', 'position'],
  ['Engineer, how many laps to go?', 'laps-left'], ['Engineer, what track is this?', 'track'], ['Engineer, any flags?', 'flags'], ['Engineer, is the safety car out?', 'flags'],
  ['Engineer, talk less.', 'mode-quiet'], ['Engineer, give me more feedback.', 'mode-coach'], ['Engineer, say that again.', 'repeat'], ['Engineer, mute.', 'mute'],
];
const root = modelsRoot();
const models = readdirSync(root).filter((d) => d.includes('streaming-zipformer') && existsSync(join(root, d, 'tokens.txt')));
if (models.length === 0) { console.error('no speech models in models/'); process.exit(2); }

const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
const to16k = (p: { samples: Int16Array; sampleRate: number }): Int16Array => { const n = Math.round(p.samples.length * 16000 / p.sampleRate), o = new Int16Array(n); for (let i = 0; i < n; i++) { const x = i * p.sampleRate / 16000, j = Math.floor(x), f = x - j; o[i] = Math.round((p.samples[j] ?? 0) * (1 - f) + (p.samples[j + 1] ?? p.samples[j] ?? 0) * f); } return o; };
// car-like noise: low rumble (brown noise) + broadband hiss; deterministic
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
function withNoise(a: Int16Array, snrDb: number): Int16Array {
  if (!Number.isFinite(snrDb)) return a;
  let sp = 0, n = 0; for (const x of a) if (Math.abs(x) > 500) { sp += x * x; n++; }
  const sigRms = Math.sqrt(sp / Math.max(1, n)), noiseRms = sigRms / 10 ** (snrDb / 20);
  const noise = new Float32Array(a.length); let brown = 0;
  for (let i = 0; i < a.length; i++) { brown = (brown + rnd() * 0.2) * 0.995; noise[i] = brown * 6 + rnd(); }
  let nr = 0; for (const x of noise) nr += x * x; nr = Math.sqrt(nr / noise.length);
  const out = new Int16Array(a.length); for (let i = 0; i < a.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(a[i]! + noise[i]! / nr * noiseRms)));
  return out;
}
const audios: { clean: Int16Array; noisy: Int16Array }[] = [];
for (const [text] of CASES) { const sp = to16k(await tts.synth(text)); const pad = new Int16Array(sp.length + 16000 * 2); pad.set(sp, 3200); audios.push({ clean: pad, noisy: withNoise(pad, snr) }); }
await tts.stop();

console.log(`${CASES.length} phrases; noisy = SNR ${snr} dB car-like noise\n`);
for (const m of models) {
  const asr = new SpeechRecognizer({ modelDir: join(root, m), threads: 2 });
  const t0 = performance.now(); await asr.start(); const loadMs = performance.now() - t0;
  const run = async (key: 'clean' | 'noisy') => {
    let ok = 0; const misses: string[] = []; let feedMs = 0, audioMs = 0;
    for (let i = 0; i < CASES.length; i++) {
      const finals: string[] = []; asr.events.onFinal = (t) => finals.push(t);
      const a = audios[i]![key]; const s = performance.now();
      for (let k = 0; k < a.length; k += 1600) asr.feed(a.subarray(k, k + 1600));
      for (let w = 0; w < 200 && finals.length === 0; w++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 150));
      feedMs += performance.now() - s; audioMs += a.length / 16;
      const g = new WakeGate(); const heard = finals.join(' ');
      const r = g.onFinal(heard, 0);
      const got = r.kind === 'command' ? classify(r.text) : null;
      if (got === CASES[i]![1]) ok++; else misses.push(`"${CASES[i]![0]}" → "${heard}" → ${r.kind}/${got}`);
      asr.reset();
    }
    return { ok, misses, rtf: feedMs / audioMs };
  };
  const c = await run('clean'), n = await run('noisy');
  console.log(`${m}\n  load ${Math.round(loadMs)} ms · clean ${c.ok}/${CASES.length} · noisy ${n.ok}/${CASES.length} · decode speed ${(1 / Math.max(0.001, n.rtf)).toFixed(0)}x real time (incl. pacing)`);
  for (const x of n.misses.slice(0, 6)) console.log(`    noisy miss: ${x}`);
  await asr.stop();
}
process.exit(0);
