// End-to-end hands-free voice test in a real browser. Chromium gets a fake microphone that loops a WAV of
// driver speech (generated with the Piper voice); the page captures it, streams it over the websocket, the
// companion recognises it offline, applies the wake word and answers. Prints what the page shows.
//   npm run voice:e2e            (needs the voice and speech models: npm run voice:get)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TtsEngine, defaultModelDir, modelAvailable } from '../src/radio/tts.ts';
import { asrAvailable } from '../src/voice/asr.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!modelAvailable() || !asrAvailable()) { console.error('models missing: run npm run voice:get'); process.exit(2); }
const outDir = join(root, 'docs', 'milestones'); mkdirSync(outDir, { recursive: true });
const cap = join(root, 'captures', 'synthetic-gt7.pwcap');
if (!existsSync(cap)) { console.error('captures/synthetic-gt7.pwcap missing: npm run capture:synth'); process.exit(2); }

// ---- the "driver": phrases separated by silence, as a 48 kHz mono WAV that Chromium loops as its microphone ----
const SCRIPT: { say: string; gapS: number }[] = [
  { say: "Engineer, how's my fuel?", gapS: 6 },
  { say: 'Hey engineer, where am I losing time?', gapS: 6 },
  { say: 'Engineer. ... How many laps to go?', gapS: 6 },
  { say: 'Engineer, talk less.', gapS: 6 },
  { say: 'He goes round the outside of the leader into turn one.', gapS: 6 },   // not addressed: must be ignored
  { say: 'Engineer, coach me.', gapS: 6 },
];
const tts = new TtsEngine({ modelDir: defaultModelDir(), threads: 2 }); await tts.start();
const RATE = 48000, chunks: Int16Array[] = [new Int16Array(RATE * 2)];
const up = (p: { samples: Int16Array; sampleRate: number }) => { const n = Math.round(p.samples.length * RATE / p.sampleRate), o = new Int16Array(n); for (let i = 0; i < n; i++) { const x = i * p.sampleRate / RATE, j = Math.floor(x), f = x - j; o[i] = Math.round((p.samples[j] ?? 0) * (1 - f) + (p.samples[j + 1] ?? p.samples[j] ?? 0) * f); } return o; };
for (const s of SCRIPT) { chunks.push(up(await tts.synth(s.say.replace('...', ','))), new Int16Array(Math.round(RATE * s.gapS))); }
await tts.stop();
const total = chunks.reduce((n, c) => n + c.length, 0), pcm = new Int16Array(total); { let o = 0; for (const c of chunks) { pcm.set(c, o); o += c.length; } }
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
Buffer.from(pcm.buffer).copy(wav, 44);
const wavPath = join(root, 'dist', 'fake-mic.wav'); mkdirSync(dirname(wavPath), { recursive: true }); writeFileSync(wavPath, wav);
console.log(`fake microphone: ${(pcm.length / RATE).toFixed(0)} s loop, ${SCRIPT.length} utterances → ${wavPath}`);

// ---- companion + browser ----
const port = 8796;
import { rmSync } from 'node:fs';
for (const f of ['voice-e2e.db', 'voice-e2e.db-wal', 'voice-e2e.db-shm']) rmSync(join(root, 'dist', f), { force: true }); // fresh settings every run
const server = spawn(process.execPath, [join(root, 'src/server/main.ts'), 'replay', cap, '--speed', '6', '--port', String(port), '--no-device-audio', '--no-llm', '--db', join(root, 'dist', 'voice-e2e.db')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PITWALL_VOICE_DEBUG: '1' } });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const stop = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', stop);
for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://localhost:${port}/api/status`); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
const info = await fetch(`http://localhost:${port}/api/settings`).then((r) => r.json()) as { voiceAvailable: boolean; settings: { mode: string } };
console.log(`companion up: voiceAvailable=${info.voiceAvailable}, mode=${info.settings.mode}`);
if (!info.voiceAvailable) { console.error('voice not available on the server\n' + serverLog.slice(-1500)); stop(); process.exit(1); }

const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`] });
const results: { heard: string; answer: string | undefined; intent: string | null }[] = [];
for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]] as const) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, permissions: ['microphone'], colorScheme: 'dark' });
  const page = await ctx.newPage();
  const seen: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (typeof f.payload !== 'string' || !f.payload.startsWith('{"ch":"voice"')) return; try { const e = JSON.parse(f.payload).payload; if (e.heard) seen.push(JSON.stringify({ heard: e.heard, intent: e.intent ?? null, answer: e.answer })); } catch { /* ignore */ } }));
  await page.goto(`http://localhost:${port}/#radio`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Turn on microphone' }).click();
  await page.waitForSelector('text=Microphone on', { timeout: 10000 });
  if (name === 'desktop') {
    // wait for the six-utterance loop to play through once (about 50 s of audio)
    const t0 = Date.now();
    while (Date.now() - t0 < 110000) { await page.waitForTimeout(1000); const answered = new Set(seen.map((s) => JSON.parse(s).intent)); if (answered.has('mode-coach')) break; }
    await page.waitForTimeout(1500);
  } else await page.waitForTimeout(14000);
  await page.screenshot({ path: join(outDir, `m6-voice-${name}.png`), fullPage: true });
  if (name === 'desktop') for (const s of seen) results.push(JSON.parse(s));
  await ctx.close();
}
await browser.close();
const final = await fetch(`http://localhost:${port}/api/settings`).then((r) => r.json()) as { settings: { mode: string } };
stop();

console.log('\nevery utterance the recogniser finished (debug log):');
for (const l of serverLog.split('\n').filter((x) => x.includes('voice-debug'))) console.log('  ' + l.replace('[info] voice-debug heard ', ''));
console.log('\nwhat the engineer understood (desktop run):');
for (const r of results) console.log(`  heard "${r.heard}"  → intent ${r.intent}${r.answer ? `  → "${r.answer}"` : ''}`);
const intents = results.map((r) => r.intent);
const checks: [string, boolean][] = [
  ['fuel question understood', intents.includes('fuel')],
  ['"losing time" question understood', intents.includes('losing')],
  ['"how many laps to go" understood (wake word, pause, then question)', intents.includes('laps-left')],
  ['"talk less" switched mode to quiet', intents.includes('mode-quiet')],
  ['"coach me" understood', intents.includes('mode-coach')],
  ['commentary without the wake word was ignored', !results.some((r) => /outside of the leader|turn one/i.test(r.heard))],
  ['mode in settings changed by voice (last command was coach me)', final.settings.mode === 'coach'],
];
let ok = true; for (const [label, pass] of checks) { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); ok &&= pass; }
process.exit(ok ? 0 : 1);
