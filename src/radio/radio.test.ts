import { describe, expect, it } from 'vitest';
import { Bus } from '../core/bus.ts';
import { defaultTrack } from '../synth/track.ts';
import { streetTrack } from '../synth/tracks.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import { SessionAnalyser } from '../analysis/session.ts';
import { Radio } from './radio.ts';
import { NullSink } from './audio.ts';
import { RadioQueue, type Call } from './queue.ts';
import { checkCall, REFERENCE_CALLS, REJECTED_EXAMPLES } from './rules.ts';
import { buildZones, canStartCall } from './safezones.ts';
import { coachingCalls, sayLapTime } from './calls.ts';

const call = (text: string, priority: 1 | 2 | 3 | 4, facts: Call['facts'] = {}, key = text): Call => ({ text, priority, key, reason: 'test', facts, dueAfter: 0, expiresAt: 1e12, immediate: priority === 1, createdAt: 0, triggerT: 0, ...(typeof facts.corner === 'number' ? { corner: facts.corner } : {}) });

describe('persona rules', () => {
  it('accepts all 20 reference calls', () => {
    for (const r of REFERENCE_CALLS) { const res = checkCall(call(r.text, r.priority, r.facts)); expect(res.violations, r.text).toEqual([]); }
  });
  it('rejects the rejected examples', () => {
    for (const t of REJECTED_EXAMPLES) expect(checkCall(call(t, 3, { corner: 1 })).ok, t).toBe(false);
  });
  it('rejects coaching calls with invented numbers or no corner', () => {
    expect(checkCall(call('Turn 4, braking 10 metres early.', 3, { corner: 4 })).violations).toContain('number 10 not in facts');
    expect(checkCall(call('Brake 10 metres later.', 3, { metres: 10 })).ok).toBe(false);
  });
  it('reads lap times like an engineer', () => {
    expect(sayLapTime(92456)).toBe('one thirty-two point four');
    expect(sayLapTime(65900)).toBe('one oh five point nine');
    expect(sayLapTime(90364)).toBe('one thirty point three'); // was "one thirty three", heard as 1:33 at Miami
    expect(sayLapTime(120000)).toBe('two oh zero point zero');
  });
});

describe('queue', () => {
  it('orders by priority, dedupes keys, enforces per-lap caps and corner cooldowns', () => {
    const q = new RadioQueue(); q.mode = 'normal'; q.newLap(1);
    expect(q.push(call('Turn 4, braking 10 metres early.', 3, { corner: 4, metres: 10 }, 'coach:T4:brake'))).toBe(true);
    expect(q.push(call('Turn 4, braking 10 metres early.', 3, { corner: 4, metres: 10 }, 'coach:T4:brake'))).toBe(false); // dup
    q.push(call('Fuel, two laps short, lift and coast.', 2, {}, 'fuel'));
    q.push(call('Yellow flag.', 1, {}, 'flag'));
    expect(q.next(1)!.key).toBe('flag'); q.spoken(q.next(1)!);
    expect(q.next(1)!.key).toBe('fuel'); q.spoken(q.next(1)!);
    expect(q.next(1)!.key).toBe('coach:T4:brake'); q.spoken(q.next(1)!);
    // second coaching call this lap is allowed in normal (cap 2), third is not
    const c7 = call('Turn 7, carry 5 more through the apex.', 3, { corner: 7, kph: 5 }, 'coach:T7:apex');
    q.push(c7); expect(q.next(1)).toBe(c7); q.spoken(c7);
    const c8 = call('Turn 8, you’re losing two tenths there.', 3, { corner: 8, tenths: 2 }, 'coach:T8:delta');
    q.push(c8); expect(q.next(1)).toBeNull();
    // next lap: T4 is on cooldown for 3 laps, T8 can go
    q.newLap(2);
    expect(q.push(call('Turn 4, carry 5 more through the apex.', 3, { corner: 4, kph: 5 }, 'coach:T4:apex'))).toBe(false);
    expect(q.next(1)).toBe(c8);
  });
  it('quiet mode speaks safety and strategy, rations coaching to one call every 3 laps', () => {
    const q = new RadioQueue(); q.mode = 'quiet'; q.newLap(5);
    const c = call('Turn 2, braking 10 metres early.', 3, { corner: 2, metres: 10 }, 'coach:T2:brake');
    q.push(c); expect(q.next(1)).toBe(c); q.spoken(c);
    q.newLap(6);
    const d = call('Turn 3, braking 15 metres early.', 3, { corner: 3, metres: 15 }, 'coach:T3:brake');
    q.push(d); expect(q.next(1)).toBeNull();
    q.newLap(8); expect(q.next(1)).toBe(d);
    q.push(call('Fuel, one lap short, lift and coast.', 2, {}, 'fuel')); expect(q.next(1)!.key).toBe('fuel');
  });
  it('expires stale calls', () => {
    const q = new RadioQueue();
    const c = { ...call('Yellow flag.', 1, {}, 'flag'), expiresAt: 100 };
    q.push(c); expect(q.next(50)).toBe(c); expect(q.next(150)).toBeNull();
  });
});

