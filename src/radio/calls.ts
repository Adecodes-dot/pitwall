// Deterministic call generator. Every call is a template filled from facts the analysis produced;
// no text is ever invented. Persona rules live in DESIGN_SYSTEM.md and are enforced by rules.ts.
import type { Call, Priority } from './queue.ts';
import type { AnalysisUpdate } from '../analysis/session.ts';
import type { NormalisedFrame, FiaFlag, SafetyCar } from '../core/types.ts';
import type { CornerMetrics } from '../analysis/laps.ts';

export interface CallContext { now: number; triggerT: number; lapTimeMs?: number }

const round5 = (x: number) => Math.round(x / 5) * 5;
const mk = (text: string, priority: Priority, key: string, reason: string, facts: Call['facts'], ctx: CallContext, o: { immediate?: boolean; ttlMs?: number; corner?: number } = {}): Call => ({
  text, priority, key, reason, facts, dueAfter: ctx.now, expiresAt: ctx.now + (o.ttlMs ?? 120000), immediate: o.immediate ?? false, createdAt: ctx.now, triggerT: ctx.triggerT,
  ...(o.corner !== undefined ? { corner: o.corner } : {}),
});

/** Lap time read the way an engineer says it: 1:32.456 → "one thirty-two four" */
export function sayLapTime(ms: number): string {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), tenth = Math.floor((ms % 1000) / 100);
  // "one thirty point three": without "point", 1:30.3 is heard as 1:33
  return `${NUM[m] ?? m} ${s < 10 ? 'oh ' + NUM[s] : TENS(s)} point ${NUM[tenth]}`;
}
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = (n: number): string => n < 20 ? NUM[n]! : `${['', '', 'twenty', 'thirty', 'forty', 'fifty'][Math.floor(n / 10)]}${n % 10 ? '-' + NUM[n % 10] : ''}`;

// ---- Safety (immediate, priority 1) ----

export function flagCall(flag: FiaFlag, sector: number | null, ctx: CallContext): Call | null {
  switch (flag) {
    case 'yellow': return mk(sector !== null ? `Yellow flag, sector ${['one', 'two', 'three'][sector] ?? sector + 1}.` : 'Yellow flag.', 1, 'flag:yellow', 'FIA flag yellow', { flag, sector }, ctx, { immediate: true, ttlMs: 15000 });
    case 'red': return mk('Red flag, red flag, slow down.', 1, 'flag:red', 'FIA flag red', { flag }, ctx, { immediate: true, ttlMs: 20000 });
    case 'blue': return mk('Blue flag, let them through.', 1, 'flag:blue', 'FIA flag blue', { flag }, ctx, { immediate: true, ttlMs: 8000 });
    case 'green': return mk('Track clear, green flag.', 1, 'flag:green', 'FIA flag green', { flag }, ctx, { immediate: true, ttlMs: 8000 });
    default: return null;
  }
}

export function safetyCarCall(status: SafetyCar, phase: string | undefined, ctx: CallContext): Call | null {
  if (phase === 'deployed') {
    if (status === 'full') return mk('Safety car, safety car.', 1, 'sc:deployed', 'safety car deployed', { status }, ctx, { immediate: true, ttlMs: 20000 });
    if (status === 'virtual') return mk('Virtual safety car, hold the delta.', 1, 'sc:vsc', 'virtual safety car', { status }, ctx, { immediate: true, ttlMs: 20000 });
  }
  if (phase === 'returning') return mk('Safety car in this lap.', 1, 'sc:returning', 'safety car returning', { status }, ctx, { immediate: true, ttlMs: 20000 });
  if (phase === 'resume' || phase === 'returned') return mk('Green flag, racing again.', 1, 'sc:resume', 'safety car period over', { status }, ctx, { immediate: true, ttlMs: 20000 });
  return null;
}

// ---- Strategy (priority 2) ----

export function fuelCall(fuelLaps: number, lapsLeft: number, ctx: CallContext): Call | null {
  const short = lapsLeft - fuelLaps;
  if (short >= 0.4) {
    const n = Math.min(5, Math.max(1, Math.round(short)));
    return mk(`Fuel, ${NUM[n]} ${n === 1 ? 'lap' : 'laps'} short, lift and coast.`, 2, 'fuel:short', 'fuel laps below laps remaining', { fuelLaps: +fuelLaps.toFixed(1), lapsLeft, short: n }, ctx, { ttlMs: 60000 });
  }
  if (short <= -1.5 && lapsLeft > 2) return mk('Fuel is good, push.', 2, 'fuel:ok', 'fuel margin over 1.5 laps', { fuelLaps: +fuelLaps.toFixed(1), lapsLeft }, ctx, { ttlMs: 60000 });
  return null;
}

