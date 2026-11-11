// Streaming speech recogniser in a worker thread (sherpa-onnx online zipformer, CPU, offline).
// In: 16 kHz mono float32 chunks. Out: 'partial' text as it changes, 'final' at each endpoint (pause after speech).
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { modelDir, threads, addonDir } = workerData as { modelDir: string; threads: number; addonDir: string };
process.env.PATH = `${addonDir};${process.env.PATH ?? ''}`;

interface Stream { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void }
interface Recognizer { createStream(): Stream; isReady(s: Stream): boolean; decode(s: Stream): void; getResult(s: Stream): { text: string }; isEndpoint(s: Stream): boolean; reset(s: Stream): void }

let rec: Recognizer | null = null, stream: Stream | null = null, err: string | null = null;
try {
  const sherpa = require('sherpa-onnx-node') as { OnlineRecognizer: new (c: unknown) => Recognizer };
  const files = readdirSync(modelDir);
  const pick = (prefix: string) => { const f = files.find((x) => x.startsWith(prefix) && x.endsWith('.int8.onnx')) ?? files.find((x) => x.startsWith(prefix) && x.endsWith('.onnx')); if (!f) throw new Error(`no ${prefix} model in ${modelDir}`); return path.join(modelDir, f); };
  rec = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: pick('encoder'), decoder: pick('decoder'), joiner: pick('joiner') }, tokens: path.join(modelDir, 'tokens.txt'), numThreads: threads, provider: 'cpu', debug: 0 },
    decodingMethod: 'greedy_search', maxActivePaths: 4,
    enableEndpoint: 1, rule1MinTrailingSilence: 2.0, rule2MinTrailingSilence: 0.9, rule3MinUtteranceLength: 15,
  });
  stream = rec.createStream();
} catch (e) { err = (e as Error).message; }
parentPort!.postMessage({ t: 'ready', error: err });

let last = '';
parentPort!.on('message', (m: { t: 'audio'; samples: Float32Array } | { t: 'reset' }) => {
  if (!rec || !stream) return;
  if (m.t === 'reset') { rec.reset(stream); last = ''; return; }
  stream.acceptWaveform({ samples: m.samples, sampleRate: 16000 });
  while (rec.isReady(stream)) rec.decode(stream);
  const text = rec.getResult(stream).text.trim().toLowerCase();
  if (text !== last && text) { last = text; parentPort!.postMessage({ t: 'partial', text }); }
  if (rec.isEndpoint(stream)) {
    if (text) parentPort!.postMessage({ t: 'final', text });
    rec.reset(stream); last = '';
  }
});
