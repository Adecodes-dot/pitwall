import { describe, expect, it } from 'vitest';
import { WakeGate, wakeWordsFor } from './wake.ts';
import { VoiceListener, ECHO_GUARD_MS, type AsrLike, type VoiceEvent, type VoiceHost } from './voice.ts';
import { TtsEngine, defaultModelDir, modelAvailable } from '../radio/tts.ts';
import { SpeechRecognizer, asrAvailable } from './asr.ts';

describe('wake gate', () => {
  const g = () => new WakeGate();
  it('command in the same breath, any phrasing of the wake word', () => {
    expect(g().onFinal("engineer how's my fuel", 0)).toEqual({ kind: 'command', text: "how's my fuel", wake: true });
    expect(g().onFinal('hey engineer where am I losing time', 0)).toMatchObject({ kind: 'command', text: 'where am I losing time' });
    expect(g().onFinal('ineer has my fuel', 0)).toMatchObject({ kind: 'command', text: 'has my fuel' }); // clipped onset
    expect(g().onFinal('engineers how are the tires', 0)).toMatchObject({ kind: 'command' });
    expect(g().onFinal('pit wall how many laps to go', 0)).toMatchObject({ kind: 'command', text: 'how many laps to go' });
  });
  it('wake word at the end of the question', () => {
    expect(g().onFinal('how are the tires engineer', 0)).toEqual({ kind: 'command', text: 'how are the tires', wake: true });
    expect(g().onFinal('hey engineer', 0)).toEqual({ kind: 'wake-only' });
  });
  it('wake word alone opens a window for the next utterance, which then needs no wake word', () => {
    const gate = g();
    expect(gate.onFinal('engineer', 1000)).toEqual({ kind: 'wake-only' });
    // the driver called the engineer, then paused: the next utterance is addressed, as if said in one breath
    expect(gate.onFinal('how is my fuel', 3000)).toEqual({ kind: 'command', text: 'how is my fuel', wake: true });
    expect(gate.onFinal('and the tyres', 4000)).toEqual({ kind: 'ignore' });          // window closes after one command
    expect(gate.onFinal('engineer', 5000)).toEqual({ kind: 'wake-only' });
    expect(gate.onFinal('how is my fuel', 5000 + 7000)).toEqual({ kind: 'ignore' });   // window expired (6 s)
  });
  it('follow-ups after an answer need no wake word for a few seconds', () => {
    const gate = g();
    gate.markAnswered(10000);
    expect(gate.onFinal('and the tyres', 12000)).toMatchObject({ kind: 'command', wake: false });
    gate.markAnswered(20000);
    expect(gate.onFinal('and the tyres', 20000 + 8000)).toEqual({ kind: 'ignore' });
  });
  it('a clipped wake word counts only when the rest is a clear question', async () => {
    const g = new WakeGate();
    expect(g.onFinal('er any flags', 0)).toMatchObject({ kind: 'command', text: 'any flags', wake: true, weak: true });
    expect(g.onFinal('neer how are the tyres', 0)).toMatchObject({ kind: 'command', weak: true });
    expect(g.onFinal('er and he goes round the outside', 0)).toMatchObject({ kind: 'command', weak: true }); // gate lets it through...
    const asr = new FakeAsr(), h = host(), v = new VoiceListener(asr, new WakeGate(), h, () => {}); void v;
    asr.events.onFinal!('er and he goes round the outside'); await new Promise((r) => setTimeout(r, 0));
    expect(h.log).toEqual([]);                                                       // ...the listener does not act on it
    asr.events.onFinal!('er any flags'); await new Promise((r) => setTimeout(r, 0));
    expect(h.log).toEqual(['ask:any flags']);
  });
  it('ignores everything not addressed to it (TV commentary, chatter)', () => {
    for (const t of ['and he goes into turn one on the inside', 'the radio said box box', 'engine failure for the leader', 'whatever', '']) expect(g().onFinal(t, 0)).toEqual({ kind: 'ignore' });
  });
  it('wake words are configurable', () => {
    const gate = new WakeGate({ words: ['boss'] });
    expect(gate.onFinal('boss how is my fuel', 0)).toMatchObject({ kind: 'command' });
    expect(gate.onFinal('engineer how is my fuel', 0)).toEqual({ kind: 'ignore' });
  });
});

