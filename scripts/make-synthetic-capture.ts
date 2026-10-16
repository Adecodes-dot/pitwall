// Write a synthetic capture: node scripts/make-synthetic-capture.ts [f1|gt7] [laps] [out.pwcap]
import { join } from 'node:path';
import { defaultTrack } from '../src/synth/track.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';
import { PwcapWriter } from '../src/capture/pwcap.ts';

const game = (process.argv[2] ?? 'gt7') as 'f1' | 'gt7';
const laps = Number(process.argv[3] ?? 3);
const out = process.argv[4] ?? join('captures', `synthetic-${game}-${laps}laps.pwcap`);
const sess = generateSession(defaultTrack(), laps, { seed: 11 });
const w = new PwcapWriter(out, { createdAt: new Date().toISOString(), game, adapterVersion: '0.1.0', notes: `synthetic, ${laps} laps`, referenceLapTimesMs: sess.lapTimesMs });
for (const r of synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' })) w.write(r);
w.close();
console.log(`${out}: ${w.count} packets, laps ${sess.lapTimesMs.map((x) => (x / 1000).toFixed(3)).join(' / ')}`);
