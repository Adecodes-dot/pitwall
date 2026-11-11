// Hands-free voice: mic audio in → speech recogniser → wake gate → intent → radio.
// Half-duplex on purpose: while the engineer is speaking (and for a moment after) incoming audio is dropped,
// so speakers can never trigger the wake word or be transcribed as a question.
import { classify, normalise } from './intent.ts';
import { WakeGate } from './wake.ts';

export type VoiceState = 'off' | 'idle' | 'listening';
export interface VoiceEvent {
  state: VoiceState;
  /** live transcript of what is being said right now (only while a wake word is in it) */
  partial?: string;
  /** a finished utterance that was addressed to the engineer */
  heard?: string;
  intent?: string | null;
  answer?: string;
  /** microphone level 0..1, a few times a second */
  level?: number;
  /** teaching the engineer's name: progress, and the result when finished */
  calibration?: { count: number; want: number; heard: string[]; done?: CalibrationResult };
}

export interface CalibrationResult {
  total: number;
  /** how many of the samples the wake gate already recognised as the name */
  matched: number;
  /** how the recogniser wrote the name when it did not match: learned as extra wake phrases */
  aliases: string[];
  /** samples that were too long to be the name alone (sentences) and were not learned */
  rejected: number;
}

export interface AsrLike {
  events: { onPartial?: (t: string) => void; onFinal?: (t: string) => void };
  feed(samples: Int16Array): void;
  reset(): void;
}

/** What the listener needs from the rest of the app (the Radio implements it; tests fake it). */
export interface VoiceHost {
  now(): number;
  busyUntil(): number;
  ask(question: string, opts: { voice: boolean }): Promise<{ text: string; intent: string }>;
  repeatLast(): boolean;
  announce(text: string, key?: string): void;
  beep(): void;
  setMode(mode: 'quiet' | 'normal' | 'coach'): void;
  setMuted(muted: boolean): void;
}

const MODE_NAME = { quiet: 'Quiet mode.', normal: 'Normal mode.', coach: 'Coach mode.' } as const;
/** after our own voice ends, keep ignoring the mic this long (speaker tail, room echo) */
export const ECHO_GUARD_MS = 350;

export class VoiceListener {
  private asr: AsrLike;
  private gate: WakeGate;
  private host: VoiceHost;
  private emit: (e: VoiceEvent) => void;
  private enabled = true;
  private wasDeaf = false;
  private beeped = false;
  private lastLevelAt = 0;
  private state: VoiceState = 'idle';
  stats = { chunks: 0, droppedWhileSpeaking: 0, utterances: 0, addressed: 0 };
  /** opt-in (PITWALL_VOICE_DEBUG=1): sees every finished utterance, addressed or not. Off by default: unaddressed speech is never kept. */
  debug: ((text: string, outcome: string) => void) | null = null;
  private cal: { want: number; heard: string[] } | null = null;

  constructor(asr: AsrLike, gate: WakeGate, host: VoiceHost, emit: (e: VoiceEvent) => void) {
    this.asr = asr; this.gate = gate; this.host = host; this.emit = emit;
    asr.events.onPartial = (t) => this.onPartial(t);
    asr.events.onFinal = (t) => { void this.onFinal(t); };
  }

  /** Start collecting samples of the driver saying the name (nothing is acted on while calibrating). */
  startCalibration(want = 5): void { this.cal = { want, heard: [] }; this.gate.close(); this.emit({ state: 'listening', calibration: { count: 0, want, heard: [] } }); }

  /** Stop and summarise. Unmatched, short samples become aliases; the caller stores them. */
  finishCalibration(): CalibrationResult {
    const c = this.cal; this.cal = null; this.setState('idle');
    const heard = c?.heard ?? [];
    let matched = 0, rejected = 0; const alias = new Set<string>();
    for (const text of heard) {
      if (this.gate.hasWake(text)) { matched++; continue; }
      const words = normalise(text);
      if (words.length === 0 || words.length > 4) { rejected++; continue; }
      alias.add(words.join(' '));
    }
    const result: CalibrationResult = { total: heard.length, matched, aliases: [...alias], rejected };
    this.emit({ state: 'idle', calibration: { count: heard.length, want: c?.want ?? 5, heard, done: result } });
    return result;
  }

