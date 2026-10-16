// M2 demo: three synthetic circuits → corner detection, references, per-corner deltas, fingerprint.
// Writes track maps to docs/milestones/m2-trackmap-<name>.svg.
//   npm run demo:m2            → synthetic (gt7 on 3 tracks, f1 on the GP track)
//   npm run demo:m2 -- <file>  → analyse a real .pwcap capture
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { defaultTrack } from '../src/synth/track.ts';
import { streetTrack, fastTrack } from '../src/synth/tracks.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';
import { readPwcap, type CaptureRecord } from '../src/capture/pwcap.ts';
import { F1Adapter } from '../src/adapters/f1/adapter.ts';
import { Gt7Adapter } from '../src/adapters/gt7/adapter.ts';
import { SessionAnalyser } from '../src/analysis/session.ts';
import { trackMapSvg } from '../src/analysis/track.ts';
import { segments, segmentDeltas, personalBest } from '../src/analysis/laps.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'milestones');
mkdirSync(outDir, { recursive: true });
const fmt = (ms: number | null) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
const sgn = (ms: number) => `${ms >= 0 ? '+' : ''}${(ms / 1000).toFixed(3)}`;

function analyse(name: string, records: CaptureRecord[], expectedCorners: number | null): boolean {
  const an = new SessionAnalyser(null);
  const adapters = { f1: new F1Adapter(), gt7: new Gt7Adapter() };
  for (const r of records) {
    const a = r.game === 'f1' ? adapters.f1 : adapters.gt7;
    const o = a.feed(r.data, r.t);
    for (const f of o.frames) an.onFrame(f);
    for (const e of o.events) an.onEvent(e);
  }
  const u = an.lastUpdate, m = an.model;
  console.log(`\n== ${name}`);
  if (!u || !m) { console.log('   no completed laps / no track model'); return false; }
  console.log(`   track ${m.id}: ${m.length} m, ${m.corners.length} corners${expectedCorners !== null ? ` (expected ${expectedCorners}: ${m.corners.length === expectedCorners ? 'PASS' : 'FAIL'})` : ''}`);
  console.log(`   corners: ${m.corners.map((c) => `${c.name}@${Math.round(c.sApex)}m R${Math.round(c.minRadius)}${c.direction[0]}`).join('  ')}`);
  console.log(`   laps: ${u.laps.map((l) => `L${l.number} ${fmt(l.timeMs)}${l.deltaToPbMs ? ` (${sgn(l.deltaToPbMs)})` : ''}`).join('  ')}`);
  console.log(`   PB ${fmt(u.pbMs)} (lap ${u.pbLap})   theoretical ${fmt(u.theoreticalMs)}   consistency ${u.fingerprint?.consistencyScore?.toFixed(0) ?? '—'}/100`);
  const laps = an.collector.laps, pb = personalBest(laps)!;
  const segs = segments(m);
  let ok = true;
  for (const l of laps) {
    if (l === pb || !l.ch) continue;
    const d = segmentDeltas(l, pb, segs);
    const sum = d.reduce((a, x) => a + x.deltaMs, 0), real = l.timeMs - pb.timeMs;
    const pass = Math.abs(sum - real) < 100; ok = ok && pass;
    console.log(`   L${l.number} vs PB: corners ${d.filter((x) => x.seg.kind === 'corner').map((x) => `${x.seg.corner!.name}${sgn(x.deltaMs)}`).join(' ')} | straights ${sgn(d.filter((x) => x.seg.kind === 'straight').reduce((a, x) => a + x.deltaMs, 0))} | sum ${sgn(sum)} vs lap ${sgn(real)} ${pass ? 'PASS' : 'FAIL'}`);
  }
  const fp = u.fingerprint!;
  console.log(`   worst corners last lap: ${u.worstCorners.map((c) => `T${c.corner} ${sgn(c.deltaMs)}`).join('  ') || '—'}`);
  console.log(`   fingerprint: ${fp.corners.slice(0, 4).map((c) => `T${c.corner} brake ${c.meanBrakePointM?.toFixed(0) ?? '—'}±${c.stdBrakePointM?.toFixed(0) ?? '—'}m vmin ${(c.meanMinSpeed * 3.6).toFixed(0)}km/h coast ${c.meanCoastingM.toFixed(0)}m${c.trailBraking ? ' trail' : ''}`).join('  ')} …`);
  console.log(`   mistakes: ${fp.mistakes.filter((x) => x.kind === 'lockup').length} lockups, ${fp.mistakes.filter((x) => x.kind === 'wheelspin').length} wheelspins (${fp.mistakes.slice(0, 5).map((x) => `${x.kind[0]}@T${x.corner}`).join(' ')})`);
  const svgPath = join(outDir, `m2-trackmap-${name.replace(/[^a-z0-9]+/gi, '-')}.svg`);
  writeFileSync(svgPath, trackMapSvg(m, { highlight: u.worstCorners.map((c) => c.corner) }));
  console.log(`   map → ${svgPath}`);
  return ok && (expectedCorners === null || m.corners.length === expectedCorners);
}

const arg = process.argv[2];
let allOk = true;
if (arg) {
  const { records } = readPwcap(resolve(arg));
  allOk = analyse(arg, records, null);
} else {
  const cases = [
    { name: 'gt7-synth-gp', track: defaultTrack(), corners: 10, game: 'gt7' as const },
    { name: 'gt7-synth-street', track: streetTrack(), corners: 14, game: 'gt7' as const },
    { name: 'gt7-synth-fast', track: fastTrack(), corners: 6, game: 'gt7' as const },
    { name: 'f1-synth-gp', track: defaultTrack(), corners: 10, game: 'f1' as const },
  ];
  for (const c of cases) {
    const sess = generateSession(c.track, 4, { seed: 21, brakeJitterM: 12, speedJitter: 0.05 });
    const recs = synthRecords(sess, c.game, { format: c.game === 'f1' ? 2025 : '~' });
    allOk = analyse(c.name, recs, c.corners) && allOk;
  }
}
console.log(`\n${allOk ? 'All M2 checks passed.' : 'M2 CHECKS FAILED.'}`);
process.exit(allOk ? 0 : 1);
