// Audio sinks. The laptop sink keeps one output stream open for the whole session and feeds it from a
// ring buffer, so a call starts within one device buffer (~40 ms) of being queued. The bus sink sends
// WAV clips to connected browsers (phone or laptop page) which play them with Web Audio.
import type { Pcm } from './tts.ts';
import { pcmToWav } from './tts.ts';
import type { Bus } from '../core/bus.ts';

export interface PlayHandle { id: number; started: Promise<number>; done: Promise<void>; cancel(): void }

export interface AudioSink {
  readonly name: string;
  /** device/buffer latency added after `started` resolves, ms (null = unknown) */
  readonly latencyMs: number | null;
  start(): Promise<void>;
  play(pcm: Pcm): PlayHandle;
  stop(): Promise<void>;
}

/** Test sink: resolves immediately, keeps a log. */
export class NullSink implements AudioSink {
  readonly name = 'null';
  readonly latencyMs = 0;
  played: { id: number; durationS: number; t: number }[] = [];
  private id = 0;
  async start(): Promise<void> {}
  play(pcm: Pcm): PlayHandle {
    const id = ++this.id, t = performance.now();
    this.played.push({ id, durationS: pcm.durationS, t });
    return { id, started: Promise.resolve(t), done: new Promise((r) => setTimeout(r, Math.round(pcm.durationS * 1000))), cancel() {} };
  }
  async stop(): Promise<void> {}
}

/** Laptop speakers / headphone jack via the prebuilt @echogarden/audio-io addon (MME on Windows). */
export class DeviceSink implements AudioSink {
  readonly name = 'device';
  private out: { dispose(): Promise<void> } | null = null;
  private queue: { id: number; samples: Int16Array; pos: number; onStart: (t: number) => void; onDone: () => void; cancelled: boolean }[] = [];
  private id = 0;
  private bufferMs: number;
  sampleRate: number;
  private cbCount = 0;
  constructor(sampleRate = 22050, bufferMs = 40) { this.sampleRate = sampleRate; this.bufferMs = bufferMs; }
  get latencyMs(): number { return this.bufferMs; }

  async start(): Promise<void> {
    const mod = await import('@echogarden/audio-io') as { createAudioOutput(cfg: { sampleRate: number; channelCount: number; bufferDuration: number }, handler: (buf: Int16Array) => void): Promise<{ dispose(): Promise<void> }> };
    this.out = await mod.createAudioOutput({ sampleRate: this.sampleRate, channelCount: 1, bufferDuration: this.bufferMs }, (buf) => this.fill(buf));
  }

  private fill(buf: Int16Array): void {
    this.cbCount++;
    let i = 0;
    while (i < buf.length) {
      const cur = this.queue[0];
      if (!cur) { buf.fill(0, i); return; }
      if (cur.cancelled) { this.queue.shift(); continue; }
      if (cur.pos === 0) cur.onStart(performance.now());
      const n = Math.min(buf.length - i, cur.samples.length - cur.pos);
      buf.set(cur.samples.subarray(cur.pos, cur.pos + n), i);
      i += n; cur.pos += n;
      if (cur.pos >= cur.samples.length) { this.queue.shift(); cur.onDone(); }
    }
  }

  play(pcm: Pcm): PlayHandle {
    const id = ++this.id;
    let onStart!: (t: number) => void, onDone!: () => void;
    const started = new Promise<number>((r) => { onStart = r; });
    const done = new Promise<void>((r) => { onDone = r; });
    const item = { id, samples: pcm.sampleRate === this.sampleRate ? pcm.samples : resample(pcm.samples, pcm.sampleRate, this.sampleRate), pos: 0, onStart, onDone, cancelled: false };
    this.queue.push(item);
    return { id, started, done, cancel: () => { item.cancelled = true; if (item.pos > 0) onDone(); } };
  }

  /** Drop everything queued (used when a safety call interrupts). */
  cancelAll(): void { for (const q of this.queue) q.cancelled = true; }

  async stop(): Promise<void> { await this.out?.dispose(); this.out = null; }
}

function resample(src: Int16Array, from: number, to: number): Int16Array {
  const n = Math.round(src.length * to / from), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const x = i * from / to, j = Math.floor(x), f = x - j; out[i] = Math.round((src[j] ?? 0) * (1 - f) + (src[j + 1] ?? src[j] ?? 0) * f); }
  return out;
}

/** Sends clips to browsers over the bus → WebSocket 'audio' channel. Playback latency is reported back by the page. */
export class BusSink implements AudioSink {
  readonly name = 'browser';
  latencyMs: number | null = null;
  private id = 0;
  private bus: Bus;
  constructor(bus: Bus) { this.bus = bus; }
  async start(): Promise<void> {}
  play(pcm: Pcm): PlayHandle {
    const id = ++this.id;
    const wav = Buffer.from(pcmToWav(pcm)).toString('base64');
    const t = performance.now();
    this.bus.emit('audio', { id, wavBase64: wav, durationS: pcm.durationS });
    return { id, started: Promise.resolve(t), done: new Promise((r) => setTimeout(r, Math.round(pcm.durationS * 1000))), cancel() {} };
  }
  /** called when a page reports its AudioContext.outputLatency */
  reportLatency(ms: number): void { this.latencyMs = ms; }
  async stop(): Promise<void> {}
}
