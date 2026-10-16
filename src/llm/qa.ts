// Push-to-talk Q&A answered from data. Deterministic intent rules first; an optional LLM answers free-form
// questions from the same fact sheet; otherwise "I don't have that."
import type { AnalysisUpdate } from '../analysis/session.ts';
import type { NormalisedFrame } from '../core/types.ts';
import type { Phraser } from './phrase.ts';
import { sayLapTime } from '../radio/calls.ts';

export interface QaContext { update: AnalysisUpdate | null; frame: NormalisedFrame | null; fuelLaps: number | null; lapsLeft: number | null; game: 'f1' | 'gt7' | null }
export interface Answer { text: string; intent: string; facts: Record<string, number | string | null>; source: 'rule' | 'llm' | 'none' }

const fmt = (ms: number) => { const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(1); return `${m} ${s}`; };
const say = sayLapTime;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const tenths = (ms: number) => { const n = Math.max(1, Math.round(Math.abs(ms) / 100)); return n > 12 ? `${(Math.abs(ms) / 1000).toFixed(1)} seconds` : n === 1 ? 'a tenth' : `${WORDS[n]} tenths`; };

export function factSheet(c: QaContext): string {
  const u = c.update, f = c.frame;
  const lines: string[] = [];
  if (f) {
    if (f.fuel.level !== null) lines.push(`fuel level: ${f.fuel.level.toFixed(1)}`);
    if (c.fuelLaps !== null) lines.push(`fuel laps remaining: ${c.fuelLaps.toFixed(1)}`);
    if (c.lapsLeft !== null) lines.push(`race laps remaining: ${c.lapsLeft}`);
    if (f.wheels.surfaceTemp) lines.push(`tyre surface temps FL FR RL RR: ${f.wheels.surfaceTemp.map((x) => Math.round(x)).join(' ')} C`);
    if (f.wheels.wear) lines.push(`tyre wear FL FR RL RR: ${f.wheels.wear.map((x) => Math.round(x)).join(' ')} percent`);
    if (f.race.position !== null) lines.push(`race position: ${f.race.position}`);
    if (f.lap.number !== null) lines.push(`current lap: ${f.lap.number}${f.lap.total ? ` of ${f.lap.total}` : ''}`);
    if (f.lap.lastTimeMs !== null) lines.push(`last lap: ${fmt(f.lap.lastTimeMs)}`);
    if (f.flags.fia) lines.push(`flag: ${f.flags.fia}`);
  }
  if (u) {
    if (u.pbMs !== null) lines.push(`best lap this session: ${fmt(u.pbMs)} (lap ${u.pbLap})`);
    if (u.theoreticalMs !== null) lines.push(`theoretical best: ${fmt(u.theoreticalMs)}`);
    if (u.fingerprint?.consistencyScore != null) lines.push(`consistency: ${Math.round(u.fingerprint.consistencyScore)} of 100`);
    if (u.worstCorners.length) lines.push(`time lost last lap vs best: ${u.worstCorners.map((w) => `turn ${w.corner} ${tenths(w.deltaMs)} s`).join(', ')}`);
    if (u.trackName) lines.push(`track: ${u.trackName}, ${u.corners.length} corners, ${u.trackLength} m`);
  }
  return lines.join('\n') || 'no data yet';
}

