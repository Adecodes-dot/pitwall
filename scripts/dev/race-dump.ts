// Per-lap fuel and tyre values from a capture, plus every unprompted radio call the engineer would make.
import { readPwcap } from '../../src/capture/pwcap.ts';
import { F1Adapter } from '../../src/adapters/f1/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
import { Bus } from '../../src/core/bus.ts';
import { Radio } from '../../src/radio/radio.ts';
import { NullSink } from '../../src/radio/audio.ts';
const { records } = readPwcap(process.argv[2]!);
const bus = new Bus(); const an = new SessionAnalyser(null); an.listeners.push((u) => bus.emit('analysis', { ...u, svg: null }));
let clock = 0; const radio = new Radio(bus, an, { mode: (process.argv[3] as never) ?? 'coach', tts: null, sinks: [new NullSink()], now: () => clock }); const saved: any[] = []; bus.on('event', (e) => { if (e.type === 'session.start') saved.push(...(radio as any).transcript); }); radio.attach();
const ad = new F1Adapter(); let lastLap: number | null = null; let last: any = null;
const r1 = (a: number[] | null) => (a ? a.map((x) => Math.round(x * 10) / 10).join('/') : '—');
for (const r of records) {
  clock = r.t; const o = ad.feed(r.data, r.t);
  for (const f of o.frames) {
    bus.emit('frame', f); an.onFrame(f); last = f;
    if (f.lap.number !== null && f.lap.number !== lastLap && f.flags.onTrack) {
      lastLap = f.lap.number;
      console.log(`lap ${f.lap.number}/${f.lap.total} fuel ${f.fuel.level?.toFixed(2)} kg of ${f.fuel.capacity} MFD-laps ${f.fuel.lapsRemaining?.toFixed(2)} | wear FL/FR/RL/RR ${r1(f.wheels.wear)} | surface ${r1(f.wheels.surfaceTemp)} | inner ${r1(f.wheels.innerTemp)} | pos ${f.race.position} ${f.race.sessionType}`);
    }
  }
  for (const e of o.events) { bus.emit('event', e); an.onEvent(e); }
}
console.log('--- radio calls (unprompted)');
for (const c of [...saved, ...((radio as any).transcript as any[])]) console.log(`${(c.t.chosen / 1000).toFixed(0)}s L${c.lap} [${c.zone}] p${c.priority} ${c.key}: ${c.text}`);
console.log('--- dropped', ((radio as any).dropped as any[]).slice(0, 8).map((d) => `${d.call.text} (${d.why})`).join(' | '));
