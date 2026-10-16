// TTS worker: loads sherpa-onnx once and synthesises on request so the main loop never blocks.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { modelDir, threads, addonDir } = workerData as { modelDir: string; threads: number; addonDir: string };
// the prebuilt addon's DLLs are found through PATH on Windows
process.env.PATH = `${addonDir};${process.env.PATH ?? ''}`;

type Sherpa = { OfflineTts: new (cfg: unknown) => { generate(o: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number } } };
let tts: InstanceType<Sherpa['OfflineTts']> | null = null;
let err: string | null = null;
try {
  const sherpa = require('sherpa-onnx-node') as Sherpa;
  const onnx = path.join(modelDir, require('node:fs').readdirSync(modelDir).find((f: string) => f.endsWith('.onnx')) ?? 'model.onnx');
  tts = new sherpa.OfflineTts({
    model: { vits: { model: onnx, tokens: path.join(modelDir, 'tokens.txt'), dataDir: path.join(modelDir, 'espeak-ng-data') }, numThreads: threads, provider: 'cpu', debug: 0 },
    maxNumSentences: 1,
  });
} catch (e) { err = (e as Error).message; }

parentPort!.postMessage({ type: 'ready', error: err });

parentPort!.on('message', (m: { id: number; text: string; speed?: number }) => {
  if (!tts) { parentPort!.postMessage({ id: m.id, error: err ?? 'tts not loaded' }); return; }
  try {
    const t0 = performance.now();
    const a = tts.generate({ text: m.text, sid: 0, speed: m.speed ?? 1.0 });
    const samples = new Int16Array(a.samples.length);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-32768, Math.min(32767, Math.round(a.samples[i]! * 32767)));
    parentPort!.postMessage({ id: m.id, samples, sampleRate: a.sampleRate, synthMs: performance.now() - t0 }, [samples.buffer]);
  } catch (e) { parentPort!.postMessage({ id: m.id, error: (e as Error).message }); }
});