  setEnabled(on: boolean): void { this.enabled = on; this.setState(on ? 'idle' : 'off'); if (!on) this.asr.reset(); }

  /** 16 kHz mono int16 straight from the microphone */
  feed(samples: Int16Array): void {
    if (!this.enabled) return;
    this.stats.chunks++;
    const now = this.host.now();
    const deaf = now < this.host.busyUntil() + ECHO_GUARD_MS;
    if (deaf) { this.stats.droppedWhileSpeaking++; this.wasDeaf = true; return; }
    if (this.wasDeaf) { this.wasDeaf = false; this.asr.reset(); this.beeped = false; } // forget anything half-heard around our own voice
    if (now - this.lastLevelAt > 150) {
      let sum = 0; for (let i = 0; i < samples.length; i++) sum += (samples[i]! / 32768) ** 2;
      this.lastLevelAt = now; this.emit({ state: this.state, level: Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 6) });
    }
    this.asr.feed(samples);
  }

  private setState(s: VoiceState): void { if (s !== this.state) { this.state = s; this.emit({ state: s }); } }

  private onPartial(text: string): void {
    if (!this.enabled) return;
    if (this.gate.hasWake(text) || this.gate.isOpen(this.host.now())) {
      if (!this.beeped && this.gate.hasWake(text)) { this.beeped = true; this.host.beep(); } // instant "I heard you"
      this.setState('listening');
      this.emit({ state: 'listening', partial: text });
    }
  }

  private async onFinal(text: string): Promise<void> {
    if (!this.enabled) return;
    this.stats.utterances++;
    this.beeped = false;
    if (this.cal) {
      this.cal.heard.push(text.trim());
      this.emit({ state: 'listening', calibration: { count: this.cal.heard.length, want: this.cal.want, heard: this.cal.heard } });
      return; // calibrating: never act on what is said
    }
    const now = this.host.now();
    const r = this.gate.onFinal(text, now);
    this.debug?.(text, r.kind === 'command' ? `command${r.weak ? ' (weak wake)' : r.wake ? '' : ' (follow-up)'}` : r.kind);
    if (r.kind === 'ignore') { this.setState('idle'); return; } // not addressed to us: never stored, never shown
    // a follow-up window, or a clipped wake word, never acts on something that is not a clear racing question
    if (r.kind === 'command' && (!r.wake || r.weak) && classify(r.text) === null) { this.setState('idle'); return; }
    this.stats.addressed++;
    if (r.kind === 'wake-only') { this.setState('listening'); this.emit({ state: 'listening', heard: text }); return; }
    const intent = classify(r.text);
    this.emit({ state: 'listening', heard: r.text, intent });
    let answer: string | undefined;
    switch (intent) {
      case 'repeat': this.host.repeatLast(); break;
      case 'mute': this.host.announce('Muted. Say talk to me to bring me back.', 'voice:mute'); break;
      case 'unmute': this.host.setMuted(false); this.host.announce('Back on.'); break;
      case 'mode-quiet': case 'mode-normal': case 'mode-coach': {
        const mode = intent === 'mode-quiet' ? 'quiet' : intent === 'mode-coach' ? 'coach' : 'normal';
        this.host.setMode(mode); this.host.announce(MODE_NAME[mode]); answer = MODE_NAME[mode]; break;
      }
      default: { const a = await this.host.ask(r.text, { voice: true }); answer = a.text; }
    }
    this.gate.markAnswered(this.host.now());
    this.emit({ state: 'listening', heard: r.text, intent, ...(answer ? { answer } : {}) });
    setTimeout(() => this.setState(this.enabled ? 'idle' : 'off'), 1500).unref?.();
  }
}