export function tyreCalls(f: NormalisedFrame, ctx: CallContext): Call[] {
  const out: Call[] = [];
  const t = f.wheels.surfaceTemp, w = f.wheels.wear;
  if (t) {
    const front = Math.max(t[0], t[1]), rear = Math.max(t[2], t[3]);
    if (front > 110 && front >= rear) out.push(mk('Fronts are hot, give them a lap.', 2, 'tyre:front-hot', 'front surface temp over 110', { front: Math.round(front) }, ctx, { ttlMs: 30000 }));
    else if (rear > 110) out.push(mk('Rears are hot, easy on the exits.', 2, 'tyre:rear-hot', 'rear surface temp over 110', { rear: Math.round(rear) }, ctx, { ttlMs: 30000 }));
  }
  if (w) {
    const rear = Math.max(w[2], w[3]), front = Math.max(w[0], w[1]);
    if (rear > 60 && rear >= front) out.push(mk('Rears are gone, manage the exits.', 2, 'tyre:rear-worn', 'rear wear over 60 %', { rear: Math.round(rear) }, ctx, { ttlMs: 60000 }));
    else if (front > 60) out.push(mk('Fronts are going, protect them on entry.', 2, 'tyre:front-worn', 'front wear over 60 %', { front: Math.round(front) }, ctx, { ttlMs: 60000 }));
  }
  return out;
}

// ---- Coaching (priority 3): from the completed lap vs the driver's own best ----

export interface CoachingInput {
  update: AnalysisUpdate;
  assists: { abs: boolean | null; tc: number | null };
  /** max calls to produce */
  max: number;
}

export interface Diagnosis { text: string; kind: string; reason: string; facts: Call['facts'] }

/** a corner pass this much slower than the comparison is an incident (spin, off, contact, a stop), not technique:
 *  no coaching from it. Miami race: real technique losses were up to 0.8 s a corner, incidents 4.6 and 9.5 s. */
export const INCIDENT_MS = 2000;

/** One idea per corner, chosen by the largest clear cause. Shared by the radio (next lap) and the debrief. */
export function diagnoseCorner(corner: number, m: CornerMetrics, best: CornerMetrics, deltaMs: number, flags: { lockedHere: boolean; spunHere: boolean }, assists: { abs: boolean | null; tc: number | null }): Diagnosis {
  const T = `Turn ${corner}`;
  const tenths = Math.max(1, Math.round(deltaMs / 100));
  const facts: Call['facts'] = { corner, deltaMs: Math.round(deltaMs) };
  if (flags.lockedHere && assists.abs !== true) return { text: `${T}, ease off the brake, you're locking.`, kind: 'lock', reason: 'lockup detected this lap, ABS off', facts: { ...facts, cause: 'lockup' } };
  if (m.brakePointM !== null && best.brakePointM !== null && m.brakePointM - best.brakePointM >= 8) {
    const early = round5(m.brakePointM - best.brakePointM);
    return { text: `${T}, braking ${early} metres early.`, kind: 'brake', reason: 'brake point earlier than own best', facts: { ...facts, cause: 'brake-early', metres: early, lapBrakeM: Math.round(m.brakePointM), bestBrakeM: Math.round(best.brakePointM) } };
  }
  if (best.minSpeed - m.minSpeed >= 1.4) {
    const more = round5((best.minSpeed - m.minSpeed) * 3.6);
    return { text: `${T}, carry ${more} more through the apex.`, kind: 'apex', reason: 'min speed below own best', facts: { ...facts, cause: 'min-speed', kph: more, lapMin: +(m.minSpeed * 3.6).toFixed(0), bestMin: +(best.minSpeed * 3.6).toFixed(0) } };
  }
  if (flags.spunHere && assists.tc !== 2) return { text: `${T} exit, wheelspin, feed the throttle.`, kind: 'spin', reason: 'wheelspin on exit this lap', facts: { ...facts, cause: 'wheelspin' } };
  if (m.coastingM >= 15 && m.coastingM - best.coastingM >= 8) return { text: `${T}, you're coasting, pick up the throttle.`, kind: 'coast', reason: 'coasting distance above own best', facts: { ...facts, cause: 'coasting', coastM: m.coastingM, bestCoastM: best.coastingM } };
  if (m.throttlePickupM !== null && best.throttlePickupM !== null && m.throttlePickupM - best.throttlePickupM >= 8) return { text: `${T}, pick up the throttle earlier.`, kind: 'pickup', reason: 'throttle pick-up later than own best', facts: { ...facts, cause: 'pickup-late', metres: round5(m.throttlePickupM - best.throttlePickupM) } };
  if (m.brakeReleaseM !== null && best.brakeReleaseM !== null && best.brakeReleaseM - m.brakeReleaseM >= 8) return { text: `${T}, bleed the brake off slower.`, kind: 'trail', reason: 'brake released earlier than own best (less trail braking)', facts: { ...facts, cause: 'release-early' } };
  return { text: `${T}, you're losing ${tenths === 1 ? 'a tenth' : NUM[tenths] + ' tenths'} there.`, kind: 'delta', reason: 'corner slower than own best, no single cause', facts: { ...facts, cause: 'delta', tenths } };
}

