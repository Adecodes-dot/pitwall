// Optional LLM phrasing. The model only rephrases a deterministic call into the engineer's voice from a fact
// sheet; the result must pass the same persona rules and contain the same numbers, else the template is used.
// Never on the time-critical path: callers invoke this with a lap of lead time and a short timeout.
import type { Call } from '../radio/queue.ts';
import { checkCall } from '../radio/rules.ts';

export interface Phraser {
  readonly name: string;
  /** returns a rephrased text that passed the rules, or null (caller keeps the template) */
  rephrase(call: Call, timeoutMs?: number): Promise<string | null>;
  /** free-text answer from a fact sheet (Q&A fallback), or null */
  answer(question: string, factSheet: string, timeoutMs?: number): Promise<string | null>;
}

export const PERSONA_SYSTEM = `You are the race engineer on a sim racer's radio. Calm, precise, brief. British-neutral English.
Rules you must follow exactly:
- At most 12 words. One idea. No exclamation marks, no praise inflation, no filler, no hedging ("might", "maybe", "consider").
- Keep every number from the facts exactly as given, and never introduce a number that is not in the facts.
- Coaching lines start with the corner, e.g. "Turn 4, ...".
- Reply with the line only. No quotes, no explanation.`;

export class TemplatePhraser implements Phraser {
  readonly name = 'template';
  async rephrase(): Promise<string | null> { return null; }
  async answer(): Promise<string | null> { return null; }
}

/** Anthropic API phraser. Enabled only when ANTHROPIC_API_KEY (or an `ant auth login` profile) is available. */
export class AnthropicPhraser implements Phraser {
  readonly name = 'anthropic';
  private client: import('@anthropic-ai/sdk').default | null = null;
  readonly model: string;
  stats = { calls: 0, accepted: 0, rejected: 0, failed: 0 };
  constructor(model = process.env.PITWALL_LLM_MODEL ?? 'claude-opus-5-5') { this.model = model; }

  private async ensure(): Promise<import('@anthropic-ai/sdk').default> {
    if (!this.client) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); this.client = new Anthropic(); }
    return this.client;
  }

  protected async complete(system: string, user: string, timeoutMs: number): Promise<string | null> {
    this.stats.calls++;
    try {
      const client = await this.ensure();
      const res = await client.messages.create(
        { model: this.model, max_tokens: 256, system, output_config: { effort: 'low' }, messages: [{ role: 'user', content: user }] },
        { timeout: timeoutMs, maxRetries: 0 },
      );
      if (res.stop_reason === 'refusal') { this.stats.failed++; return null; }
      const text = res.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join(' ').trim();
      return text.replace(/^["“”']+|["“”']+$/g, '').split('\n')[0]!.trim() || null;
    } catch { this.stats.failed++; return null; }
  }

  async rephrase(call: Call, timeoutMs = 2500): Promise<string | null> {
    const facts = JSON.stringify(call.facts);
    const text = await this.complete(PERSONA_SYSTEM, `Facts: ${facts}\nReason: ${call.reason}\nTemplate line: "${call.text}"\nRephrase the template line in your voice, keeping the same meaning and numbers.`, timeoutMs);
    if (!text) return null;
    const candidate: Call = { ...call, text };
    const ok = checkCall(candidate).ok && sameNumbers(call.text, text);
    if (ok) this.stats.accepted++; else this.stats.rejected++;
    return ok ? text : null;
  }

  async answer(question: string, factSheet: string, timeoutMs = 4000): Promise<string | null> {
    const text = await this.complete(PERSONA_SYSTEM + '\nAnswer the driver\'s question from the facts only. If the facts do not contain the answer, reply exactly: "I don\'t have that."', `Facts:\n${factSheet}\n\nDriver asks: "${question}"`, timeoutMs);
    if (!text) return null;
    const words = text.split(/\s+/).length;
    return words <= 16 && !/!/.test(text) ? text : null;
  }
}

/** every number in the template must appear in the rephrased text and vice versa */
export function sameNumbers(a: string, b: string): boolean {
  const na = (a.match(/\d+(\.\d+)?/g) ?? []).sort().join(','), nb = (b.match(/\d+(\.\d+)?/g) ?? []).sort().join(',');
  return na === nb;
}

export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.PITWALL_LLM);
}