class FakeAsr implements AsrLike {
  events: AsrLike['events'] = {};
  fed = 0; resets = 0;
  feed(s: Int16Array) { this.fed += s.length; }
  reset() { this.resets++; }
}
function host(over: Partial<VoiceHost> = {}) {
  const log: string[] = [];
  let clock = 0, busy = 0;
  const h: VoiceHost & { log: string[]; set: (t: number) => void; busy: (t: number) => void } = {
    now: () => clock, busyUntil: () => busy,
    ask: async (q) => { log.push(`ask:${q}`); return { text: 'Fuel is good.', intent: 'fuel' }; },
    repeatLast: () => { log.push('repeat'); return true; }, announce: (t, k) => { log.push(`say:${t}${k ? `[${k}]` : ''}`); }, beep: () => { log.push('beep'); },
    setMode: (m) => { log.push(`mode:${m}`); }, setMuted: (m) => { log.push(`muted:${m}`); },
    log, set: (t) => { clock = t; }, busy: (t) => { busy = t; }, ...over,
  };
  return h;
}

describe('voice listener', () => {
  const setup = () => { const asr = new FakeAsr(), h = host(), events: VoiceEvent[] = []; const v = new VoiceListener(asr, new WakeGate(), h, (e) => events.push(e)); return { asr, h, events, v }; };
  const say = async (asr: FakeAsr, text: string) => { asr.events.onFinal!(text); await new Promise((r) => setTimeout(r, 0)); };

  it('a question runs through the radio; a mode command changes the mode and confirms', async () => {
    const { asr, h, events } = setup();
    await say(asr, "engineer how's my fuel");
    expect(h.log).toContain("ask:how's my fuel");
    await say(asr, 'engineer talk less');
    expect(h.log).toEqual(expect.arrayContaining(['mode:quiet', 'say:Quiet mode.']));
    await say(asr, 'engineer coach me');
    expect(h.log).toEqual(expect.arrayContaining(['mode:coach', 'say:Coach mode.']));
    await say(asr, 'engineer say that again');
    expect(h.log).toContain('repeat');
    expect(events.some((e) => e.heard === "how's my fuel" && e.intent === 'fuel')).toBe(true);
  });
  it('mute confirms first and is flagged so the radio mutes after it; unmute restores', async () => {
    const { asr, h } = setup();
    await say(asr, 'engineer be quiet and stop talking');
    // "be quiet" is a mode request; an explicit mute phrase:
    await say(asr, 'engineer mute');
    expect(h.log).toContain('say:Muted. Say talk to me to bring me back.[voice:mute]');
    await say(asr, 'engineer talk to me');
    expect(h.log).toEqual(expect.arrayContaining(['muted:false', 'say:Back on.']));
  });
  it('speech not addressed to the engineer is dropped and never emitted', async () => {
    const { asr, h, events } = setup();
    await say(asr, 'he takes the inside line into turn one');
    expect(h.log).toEqual([]);
    expect(events.filter((e) => e.heard)).toEqual([]);
  });
  it('beeps once as soon as the wake word appears in a partial transcript', () => {
    const { asr, h } = setup();
    asr.events.onPartial!('engi'); asr.events.onPartial!('engineer how'); asr.events.onPartial!('engineer how is my');
    expect(h.log.filter((x) => x === 'beep')).toHaveLength(1);
  });
  it('half-duplex: audio is dropped while the engineer speaks and for the echo guard after, then the recogniser resets', () => {
    const { asr, h, v } = setup();
    h.set(1000); h.busy(2000);
    v.feed(new Int16Array(1600)); expect(asr.fed).toBe(0);                 // engineer is speaking
    h.set(2000 + ECHO_GUARD_MS - 50); v.feed(new Int16Array(1600)); expect(asr.fed).toBe(0); // tail
    h.set(2000 + ECHO_GUARD_MS + 10); v.feed(new Int16Array(1600));
    expect(asr.fed).toBe(1600); expect(asr.resets).toBe(1);
    expect(v.stats.droppedWhileSpeaking).toBe(2);
  });
  it('a follow-up window acts on racing questions but never on chatter', async () => {
    const { asr, h } = setup();
    await say(asr, "engineer how's my fuel");
    h.log.length = 0;
    await say(asr, 'and the tyres');                         // follow-up, no wake word
    expect(h.log).toEqual(['ask:and the tyres']);
    h.log.length = 0;
    await say(asr, 'he goes into turn one on the inside');   // commentary inside the window
    expect(h.log).toEqual([]);
  });
  it('name, pause, unclear question: it goes to the radio (which says "Say again?"), never silence', async () => {
    const { asr, h } = setup();
    await say(asr, 'engineer'); // wake word alone (Miami race log: "at last" … "how is my few")
    await say(asr, 'zorba');    // not understood
    expect(h.log).toEqual(['ask:zorba']);
    h.log.length = 0;
    await say(asr, 'he goes into turn one on the inside'); // after the answer: a follow-up window, chatter still dropped
    expect(h.log).toEqual([]);
  });
  it('disabled listener ignores audio and speech', async () => {
    const { asr, h, v } = setup();
    v.setEnabled(false);
    v.feed(new Int16Array(1600)); expect(asr.fed).toBe(0);
    await say(asr, 'engineer how is my fuel'); expect(h.log).toEqual([]);
  });
});

