// UDP sockets: F1 listener on 20777 and the GT7 heartbeat/receive pair (33739 out, 33740 in).
// The GT7 heartbeat is sent from the 33740 socket so the console replies to the port we listen on.
import dgram from 'node:dgram';
import type { Engine } from './engine.ts';
import { F1_PORT, GT7_RECV_PORT, GT7_SEND_PORT } from './engine.ts';
import type { Gt7Format } from '../adapters/gt7/crypto.ts';

export interface UdpOptions {
  f1Port?: number;
  /** PS5 address for GT7; when null we broadcast the heartbeat on the subnet (discovery). */
  gt7Host?: string | null;
  gt7Format?: Gt7Format;
  heartbeatMs?: number;
}

export class UdpIngest {
  private f1: dgram.Socket | null = null;
  private gt7: dgram.Socket | null = null;
  private hb: NodeJS.Timeout | null = null;
  private lastGt7From: string | null = null;
  errors: string[] = [];

  private engine: Engine;
  private opts: UdpOptions;
  constructor(engine: Engine, opts: UdpOptions = {}) { this.engine = engine; this.opts = opts; }

  async start(): Promise<void> {
    const { bus } = this.engine;
    const f1Port = this.opts.f1Port ?? F1_PORT;
    this.f1 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.f1.on('message', (msg) => this.engine.ingest(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength), f1Port, performance.now()));
    this.f1.on('error', (e) => { this.errors.push(`F1 socket: ${e.message}`); bus.emit('log', { level: 'error', msg: `F1 UDP ${f1Port}: ${e.message}` }); });
    await new Promise<void>((res, rej) => this.f1!.bind(f1Port, '0.0.0.0', () => res()).once('error', rej));
    bus.emit('log', { level: 'info', msg: `listening for F1 on udp/${f1Port}` });

    this.gt7 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.gt7.on('message', (msg, rinfo) => {
      if (this.lastGt7From !== rinfo.address) { this.lastGt7From = rinfo.address; bus.emit('log', { level: 'info', msg: `GT7 stream from ${rinfo.address}` }); }
      this.engine.ingest(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength), GT7_RECV_PORT, performance.now());
    });
    this.gt7.on('error', (e) => { this.errors.push(`GT7 socket: ${e.message}`); bus.emit('log', { level: 'error', msg: `GT7 UDP ${GT7_RECV_PORT}: ${e.message}` }); });
    await new Promise<void>((res, rej) => this.gt7!.bind(GT7_RECV_PORT, '0.0.0.0', () => res()).once('error', rej));
    this.gt7.setBroadcast(true);
    const hbMs = this.opts.heartbeatMs ?? 1500;
    const send = () => {
      const host = this.opts.gt7Host ?? this.lastGt7From ?? '255.255.255.255';
      this.gt7?.send(this.opts.gt7Format ?? '~', GT7_SEND_PORT, host, () => { /* ignore */ });
    };
    send();
    this.hb = setInterval(send, hbMs);
    bus.emit('log', { level: 'info', msg: `GT7 heartbeat '${this.opts.gt7Format ?? '~'}' every ${hbMs} ms to ${this.opts.gt7Host ?? 'broadcast'}:${GT7_SEND_PORT}, listening on udp/${GT7_RECV_PORT}` });
  }

  stop(): void {
    if (this.hb) clearInterval(this.hb);
    this.f1?.close(); this.gt7?.close();
    this.f1 = null; this.gt7 = null;
  }
}
