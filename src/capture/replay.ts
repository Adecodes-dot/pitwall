// Replay scheduler: feeds recorded datagrams to a sink with the original inter-packet spacing
// scaled by `speed` (1 = real time, 4 = 4x, Infinity = as fast as possible, synchronous).
import type { CaptureRecord } from './pwcap.ts';

export interface ReplayOptions {
  speed?: number;
  /** called with each record and its original monotonic time; return value ignored */
  sink: (rec: CaptureRecord) => void;
  onProgress?: (index: number, total: number) => void;
  onDone?: () => void;
  /** optional cancellation */
  signal?: AbortSignal;
}

export interface ReplayHandle { pause(): void; resume(): void; stop(): void; readonly paused: boolean }

export function replay(records: CaptureRecord[], opts: ReplayOptions): ReplayHandle {
  const speed = opts.speed ?? 1;
  let i = 0, paused = false, stopped = false;
  let timer: NodeJS.Timeout | null = null;

  if (!Number.isFinite(speed) || speed <= 0) {
    for (; i < records.length; i++) { if (opts.signal?.aborted) break; opts.sink(records[i]!); }
    opts.onProgress?.(records.length, records.length);
    opts.onDone?.();
    return { pause() {}, resume() {}, stop() {}, get paused() { return false; } };
  }

  const t0rec = records[0]?.t ?? 0;
  let startWall = performance.now();
  let pausedAtRec = t0rec;

  const step = (): void => {
    if (stopped || paused) return;
    const now = performance.now();
    // emit everything whose scaled time has arrived
    while (i < records.length) {
      const rec = records[i]!;
      const due = startWall + (rec.t - pausedAtRec) / speed;
      if (due > now) {
        timer = setTimeout(step, Math.max(0, Math.min(50, due - now)));
        return;
      }
      opts.sink(rec);
      i++;
      if (i % 100 === 0) opts.onProgress?.(i, records.length);
    }
    opts.onProgress?.(records.length, records.length);
    opts.onDone?.();
  };
  timer = setTimeout(step, 0);

  return {
    pause() { if (paused) return; paused = true; if (timer) clearTimeout(timer); },
    resume() {
      if (!paused) return;
      paused = false;
      startWall = performance.now();
      pausedAtRec = records[i]?.t ?? pausedAtRec;
      step();
    },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
    get paused() { return paused; },
  };
}
