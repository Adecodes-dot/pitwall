// Minimal typed event bus. One instance per companion process.
import type { AdapterEvent, NormalisedFrame, GameId } from './types.ts';
import type { AnalysisUpdate } from '../analysis/session.ts';
import type { SpokenCall } from '../radio/radio.ts';

export interface BusEvents {
  frame: NormalisedFrame;
  event: AdapterEvent;
  /** Raw datagram as received, for the capture writer. */
  datagram: { t: number; game: GameId | 'unknown'; srcPort: number; data: Uint8Array };
  status: StatusSnapshot;
  log: { level: 'info' | 'warn' | 'error'; msg: string };
  /** emitted after every completed lap by the session analyser (+ a track map svg for the UI) */
  analysis: AnalysisUpdate & { svg: string | null };
  /** a radio call that started playing */
  radio: SpokenCall;
  /** an audio clip for browser clients to play */
  audio: { id: number; wavBase64: string; durationS: number };
}

export interface StatusSnapshot {
  game: GameId | null;
  receiving: boolean;
  packetsPerSec: number;
  framesPerSec: number;
  lastPacketAgeMs: number | null;
  lossPct: number;
  detail: string;
  mode: 'live' | 'replay' | 'synth';
  lanIp: string | null;
}

type Handler<T> = (payload: T) => void;

export class Bus {
  private handlers: { [K in keyof BusEvents]?: Set<Handler<BusEvents[K]>> } = {};

  on<K extends keyof BusEvents>(name: K, fn: Handler<BusEvents[K]>): () => void {
    let set = this.handlers[name] as Set<Handler<BusEvents[K]>> | undefined;
    if (!set) { set = new Set(); (this.handlers as Record<string, unknown>)[name] = set; }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  emit<K extends keyof BusEvents>(name: K, payload: BusEvents[K]): void {
    const set = this.handlers[name] as Set<Handler<BusEvents[K]>> | undefined;
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}
