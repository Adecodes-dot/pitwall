import { describe, expect, it } from 'vitest';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { SessionAnalyser } from '../analysis/session.ts';
import { Store } from '../analysis/store.ts';
import { buildDebrief, debriefHtml } from './debrief.ts';
import { checkCall } from '../radio/rules.ts';
import { answerByRule, answerQuestion, factSheet } from '../llm/qa.ts';
import { sameNumbers, TemplatePhraser, AnthropicPhraser } from '../llm/phrase.ts';
import type { NormalisedFrame } from '../core/types.ts';

function run(game: 'f1' | 'gt7', store: Store | null = null, laps = 5) {
  const sess = generateSession(defaultTrack(), laps, { seed: 23, brakeJitterM: 15, speedJitter: 0.06 });
  const recs = synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' });
  const an = new SessionAnalyser(store);
  const a = game === 'f1' ? new F1Adapter() : new Gt7Adapter();
  let last: NormalisedFrame | null = null;
  for (const r of recs) { const o = a.feed(r.data, r.t); for (const f of o.frames) { an.onFrame(f); last = f; } for (const e of o.events) an.onEvent(e); }
  return { an, last };
}

describe('debrief', () => {
  for (const game of ['f1', 'gt7'] as const) {
    it(`${game}: top-3 corners with traces and one specific instruction each, a drill, and an HTML export`, () => {
      const store = new Store(':memory:');
      const { an } = run(game, store);
      const d = buildDebrief(an, store)!;
      expect(d).not.toBeNull();
      expect(d.laps).toBe(5);
      expect(d.bestMs).not.toBeNull();
      expect(d.theoreticalMs!).toBeLessThanOrEqual(d.bestMs!);
      expect(d.topCorners).toHaveLength(3);
      // ranked by time lost, every one with traces of the same length for lap and reference
      for (let i = 1; i < d.topCorners.length; i++) expect(d.topCorners[i]!.lostMs).toBeLessThanOrEqual(d.topCorners[i - 1]!.lostMs);
      for (const c of d.topCorners) {
        expect(c.traces.lap.s.length).toBe(c.traces.ref.s.length);
        expect(c.traces.lap.s.length).toBeGreaterThan(50);
        expect(c.traces.deltaMs.length).toBe(c.traces.lap.s.length);
        expect(c.diagnosis.text).toMatch(new RegExp(`^Turn ${c.corner.index}`));
        // the instruction obeys the persona rules (as a coaching call)
        const res = checkCall({ text: c.diagnosis.text, priority: 3, key: 'x', reason: c.diagnosis.reason, facts: c.diagnosis.facts, dueAfter: 0, expiresAt: 1, immediate: false, createdAt: 0, triggerT: 0 });
        expect(res.violations).toEqual([]);
        expect(c.worstLap).not.toBe(d.bestLap);
      }
      expect(d.drill).not.toBeNull();
      expect(d.drill!.text).toMatch(/Ten laps, T\d+ only\./);
      expect(d.drill!.target).toMatch(/minimum \d+ km\/h/);
      expect(d.summary).toContain('Best');
      const html = debriefHtml(d);
      expect(html).toContain('<svg');
      expect(html).toContain(d.drill!.text);
      expect(html).not.toContain('<script');
      expect(html.length).toBeGreaterThan(5000);
      expect(d.progress).toHaveLength(1);
      store.close();
    });
  }
});

describe('Q&A from data', () => {
  const { an, last } = run('f1');
  const ctx = { update: an.lastUpdate, frame: last, fuelLaps: last!.fuel.lapsRemaining, lapsLeft: 10, game: 'f1' as const };
  const cases: [string, string, RegExp][] = [
    ["how's my fuel", 'fuel', /Fuel/],
    ['where am I losing time', 'losing', /^Turn \d+, (a tenth|\w+ tenths)/],
    ["what's my best", 'best', /Best is one \w+(-\w+)? \w+, lap \d/],
    ['how was that lap', 'lap', /^one \w+(-\w+)? \w+/],
    ['how are the tyres', 'tyres', /Fronts \d+, rears \d+/],
    ['am I consistent', 'consistency', /Consistency \d+ out of 100/],
    ['what position am I', 'position', /P\d/],
    ['how many laps left', 'laps', /10 laps to go/],
    ['what track is this', 'track', /corners/],
    ['any flags', 'flags', /clear|flag/],
  ];
  for (const [q, intent, re] of cases) {
    it(`"${q}" → ${intent}`, () => {
      const a = answerByRule(q, ctx)!;
      expect(a).not.toBeNull();
      expect(a.intent).toBe(intent);
      expect(a.text).toMatch(re);
      expect(a.text.split(/\s+/).length).toBeLessThanOrEqual(16);
    });
  }
  it('GT7 without race position answers "not provided"', () => {
    const g = run('gt7');
    const a = answerByRule('what position am I', { update: g.an.lastUpdate, frame: g.last, fuelLaps: null, lapsLeft: null, game: 'gt7' })!;
    expect(a.text).toMatch(/not provided by this game/);
  });
  it('unknown question without an LLM says so; fact sheet lists what is known', async () => {
    const a = await answerQuestion('what should I have for dinner', ctx, new TemplatePhraser());
    expect(a.source).toBe('none');
    expect(a.text).toBe("I don't have that.");
    expect(factSheet(ctx)).toMatch(/best lap this session/);
  });
});

describe('LLM phrasing guard rails', () => {
  it('sameNumbers requires identical numbers', () => {
    expect(sameNumbers('Turn 4, braking 10 metres early.', 'Ten metres early into Turn 4.')).toBe(false); // "Ten" is not a digit
    expect(sameNumbers('Turn 4, braking 10 metres early.', 'Turn 4, you are 10 metres early on the brakes.')).toBe(true);
    expect(sameNumbers('Turn 4, braking 10 metres early.', 'Turn 4, braking 15 metres early.')).toBe(false);
  });
  it('a rephrase that invents or drops numbers is rejected; a faithful one is accepted', async () => {
    class Fake extends AnthropicPhraser { reply = ''; protected override async complete(): Promise<string | null> { return this.reply; } }
    const call = { text: 'Turn 4, braking 10 metres early.', priority: 3 as const, key: 'k', reason: 'r', facts: { corner: 4, metres: 10 }, dueAfter: 0, expiresAt: 1, immediate: false, createdAt: 0, triggerT: 0 };
    const p = new Fake();
    p.reply = 'Turn 4, brakes on 15 metres too early.'; expect(await p.rephrase(call)).toBeNull();
    p.reply = 'Turn 4, you might want to brake 10 metres later.'; expect(await p.rephrase(call)).toBeNull();
    p.reply = 'Turn 4, you are on the brakes 10 metres early.'; expect(await p.rephrase(call)).toBe('Turn 4, you are on the brakes 10 metres early.');
    expect(p.stats).toMatchObject({ accepted: 1, rejected: 2 });
  });
});
