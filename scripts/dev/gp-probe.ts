import { TtsEngine, defaultModelDir } from '../../src/radio/tts.ts';
import { SpeechRecognizer } from '../../src/voice/asr.ts';
const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
const asr = new SpeechRecognizer({ threads: 2 }); await asr.start();
const heard: string[] = []; asr.events.onFinal = (t) => heard.push(t);
function to16k(p: { samples: Int16Array; sampleRate: number }): Int16Array { const n = Math.round(p.samples.length * 16000 / p.sampleRate), o = new Int16Array(n); for (let i = 0; i < n; i++) { const x = i * p.sampleRate / 16000, j = Math.floor(x), f = x - j; o[i] = Math.round((p.samples[j] ?? 0) * (1 - f) + (p.samples[j + 1] ?? p.samples[j] ?? 0) * f); } return o; }
for (const phrase of ['GP, how is my fuel?', 'G P, how is my fuel?', 'GP.', 'G P.', 'GP, how are the tyres?', 'Hey GP, any flags?']) {
  const sp = to16k(await tts.synth(phrase)); const a = new Int16Array(sp.length + 32000); a.set(sp, 3200);
  heard.length = 0; for (let i = 0; i < a.length; i += 1600) { asr.feed(a.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 3)); }
  await new Promise((r) => setTimeout(r, 600)); console.log(JSON.stringify(phrase), '→', JSON.stringify(heard));
}
await asr.stop(); await tts.stop();
