// Ingest engine: routes datagrams to the right adapter, publishes frames/events on the bus,
// keeps live statistics for the status strip, and optionally records everything to a .pwcap file.
import { Bus, type StatusSnapshot } from '../core/bus.ts';
import type { GameId } from '../core/types.ts';
import { F1Adapter } from '../adapters/f1/adapter.ts';
import { Gt7Adapter } from '../adapters/gt7/adapter.ts';
import type { Adapter } from '../adapters/adapter.ts';
import { isF1Format } from '../adapters/f1/codec.ts';
import { FORMAT_BY_SIZE } from '../adapters/gt7/crypto.ts';
import { PwcapWriter, type CaptureMeta } from '../capture/pwcap.ts';

export const F1_PORT = 20777;
export const GT7_RECV_PORT = 33740;
export const GT7_SEND_PORT = 33739;

export interface EngineOptions { mode: StatusSnapshot['mode']; lanIp: string | null; /** time source for rates and loss; tests pass the recording's clock */ now?: () => number }

/** Guess the game from the datagram itself (used when the source port is ambiguous, e.g. replays of unknown captures). */
export function sniffGame(data: Uint8Array, srcPort: number): GameId | null {
  if (srcPort === GT7_RECV_PORT || srcPort === GT7_SEND_PORT) return 'gt7';
  if (srcPort === F1_PORT) return 'f1';
  if (data.length >= 29) {
    const fmt = data[0]! | (data[1]! << 8);
    if (isF1Format(fmt) && data[6]! <= 16) return 'f1';
  }
  if (FORMAT_BY_SIZE[data.length]) return 'gt7';
  return null;
}

export class Engine {
  readonly bus = new Bus();
  readonly adapters: Record<GameId, Adapter> = { f1: new F1Adapter(), gt7: new Gt7Adapter() };
  game: GameId | null = null;
  private writer: PwcapWriter | null = null;
  private packetTimes: number[] = [];
  private frameTimes: number[] = [];
  private lastPacketT: number | null = null;
  private lastSeq: number | null = null;
  /** rolling 10 s frame accounting: got/lost per frame step, robust to send rate and ignoring outages > 1 s */
  private lossWin: { t: number; got: number; lost: number }[] = [];
  private seqDeltas: number[] = [];
  private lastFrameAt = 0;
  gaps = 0;
  private statusTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private detail = 'waiting for packets';

  opts: EngineOptions;
  constructor(opts: EngineOptions) { this.opts = opts; }

  start(): void {
    this.statusTimer = setInterval(() => this.bus.emit('status', this.status(performance.now())), 500);
    this.tickTimer = setInterval(() => {
      if (!this.game) return;
      const out = this.adapters[this.game].tick?.(performance.now());
      if (out) this.publish(out.frames, out.events, performance.now());
    }, 25);
  }

  stop(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.stopCapture();
  }

  startCapture(path: string, meta: Partial<CaptureMeta> = {}): void {
    this.stopCapture();
    this.writer = new PwcapWriter(path, { createdAt: new Date().toISOString(), game: this.game ?? 'unknown', adapterVersion: '0.1.0', ...(this.opts.lanIp ? { lanIp: this.opts.lanIp } : {}), ...meta });
    this.bus.emit('log', { level: 'info', msg: `recording to ${path}` });
  }

  stopCapture(): string | null {
    if (!this.writer) return null;
    const w = this.writer; this.writer = null;
    w.close();
    this.bus.emit('log', { level: 'info', msg: `saved ${w.count} packets to ${w.path}` });
    return w.path;
  }

  get capturing(): boolean { return this.writer !== null; }
  get captureCount(): number { return this.writer?.count ?? 0; }

