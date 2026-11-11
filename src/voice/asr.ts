// Main-thread handle for the speech recogniser worker.
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelsRoot } from '../radio/tts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_URL = existsSync(path.join(here, 'asr-worker.ts')) ? new URL('./asr-worker.ts', import.meta.url) : new URL('./asr-worker.mjs', import.meta.url);
export const ASR_MODEL = 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17';

export function asrModelDir(): string { return path.join(modelsRoot(), ASR_MODEL); }
export function asrAvailable(dir = asrModelDir()): boolean { return existsSync(path.join(dir, 'tokens.txt')); }
function addonDir(): string {
  try { return path.dirname(createRequire(import.meta.url).resolve('sherpa-onnx-win-x64/package.json')); } catch { return path.resolve(here, '../../node_modules/sherpa-onnx-win-x64'); }
}

export interface AsrEvents { onPartial?: (text: string) => void; onFinal?: (text: string) => void }

export class SpeechRecognizer {
  private worker: Worker | null = null;
  events: AsrEvents = {};
  private opts: { modelDir?: string; threads?: number };
  constructor(opts: { modelDir?: string; threads?: number } = {}) { this.opts = opts; }

  async start(): Promise<void> {
    const w = new Worker(WORKER_URL, { workerData: { modelDir: this.opts.modelDir ?? asrModelDir(), threads: this.opts.threads ?? 2, addonDir: addonDir() } });
    this.worker = w;
    await new Promise<void>((resolve, reject) => {
      w.once('message', (m: { t: string; error: string | null }) => (m.error ? reject(new Error(m.error)) : resolve()));
      w.once('error', reject);
    });
    w.on('message', (m: { t: 'partial' | 'final'; text: string }) => { if (m.t === 'partial') this.events.onPartial?.(m.text); else if (m.t === 'final') this.events.onFinal?.(m.text); });
  }

  /** 16 kHz mono, int16 or float32 in [-1, 1] */
  feed(samples: Int16Array | Float32Array): void {
    if (!this.worker) return;
    let f: Float32Array;
    if (samples instanceof Float32Array) f = samples.slice();
    else { f = new Float32Array(samples.length); for (let i = 0; i < samples.length; i++) f[i] = samples[i]! / 32768; }
    this.worker.postMessage({ t: 'audio', samples: f }, [f.buffer as ArrayBuffer]);
  }

  reset(): void { this.worker?.postMessage({ t: 'reset' }); }
  async stop(): Promise<void> { await this.worker?.terminate(); this.worker = null; }
}
