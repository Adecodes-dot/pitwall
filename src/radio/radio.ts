// Radio orchestrator: turns analysis and events into calls, speaks them only in safe zones, and
// records a timestamped transcript with per-stage latency for every call.
import type { Bus, StatusSnapshot } from '../core/bus.ts';
import type { AdapterEvent, NormalisedFrame } from '../core/types.ts';
import type { SessionAnalyser, AnalysisUpdate } from '../analysis/session.ts';
import { buildZones, canStartCall, StraightHeuristic, type ZoneMap } from './safezones.ts';
import { RadioQueue, type Call, type Chattiness } from './queue.ts';
import { coachingCalls, flagCall, fuelCall, lapCalls, safetyCarCall, tyreCalls, RADIO_CHECK, type CallContext } from './calls.ts';
import { checkCall } from './rules.ts';
import type { TtsEngine, Pcm } from './tts.ts';
import type { AudioSink, PlayHandle } from './audio.ts';
import type { Phraser } from '../llm/phrase.ts';
import { answerQuestion, type Answer, type QaContext } from '../llm/qa.ts';

export interface SpokenCall {
  text: string; reason: string; priority: number; key: string; facts: Call['facts'];
  /** lap distance and zone state at audio start */
  s: number | null; zone: 'safe' | 'heuristic' | 'unknown';
  /** pedal state at audio start, for the never-in-a-braking-zone test */
  brake: number | null; throttle: number | null;
  lap: number | null;
  /** monotonic ms for each stage */
  t: { trigger: number; created: number; chosen: number; ttsReady: number; audioStart: number };
  fromBank: boolean;
  /** trigger → audio start (process), plus sink device latency estimate */
  latencyMs: number; deviceLatencyMs: number | null;
}

export interface RadioOptions { mode?: Chattiness; tts: TtsEngine | null; sinks: AudioSink[]; /** speak nothing (analysis only) */ muted?: boolean; /** time source for queue timing; tests replaying at max speed pass the frame clock */ now?: () => number; /** optional LLM rephrasing for non-time-critical calls */ phraser?: Phraser | null }

interface Prepared { call: Call; pcm: Pcm; fromBank: boolean; ttsReady: number }

export class Radio {
  readonly queue = new RadioQueue();
  transcript: SpokenCall[] = [];
  dropped: { call: Call; why: string }[] = [];
  /** why the last tick did not speak (diagnostics) */
  lastSkip = '';
  zones: ZoneMap | null = null;
  private heuristic = new StraightHeuristic();
  private bus: Bus;
  private analyser: SessionAnalyser;
  private tts: TtsEngine | null;
  private sinks: AudioSink[];
  muted: boolean;
  now: () => number;
  phraser: Phraser | null;
  private lastUpdate: AnalysisUpdate | null = null;
  private fuelLapsEstimate: number | null = null;
  private lapsLeft: number | null = null;
  private status: StatusSnapshot | null = null;
  private lastFrame: NormalisedFrame | null = null;
  private lastFrameWall = 0;
  private s: number | null = null;
  private hint: number | null = null;
  private playing: { call: Call; handles: PlayHandle[]; until: number } | null = null;
  private prepared = new Map<string, Prepared | Promise<Prepared>>();
  private prevPbMs: number | null = null;
  private fuelAtLapStart: { lap: number; level: number }[] = [];
  private lastTyreCheckLap = -1;
  private lapNumber: number | null = null;
  private unsub: (() => void)[] = [];

  constructor(bus: Bus, analyser: SessionAnalyser, opts: RadioOptions) {
    this.bus = bus; this.analyser = analyser; this.tts = opts.tts; this.sinks = opts.sinks; this.muted = opts.muted ?? false; this.now = opts.now ?? (() => performance.now()); this.phraser = opts.phraser ?? null;
    if (opts.mode) this.queue.mode = opts.mode;
  }

  attach(): void {
    this.unsub.push(this.bus.on('frame', (f) => this.onFrame(f)));
    this.unsub.push(this.bus.on('event', (e) => this.onEvent(e)));
    this.unsub.push(this.bus.on('analysis', (a) => this.onAnalysis(a)));
    this.unsub.push(this.bus.on('status', (s) => { this.status = s; }));
  }
  detach(): void { for (const u of this.unsub) u(); this.unsub = []; }

  get mode(): Chattiness { return this.queue.mode; }
  set mode(m: Chattiness) { this.queue.mode = m; }

  /** "Radio check" from the setup screen: user-initiated, so it bypasses the quiet and zone gates. */
  radioCheck(): void {
    const now = this.now();
    const call = RADIO_CHECK({ now, triggerT: now });
    const prep = this.prepare(call);
    const go = (p: Prepared) => { if (this.playing) { for (const h of this.playing.handles) h.cancel(); this.playing = null; } this.speak(p, this.now(), 'heuristic'); };
    if (prep instanceof Promise) prep.then(go); else go(prep);
  }

