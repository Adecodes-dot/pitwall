// Natural-language intent matching for spoken questions. No fixed command phrases: a question matches when it
// contains the right *kind* of words (with synonyms, plurals and one-letter ASR typos tolerated), in any order.
// Deterministic by design: it only selects WHICH measured fact to read back, it never invents one.

export type Intent =
  | 'fuel' | 'tyres' | 'losing' | 'best' | 'lap' | 'consistency' | 'position' | 'laps-left' | 'track' | 'flags' | 'radio-check' | 'gap' | 'weather'
  | 'repeat' | 'mode-quiet' | 'mode-normal' | 'mode-coach' | 'mute' | 'unmute' | 'thanks';

const NUMBER_WORDS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** lower-case words, punctuation gone, contractions folded ("how's" → "how is"), spelling variants unified */
export function normalise(text: string): string[] {
  const t = text.toLowerCase()
    .replace(/[’']s\b/g, ' is').replace(/[’']re\b/g, ' are').replace(/[’']m\b/g, ' am').replace(/n[’']t\b/g, ' not').replace(/[’']ll\b/g, ' will').replace(/[’']ve\b/g, ' have')
    .replace(/[^a-z0-9\s]/g, ' ');
  // glued or garbled "talk less" / "talk more" as the small recogniser writes them ("talklace", "talkmore")
  return t.split(/\s+/).filter(Boolean).flatMap((w) => /^talk(less|lace|lass|les|list|lis|lest)$/.test(w) ? ['talk', 'less'] : /^talk(more|mor|moor)$/.test(w) ? ['talk', 'more'] : [(w === 'tire' || w === 'tires' || w === 'tyres' || w === 'attires' || w === 'attire' ? 'tyre' : w === 'feudal' || w === 'fuels' ? 'fuel' : w === 'gonna' ? 'going' : w === 'taught' || w === 'tock' || w === 'tok' ? 'talk' : w === 'loosen' || w === 'loosing' || w === 'loose' ? 'losing' : w === 'flakes' || w === 'flex' || w === 'flax' ? 'flags' : NUMBER_WORDS[w] ?? w)]);
}

function lev(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!; prev[0] = i; let rowMin = prev[0]!;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp; rowMin = Math.min(rowMin, prev[j]!);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length]!;
}

/** token matches a word: exact, plural/-ing/-ed stem, or one typo for words of 6+ letters */
export function wordMatch(token: string, word: string): boolean {
  if (token === word) return true;
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');
  if (word.length >= 4 && stem(token) === stem(word)) return true;
  return word.length >= 6 && lev(token, word, 1) <= 1;
}

const has = (tokens: string[], words: string[]): boolean => tokens.some((t) => words.some((w) => wordMatch(t, w)));
/** adjacent word pair, e.g. phrase(tokens, 'last', 'lap') */
const phrase = (tokens: string[], ...words: string[]): boolean => {
  for (let i = 0; i + words.length <= tokens.length; i++) if (words.every((w, k) => wordMatch(tokens[i + k]!, w))) return true;
  return false;
};

interface Rule { intent: Intent; test: (t: string[]) => boolean }

