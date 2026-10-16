// Persona rules (DESIGN_SYSTEM.md "Voice and tone"). Applied to every call before it is spoken and
// to the 20 reference calls in tests. A failing call is dropped, never "fixed up".
import type { Call } from './queue.ts';

const HEDGES = ['might', 'maybe', 'perhaps', 'consider', 'basically', 'okay so', 'kind of', 'sort of', 'i think', 'try to'];
const FILLER = ['great job', 'awesome', 'amazing', 'keep it up', 'well done!!'];

export interface RuleResult { ok: boolean; violations: string[] }

export function checkCall(c: Call): RuleResult {
  const v: string[] = [];
  const words = c.text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) v.push('empty');
  if (words.length > 12) v.push(`too long (${words.length} words)`);
  if (/!/.test(c.text)) v.push('exclamation mark');
  const lower = c.text.toLowerCase();
  for (const h of HEDGES) if (lower.includes(h)) v.push(`hedge: ${h}`);
  for (const f of FILLER) if (lower.includes(f)) v.push(`filler: ${f}`);
  if (c.priority === 3) {
    if (!/\bturn \d+\b/i.test(c.text)) v.push('coaching call without a corner number');
    if (typeof c.facts.corner !== 'number') v.push('coaching call without corner fact');
    // every number in the text must come from the facts
    const nums = (c.text.match(/\d+/g) ?? []).map(Number);
    const factNums = new Set(Object.values(c.facts).filter((x): x is number => typeof x === 'number'));
    for (const n of nums) if (!factNums.has(n)) v.push(`number ${n} not in facts`);
  }
  if (!/[.?]$/.test(c.text.trim())) v.push('no terminal punctuation');
  return { ok: v.length === 0, violations: v };
}

/** The 20 reference calls from DESIGN_SYSTEM.md, as the persona test set. */
export const REFERENCE_CALLS: { text: string; priority: 1 | 2 | 3 | 4; facts: Call['facts'] }[] = [
  { text: 'Turn 4, braking 10 metres early.', priority: 3, facts: { corner: 4, metres: 10 } },
  { text: 'Turn 7, carry 5 more through the apex.', priority: 3, facts: { corner: 7, kph: 5 } },
  { text: "Turn 9, pick up throttle earlier, you're coasting.", priority: 3, facts: { corner: 9 } },
  { text: "Turn 2, ease off the brake, you're locking.", priority: 3, facts: { corner: 2 } },
  { text: 'Turn 11 exit, wheelspin, feed the throttle.', priority: 3, facts: { corner: 11 } },
  { text: 'Turn 1, bleed the brake off slower.', priority: 3, facts: { corner: 1 } },
  { text: 'Purple sector two.', priority: 4, facts: { sector: 2 } },
  { text: "That's a new best, one thirty-two four.", priority: 4, facts: { lapMs: 92400 } },
  { text: 'Yellow flag, sector three.', priority: 1, facts: { sector: 3 } },
  { text: 'Safety car, safety car.', priority: 1, facts: {} },
  { text: 'Box this lap, box box.', priority: 2, facts: {} },
  { text: 'Fuel, two laps short, lift and coast.', priority: 2, facts: { short: 2 } },
  { text: 'Fronts are hot, give them a lap.', priority: 2, facts: {} },
  { text: 'Rears are gone, manage the exits.', priority: 2, facts: {} },
  { text: 'Gap ahead one point two, closing.', priority: 4, facts: { gapS: 1.2 } },
  { text: "Turn 6, you're losing three tenths there.", priority: 3, facts: { corner: 6, tenths: 3 } },
  { text: 'Consistent, keep this rhythm.', priority: 4, facts: {} },
  { text: 'DRS available.', priority: 4, facts: {} },
  { text: 'Rain in two minutes, stay out.', priority: 2, facts: { minutes: 2 } },
  { text: 'Radio check, loud and clear.', priority: 4, facts: {} },
];

export const REJECTED_EXAMPLES: string[] = [
  'Brake later!',
  'Great job, keep it up!!',
  'You might want to consider braking a little later into the next corner.',
  'Okay so basically what I am seeing is that you are losing a lot of time in the middle sector today.',
];
