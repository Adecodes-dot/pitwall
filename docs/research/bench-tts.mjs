// TTS latency benchmark: sherpa-onnx-node + Piper VITS voice on CPU.
// Measures time-to-first-audio for short radio phrases (full synthesis; the
// addon's callback gives us the first chunk time as a proxy for streaming).
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

const dir = path.resolve('models/vits-piper-en_GB-alba-medium');
const threads = Number(process.argv[2] ?? 2);
const config = {
  model: {
    vits: {
      model: path.join(dir, 'en_GB-alba-medium.onnx'),
      tokens: path.join(dir, 'tokens.txt'),
      dataDir: path.join(dir, 'espeak-ng-data'),
    },
    debug: 0,
    numThreads: threads,
    provider: 'cpu',
  },
  maxNumSentences: 1,
};

const t0 = performance.now();
const tts = new sherpa.OfflineTts(config);
const tLoad = performance.now() - t0;

const phrases = [
  'Box this lap, box box.',
  'Turn 4, braking 10 metres early.',
  'Yellow flag, sector three.',
  'Turn 7, carry 5 more through the apex.',
  "That's a new best, one thirty-two four.",
  'Fuel, two laps short, lift and coast.',
];

const results = [];
for (let round = 0; round < 3; round++) {
  for (const text of phrases) {
    let firstChunkMs = null;
    const start = performance.now();
    const audio = tts.generate({
      text, sid: 0, speed: 1.0, enableExternalBuffer: true,
      callback: () => { if (firstChunkMs === null) firstChunkMs = performance.now() - start; return 1; },
    });
    const total = performance.now() - start;
    const durMs = (audio.samples.length / audio.sampleRate) * 1000;
    results.push({ text, firstChunkMs, total, durMs, rtf: total / durMs });
  }
}
const warm = results.slice(phrases.length); // drop first round (warm-up)
const p = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const totals = warm.map(r => r.total);
const firsts = warm.map(r => r.firstChunkMs ?? r.total);
console.log(JSON.stringify({
  cpu: os.cpus()[0].model, cores: os.cpus().length, threads, node: process.version,
  modelLoadMs: Math.round(tLoad), sampleRate: 'see model',
  p50_total_ms: Math.round(p(totals, 0.5)), p95_total_ms: Math.round(p(totals, 0.95)),
  p50_first_chunk_ms: Math.round(p(firsts, 0.5)), p95_first_chunk_ms: Math.round(p(firsts, 0.95)),
  mean_rtf: +(warm.reduce((a, r) => a + r.rtf, 0) / warm.length).toFixed(3),
  perPhrase: warm.slice(0, phrases.length).map(r => ({ text: r.text, total_ms: Math.round(r.total), first_ms: r.firstChunkMs && Math.round(r.firstChunkMs), audio_ms: Math.round(r.durMs) })),
}, null, 2));