  // ---- inputs ----

  onFrame(f: NormalisedFrame): void {
    const now = this.now();
    this.lastFrame = f; this.lastFrameWall = performance.now();
    this.heuristic.update(f.t, f.input.throttle, f.input.brake, f.input.steer);
    // lap distance: the game's where provided, else projection onto the learned track
    if (f.lap.distance !== null) this.s = f.lap.distance;
    else if (this.analyser.projector && f.pos) { const r = this.analyser.projector.project(f.pos.x, f.pos.z, this.hint); this.s = r.s; this.hint = r.s; }
    else this.s = null;
    if (f.lap.number !== null && f.lap.number !== this.lapNumber) {
      this.lapNumber = f.lap.number;
      this.queue.newLap(f.lap.number);
      if (f.fuel.level !== null) this.fuelAtLapStart.push({ lap: f.lap.number, level: f.fuel.level });
      this.strategyOnLapStart(f, now);
    }
    this.tick(now);
  }

  onEvent(e: AdapterEvent): void {
    const now = this.now();
    const ctx: CallContext = { now, triggerT: now };
    switch (e.type) {
      case 'flag.change': { const c = flagCall(e.fia, this.lastFrame?.lap.sector ?? null, ctx); if (c) this.enqueue(c); break; }
      case 'safetycar': { const c = safetyCarCall(e.status, e.phase, ctx); if (c) this.enqueue(c); break; }
      case 'session.start': this.queue.clear(); this.prepared.clear(); this.prevPbMs = null; this.fuelAtLapStart = []; this.zones = null; this.transcript = []; break;
      case 'stream.lost': this.queue.clear(); break;
    }
    this.tick(now, e.type === 'flag.change' || e.type === 'safetycar');
  }

  onAnalysis(u: AnalysisUpdate): void {
    this.lastUpdate = u;
    const now = this.now();
    const ctx: CallContext = { now, triggerT: now };
    if (this.analyser.model) this.zones = buildZones(this.analyser.model, this.analyser.collector.laps);
    const assists = { abs: this.lastFrame?.assists.abs ?? null, tc: this.lastFrame?.assists.tc ?? null };
    for (const c of lapCalls(u, this.prevPbMs, this.queue.mode, ctx)) this.enqueue(c);
    for (const c of coachingCalls({ update: u, assists, max: this.queue.limits.coachingPerLap }, ctx)) this.enqueue(c);
    this.prevPbMs = u.pbMs;
    this.tick(now);
  }

  private strategyOnLapStart(f: NormalisedFrame, now: number): void {
    const ctx: CallContext = { now, triggerT: now };
    // fuel: F1 gives laps remaining; GT7 needs fuel-per-lap from the last two lap starts
    const lapsLeft = f.lap.total !== null && f.lap.number !== null && f.lap.total > 0 ? f.lap.total - f.lap.number + 1 : null;
    if (lapsLeft !== null) {
      let fuelLaps = f.fuel.lapsRemaining;
      if (fuelLaps === null && f.fuel.level !== null && this.fuelAtLapStart.length >= 2) {
        const a = this.fuelAtLapStart[this.fuelAtLapStart.length - 2]!, b = this.fuelAtLapStart[this.fuelAtLapStart.length - 1]!;
        const perLap = (a.level - b.level) / Math.max(1, b.lap - a.lap);
        if (perLap > 0.01) fuelLaps = f.fuel.level / perLap;
      }
      this.fuelLapsEstimate = fuelLaps; this.lapsLeft = lapsLeft;
      if (fuelLaps !== null) { const c = fuelCall(fuelLaps, lapsLeft, ctx); if (c) this.enqueue(c); }
    } else { this.fuelLapsEstimate = f.fuel.lapsRemaining; this.lapsLeft = null; }
    if (f.lap.number !== null && f.lap.number !== this.lastTyreCheckLap) { this.lastTyreCheckLap = f.lap.number; for (const c of tyreCalls(f, ctx)) this.enqueue(c); }
  }

  /** Push-to-talk question. Answered from data (rules first, LLM optional), spoken at the next safe moment. */
  async ask(question: string): Promise<Answer> {
    const f = this.lastFrame;
    const ctx: QaContext = { update: this.lastUpdate, frame: f, fuelLaps: this.fuelLapsEstimate ?? f?.fuel.lapsRemaining ?? null, lapsLeft: this.lapsLeft, game: f?.game ?? null };
    const a = await answerQuestion(question, ctx, this.phraser);
    const now = this.now();
    const call: Call = { text: a.text, priority: 2, key: `qa:${now}`, reason: `answer: ${question}`, facts: a.facts, dueAfter: now, expiresAt: now + 20000, immediate: false, createdAt: now, triggerT: now };
    this.enqueue(call, true);
    this.tick(now);
    return a;
  }

