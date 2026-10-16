// Companion entry point.
//   node src/server/main.ts live   [--port 8787] [--capture out.pwcap] [--gt7-host 192.168.1.20] [--gt7-format ~]
//   node src/server/main.ts replay <file.pwcap> [--speed 1|4|max] [--port 8787]
//   node src/server/main.ts synth  [--game f1|gt7] [--laps 3] [--speed 1] [--port 8787]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Engine } from './engine.ts';
import { UdpIngest } from './udp.ts';
import { attachWs } from './ws.ts';
import { createHttp, lanIp } from './http.ts';
import { readPwcap, type CaptureRecord } from '../capture/pwcap.ts';
import { replay, type ReplayHandle } from '../capture/replay.ts';
import { defaultTrack } from '../synth/track.ts';
import { generateSession } from '../synth/driver.ts';
import { synthRecords } from '../synth/emit.ts';
import type { Gt7Format } from '../adapters/gt7/crypto.ts';
import { SessionAnalyser } from '../analysis/session.ts';
import { Store } from '../analysis/store.ts';
import { trackMapSvg } from '../analysis/track.ts';
import { Radio } from '../radio/radio.ts';
import { TtsEngine, BANK_PHRASES, defaultModelDir, modelAvailable } from '../radio/tts.ts';
import { BusSink, DeviceSink, type AudioSink } from '../radio/audio.ts';
import type { Chattiness } from '../radio/queue.ts';
import { buildDebrief, debriefHtml } from '../debrief/debrief.ts';
import { AnthropicPhraser, TemplatePhraser, hasAnthropicCredentials, type Phraser } from '../llm/phrase.ts';
import { SettingsStore, type Settings } from './settings.ts';
import { CrashReporter, VERSION } from './crash.ts';
import { existsSync, readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const UI_DIST = process.env.PITWALL_UI ?? resolve(here, '../../ui/dist');

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8787' }, capture: { type: 'string' }, 'gt7-host': { type: 'string' }, 'gt7-format': { type: 'string', default: '~' },
    speed: { type: 'string', default: '1' }, db: { type: 'string' }, mode: { type: 'string', default: 'normal' }, 'no-device-audio': { type: 'boolean', default: false }, 'no-llm': { type: 'boolean', default: false }, game: { type: 'string', default: 'f1' }, laps: { type: 'string', default: '3' }, quiet: { type: 'boolean', default: false },
  },
});
const mode = (positionals[0] ?? 'live') as 'live' | 'replay' | 'synth';
const port = Number(v.port);
const ip = lanIp();

const engine = new Engine({ mode, lanIp: ip });
if (!v.quiet) engine.bus.on('log', (l) => console.log(`[${l.level}] ${l.msg}`));
const dbPath = v.db ?? join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '.', 'PitWall', 'pitwall.db');
const store = new Store(dbPath);
const settings = new SettingsStore(store.db);
const crash = new CrashReporter(join(dirname(dbPath), 'logs'), engine.bus);
crash.setEnabled(settings.get().crashLogs);
crash.install();
const modelsDir = process.env.PITWALL_MODELS ?? resolve(here, '../../models');
const voices = () => (existsSync(modelsDir) ? readdirSync(modelsDir).filter((d) => existsSync(join(modelsDir, d, 'tokens.txt'))) : []);
const analyser = new SessionAnalyser(store);
engine.bus.on('frame', (f) => analyser.onFrame(f));
engine.bus.on('event', (e) => analyser.onEvent(e));
analyser.listeners.push((u) => engine.bus.emit('analysis', { ...u, svg: analyser.model ? trackMapSvg(analyser.model, { width: 520, highlight: u.worstCorners.map((c) => c.corner) }) : null }));

