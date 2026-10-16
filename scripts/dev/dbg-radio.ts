import { Bus } from '../../src/core/bus.ts';
import { defaultTrack } from '../../src/synth/track.ts';
import { generateSession } from '../../src/synth/driver.ts';
import { synthRecords } from '../../src/synth/emit.ts';
import { Gt7Adapter } from '../../src/adapters/gt7/adapter.ts';
import { SessionAnalyser } from '../../src/analysis/session.ts';
import { Radio } from '../../src/radio/radio.ts';
import { NullSink } from '../../src/radio/audio.ts';
const sess = generateSession(defaultTrack(), 4, { seed: 13, brakeJitterM: 15, speedJitter: 0.06 });
const recs = synthRecords(sess, 'gt7', { format: '~' });
const bus = new Bus(); const analyser = new SessionAnalyser(null);
bus.on('frame', (f) => analyser.onFrame(f)); bus.on('event', (e) => analyser.onEvent(e));
analyser.listeners.push((u) => bus.emit('analysis', { ...u, svg: null }));
let clock = 0; const radio = new Radio(bus, analyser, { mode: 'coach', tts: null, sinks: [new NullSink()], now: () => clock }); radio.attach();
const a = new Gt7Adapter(); let nextFlag = 8000, on = false; let n = 0;
for (const r of recs) { clock = r.t; const o = a.feed(r.data, r.t); for (const e of o.events) bus.emit('event', e); for (const f of o.frames) bus.emit('frame', f);
  if (r.t >= nextFlag) { bus.emit('event', { type: 'flag.change', t: r.t, fia: on ? 'green' : 'yellow' }); on = !on; nextFlag += on ? 3000 : 8000; }
  if (++n % 2000 === 0) console.log(`t=${(r.t/1000).toFixed(0)}s pending=${radio.queue.pending} spoken=${radio.transcript.length} zones=${radio.zones ? radio.zones.safeRanges.length : 'none'} s=${(radio as any).s?.toFixed(0)} speed=${o.frames[0]?.speed?.toFixed(0)} thr=${o.frames[0]?.input.throttle?.toFixed(2)} dropped=${radio.dropped.length} skip=${radio.lastSkip}`); }
console.log('dropped', radio.dropped.slice(0,3).map(d=>d.why));
console.log('zones', radio.zones && radio.zones.safeRanges.map(r=>`${r.s0}-${r.s1}`).join(' '));