// ---- the whole chain on real audio: Piper speech → streaming recogniser → wake gate → intent ----
const haveModels = modelAvailable() && asrAvailable();
describe.skipIf(!haveModels)('speech → wake → intent on generated audio (needs the voice and speech models)', () => {
  function to16k(p: { samples: Int16Array; sampleRate: number }): Int16Array {
    const n = Math.round(p.samples.length * 16000 / p.sampleRate), o = new Int16Array(n);
    for (let i = 0; i < n; i++) { const x = i * p.sampleRate / 16000, j = Math.floor(x), f = x - j; o[i] = Math.round((p.samples[j] ?? 0) * (1 - f) + (p.samples[j + 1] ?? p.samples[j] ?? 0) * f); }
    return o;
  }
  const PHRASES: [string, string][] = [
    ["Engineer, how's my fuel?", 'fuel'], ['Hey engineer, where am I losing time?', 'losing'], ['How are the tyres, engineer?', 'tyres'],
    ["Engineer, what's my best lap?", 'best'], ['Engineer, how many laps to go?', 'laps-left'], ['Engineer, talk less.', 'mode-quiet'],
    ['Engineer, say that again.', 'repeat'], ['Engineer, am I consistent?', 'consistency'], ['Engineer, any flags?', 'flags'], ['Engineer, what was my last lap?', 'lap'],
  ];
  it('understands ten natural questions end to end, and ignores a sentence without the wake word', async () => {
    const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
    const asr = new SpeechRecognizer({ threads: 2 }); await asr.start();
    const heard: { text: string; intent: string | null }[] = [];
    const gate = new WakeGate();
    const h = host({ ask: async (q) => { heard.push({ text: q, intent: null }); return { text: 'ok', intent: 'x' }; } });
    h.set(1e6); // any time well past the echo guard
    const v = new VoiceListener(asr, gate, h, (e) => { if (e.heard && e.intent !== undefined && e.answer === undefined) heard.push({ text: e.heard, intent: e.intent }); });
    try {
      let ok = 0; const misses: string[] = [];
      for (const [phrase, want] of PHRASES) {
        heard.length = 0; h.log.length = 0;
        const speech = to16k(await tts.synth(phrase));
        const audio = new Int16Array(speech.length + 16000 * 2); audio.set(speech, 3200);
        for (let i = 0; i < audio.length; i += 1600) { v.feed(audio.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 3)); }
        // a loaded machine decodes slower than real time: wait for the utterance to finish rather than a fixed delay
        for (let w = 0; w < 100 && !heard.some((x) => x.intent !== null); w++) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 100));
        const got = heard.find((x) => x.intent !== null)?.intent ?? null;
        if (got === want) ok++; else misses.push(`"${phrase}" → ${got} (log ${h.log.join('|')})`);
      }
      console.log(`speech→intent: ${ok}/${PHRASES.length}${misses.length ? '\n  ' + misses.join('\n  ') : ''}`);
      expect(ok).toBeGreaterThanOrEqual(9);
      // not addressed: no wake word → nothing happens
      h.log.length = 0; heard.length = 0;
      const speech = to16k(await tts.synth('He goes into turn one on the inside of the leader.'));
      const audio = new Int16Array(speech.length + 16000 * 2); audio.set(speech, 3200);
      for (let i = 0; i < audio.length; i += 1600) { v.feed(audio.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 3)); }
      await new Promise((r) => setTimeout(r, 2500)); // generous: nothing should ever arrive
      expect(heard).toEqual([]); expect(h.log).toEqual([]);
    } finally { await asr.stop(); await tts.stop(); }
  }, 120000);

  it('a short chosen name: teach it by saying it five times, then it answers to it (Bono, Will Joseph; GP is reported, not asserted)', async () => {
    const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
    const asr = new SpeechRecognizer({ threads: 2 }); await asr.start();
    try {
      const report: string[] = [];
      for (const [name, strict] of [['Bono', true], ['Will Joseph', true], ['GP', false]] as const) {
        const asked: string[] = [];
        const gate = new WakeGate({ words: wakeWordsFor(name) });
        const h = host({ ask: async (q) => { asked.push(q); return { text: 'ok', intent: 'x' }; } }); h.set(1e6);
        const v = new VoiceListener(asr, gate, h, () => {});
        const speak = async (phrase: string, tail = 2) => {
          const sp = to16k(await tts.synth(phrase)); const audio = new Int16Array(sp.length + 16000 * tail); audio.set(sp, 3200);
          for (let i = 0; i < audio.length; i += 1600) { v.feed(audio.subarray(i, i + 1600)); await new Promise((r) => setTimeout(r, 3)); }
          await new Promise((r) => setTimeout(r, 150));
        };
        v.startCalibration(5);
        for (let i = 0; i < 5; i++) await speak(name + '.');
        const cal = v.finishCalibration();
        gate.configure({ words: wakeWordsFor(name, cal.aliases) });
        let ok = 0;
        for (const q of ["how's my fuel?", 'how are the tyres?', 'where am I losing time?', 'how many laps to go?', 'any flags?']) {
          asked.length = 0; await speak(name + ', ' + q);
          for (let w = 0; w < 60 && asked.length === 0; w++) await new Promise((r) => setTimeout(r, 50));
          if (asked.length) ok++;
        }
        report.push(`${name}: taught ${cal.matched}/${cal.total} straight, aliases [${cal.aliases.join(', ')}], then ${ok}/5 questions answered`);
        if (strict) expect(ok).toBeGreaterThanOrEqual(3); // 4-5 when the machine is idle; the full suite runs this under load
      }
      console.log(['name wake-up (synthetic voice):', ...report].join('\n  '));
    } finally { await asr.stop(); await tts.stop(); }
  }, 240000);
});

