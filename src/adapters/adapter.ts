// Common adapter interface. An adapter is a pure function of datagrams: bytes in, frames/events out.
// Sockets, heartbeats and timing live in the server layer so adapters are testable on recordings.
import type { AdapterEvent, Capabilities, GameId, NormalisedFrame } from '../core/types.ts';

export interface AdapterOutput {
  frames: NormalisedFrame[];
  events: AdapterEvent[];
}

export interface Adapter {
  readonly game: GameId;
  readonly capabilities: Capabilities;
  /** Feed one datagram received at monotonic time t (ms). Returns zero or more frames and events. */
  feed(data: Uint8Array, t: number): AdapterOutput;
  /** Called when no datagram has arrived for a while; lets the adapter flush partial state. */
  tick?(t: number): AdapterOutput;
  reset(): void;
}

export const NONE: AdapterOutput = { frames: [], events: [] };