function runRadio(game: 'f1' | 'gt7', track = defaultTrack(), laps = 4) {
  const sess = generateSession(track, laps, { seed: 13, brakeJitterM: 15, speedJitter: 0.06 });
  const recs = synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' });
  const bus = new Bus();
  const analyser = new SessionAnalyser(null);
  bus.on('frame', (f) => analyser.onFrame(f));
  bus.on('event', (e) => analyser.onEvent(e));
  analyser.listeners.push((u) => bus.emit('analysis', { ...u, svg: null }));
  let clock = 0;
  const sink = new NullSink();
  const radio = new Radio(bus, analyser, { mode: 'coach', tts: null, sinks: [sink], now: () => clock });
  radio.attach();
  const adapter = game === 'f1' ? new F1Adapter() : new Gt7Adapter();
  let nextFlag = 8000, flagOn = false;
  for (const r of recs) {
    clock = r.t;
    const o = adapter.feed(r.data, r.t);
    for (const e of o.events) bus.emit('event', e);
    for (const f of o.frames) bus.emit('frame', f);
    // inject a yellow flag every 8 s of session time, cleared 3 s later (safety calls at random track positions)
    if (r.t >= nextFlag) { bus.emit('event', { type: 'flag.change', t: r.t, fia: flagOn ? 'green' : 'yellow' }); flagOn = !flagOn; nextFlag += flagOn ? 3000 : 8000; }
  }
  return { radio, analyser, sess };
}

describe('radio with asynchronous TTS', () => {
  it('speaks dynamic calls once synthesis resolves (promise is replaced in the prepared map)', async () => {
    const sess = generateSession(defaultTrack(), 4, { seed: 13, brakeJitterM: 15, speedJitter: 0.06 });
    const recs = synthRecords(sess, 'gt7', { format: '~' });
    const bus = new Bus();
    const analyser = new SessionAnalyser(null);
    bus.on('frame', (f) => analyser.onFrame(f));
    bus.on('event', (e) => analyser.onEvent(e));
    analyser.listeners.push((u) => bus.emit('analysis', { ...u, svg: null }));
    let clock = 0;
    let synths = 0;
    const fakeTts = { get: () => null, speak: async (text: string) => { synths++; await new Promise((r) => setTimeout(r, 2)); return { samples: new Int16Array(22050), sampleRate: 22050, durationS: 1 + text.length / 40 }; } };
    const radio = new Radio(bus, analyser, { mode: 'coach', tts: fakeTts as never, sinks: [new NullSink()], now: () => clock });
    radio.attach();
    const adapter = new Gt7Adapter();
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]!; clock = r.t;
      const o = adapter.feed(r.data, r.t);
      for (const e of o.events) bus.emit('event', e);
      for (const f of o.frames) bus.emit('frame', f);
      if (i % 300 === 0) await new Promise((res) => setTimeout(res, 5)); // let synthesis promises resolve as a real session would
    }
    await new Promise((res) => setTimeout(res, 20));
    expect(synths).toBeGreaterThan(0);
    expect(radio.transcript.length).toBeGreaterThan(2);
    expect(radio.transcript.every((c) => c.fromBank === false)).toBe(true);
    expect(radio.dropped).toEqual([]);
  });
});