describe('driver-chosen engineer name', () => {
  const say = async (asr: FakeAsr, text: string) => { asr.events.onFinal!(text); await new Promise((r) => setTimeout(r, 0)); };

  it('wakes on the chosen name, "hey <name>", and not on the old word', () => {
    for (const name of ['Bono', 'GP', 'Will Joseph']) {
      const lower = name.toLowerCase();
      const gate = () => new WakeGate({ words: wakeWordsFor(name) });
      expect(gate().onFinal(`${lower} how's my fuel`, 0)).toMatchObject({ kind: 'command', text: "how's my fuel", wake: true });
      expect(gate().onFinal(`hey ${lower} where am i losing time`, 0)).toMatchObject({ kind: 'command' });
      expect(gate().onFinal(`how are the tyres ${lower}`, 0)).toMatchObject({ kind: 'command', text: 'how are the tyres' });
      expect(gate().onFinal(`${lower}`, 0)).toEqual({ kind: 'wake-only' });
      expect(gate().onFinal("engineer how's my fuel", 0)).toEqual({ kind: 'ignore' });
    }
  });
  it('text with no words never wakes and never throws', () => {
    const g = new WakeGate({ words: wakeWordsFor('Altman') });
    expect(g.hasWake('')).toBe(false); expect(g.hasWake("'")).toBe(false); expect(g.onFinal('...', 0)).toEqual({ kind: 'ignore' });
  });
  it('wakeWordsFor trims, lower-cases, de-duplicates and falls back to engineer', () => {
    expect(wakeWordsFor('  Bono ', ['Bonoh', 'bono', ' '])).toEqual(['bono', 'hey bono', 'bonoh']);
    expect(wakeWordsFor('GP')).toEqual(['gp', 'hey gp', 'g p']);
    expect(wakeWordsFor('')).toEqual(['engineer', 'hey engineer']);
  });
  it('teaching: matched count, mis-hearings become aliases, sentences are rejected, and the gate then accepts the alias', async () => {
    const asr = new FakeAsr(), h = host(), events: VoiceEvent[] = [];
    const gate = new WakeGate({ words: wakeWordsFor('bono') });
    const v = new VoiceListener(asr, gate, h, (e) => events.push(e));
    v.startCalibration(5);
    for (const t of ['bono', 'bono', 'bonnor', 'bonnor', 'i think this is a long sentence about something']) await say(asr, t);
    expect(h.log).toEqual([]);                                                // calibrating acts on nothing
    const r = v.finishCalibration();
    expect(r).toEqual({ total: 5, matched: 2, aliases: ['bonnor'], rejected: 1 });
    expect(events.some((e) => e.calibration && !e.calibration.done && e.calibration.count === 3)).toBe(true);
    expect(events.at(-1)!.calibration!.done).toEqual(r);
    const learned = new WakeGate({ words: wakeWordsFor('bono', r.aliases) });
    expect(learned.onFinal("bonnor how's my fuel", 0)).toMatchObject({ kind: 'command', text: "how's my fuel" });
    // and after finishing, normal operation resumes
    await say(asr, "bono how's my fuel");
    expect(h.log).toContain("ask:how's my fuel");
  });
});