// ---- radio: TTS, audio sinks, orchestrator ----
let tts: TtsEngine | null = null;
const voiceDir = join(modelsDir, settings.get().voice);
if (modelAvailable(voiceDir) || modelAvailable()) {
  tts = new TtsEngine({ modelDir: modelAvailable(voiceDir) ? voiceDir : defaultModelDir(), threads: 4 });
  try { await tts.start(); const t0 = performance.now(); const n = await tts.prime(BANK_PHRASES); engine.bus.emit('log', { level: 'info', msg: `TTS ready: ${n} phrases banked in ${Math.round(performance.now() - t0)} ms` }); }
  catch (e) { engine.bus.emit('log', { level: 'error', msg: `TTS failed: ${(e as Error).message}` }); tts = null; }
} else engine.bus.emit('log', { level: 'warn', msg: 'no voice model in models/; run: npm run voice:get (radio will be silent)' });
const busSink = new BusSink(engine.bus);
const sinks: AudioSink[] = [];
if (!v['no-device-audio'] && settings.get().deviceAudio) { try { const d = new DeviceSink(22050, 40); await d.start(); sinks.push(d); engine.bus.emit('log', { level: 'info', msg: 'audio: laptop output device (40 ms buffer)' }); } catch (e) { engine.bus.emit('log', { level: 'warn', msg: `audio device unavailable: ${(e as Error).message}` }); } }
sinks.push(busSink);
const phraser: Phraser = v['no-llm'] || !settings.get().llm || !hasAnthropicCredentials() ? new TemplatePhraser() : new AnthropicPhraser();
engine.bus.emit('log', { level: 'info', msg: `phrasing: ${phraser.name}${phraser.name === 'template' ? ' (set ANTHROPIC_API_KEY to enable LLM rephrasing; live calls never depend on it)' : ''}` });
const radio = new Radio(engine.bus, analyser, { mode: (settings.get().mode ?? v.mode) as Chattiness, tts, sinks, phraser });
radio.muted = settings.get().muted;
let restartNeeded = false;
function applySettings(patch: Partial<Settings>): Settings {
  const s = settings.update(patch);
  if (patch.mode) radio.mode = s.mode;
  if (patch.muted !== undefined) radio.muted = s.muted;
  if (patch.crashLogs !== undefined) crash.setEnabled(s.crashLogs);
  if (patch.deviceAudio !== undefined || patch.voice !== undefined || patch.gt7Format !== undefined || patch.llm !== undefined) restartNeeded = true;
  engine.bus.emit('log', { level: 'info', msg: `settings updated: ${Object.keys(patch).join(', ')}${restartNeeded ? ' (restart to apply audio/voice/format/LLM changes)' : ''}` });
  return s;
}
radio.attach();
engine.start();

let handle: ReplayHandle | null = null;
let records: CaptureRecord[] = [];
const speedOf = (s: string) => (s === 'max' ? Infinity : Number(s));

function startReplay(recs: CaptureRecord[], speed: number): void {
  handle?.stop();
  records = recs;
  for (const g of Object.values(engine.adapters)) g.reset();
  engine.game = null;
  handle = replay(recs, {
    speed,
    sink: (r) => engine.ingest(r.data, r.srcPort, r.t, r.tWall),
    onProgress: (i, n) => { if (i % 2000 === 0 || i === n) engine.bus.emit('log', { level: 'info', msg: `replay ${i}/${n}` }); },
    onDone: () => engine.bus.emit('log', { level: 'info', msg: 'replay finished' }),
  });
}

