// Monotonic clock in ms with sub-ms resolution. Replay substitutes its own clock so that
// frame.t keeps the original inter-packet spacing regardless of playback speed.
import { performance } from 'node:perf_hooks';

export interface Clock { now(): number }

export const realClock: Clock = { now: () => performance.now() };

/** A clock whose time is set explicitly by the replay scheduler. */
export class ManualClock implements Clock {
  private t = 0;
  now(): number { return this.t; }
  set(t: number): void { this.t = t; }
}
