// Ranks candidate engineer names through the real speech path: Piper voice → offline recogniser → wake gate → intent.
import { TtsEngine, defaultModelDir } from '../../src/radio/tts.ts';
import { SpeechRecognizer } from '../../src/voice/asr.ts';
import { WakeGate, wakeWordsFor } from '../../src/voice/wake.ts';
import { classify, normalise } from '../../src/voice/intent.ts';
const NAMES = process.argv.slice(2);
const QS = ["how's my fuel?", 'where am I losing time?', 'what was my last lap?', 'how are the tyres?', 'radio check.', 'how many laps to go?'];
const CHATTER = ['Box box, this lap.', 'The safety car is out.', 'He is on fresh tyres.', 'What a lap from Verstappen.', 'I locked up into turn one.', 'Push now, push push.', 'Oh my days, that was close.', 'Hold on, let me check the strategy.'];
const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
const asr = new SpeechRecognizer({ threads: 2 }); await asr.start();
let finals: string[] = []; asr.events.onFinal = (t) => finals.push(t);
const to16k = (p: { samples: Int16Array; sampleRate: number }) => { const n = Math.round(p.samples.length * 16000 / p.sampleRate), o = new Int16Array(n); for (let i = 0; i < n; i++) { const x = i * p.sampleRate / 16000, j = Math.floor(x), f = x - j; o[i] = Math.round((p.samples[j] ?? 0) * (1 - f) + (p.samples[j + 1] ?? p.samples[j] ?? 0) * f); } return o; };
async function hear(phrase: string): Promise<string> {
  finals = []; const sp = to16k(await tts.synth(phrase)); const a = new Int16Array(sp.length + 32000); a.set(sp, 3200);
  for (let i = 0; i < a.length; i += 1600) { asr.feed(a.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 3)); }
  for (let w = 0; w < 30 && finals.length === 0; w++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 150)); return finals.join(' ');
}
const chatter: string[] = []; for (const c of CHATTER) chatter.push(await hear(c));
for (const name of NAMES) {
  const alone: string[] = []; for (let i = 0; i < 5; i++) alone.push(await hear(`${name}.`));
  const qs: string[] = []; for (const q of QS) qs.push(await hear(`${name}, ${q}`));
  const score = (words: string[]) => qs.filter((t) => { const r = new WakeGate({ words }).onFinal(t, 0); return r.kind === 'command' && classify(r.text) !== null; }).length;
  const raw = new WakeGate({ words: wakeWordsFor(name) });
  const matched = alone.filter((t) => raw.hasWake(t)).length;
  const aliases = [...new Set(alone.filter((t) => !raw.hasWake(t)).map((t) => normalise(t)).filter((w) => w.length > 0 && w.length <= 4).map((w) => w.join(' ')))];
  const learned = wakeWordsFor(name, aliases);
  const falseWakes = chatter.filter((t) => new WakeGate({ words: learned }).hasWake(t)).length;
  console.log(`${name.padEnd(12)} alone ${matched}/5 heard [${[...new Set(alone)].join(' | ')}]  questions raw ${score(wakeWordsFor(name))}/6, taught ${score(learned)}/6  false wakes on chatter ${falseWakes}/8${aliases.length ? `  learned [${aliases.join(', ')}]` : ''}`);
}
console.log('chatter heard as:', chatter.join(' | '));
await asr.stop(); await tts.stop();
