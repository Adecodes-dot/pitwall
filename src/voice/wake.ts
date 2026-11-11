// Wake-word gate over finished utterances from the speech recogniser. The driver says it however is natural:
//   "engineer, how's my fuel"   → command in the same breath
//   "how are my tyres engineer" → wake word at the end
//   "engineer" ... "fuel?"      → wake word alone opens a listening window for the next utterance
//   and after an answer, follow-ups ("and the tyres?") need no wake word for a few seconds.
import { normalise, wordMatch } from './intent.ts';

export interface WakeConfig {
  /** wake phrases; matched fuzzily so ASR mis-hearings of them still count */
  words: string[];
  /** how long the window stays open after the wake word alone, ms */
  commandWindowMs: number;
  /** how long follow-up questions are accepted after an answer, ms */
  followUpMs: number;
}

/** The driver names their engineer ("Bono", "GP", "Will Joseph"). Wake phrases are the name, "hey <name>", and the variants learned when the driver taught it the name. */
export function wakeWordsFor(name: string, aliases: string[] = []): string[] {
  const n = name.trim().toLowerCase() || 'engineer';
  // initials (GP) come out of the recogniser as separate letters ("g p")
  const spelled = /^[a-z]{2,3}$/.test(n) ? [n.split('').join(' ')] : [];
  return [...new Set([n, `hey ${n}`, ...spelled, ...aliases.map((a) => a.trim().toLowerCase()).filter(Boolean)])];
}

export const DEFAULT_WAKE: WakeConfig = { words: [...wakeWordsFor('engineer'), 'pit wall'], commandWindowMs: 6000, followUpMs: 7000 };

export type WakeResult =
  | { kind: 'ignore' }
  | { kind: 'wake-only' }
  /** weak: the wake word was only a clipped fragment ("er", "neer") at the start; act only if the rest is a clear question */
  | { kind: 'command'; text: string; wake: boolean; weak?: boolean };

const GREETING = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'right', 'so', 'please']);
/** consonant skeleton: "engineer" and "enjineer" and "engineers" collapse to the same key */
const skeleton = (w: string) => w.replace(/s$/, '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1').replace(/g/g, 'j');

function tokenMatches(token: string, word: string): boolean {
  if (wordMatch(token, word)) return true;
  // the recogniser often clips the first syllable after silence: "ineer", "gineer"
  if (token.length >= 5 && word.length - token.length >= 1 && word.length - token.length <= 3 && word.endsWith(token)) return true;
  if (token.length >= 5 && word.length >= 5 && skeleton(token) === skeleton(word) && skeleton(word).length >= 3) return true;
  return false;
}

export class WakeGate {
  private cfg: WakeConfig;
  private openUntil = 0;
  /** the window was opened by the wake word alone: the driver called us and paused, so the next utterance is addressed */
  private called = false;
  constructor(cfg: Partial<WakeConfig> = {}) { this.cfg = { ...DEFAULT_WAKE, ...cfg }; }
  configure(cfg: Partial<WakeConfig>): void { this.cfg = { ...this.cfg, ...cfg }; }

  /** a window is open: the next utterance is a command without the wake word */
  isOpen(now: number): boolean { return now < this.openUntil; }
  /** call after answering so follow-ups are accepted */
  markAnswered(now: number): void { this.openUntil = Math.max(this.openUntil, now + this.cfg.followUpMs); this.called = false; }
  close(): void { this.openUntil = 0; this.called = false; }

  onFinal(text: string, now: number): WakeResult {
    const raw = text.trim().split(/\s+/).filter(Boolean);
    // flat token list with the index of the raw word each token came from (contractions expand to 2 tokens)
    const tokens: string[] = [], rawIdx: number[] = [];
    raw.forEach((w, k) => { for (const t of normalise(w)) { tokens.push(t); rawIdx.push(k); } });
    if (tokens.length === 0) return { kind: 'ignore' };
    const hit = this.findWake(tokens);
    if (hit) {
      const rawStart = rawIdx[hit.start]!, rawEnd = rawIdx[hit.end - 1]! + 1;
      const after = raw.slice(rawEnd), before = raw.slice(0, rawStart).filter((w) => !GREETING.has(normalise(w)[0] ?? ''));
      if (after.length > 0) { this.close(); return { kind: 'command', text: after.join(' '), wake: true, ...(hit.weak ? { weak: true } : {}) }; }
      if (before.length >= 2) { this.close(); return { kind: 'command', text: raw.slice(0, rawStart).join(' '), wake: true }; }
      this.openUntil = now + this.cfg.commandWindowMs; this.called = true;
      return { kind: 'wake-only' };
    }
    if (this.isOpen(now)) { const wake = this.called; this.close(); return { kind: 'command', text: raw.join(' '), wake }; }
    return { kind: 'ignore' };
  }

  /** also used on partial results to give the driver instant feedback */
  hasWake(text: string): boolean { return this.findWake(normalise(text)) !== null; }

  private findWake(tokens: string[]): { start: number; end: number; weak?: boolean } | null {
    for (const phrase of this.cfg.words) {
      const w = normalise(phrase);
      if (w.length === 0) continue;
      for (let i = 0; i + w.length <= tokens.length; i++) {
        if (w.every((word, k) => tokenMatches(tokens[i + k]!, word))) return { start: i, end: i + w.length };
      }
    }
    // the recogniser often swallows the first syllable after silence, leaving "er" or "neer": a weak wake at the very start
    const first = tokens[0];
    if (first && first.length >= 2 && first.length < 5) { // no words (punctuation only): no wake
      for (const phrase of this.cfg.words) { const w = normalise(phrase); if (w.length === 1 && w[0]!.length >= 6 && w[0]!.endsWith(first)) return { start: 0, end: 1, weak: true }; }
    }
    return null;
  }
}