  // ---- queue and speaking ----

  private enqueue(c: Call, force = false): void {
    const r = checkCall(c);
    if (!r.ok) { this.dropped.push({ call: c, why: r.violations.join('; ') }); return; }
    if (!this.queue.push(c) && !force) return;
    // prepare audio now so time-critical calls never wait on synthesis at speak time;
    // an async synthesis replaces its own promise with the result and re-ticks
    if (!this.prepared.has(c.key)) {
      if (this.phraser && c.priority >= 3 && !c.immediate) {
        const ph = this.phraser.rephrase(c).then((t) => { if (t) c.text = t; return this.prepare(c); });
        this.prepared.set(c.key, ph);
        ph.then((res) => { if (this.prepared.get(c.key) === ph) this.prepared.set(c.key, res); this.tick(this.now()); }, () => { this.prepared.delete(c.key); });
        return;
      }
      const p = this.prepare(c);
      this.prepared.set(c.key, p);
      if (p instanceof Promise) p.then((res) => { if (this.prepared.get(c.key) === p) this.prepared.set(c.key, res); this.tick(this.now()); }, (e) => { this.prepared.delete(c.key); this.dropped.push({ call: c, why: `tts: ${(e as Error).message}` }); });
    }
  }

  private prepare(c: Call): Prepared | Promise<Prepared> {
    if (!this.tts) return { call: c, pcm: { samples: new Int16Array(Math.round(22050 * estimateSeconds(c.text))), sampleRate: 22050, durationS: estimateSeconds(c.text) }, fromBank: false, ttsReady: this.now() };
    const hit = this.tts.get(c.text);
    if (hit) return { call: c, pcm: hit, fromBank: true, ttsReady: this.now() };
    return this.tts.speak(c.text).then((pcm) => ({ call: c, pcm, fromBank: false, ttsReady: this.now() }));
  }

  private quietReason(now: number): string | null {
    const f = this.lastFrame;
    if (!f) return 'no frames';
    if (performance.now() - this.lastFrameWall > 250) return 'frame age';
    if (this.status && this.status.lossPct > 5) return 'packet loss';
    if (f.flags.onTrack === false) return 'off track';
    if (f.flags.paused === true) return 'paused';
    return null;
  }

  /** Called on every frame/event: speak the next allowed call if the road ahead is safe. */
  tick(now: number, urgent = false): void {
    if (this.playing) {
      if (now < this.playing.until) {
        if (urgent && this.queue.shouldInterrupt(this.playing.call)) { for (const h of this.playing.handles) h.cancel(); this.playing = null; }
        else return;
      } else this.playing = null;
    }
    const quiet = this.quietReason(now);
    const call = this.queue.next(now);
    if (!call) return;
    if (quiet && call.priority > 1) return; // safety calls still go out when the car is on track
    const prep = this.prepared.get(call.key);
    if (!prep || prep instanceof Promise) { if (prep instanceof Promise) prep.then(() => this.tick(this.now())); return; }
    const f = this.lastFrame!;
    let zone: SpokenCall['zone'];
    if (this.zones && this.s !== null) { if (!canStartCall(this.zones, this.s, f.speed, prep.pcm.durationS)) return; zone = 'safe'; }
    else { if (call.priority > 1 || !this.heuristic.safe) return; zone = 'heuristic'; }
    this.speak(prep, now, zone);
  }

  private speak(p: Prepared, chosen: number, zone: SpokenCall['zone']): void {
    const { call, pcm } = p;
    this.queue.spoken(call);
    this.prepared.delete(call.key);
    const handles = this.muted ? [] : this.sinks.map((s) => s.play(pcm));
    const until = chosen + pcm.durationS * 1000 + 250;
    this.playing = { call, handles, until };
    // record now (synchronously, so replay tests see it); the sink patches audioStart when the device takes the buffer
    const entry: SpokenCall = {
      text: call.text, reason: call.reason, priority: call.priority, key: call.key, facts: call.facts,
      s: this.s, zone, lap: this.lapNumber, brake: this.lastFrame?.input.brake ?? null, throttle: this.lastFrame?.input.throttle ?? null,
      t: { trigger: call.triggerT, created: call.createdAt, chosen, ttsReady: p.ttsReady, audioStart: chosen },
      fromBank: p.fromBank, latencyMs: chosen - call.triggerT, deviceLatencyMs: this.sinks[0]?.latencyMs ?? null,
    };
    this.transcript.push(entry);
    const first = handles[0];
    if (first) first.started.then((audioStart) => { entry.t.audioStart = audioStart; entry.latencyMs = audioStart - call.triggerT; this.bus.emit('radio', entry); });
    else this.bus.emit('radio', entry);
  }
}

function estimateSeconds(text: string): number { return 0.35 + text.split(/\s+/).length * 0.33; }