const server = createHttp(engine, {
  staticDir: UI_DIST,
  api: {
    '/api/info': () => ({ version: VERSION, mode, lanIp: ip, port, game: engine.game, capturing: engine.capturing, firstRunDone: settings.get().firstRunDone, radio: { mode: radio.mode, tts: tts !== null, sinks: sinks.map((s) => s.name), spoken: radio.transcript.length }, replay: handle ? { paused: handle.paused, records: records.length } : null }),
    '/api/capture/start': () => { const p = join(process.cwd(), 'captures', `${engine.game ?? 'unknown'}-${new Date().toISOString().replace(/[:.]/g, '-')}.pwcap`); engine.startCapture(p); return { path: p }; },
    '/api/capture/stop': () => ({ path: engine.stopCapture() }),
    '/api/settings': async (req) => { if (req.method === 'PUT' || req.method === 'POST') { const body = await new Promise<string>((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); }); return { settings: applySettings(JSON.parse(body || '{}')), restartNeeded }; } return { settings: settings.get(), restartNeeded, voices: voices(), llmCredentials: hasAnthropicCredentials(), ttsLoaded: tts !== null, deviceSink: sinks.some((x) => x.name === 'device'), version: VERSION, logsDir: crash.dir, dbPath }; },
    '/api/logs': () => ({ lines: crash.tail(150), dir: crash.dir }),
    '/api/debrief': () => buildDebrief(analyser, store) ?? { error: 'no completed laps yet' },
    '/api/debrief.html': (_req, _url, res) => { const d = buildDebrief(analyser, store); if (!d) return { error: 'no completed laps yet' }; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="pitwall-debrief-${(d.trackName ?? 'session').replace(/[^a-z0-9]+/gi, '-')}.html"` }); res.end(debriefHtml(d)); return undefined; },
  },
});
attachWs(server, engine, {
  onCommand: (cmd, args, reply) => {
    if (cmd === 'replay.pause') handle?.pause();
    else if (cmd === 'replay.resume') handle?.resume();
    else if (cmd === 'replay.restart') startReplay(records, speedOf(String(args.speed ?? v.speed)));
    else if (cmd === 'capture.start') engine.startCapture(join(process.cwd(), 'captures', `${engine.game ?? 'unknown'}-${Date.now()}.pwcap`));
    else if (cmd === 'capture.stop') engine.stopCapture();
    else if (cmd === 'radio.mode') { radio.mode = String(args.mode ?? 'normal') as Chattiness; engine.bus.emit('log', { level: 'info', msg: `radio mode: ${radio.mode}` }); }
    else if (cmd === 'radio.check') radio.radioCheck();
    else if (cmd === 'radio.mute') radio.muted = Boolean(args.muted);
    else if (cmd === 'audio.latency') busSink.reportLatency(Number(args.ms));
    else if (cmd === 'settings.update') { reply({ ok: true, settings: applySettings((args.patch ?? {}) as Partial<Settings>), restartNeeded }); return; }
    else if (cmd === 'radio.ask') { radio.ask(String(args.text ?? '')).then((a) => reply({ ok: true, answer: a })); return; }
    reply({ ok: true });
  },
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`Pit Wall companion (${mode})  →  http://localhost:${port}  |  phone: http://${ip ?? '<lan-ip>'}:${port}  |  db: ${dbPath}`);
  if (mode === 'live') {
    const udp = new UdpIngest(engine, { gt7Host: v['gt7-host'] ?? null, gt7Format: (v['gt7-format'] !== '~' ? v['gt7-format'] : settings.get().gt7Format) as Gt7Format });
    await udp.start();
    if (v.capture) engine.startCapture(resolve(v.capture));
    else if (settings.get().recordSessions) { engine.bus.on('event', (e) => { if (e.type === 'stream.found' && !engine.capturing) engine.startCapture(join(process.cwd(), 'captures', `${engine.game ?? 'unknown'}-${new Date().toISOString().replace(/[:.]/g, '-')}.pwcap`)); }); }
    process.on('SIGINT', () => { engine.stopCapture(); udp.stop(); process.exit(0); });
  } else if (mode === 'replay') {
    const file = positionals[1];
    if (!file) { console.error('usage: replay <file.pwcap>'); process.exit(2); }
    const { meta, records: recs } = readPwcap(resolve(file));
    console.log(`loaded ${recs.length} packets, game=${meta.game}, notes=${meta.notes ?? ''}`);
    startReplay(recs, speedOf(v.speed));
  } else if (mode === 'synth') {
    const sess = generateSession(defaultTrack(), Number(v.laps), { seed: 11 });
    const recs = synthRecords(sess, v.game === 'gt7' ? 'gt7' : 'f1', { format: v.game === 'gt7' ? '~' : 2025 });
    console.log(`synthetic ${v.game}: ${recs.length} packets, lap times ${sess.lapTimesMs.map((ms) => (ms / 1000).toFixed(3)).join(' / ')}`);
    startReplay(recs, speedOf(v.speed));
  }
});
