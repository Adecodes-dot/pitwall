// TTS engine: worker-backed synthesis plus a phrase bank so time-critical calls never wait for the model.
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface Pcm { samples: Int16Array; sampleRate: number; durationS: number }

export interface TtsOptions { modelDir: string; threads?: number; addonDir?: string }

const here = path.dirname(fileURLToPath(import.meta.url));
/** source tree: ./tts-worker.ts; bundled app: ./tts-worker.mjs next to the bundle */
const WORKER_URL = existsSync(path.join(here, 'tts-worker.ts')) ? new URL('./tts-worker.ts', import.meta.url) : new URL('./tts-worker.mjs', import.meta.url);
function addonDir(): string {
  try { return path.dirname(createRequire(import.meta.url).resolve('sherpa-onnx-win-x64/package.json')); } catch { return path.resolve(here, '../../node_modules/sherpa-onnx-win-x64'); }
}

export function modelsRoot(): string { return process.env.PITWALL_MODELS ?? path.resolve(here, '../../models'); }
export function defaultModelDir(): string { return path.join(modelsRoot(), 'vits-piper-en_GB-alba-medium'); }
export function modelAvailable(dir = defaultModelDir()): boolean { return existsSync(path.join(dir, 'tokens.txt')); }

export class TtsEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (p: Pcm) => void; reject: (e: Error) => void }>();
  private bank = new Map<string, Pcm>();
  private inflight = new Map<string, Promise<Pcm>>();
  readonly opts: Required<TtsOptions>;
  stats = { synths: 0, synthMsTotal: 0, bankHits: 0 };

  constructor(opts: TtsOptions) {
    this.opts = { threads: 4, addonDir: addonDir(), ...opts };
  }

  async start(): Promise<void> {
    const w = new Worker(WORKER_URL, { workerData: { modelDir: this.opts.modelDir, threads: this.opts.threads, addonDir: this.opts.addonDir } });
    this.worker = w;
    await new Promise<void>((resolve, reject) => {
      w.once('message', (m: { type: string; error: string | null }) => (m.error ? reject(new Error(m.error)) : resolve()));
      w.once('error', reject);
    });
    w.on('message', (m: { id: number; samples?: Int16Array; sampleRate?: number; synthMs?: number; error?: string }) => {
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id);
      if (m.error || !m.samples) p.reject(new Error(m.error ?? 'no samples'));
      else { this.stats.synths++; this.stats.synthMsTotal += m.synthMs ?? 0; p.resolve({ samples: m.samples, sampleRate: m.sampleRate!, durationS: m.samples.length / m.sampleRate! }); }
    });
  }

  /** Synthesise (uncached). */
  synth(text: string): Promise<Pcm> {
    if (!this.worker) return Promise.reject(new Error('tts not started'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker!.postMessage({ id, text }); });
  }

  /** Bank hit or null. */
  get(text: string): Pcm | null { const p = this.bank.get(text) ?? null; if (p) this.stats.bankHits++; return p; }

  /** Bank hit, else synthesise and cache (coalescing duplicate requests). */
  speak(text: string): Promise<Pcm> {
    const hit = this.get(text); if (hit) return Promise.resolve(hit);
    let p = this.inflight.get(text);
    if (!p) {
      p = this.synth(text).then((pcm) => { this.bank.set(text, pcm); this.inflight.delete(text); return pcm; }, (e) => { this.inflight.delete(text); throw e; });
      this.inflight.set(text, p);
    }
    return p;
  }

  /** Pre-synthesise fixed phrases (sequentially; the worker is single-threaded per request). */
  async prime(texts: string[]): Promise<number> {
    let n = 0;
    for (const t of texts) { if (!this.bank.has(t)) { await this.speak(t); n++; } }
    return n;
  }

  get bankSize(): number { return this.bank.size; }

  async stop(): Promise<void> { await this.worker?.terminate(); this.worker = null; }
}

/** Fixed phrases every session needs instantly: safety, strategy variants, radio check. */
export const BANK_PHRASES: string[] = [
  'Yellow flag.', 'Yellow flag, sector one.', 'Yellow flag, sector two.', 'Yellow flag, sector three.',
  'Red flag, red flag, slow down.', 'Blue flag, let them through.', 'Track clear, green flag.',
  'Safety car, safety car.', 'Virtual safety car, hold the delta.', 'Safety car in this lap.', 'Green flag, racing again.',
  'Fuel, one lap short, lift and coast.', 'Fuel, two laps short, lift and coast.', 'Fuel, three laps short, lift and coast.', 'Fuel, four laps short, lift and coast.', 'Fuel, five laps short, lift and coast.', 'Fuel is good, push.',
  'Fronts are hot, give them a lap.', 'Rears are hot, easy on the exits.', 'Rears are gone, manage the exits.', 'Fronts are going, protect them on entry.',
  'Consistent, keep this rhythm.', 'Radio check, loud and clear.',
];

/** Minimal WAV encoder for the browser sink and exports. */
export function pcmToWav(p: Pcm): Uint8Array {
  const bytes = p.samples.length * 2;
  const buf = new Uint8Array(44 + bytes);
  const dv = new DataView(buf.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, p.sampleRate, true);
  dv.setUint32(28, p.sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, bytes, true);
  new Int16Array(buf.buffer, 44, p.samples.length).set(p.samples);
  return buf;
}
