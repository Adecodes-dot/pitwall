import { describe, expect, it } from 'vitest';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { SessionAnalyser } from '../analysis/session.ts';
import { Store } from '../analysis/store.ts';
import { buildDebrief, currentDebrief, debriefHtml, saveDebrief } from './debrief.ts';
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
      // every trace point is inside its SVG (the pedal traces used to be drawn below the bottom edge)
      for (const m of html.matchAll(/<svg viewBox="0 0 (\d+) (\d+)"[\s\S]*?<\/svg>/g)) {
        const h = Number(m[2]);
        for (const g of m[0].matchAll(/(?:<g transform="translate\(0,(\d+)\)">)?((?:<polyline[^>]*\/>)+)/g)) {
          const dy = Number(g[1] ?? 0);
          for (const p of g[2]!.matchAll(/points="([^"]+)"/g)) for (const xy of p[1]!.split(' ')) { const y = Number(xy.split(',')[1]) + dy; expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(h); }
        }
      }
      expect(d.progress).toHaveLength(1);
      store.close();
    });
  }
});

describe('incidents in the debrief', () => {
  it('in-laps and out-laps (pit lane) get no trace: no coaching, ranking or reference from them', () => {
    // Miami race laps 16-17 (pit stop): the limiter through the pit lane came out as "Turn 1, carry 190 more"
    const sess = generateSession(defaultTrack(), 5, { seed: 23, brakeJitterM: 15, speedJitter: 0.06 });
    const recs = synthRecords(sess, 'f1', { format: 2025 });
    const an = new SessionAnalyser(null), a = new F1Adapter();
    for (const r of recs) { const o = a.feed(r.data, r.t); for (const f of o.frames) { if (f.lap.number === 3) f.flags.pitting = true; an.onFrame(f); } for (const e of o.events) an.onEvent(e); }
    const pitLap = an.collector.laps.find((l) => l.number === 3)!;
    expect(pitLap.pit).toBe(true);
    expect(pitLap.ch).toBeNull();
    expect(an.collector.laps.filter((l) => l.ch).length).toBeGreaterThanOrEqual(3);
    for (const c of buildDebrief(an, null)!.topCorners) expect(c.worstLap).not.toBe(3);
  });
  it('a corner pass that lost over 2 s (spin, off, contact) is kept out of the ranking and the drill', () => {
    // Miami race: laps 16-17 lost 4.6 s at T14 and 9.5 s at T1, which ranked first and became the drill
    const store = new Store(':memory:');
    const { an } = run('f1', store);
    const pb = buildDebrief(an, store)!.bestLap;
    const lap = an.collector.laps.find((l) => l.ch && l.number !== pb && !l.rewound)!;
    const c = an.model!.corners[0]!;
    const t = lap.ch!.t;
    for (let s = Math.round(c.sApex); s < lap.ch!.L; s++) t[s] = t[s]! + 5000; // 5 s stopped at the apex
    const d = buildDebrief(an, store)!;
    for (const x of d.topCorners) {
      expect(x.lostMs).toBeLessThan(5000);
      if (x.corner.index === c.index) expect(x.worstLap).not.toBe(lap.number);
    }
    store.close();
  });
});

describe('debrief across an app restart', () => {
  it('the last saved debrief is served until the new run completes a lap, then the live one takes over', () => {
    const store = new Store(':memory:');
    expect(currentDebrief(new SessionAnalyser(store), store)).toBeNull(); // nothing saved yet
    const { an } = run('f1', store);
    saveDebrief(an, store); // the server does this on every completed lap
    const live = buildDebrief(an, store)!;
    // the app restarts: a new analyser on the same database, no session yet
    const after = new SessionAnalyser(store);
    expect(buildDebrief(after, store)).toBeNull();
    const d = currentDebrief(after, store)!;
    expect(d.previousSession).toBe(true);
    expect(d.laps).toBe(live.laps);
    expect(d.bestMs).toBe(live.bestMs);
    expect(d.topCorners).toHaveLength(3);
    expect(d.topCorners[0]!.traces.lap.s.length).toBeGreaterThan(50);
    expect(d.progress).toHaveLength(1);
    expect(debriefHtml(d)).toContain('<svg');
    // a session in progress without laps keeps showing it; the first lap of a new run replaces it
    const next = run('f1', store, 3).an;
    expect(currentDebrief(next, store)!.previousSession).toBe(false);
    expect(currentDebrief(next, store)!.laps).toBe(3);
    store.close();
  });
  it('a save that runs after the next session started (no lap yet) still keeps the finished session', () => {
    const store = new Store(':memory:');
    const { an } = run('f1', store);
    an.onEvent({ type: 'session.start', t: 0, sessionUid: '2' }); // the save is deferred: it can run after this
    saveDebrief(an, store);
    const d = currentDebrief(new SessionAnalyser(store), store)!;
    expect(d.laps).toBe(5);
    expect(d.topCorners).toHaveLength(3);
    store.close();
  });
});

describe('Q&A from data', () => {
  const { an, last } = run('f1');
  const ctx = { update: an.lastUpdate, frame: last, fuelLaps: last!.fuel.lapsRemaining, lapsLeft: 10, game: 'f1' as const };
  const cases: [string, string, RegExp][] = [
    ["how's my fuel", 'fuel', /Fuel/],
    ['where am I losing time', 'losing', /^Turn \d+, (a tenth|\w+ tenths)/],
    ["what's my best", 'best', /Best is one \w+(-\w+)? point \w+, lap \d/],
    ['how was that lap', 'lap', /^one \w+(-\w+)? \w+/],
    ['how are the tyres', 'tyres', /^(Front|Rear) (left|right) worst, \d+ percent wear\.$/],
    ['tyre temps', 'tyres', /^Surface temps: fronts \d+ and \d+, rears \d+ and \d+ degrees\.$/],
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
