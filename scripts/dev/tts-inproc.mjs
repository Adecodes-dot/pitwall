// Does the addon load in-process when PATH is extended at runtime (no shell wrapper)?
import { createRequire } from 'node:module';
import path from 'node:path';
process.env.PATH = path.resolve('node_modules/sherpa-onnx-win-x64') + ';' + process.env.PATH;
const require = createRequire(import.meta.url);
const t0 = performance.now();
const sherpa = require('sherpa-onnx-node');
const dir = path.resolve('models/vits-piper-en_GB-alba-medium');
const tts = new sherpa.OfflineTts({ model: { vits: { model: path.join(dir, 'en_GB-alba-medium.onnx'), tokens: path.join(dir, 'tokens.txt'), dataDir: path.join(dir, 'espeak-ng-data') }, numThreads: 4, provider: 'cpu' }, maxNumSentences: 1 });
const t1 = performance.now();
const a = tts.generate({ text: 'Yellow flag, sector three.', sid: 0, speed: 1.0 });
const t2 = performance.now();
console.log(JSON.stringify({ loadMs: Math.round(t1 - t0), synthMs: Math.round(t2 - t1), samples: a.samples.length, sampleRate: a.sampleRate }));
