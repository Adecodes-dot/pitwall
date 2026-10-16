// Radio queue after Crew Chief's design: an immediate queue (safety; may interrupt) and a priority
// queue with due/expiry times, per-key dedupe, per-corner cooldowns and chattiness caps.
export type Priority = 1 | 2 | 3 | 4; // 1 safety, 2 strategy, 3 coaching, 4 encouragement/info
export type Chattiness = 'quiet' | 'normal' | 'coach';

export interface Call {
  text: string;
  priority: Priority;
  /** dedupe key, e.g. "coach:T4:brake" */
  key: string;
  /** why this call exists, for the transcript and tests */
  reason: string;
  /** facts the text was built from (numbers must come from here) */
  facts: Record<string, number | string | boolean | null>;
  /** earliest and latest monotonic ms at which the call may be spoken */
  dueAfter: number;
  expiresAt: number;
  immediate: boolean;
  /** corner index for cooldowns, if any */
  corner?: number;
  /** when the call was created (monotonic ms) and what frame triggered it */
  createdAt: number;
  triggerT: number;
}

export interface QueueLimits { coachingPerLap: number; totalPerLap: number; coachingEveryNLaps: number; cornerCooldownLaps: number }

export const LIMITS: Record<Chattiness, QueueLimits> = {
  quiet: { coachingPerLap: 1, totalPerLap: 2, coachingEveryNLaps: 3, cornerCooldownLaps: 3 },
  normal: { coachingPerLap: 2, totalPerLap: 3, coachingEveryNLaps: 1, cornerCooldownLaps: 3 },
  coach: { coachingPerLap: 4, totalPerLap: 6, coachingEveryNLaps: 1, cornerCooldownLaps: 2 },
};

export class RadioQueue {
  mode: Chattiness = 'normal';
  private immediate: Call[] = [];
  private queued: Call[] = [];
  private lap = 0;
  private spokenThisLap = { coaching: 0, total: 0 };
  private lastCoachingLap = -99;
  private cornerLastLap = new Map<number, number>();
  private recentKeys = new Map<string, number>();
  /** keys the driver has "fixed" (metric improved) → never repeat until it regresses */
  private suppressed = new Set<string>();

  get limits(): QueueLimits { return LIMITS[this.mode]; }

  newLap(lap: number): void { this.lap = lap; this.spokenThisLap = { coaching: 0, total: 0 }; }

  suppress(key: string): void { this.suppressed.add(key); }
  unsuppress(key: string): void { this.suppressed.delete(key); }

  push(call: Call): boolean {
    if (this.suppressed.has(call.key)) return false;
    const list = call.immediate ? this.immediate : this.queued;
    if (list.some((c) => c.key === call.key)) return false; // already waiting
    if (call.priority === 3 && call.corner !== undefined) {
      const last = this.cornerLastLap.get(call.corner);
      if (last !== undefined && this.lap - last < this.limits.cornerCooldownLaps) return false;
    }
    list.push(call);
    list.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    return true;
  }

  /** The next call allowed to be spoken now, or null. Drops expired calls. */
  next(now: number): Call | null {
    this.immediate = this.immediate.filter((c) => c.expiresAt > now);
    this.queued = this.queued.filter((c) => c.expiresAt > now);
    const im = this.immediate.find((c) => c.dueAfter <= now);
    if (im) return im;
    for (const c of this.queued) {
      if (c.dueAfter > now) continue;
      if (!this.allowedByLimits(c)) continue;
      return c;
    }
    return null;
  }

  private allowedByLimits(c: Call): boolean {
    if (c.priority === 1) return true;
    const lim = this.limits;
    if (this.spokenThisLap.total >= lim.totalPerLap && c.priority >= 3) return false;
    if (c.priority === 3) {
      if (this.spokenThisLap.coaching >= lim.coachingPerLap) return false;
      if (lim.coachingEveryNLaps > 1 && this.lap - this.lastCoachingLap < lim.coachingEveryNLaps) return false;
    }
    if (c.priority === 4 && this.mode === 'quiet' && !c.key.startsWith('pb')) return false;
    return true;
  }

  /** Mark a call as spoken: removes it and updates counters. */
  spoken(c: Call): void {
    this.immediate = this.immediate.filter((x) => x !== c);
    this.queued = this.queued.filter((x) => x !== c);
    this.recentKeys.set(c.key, this.lap);
    if (c.priority >= 2) this.spokenThisLap.total++;
    if (c.priority === 3) { this.spokenThisLap.coaching++; this.lastCoachingLap = this.lap; if (c.corner !== undefined) this.cornerLastLap.set(c.corner, this.lap); }
  }

  /** Something higher-priority arrived: should the currently playing call be cut? Only safety interrupts. */
  shouldInterrupt(playing: Call | null): boolean {
    return playing !== null && playing.priority > 1 && this.immediate.length > 0;
  }

  get pending(): number { return this.immediate.length + this.queued.length; }
  clear(): void { this.immediate = []; this.queued = []; }
}
