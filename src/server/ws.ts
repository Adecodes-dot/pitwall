// WebSocket channels (after Open Pit Wall's subscription pattern):
//   status    1 Hz StatusSnapshot
//   telemetry latest frame every 50 ms (20 Hz)
//   event     adapter events as they happen
//   log       server log lines
// Client → server: {"subscribe":["telemetry","status"]} ; {"cmd":"replay.pause"} etc. (commands handled by main).
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Engine } from './engine.ts';
import type { NormalisedFrame } from '../core/types.ts';

export type Channel = 'status' | 'telemetry' | 'event' | 'log' | 'analysis' | 'radio' | 'audio' | 'voice';
const ALL: Channel[] = ['status', 'telemetry', 'event', 'log', 'analysis', 'radio', 'audio', 'voice'];

export interface WsOptions { telemetryHz?: number; /** binary frames from a page's microphone: 16 kHz mono int16 */ onAudio?: (samples: Int16Array) => void; onCommand?: (cmd: string, args: Record<string, unknown>, reply: (msg: unknown) => void) => void }

export function attachWs(server: Server, engine: Engine, opts: WsOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const subs = new Map<WebSocket, Set<Channel>>();
  let latest: NormalisedFrame | null = null;
  let lastSent: NormalisedFrame | null = null;

  const send = (ch: Channel, payload: unknown) => {
    const msg = JSON.stringify({ ch, payload }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const [ws, set] of subs) if (set.has(ch) && ws.readyState === WebSocket.OPEN) ws.send(msg);
  };

  engine.bus.on('frame', (f) => { latest = f; });
  engine.bus.on('status', (s) => send('status', s));
  engine.bus.on('event', (e) => send('event', e));
  engine.bus.on('log', (l) => send('log', l));
  let lastAnalysis: unknown = null;
  engine.bus.on('analysis', (a) => { lastAnalysis = a; send('analysis', a); });
  engine.bus.on('radio', (c) => send('radio', c));
  engine.bus.on('audio', (a) => send('audio', a));
  engine.bus.on('voice', (e) => send('voice', e));
  const interval = setInterval(() => { if (latest && latest !== lastSent) { lastSent = latest; send('telemetry', latest); } }, 1000 / (opts.telemetryHz ?? 20));

  wss.on('connection', (ws) => {
    subs.set(ws, new Set(ALL));
    ws.send(JSON.stringify({ ch: 'status', payload: engine.status(performance.now()) }));
    if (lastAnalysis) ws.send(JSON.stringify({ ch: 'analysis', payload: lastAnalysis }));
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const b = raw as Buffer;
        // copy: a ws Buffer may start at an odd offset inside a pooled ArrayBuffer
        const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 2));
        opts.onAudio?.(new Int16Array(ab));
        return;
      }
      let m: { subscribe?: Channel[]; cmd?: string; args?: Record<string, unknown> };
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (Array.isArray(m.subscribe)) subs.set(ws, new Set(m.subscribe.filter((c): c is Channel => ALL.includes(c))));
      if (m.cmd && opts.onCommand) opts.onCommand(m.cmd, m.args ?? {}, (reply) => ws.send(JSON.stringify({ ch: 'reply', cmd: m.cmd, payload: reply })));
    });
    ws.on('close', () => subs.delete(ws));
  });
  wss.on('close', () => clearInterval(interval));
  return wss;
}