export function coachingCalls(inp: CoachingInput, ctx: CallContext): Call[] {
  const u = inp.update;
  const last = u.laps[u.laps.length - 1];
  const fp = u.fingerprint;
  if (!last || !fp || u.pbLap === null || last.number === u.pbLap) return [];
  const out: Call[] = [];
  for (const wc of u.worstCorners) {
    if (out.length >= inp.max) break;
    if (wc.deltaMs < 120 || wc.deltaMs > INCIDENT_MS) continue; // under 0.12 s: noise; over INCIDENT_MS: an incident
    const m = last.corners.find((c) => c.corner === wc.corner);
    const st = fp.corners.find((c) => c.corner === wc.corner);
    if (!m || !st) continue;
    const lockedHere = fp.mistakes.some((x) => x.kind === 'lockup' && x.lap === last.number && x.corner === wc.corner);
    const spunHere = fp.mistakes.some((x) => x.kind === 'wheelspin' && x.lap === last.number && x.corner === wc.corner);
    const d = diagnoseCorner(wc.corner, m, st.best, wc.deltaMs, { lockedHere, spunHere }, inp.assists);
    out.push(mk(d.text, 3, `coach:T${wc.corner}:${d.kind}`, d.reason, { ...d.facts, lap: last.number }, ctx, { corner: wc.corner }));
  }
  return out;
}

// ---- Encouragement / info (priority 4) ----

export function lapCalls(u: AnalysisUpdate, prevPbMs: number | null, mode: 'quiet' | 'normal' | 'coach', ctx: CallContext): Call[] {
  const last = u.laps[u.laps.length - 1];
  if (!last || last.timeMs <= 0) return [];
  const out: Call[] = [];
  const isPb = u.pbMs !== null && last.number === u.pbLap && (prevPbMs === null || u.pbMs < prevPbMs) && u.laps.length >= 2;
  if (isPb) out.push(mk(`That's a new best, ${sayLapTime(last.timeMs)}.`, 4, `pb:${last.number}`, 'personal best this session', { lapMs: last.timeMs, lap: last.number }, ctx, { ttlMs: 60000 }));
  else if (mode === 'coach' && last.deltaToPbMs !== null) {
    const tenths = Math.round(last.deltaToPbMs / 100);
    const suffix = u.laps.length < 2 || tenths <= 0 ? '' : tenths === 1 ? ', a tenth off' : tenths < 10 ? `, ${NUM[tenths]} tenths off` : `, ${NUM[Math.floor(tenths / 10)] ?? Math.floor(tenths / 10)} point ${NUM[tenths % 10]} off`;
    out.push(mk(`${sayLapTime(last.timeMs)}${suffix}.`, 4, `lap:${last.number}`, 'lap time readout (coach mode)', { lapMs: last.timeMs, deltaMs: last.deltaToPbMs }, ctx, { ttlMs: 40000 }));
  }
  const fp = u.fingerprint;
  if (fp && fp.lapsAnalysed >= 3 && fp.consistencyScore !== null && fp.consistencyScore >= 85 && !isPb) {
    out.push(mk('Consistent, keep this rhythm.', 4, 'consistent', 'three laps within tolerance', { consistency: Math.round(fp.consistencyScore) }, ctx, { ttlMs: 60000 }));
  }
  return out;
}

export const RADIO_CHECK = (ctx: CallContext): Call => mk('Radio check, loud and clear.', 4, 'radio-check', 'setup test', {}, ctx, { ttlMs: 10000 });
