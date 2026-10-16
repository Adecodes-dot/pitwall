// M1 demo: generate synthetic F1 and GT7 captures, replay both headless through the real adapters,
// compare lap times with ground truth, then start the companion serving the GT7 capture at 1x.
//   npm run demo:m1            → F1 + GT7 verification, then serves GT7 replay on http://localhost:8787
//   npm run demo:m1 -- <file>  → verify + serve a real .pwcap capture instead
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { defaultTrack } from '../src/synth/track.ts';
import { generateSession } from '../src/synth/driver.ts';
import { synthRecords } from '../src/synth/emit.ts';
import { PwcapWriter, readPwcap, type CaptureRecord } from '../src/capture/pwcap.ts';
import { Engine } from '../src/server/engine.ts';
import type { AdapterEvent } from '../src/core/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const capDir = join(root, 'captures');
mkdirSync(capDir, { recursive: true });

function verify(name: string, records: CaptureRecord[], truth: number[] | undefined): boolean {
  const engine = new Engine({ mode: 'replay', lanIp: null });
  const laps: number[] = []; let frames = 0;
  engine.bus.on('event', (e: AdapterEvent) => { if (e.type === 'lap.complete' && e.timeMs > 0) laps.push(e.timeMs); }); // F1 reports the out lap with time 0
  engine.bus.on('frame', () => frames++);
  const t0 = performance.now();
  for (const r of records) engine.ingest(r.data, r.srcPort, r.t, r.tWall);
  const ms = performance.now() - t0;
  const f1 = engine.adapters.f1 as import('../src/adapters/f1/adapter.ts').F1Adapter;
  console.log(`\n== ${name}: game=${engine.game} packets=${records.length} frames=${frames} decoded in ${ms.toFixed(0)} ms (${(records.length / ms * 1000).toFixed(0)} pkt/s)${engine.game === 'f1' ? ` badLength=${f1.stats.badLength}` : ''}`);
  console.log(`   lap times from adapter : ${laps.map((x) => (x / 1000).toFixed(3)).join('  ')}`);
  if (truth) {
    console.log(`   lap times ground truth : ${truth.map((x) => (x / 1000).toFixed(3)).join('  ')}`);
    const ok = laps.length === truth.length && laps.every((x, i) => Math.abs(x - truth[i]!) <= (engine.game === 'gt7' ? 50 : 0));
    console.log(`   ${ok ? 'PASS' : 'FAIL'}: ${engine.game === 'gt7' ? 'within 50 ms' : 'exact match'}`);
    return ok;
  }
  console.log('   (no reference lap times in capture metadata; compare with the in-game timing screen)');
  return true;
}

const arg = process.argv[2];
let serveFile: string;
let allOk = true;
if (arg) {
  serveFile = resolve(arg);
  const { meta, records } = readPwcap(serveFile);
  allOk = verify(serveFile, records, meta.referenceLapTimesMs);
} else {
  const track = defaultTrack();
  const sess = generateSession(track, 3, { seed: 11 });
  for (const game of ['f1', 'gt7'] as const) {
    const recs = synthRecords(sess, game, { format: game === 'f1' ? 2025 : '~' });
    const file = join(capDir, `synthetic-${game}.pwcap`);
    const w = new PwcapWriter(file, { createdAt: new Date().toISOString(), game, adapterVersion: '0.1.0', notes: `synthetic ${track.name}, 3 laps`, referenceLapTimesMs: sess.lapTimesMs });
    for (const r of recs) w.write(r);
    w.close();
    const { records } = readPwcap(file);
    allOk = verify(file, records, sess.lapTimesMs) && allOk;
  }
  serveFile = join(capDir, 'synthetic-gt7.pwcap');
}
console.log(`\n${allOk ? 'All checks passed.' : 'CHECKS FAILED.'} Starting companion in replay mode on http://localhost:8787 (Ctrl+C to stop)\n`);
if (!existsSync(join(root, 'ui/dist/index.html'))) console.log('UI not built yet: run `npm run ui:build` in another terminal, then reload the page.');
const child = spawn(process.execPath, [join(root, 'src/server/main.ts'), 'replay', serveFile, '--speed', '1'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