  /** Feed one datagram. `t` is monotonic ms (live: now; replay: original capture time). */
  ingest(data: Uint8Array, srcPort: number, t: number, tWall = Date.now()): void {
    const game = sniffGame(data, srcPort);
    this.bus.emit('datagram', { t, game: game ?? 'unknown', srcPort, data });
    if (this.writer) this.writer.write({ t, tWall, srcPort, game: game ?? 'unknown', data });
    if (!game) return;
    if (this.game !== game) {
      this.game = game;
      this.adapters[game].reset();
      this.lastSeq = null; this.lossWin = []; this.seqDeltas = [];
      this.detail = game === 'f1' ? 'F1 packets on port 20777' : 'GT7 packets on port 33740';
      this.bus.emit('event', { type: 'stream.found', t, detail: this.detail });
    }
    // statistics use the process clock so replays of old captures still show live rates
    const now = this.opts.now ? this.opts.now() : performance.now();
    this.packetTimes.push(now); this.lastPacketT = now;
    const out = this.adapters[game].feed(data, t);
    this.publish(out.frames, out.events, now);
  }

  private publish(frames: import('../core/types.ts').NormalisedFrame[], events: import('../core/types.ts').AdapterEvent[], t: number): void {
    for (const e of events) this.bus.emit('event', e);
    for (const f of frames) {
      this.frameTimes.push(t);
      let lost = 0;
      if (this.lastSeq !== null && f.seq > this.lastSeq) {
        const d = f.seq - this.lastSeq;
        if (t - this.lastFrameAt > 1000) this.gaps++; // outage: reported by stream.lost/found, not counted as loss
        else {
          this.seqDeltas.push(d); if (this.seqDeltas.length > 121) this.seqDeltas.shift();
          const step = [...this.seqDeltas].sort((a, b) => a - b)[Math.floor(this.seqDeltas.length / 2)]!;
          if (d >= step * 1.5) lost = Math.round(d / step) - 1;
        }
      }
      this.lossWin.push({ t, got: 1, lost });
      this.lastSeq = f.seq; this.lastFrameAt = t;
      this.bus.emit('frame', f);
    }
  }

  /** one line for the session log: enough to tell a network problem from an app problem */
  diag(now: number, loopDelayMaxMs: number): string {
    const s = this.status(now);
    const f1 = this.adapters.f1 as F1Adapter;
    const extra = this.game === 'f1' ? ` badLen=${f1.stats.badLength} unkFmt=${f1.stats.unknownFormat} ignored=${f1.stats.ignored}` : '';
    return `diag game=${s.game} rx=${s.receiving ? 1 : 0} pkt/s=${s.packetsPerSec} fps=${s.framesPerSec} loss10s=${s.lossPct.toFixed(1)}% gaps=${this.gaps} loopMax=${loopDelayMaxMs.toFixed(0)}ms${extra}`;
  }

  status(now: number): StatusSnapshot {
    const window = 1000;
    this.lossWin = this.lossWin.filter((x) => now - x.t < 10000);
    let got = 0, lost = 0;
    for (const x of this.lossWin) { got += x.got; lost += x.lost; }
    this.packetTimes = this.packetTimes.filter((x) => now - x < window);
    this.frameTimes = this.frameTimes.filter((x) => now - x < window);
    const age = this.lastPacketT === null ? null : now - this.lastPacketT;
    const receiving = age !== null && age < 1500;
    if (this.game && !receiving && this.lastPacketT !== null) this.detail = `no ${this.game} packets for ${Math.round((age ?? 0) / 1000)} s`;
    else if (this.game && receiving) this.detail = this.game === 'f1' ? `F1 format ${(this.adapters.f1 as F1Adapter).format ?? '?'}` : `GT7 format ${(this.adapters.gt7 as Gt7Adapter).capabilities.rawPedals ? '~/C' : 'A/B'}`;
    return {
      game: this.game, receiving, packetsPerSec: this.packetTimes.length, framesPerSec: this.frameTimes.length,
      lastPacketAgeMs: age, lossPct: got + lost > 0 ? (100 * lost) / (got + lost) : 0,
      detail: this.detail, mode: this.opts.mode, lanIp: this.opts.lanIp,
    };
  }
}
