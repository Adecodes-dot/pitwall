// Feasibility probe: synthesise driver phrases with the Piper voice, feed them to the streaming recogniser as
// if they came from a microphone (16 kHz, 100 ms chunks, silence between), print what it hears.
import { TtsEngine, defaultModelDir } from '../../src/radio/tts.ts';
import { SpeechRecognizer } from '../../src/voice/asr.ts';

const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
const asr = new SpeechRecognizer({ threads: 2 });
const t0 = performance.now(); await asr.start(); console.log(`asr model loaded in ${Math.round(performance.now() - t0)} ms`);
const finals: string[] = [];
asr.events.onFinal = (t) => finals.push(t);

function to16k(pcm: { samples: Int16Array; sampleRate: number }): Int16Array {
  const n = Math.round(pcm.samples.length * 16000 / pcm.sampleRate), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const x = i * pcm.sampleRate / 16000, j = Math.floor(x), f = x - j; out[i] = Math.round((pcm.samples[j] ?? 0) * (1 - f) + (pcm.samples[j + 1] ?? pcm.samples[j] ?? 0) * f); }
  return out;
}
const phrases = process.argv.slice(2).length ? process.argv.slice(2) : ["Engineer, how's my fuel?", 'Hey engineer, where am I losing time?', 'Engineer', 'How are the tyres engineer', 'Engineer, talk to me less', 'Say that again', 'What was my last lap?', 'Engineer, how many laps to go?'];
for (const p of phrases) {
  finals.length = 0;
  const speech = to16k(await tts.synth(p));
  const audio = new Int16Array(speech.length + 16000 * 2);   // 2 s of silence after: the pause that ends the utterance
  audio.set(speech, 3200);
  const start = performance.now();
  let firstFinalAt = 0;
  for (let i = 0; i < audio.length; i += 1600) { asr.feed(audio.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 4)); if (finals.length && !firstFinalAt) firstFinalAt = performance.now() - start; }
  await new Promise((r) => setTimeout(r, 400));
  console.log(`"${p}"  →  ${JSON.stringify(finals)}  (${Math.round(speech.length / 16)} ms speech, final after ${Math.round(firstFinalAt)} ms wall incl. feed pacing)`);
}
await asr.stop(); await tts.stop(); process.exit(0);