// Order matters: commands first, then the most specific data questions.
const RULES: Rule[] = [
  { intent: 'repeat', test: (t) => phrase(t, 'say', 'that', 'again') || phrase(t, 'say', 'again') || phrase(t, 'come', 'again') || phrase(t, 'what', 'did', 'you', 'say') || has(t, ['repeat', 'pardon', 'sorry']) || (has(t, ['again']) && t.length <= 4) },
  { intent: 'mode-quiet', test: (t) => has(t, ['quiet', 'quieter']) || (has(t, ['less']) && has(t, ['talk', 'chatter', 'calls', 'radio', 'noise', 'talking'])) || phrase(t, 'talk', 'less') || phrase(t, 'less', 'chatter') || phrase(t, 'less', 'talking') || (has(t, ['only', 'just']) && has(t, ['important', 'essential', 'critical', 'safety'])) || phrase(t, 'fewer', 'calls') || phrase(t, 'keep', 'it', 'short') },
  { intent: 'mode-coach', test: (t) => has(t, ['coach', 'coaching']) || phrase(t, 'talk', 'more') || phrase(t, 'more', 'feedback') || phrase(t, 'more', 'feet', 'back') || phrase(t, 'more', 'feed', 'back') || phrase(t, 'more', 'tips') || phrase(t, 'help', 'me', 'improve') || phrase(t, 'tell', 'me', 'more') },
  { intent: 'unmute', test: (t) => has(t, ['unmute']) || phrase(t, 'talk', 'to', 'me') || phrase(t, 'you', 'can', 'talk') || phrase(t, 'start', 'talking') || phrase(t, 'turn', 'on', 'radio') },
  { intent: 'mute', test: (t) => has(t, ['mute', 'silence', 'silent']) || phrase(t, 'stop', 'talking') || phrase(t, 'shut', 'up') || phrase(t, 'stop', 'radio') || phrase(t, 'no', 'more', 'talking') || phrase(t, 'turn', 'off', 'radio') },
  { intent: 'mode-normal', test: (t) => has(t, ['normal']) || phrase(t, 'back', 'to', 'normal') || phrase(t, 'default', 'mode') },
  { intent: 'radio-check', test: (t) => phrase(t, 'radio', 'check') || (has(t, ['radio']) && has(t, ['chick', 'chuck', 'chic', 'chek', 'cheque', 'czech'])) || phrase(t, 'can', 'you', 'hear') || phrase(t, 'are', 'you', 'there') || phrase(t, 'do', 'you', 'copy') || (has(t, ['hello', 'hi', 'test', 'testing']) && t.length <= 3) },
  { intent: 'thanks', test: (t) => has(t, ['thanks', 'thank', 'cheers', 'perfect', 'copy', 'understood']) && t.length <= 4 },
  { intent: 'laps-left', test: (t) => (has(t, ['many', 'long']) && phrase(t, 'to', 'go')) || has(t, ['lap', 'laps']) && (has(t, ['left', 'remaining', 'go', 'many', 'long', 'more', 'until', 'finish']) || phrase(t, 'how', 'long')) || phrase(t, 'how', 'long', 'to', 'go') || phrase(t, 'when', 'is', 'the', 'end') },
  { intent: 'consistency', test: (t) => has(t, ['consistent', 'consistency', 'rhythm', 'steady', 'smooth', 'smoothness', 'variance']) },
  // "my few / sioux / well": the driver's "my fuel" as the small recogniser heard it in the Miami race
  { intent: 'fuel', test: (t) => has(t, ['fuel', 'petrol', 'gas', 'tank', 'juice']) || (phrase(t, 'enough', 'to', 'finish')) || phrase(t, 'lift', 'and', 'coast') || phrase(t, 'running', 'out') || ['few', 'sioux', 'well'].some((w) => phrase(t, 'my', w)) },
  // "toura", "tie away": "tyre wear" as heard in the same race
  { intent: 'tyres', test: (t) => has(t, ['tyre', 'rubber', 'grip', 'degradation', 'deg', 'wear', 'compound', 'soft', 'medium', 'hard', 'toura']) || phrase(t, 'tie', 'away') },
  { intent: 'best', test: (t) => has(t, ['best', 'fastest', 'pb', 'quickest', 'record']) || phrase(t, 'personal', 'best') },
  { intent: 'lap', test: (t) => phrase(t, 'last', 'lap') || phrase(t, 'my', 'last') || phrase(t, 'that', 'lap') || phrase(t, 'lap', 'time') || phrase(t, 'how', 'was', 'that') || phrase(t, 'how', 'did', 'i', 'do') || phrase(t, 'what', 'was', 'that') || phrase(t, 'previous', 'lap') || phrase(t, 'what', 'time') || phrase(t, 'what', 'was', 'my', 'time') },
  { intent: 'losing', test: (t) => (has(t, ['where', 'which']) && has(t, ['time', 'seconds', 'tenths'])) || has(t, ['losing', 'lose', 'slow', 'slower', 'weak', 'improve', 'faster', 'quicker', 'weakness', 'improvement', 'mistake', 'mistakes', 'problem', 'work']) || phrase(t, 'where', 'can', 'i') || (phrase(t, 'what', 'should', 'i') && has(t, ['work', 'improve', 'focus', 'fix', 'change', 'try', 'practise', 'practice'])) || phrase(t, 'time', 'loss') || phrase(t, 'give', 'me', 'something') || phrase(t, 'any', 'tips') || phrase(t, 'any', 'advice') || has(t, ['tip', 'tips', 'advice', 'coaching']) },
  { intent: 'gap', test: (t) => has(t, ['gap', 'delta', 'interval', 'ahead', 'behind', 'catching', 'closing']) },
  { intent: 'weather', test: (t) => has(t, ['rain', 'weather', 'wet', 'dry', 'forecast', 'raining', 'temperature']) },
  { intent: 'flags', test: (t) => has(t, ['flag', 'yellow', 'incident', 'virtual']) || phrase(t, 'safety', 'car') || phrase(t, 'is', 'it', 'clear') },
  { intent: 'position', test: (t) => has(t, ['position', 'place', 'p1', 'p2', 'p3', 'classification', 'standing', 'standings']) || phrase(t, 'where', 'am', 'i') && !has(t, ['losing', 'lose']) },
  { intent: 'track', test: (t) => has(t, ['track', 'circuit', 'corner', 'corners', 'layout']) || phrase(t, 'where', 'are', 'we') },
];

export function classify(text: string): Intent | null {
  const tokens = normalise(text);
  if (tokens.length === 0) return null;
  for (const r of RULES) if (r.test(tokens)) return r.intent;
  return null;
}