export function answerByRule(q: string, c: QaContext): Answer | null {
  const s = q.toLowerCase();
  const u = c.update, f = c.frame;
  const none = (intent: string, what: string): Answer => ({ text: `${what} not provided by this game.`, intent, facts: {}, source: 'rule' });
  if (/fuel|petrol|gas\b/.test(s)) {
    if (!f || f.fuel.level === null) return none('fuel', 'Fuel');
    if (c.fuelLaps !== null && c.lapsLeft !== null) {
      const margin = c.fuelLaps - c.lapsLeft;
      return { text: margin >= 0.5 ? `Fuel is good, ${Math.floor(margin)} laps spare.` : margin > -0.5 ? 'Fuel is marginal, lift and coast.' : `Fuel, ${Math.ceil(-margin)} laps short.`, intent: 'fuel', facts: { fuelLaps: +c.fuelLaps.toFixed(1), lapsLeft: c.lapsLeft }, source: 'rule' };
    }
    if (c.fuelLaps !== null) return { text: `Fuel for ${Math.floor(c.fuelLaps)} more laps.`, intent: 'fuel', facts: { fuelLaps: +c.fuelLaps.toFixed(1) }, source: 'rule' };
    return { text: `Fuel ${f.fuel.level.toFixed(0)}, no lap estimate yet.`, intent: 'fuel', facts: { level: +f.fuel.level.toFixed(1) }, source: 'rule' };
  }
  if (/tyre|tire|temp|wear|rubber/.test(s)) {
    if (!f?.wheels.surfaceTemp) return none('tyres', 'Tyre data');
    const t = f.wheels.surfaceTemp, front = Math.round((t[0] + t[1]) / 2), rear = Math.round((t[2] + t[3]) / 2);
    const wear = f.wheels.wear ? `, wear ${Math.round(Math.max(...f.wheels.wear))} percent` : '';
    return { text: `Fronts ${front}, rears ${rear}${wear}.`, intent: 'tyres', facts: { front, rear }, source: 'rule' };
  }
  if (/losing|lose|where.*time|slow|weak/.test(s)) {
    if (!u || !u.worstCorners.length) return { text: 'No reference lap yet, keep lapping.', intent: 'losing', facts: {}, source: 'rule' };
    const w = u.worstCorners.slice(0, 2);
    return { text: `${w.map((x) => `Turn ${x.corner}, ${tenths(x.deltaMs)}`).join(', and ')}.`, intent: 'losing', facts: Object.fromEntries(w.map((x) => [`turn${x.corner}`, Math.round(x.deltaMs)])), source: 'rule' };
  }
  if (/best|fastest|pb/.test(s)) {
    if (!u || u.pbMs === null) return { text: 'No valid lap yet.', intent: 'best', facts: {}, source: 'rule' };
    return { text: `Best is ${say(u.pbMs)}, lap ${u.pbLap}.`, intent: 'best', facts: { bestMs: u.pbMs, lap: u.pbLap }, source: 'rule' };
  }
  if (/last lap|lap time|how was that|that lap/.test(s)) {
    const last = u?.laps[u.laps.length - 1];
    if (!last) return { text: 'No completed lap yet.', intent: 'lap', facts: {}, source: 'rule' };
    const d = last.deltaToPbMs;
    return { text: `${say(last.timeMs)}${d && d > 0 ? `, ${tenths(d)} off your best` : d === 0 ? ', your best' : ''}.`, intent: 'lap', facts: { lapMs: last.timeMs, deltaMs: d }, source: 'rule' };
  }
  if (/consisten|rhythm/.test(s)) {
    const sc = u?.fingerprint?.consistencyScore;
    if (sc == null) return { text: 'Need three laps for that.', intent: 'consistency', facts: {}, source: 'rule' };
    return { text: `Consistency ${Math.round(sc)} out of 100.`, intent: 'consistency', facts: { score: Math.round(sc) }, source: 'rule' };
  }
  if (/position|gap|ahead|behind|p\d/.test(s)) {
    if (!f || f.race.position === null) return none('position', 'Race position');
    return { text: `You are P${f.race.position}.`, intent: 'position', facts: { position: f.race.position }, source: 'rule' };
  }
  if (/lap(s)? (left|remaining|to go)|how many laps/.test(s)) {
    if (c.lapsLeft === null) return none('laps', 'Lap count');
    return { text: `${c.lapsLeft} laps to go.`, intent: 'laps', facts: { lapsLeft: c.lapsLeft }, source: 'rule' };
  }
  if (/track|corner|where are we|circuit/.test(s)) {
    if (!u || !u.corners.length) return { text: 'Still learning the track.', intent: 'track', facts: {}, source: 'rule' };
    return { text: `${u.trackName ?? 'This track'}, ${u.corners.length} corners, ${Math.round((u.trackLength ?? 0) / 100) / 10} kilometres.`, intent: 'track', facts: { corners: u.corners.length }, source: 'rule' };
  }
  if (/flag|safety car/.test(s)) {
    if (!f || f.flags.fia === null) return none('flags', 'Flag status');
    return { text: f.flags.safetyCar && f.flags.safetyCar !== 'none' ? `${f.flags.safetyCar} safety car out.` : f.flags.fia === 'none' ? 'All clear, no flags.' : `${f.flags.fia} flag.`, intent: 'flags', facts: { flag: f.flags.fia }, source: 'rule' };
  }
  if (/radio check|can you hear/.test(s)) return { text: 'Loud and clear.', intent: 'radio', facts: {}, source: 'rule' };
  return null;
}

export async function answerQuestion(q: string, c: QaContext, phraser: Phraser | null): Promise<Answer> {
  const rule = answerByRule(q, c);
  if (rule) return rule;
  if (phraser) {
    const text = await phraser.answer(q, factSheet(c));
    if (text) return { text, intent: 'free', facts: {}, source: 'llm' };
  }
  return { text: "I don't have that.", intent: 'unknown', facts: {}, source: 'none' };
}