describe('radio on replayed sessions', () => {
  for (const game of ['f1', 'gt7'] as const) {
    it(`${game}: produces calls and never starts one in a braking zone or corner`, () => {
      const { radio, analyser } = runRadio(game);
      const spoken = radio.transcript;
      expect(spoken.length).toBeGreaterThan(8);
      expect(spoken.some((c) => c.priority === 1)).toBe(true);
      expect(spoken.some((c) => c.priority === 3)).toBe(true);
      // final zone map built from every lap the driver drove
      const zones = buildZones(analyser.model!, analyser.collector.laps);
      for (const c of spoken) {
        expect(c.brake ?? 0, `${c.text} @ ${c.s} brake`).toBeLessThan(0.05);
        if (c.zone === 'safe') {
          const i = ((Math.round(c.s!) % zones.L) + zones.L) % zones.L;
          expect(zones.braking[i], `${c.text} at s=${c.s} is in a braking zone`).toBe(0);
          expect(zones.corner[i], `${c.text} at s=${c.s} is in a corner`).toBe(0);
        } else {
          expect(c.priority).toBe(1); // only safety calls may use the straight heuristic before the model exists
          expect(c.throttle ?? 0).toBeGreaterThan(0.8);
        }
      }
      // every spoken coaching call names a corner and passes the rules
      for (const c of spoken.filter((x) => x.priority === 3)) expect(c.text).toMatch(/^Turn \d+/);
      expect(radio.dropped).toEqual([]);
    });
  }

  it('safe zones: no safe metre overlaps braking or corner; a long call is refused near a zone end', () => {
    const { analyser } = runRadio('gt7', streetTrack(), 3);
    const z = buildZones(analyser.model!, analyser.collector.laps);
    for (let s = 0; s < z.L; s++) if (z.safe[s]) { expect(z.braking[s]).toBe(0); expect(z.corner[s]).toBe(0); }
    expect(z.safeRanges.length).toBeGreaterThan(5);
    const r = z.safeRanges.find((x) => x.s1 - x.s0 > 150)!;
    expect(canStartCall(z, r.s0 + 5, 60, 1.5)).toBe(true);
    expect(canStartCall(z, r.s1 - 20, 60, 1.5)).toBe(false); // 20 m left at 60 m/s < 1.9 s needed
    expect(canStartCall(z, (r.s1 + 2) % z.L, 60, 0.5)).toBe(false); // not safe
  });

  it('coaching calls are specific: corner number, a number from the facts, one idea', () => {
    const { analyser } = runRadio('gt7');
    const u = analyser.lastUpdate!;
    const calls = coachingCalls({ update: u, assists: { abs: false, tc: 0 }, max: 3 }, { now: 0, triggerT: 0 });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(checkCall(c).violations).toEqual([]);
      expect(c.corner).toBe(c.facts.corner);
      expect(c.text.split(',').length).toBeLessThanOrEqual(3);
    }
  });

  it('a corner pass that lost over 2 s (spin, off, contact) gets no coaching call', () => {
    // Miami race, lap 17: a near-stop at T14 came out as "Turn 14, carry 140 more through the apex."
    const { analyser } = runRadio('gt7');
    const u = analyser.lastUpdate!;
    const c0 = coachingCalls({ update: u, assists: { abs: false, tc: 0 }, max: 3 }, { now: 0, triggerT: 0 })[0]!.corner;
    const incident = { ...u, worstCorners: u.worstCorners.map((w) => (w.corner === c0 ? { ...w, deltaMs: 4600 } : w)) };
    const calls = coachingCalls({ update: incident, assists: { abs: false, tc: 0 }, max: 3 }, { now: 0, triggerT: 0 });
    expect(calls.some((c) => c.corner === c0)).toBe(false);
  });

  it('with ABS on, no "locking" calls are produced', () => {
    const { analyser } = runRadio('f1');
    const u = analyser.lastUpdate!;
    const withAbs = coachingCalls({ update: u, assists: { abs: true, tc: 1 }, max: 10 }, { now: 0, triggerT: 0 });
    expect(withAbs.every((c) => !/locking/.test(c.text))).toBe(true);
  });
});

describe('replies to the driver with no live data (menus, garage)', () => {
  const rig = () => {
    const bus = new Bus(); let clock = 1000; const sink = new NullSink(); const said: string[] = [];
    bus.on('radio', (e) => said.push(`${e.text}|${e.zone}`));
    const radio = new Radio(bus, new SessionAnalyser(), { mode: 'normal', tts: null, sinks: [sink], now: () => clock });
    radio.attach();
    return { radio, sink, said, later: (ms: number) => { clock += ms; radio.tick(clock); } };
  };
  // one frame of a car sitting in the garage: the game is on, nothing is moving
  const garageFrame = () => {
    const recs = synthRecords(generateSession(defaultTrack(), 1, { seed: 13 }), 'f1', { format: 2025 });
    const a = new F1Adapter();
    for (const r of recs) { const f = a.feed(r.data, r.t).frames[0]; if (f) return { ...f, flags: { ...f.flags, onTrack: false } }; }
    throw new Error('no frame');
  };
  it('"radio check" and "Say again?" are spoken, not just shown as text', async () => {
    const { radio, sink, said, later } = rig();
    radio.onFrame(garageFrame());
    await radio.ask('radio check', { voice: true });
    later(5000); // the first reply has finished
    await radio.ask('purple monkey dishwasher', { voice: true });
    later(0);
    expect(sink.played.length).toBe(2);
    expect(said).toEqual(['Loud and clear.|unknown', 'Say again?|unknown']);
  });
  it('with no game sending, an unclear phrase is room audio: no "Say again?"; a radio check is still answered', async () => {
    // 2026-11-08: the idle app said "Say again?" 7 times to songs with "at last" in them
    const { radio, sink, said, later } = rig();
    await radio.ask('i cant see a girl all its own', { voice: true });
    later(5000);
    await radio.ask('radio check', { voice: true });
    later(0);
    expect(said).toEqual(['Loud and clear.|unknown']);
    expect(sink.played.length).toBe(1);
  });
});
