// Push-to-talk Q&A answered from data. Deterministic intent rules first; an optional LLM answers free-form
// questions from the same fact sheet; otherwise "I don't have that."
import type { AnalysisUpdate } from '../analysis/session.ts';
import type { NormalisedFrame } from '../core/types.ts';
import type { Phraser } from './phrase.ts';
import { sayLapTime } from '../radio/calls.ts';
import { classify } from '../voice/intent.ts';

export interface QaContext { update: AnalysisUpdate | null; frame: NormalisedFrame | null; fuelLaps: number | null; lapsLeft: number | null; game: 'f1' | 'gt7' | null }
export interface Answer { text: string; intent: string; facts: Record<string, number | string | null>; source: 'rule' | 'llm' | 'none' }

const fmt = (ms: number) => { const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(1); return `${m} ${s}`; };
const say = sayLapTime;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const tenths = (ms: number) => { const n = Math.max(1, Math.round(Math.abs(ms) / 100)); return n >= 10 ? `${(Math.abs(ms) / 1000).toFixed(1)} seconds` : n === 1 ? 'a tenth' : `${WORDS[n]} tenths`; };

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
  const u = c.update, f = c.frame;
  const none = (intent: string, what: string): Answer => ({ text: `${what} not provided by this game.`, intent, facts: {}, source: 'rule' });
  const r = (text: string, intent: string, facts: Answer['facts'] = {}): Answer => ({ text, intent, facts, source: 'rule' });
  switch (classify(q)) {
    case 'fuel': {
      if (!f || f.fuel.level === null) return none('fuel', 'Fuel');
      if (c.fuelLaps !== null && c.lapsLeft !== null) {
        const margin = c.fuelLaps - c.lapsLeft;
        return r(margin >= 0.5 ? `Fuel is good, ${Math.floor(margin)} laps spare.` : margin > -0.5 ? 'Fuel is marginal, lift and coast.' : `Fuel, ${Math.ceil(-margin)} laps short.`, 'fuel', { fuelLaps: +c.fuelLaps.toFixed(1), lapsLeft: c.lapsLeft });
      }
      if (c.fuelLaps !== null) return r(`Fuel for ${Math.floor(c.fuelLaps)} more laps.`, 'fuel', { fuelLaps: +c.fuelLaps.toFixed(1) });
      return r(`Fuel ${f.fuel.level.toFixed(0)}, no lap estimate yet.`, 'fuel', { level: +f.fuel.level.toFixed(1) });
    }
    case 'tyres': {
      if (!f?.wheels.surfaceTemp) return none('tyres', 'Tyre data');
      // wheels are FL FR RL RR: say each pair left then right, and what the numbers are
      const w = f.wheels.wear?.map(Math.round), t = f.wheels.surfaceTemp.map(Math.round);
      if (w && !/temp|hot|cold|warm|heat/i.test(q)) {
        const i = w.indexOf(Math.max(...w));
        return r(`${['Front left', 'Front right', 'Rear left', 'Rear right'][i]} worst, ${w[i]} percent wear.`, 'tyres', { fl: w[0]!, fr: w[1]!, rl: w[2]!, rr: w[3]! });
      }
      return r(`Surface temps: fronts ${t[0]} and ${t[1]}, rears ${t[2]} and ${t[3]} degrees.`, 'tyres', { fl: t[0]!, fr: t[1]!, rl: t[2]!, rr: t[3]! });
    }
    case 'losing': {
      if (u && !u.hasReference && u.referenceMs !== null) return r('No clean trace of that lap, ask after the next one.', 'losing'); // race start from the grid, or an outage: no trace
      if (!u || !u.hasReference) return r('No reference lap yet, keep lapping.', 'losing');
      if (!u.worstCorners.length) return r('Nowhere big, you matched your best through every corner.', 'losing');
      const w = u.worstCorners.slice(0, 2);
      return r(`${w.map((x) => `Turn ${x.corner}, ${tenths(x.deltaMs)}`).join(', and ')}.`, 'losing', Object.fromEntries(w.map((x) => [`turn${x.corner}`, Math.round(x.deltaMs)])));
    }
    case 'best': {
      if (!u || u.pbMs === null) return r('No valid lap yet.', 'best');
      return r(`Best is ${say(u.pbMs)}, lap ${u.pbLap}.`, 'best', { bestMs: u.pbMs, lap: u.pbLap });
    }
    case 'lap': {
      const last = u?.laps[u.laps.length - 1];
      if (!last) return r('No completed lap yet.', 'lap');
      const d = last.deltaToPbMs;
      return r(`${say(last.timeMs)}${d && d > 0 ? `, ${tenths(d)} off your best` : d === 0 ? ', your best' : ''}.`, 'lap', { lapMs: last.timeMs, deltaMs: d });
    }
    case 'consistency': {
      const sc = u?.fingerprint?.consistencyScore;
      if (sc == null) return r('Need three laps for that.', 'consistency');
      return r(`Consistency ${Math.round(sc)} out of 100.`, 'consistency', { score: Math.round(sc) });
    }
    case 'position': {
      if (!f || f.race.position === null) return none('position', 'Race position');
      return r(`You are P${f.race.position}.`, 'position', { position: f.race.position });
    }
    case 'laps-left': {
      if (c.lapsLeft === null) return none('laps', 'Lap count');
      return r(`${c.lapsLeft} laps to go.`, 'laps', { lapsLeft: c.lapsLeft });
    }
    case 'track': {
      if (!u || !u.corners.length) return r('Still learning the track.', 'track');
      return r(`${u.trackName ?? 'This track'}, ${u.corners.length} corners, ${Math.round((u.trackLength ?? 0) / 100) / 10} kilometres.`, 'track', { corners: u.corners.length });
    }
    case 'flags': {
      if (!f || f.flags.fia === null) return none('flags', 'Flag status');
      return r(f.flags.safetyCar && f.flags.safetyCar !== 'none' ? `${f.flags.safetyCar} safety car out.` : f.flags.fia === 'none' ? 'All clear, no flags.' : `${f.flags.fia} flag.`, 'flags', { flag: f.flags.fia });
    }
    case 'radio-check': return r('Loud and clear.', 'radio');
    case 'thanks': return r('Copy.', 'thanks');
    case 'gap': case 'weather': return r("I don't have that yet.", 'unsupported');
    default: return null; // commands (repeat, mute, modes) are handled by the voice layer
  }
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
