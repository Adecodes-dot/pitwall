// GT7 adapter: decrypt → parse → NormalisedFrame, plus lap detection and a tick-based lap timer.
// GT7 provides no current lap time (except format C) and no lap distance; see RESEARCH.md §3.
import type { Adapter, AdapterOutput } from '../adapter.ts';
import type { AdapterEvent, Capabilities, NormalisedFrame } from '../../core/types.ts';
import { emptyFrame } from '../../core/types.ts';
import { decryptGt7, type Gt7Format } from './crypto.ts';
import { GT7_FLAG, parseGt7, type Gt7Packet } from './packet.ts';

export const GT7_HZ = 60;

export const gt7Capabilities = (format: Gt7Format | null): Capabilities => ({
  game: 'gt7',
  steerUnit: format && format !== 'A' ? 'wheel-rad' : null,
  lapDistance: false,
  currentLapTime: true, // derived from ticks (or native in format C)
  sectors: false,
  tyreWear: false,
  tyreInnerTemp: false,
  wheelSpeeds: true,
  slipRatio: false,
  fuelLapsRemaining: false,
  raceFlags: false,
  racePosition: false,
  trackId: false,
  assistLevels: false,
  rawPedals: format === '~' || format === 'C',
  nominalHz: GT7_HZ,
});

export class Gt7Adapter implements Adapter {
  readonly game = 'gt7' as const;
  capabilities: Capabilities = gt7Capabilities(null);

  private format: Gt7Format | null = null;
  private lastPacketId = -1;
  private firstPacketId = -1;
  private seq = 0;
  private prevLap = -1;
  private lapStartPacketId = -1;
  private pendingLap: { lapNumber: number; prevLastLapMs: number; packetsWaited: number } | null = null;
  private prevOnTrack = false;
  private lastDecryptOk = true;

  reset(): void {
    this.format = null; this.lastPacketId = -1; this.firstPacketId = -1; this.seq = 0;
    this.prevLap = -1; this.lapStartPacketId = -1; this.pendingLap = null;
    this.prevOnTrack = false; this.capabilities = gt7Capabilities(null);
  }

  feed(data: Uint8Array, t: number): AdapterOutput {
    const dec = decryptGt7(data);
    if (!dec) {
      const events: AdapterEvent[] = [];
      if (this.lastDecryptOk) events.push({ type: 'stream.lost', t });
      this.lastDecryptOk = false;
      return { frames: [], events };
    }
    const events: AdapterEvent[] = [];
    if (!this.lastDecryptOk) { this.lastDecryptOk = true; }
    if (this.format !== dec.format) {
      if (this.format !== null) events.push({ type: 'format.change', t, from: this.format, to: dec.format });
      this.format = dec.format;
      this.capabilities = gt7Capabilities(dec.format);
    }
    const p = parseGt7(dec.plain, dec.format);

    // Packet id handling: monotonic counter; a large backwards jump means the console restarted the stream.
    if (this.lastPacketId >= 0 && p.packetId <= this.lastPacketId) {
      if (p.packetId < this.lastPacketId - 1000) {
        this.firstPacketId = p.packetId; this.prevLap = -1; this.lapStartPacketId = -1;
        events.push({ type: 'session.start', t });
      } else {
        return { frames: [], events }; // duplicate / out-of-order, drop
      }
    }
    if (this.firstPacketId < 0) { this.firstPacketId = p.packetId; events.push({ type: 'session.start', t }); }
    this.lastPacketId = p.packetId;
    this.seq++;

    const onTrack = (p.flags & GT7_FLAG.carOnTrack) !== 0 && (p.flags & GT7_FLAG.loading) === 0;
    const paused = (p.flags & GT7_FLAG.paused) !== 0;

    // Lap boundary: lap counter increments while on track. Lap 0 → 1 is the race start, not a completed lap.
    if (onTrack && this.prevLap >= 0 && p.lapCount !== this.prevLap) {
      if (p.lapCount > this.prevLap && this.prevLap >= 1) {
        this.pendingLap = { lapNumber: this.prevLap, prevLastLapMs: this.lastSeenLastLapMs, packetsWaited: 0 };
      }
      this.lapStartPacketId = p.packetId;
    }
    if (!onTrack && this.prevOnTrack) {
      // Left the track (back to menu). Next lap counter will restart.
      this.prevLap = -1; this.lapStartPacketId = -1;
    }
    if (onTrack && this.prevLap < 0) { this.prevLap = p.lapCount; this.lapStartPacketId = p.packetId; }
    if (onTrack) this.prevLap = p.lapCount;
    this.prevOnTrack = onTrack;

    // Resolve the pending lap once the console has published the new last-lap time (same packet or a few later).
    if (this.pendingLap) {
      const pl = this.pendingLap;
      if (p.lastLapMs > 0 && p.lastLapMs !== pl.prevLastLapMs) {
        events.push({ type: 'lap.complete', t, lapNumber: pl.lapNumber, timeMs: p.lastLapMs, valid: null });
        this.pendingLap = null;
      } else if (++pl.packetsWaited > 30) {
        // The game did not change last-lap time (e.g. identical to previous or an invalid lap); report what we have.
        events.push({ type: 'lap.complete', t, lapNumber: pl.lapNumber, timeMs: p.lastLapMs > 0 ? p.lastLapMs : -1, valid: null });
        this.pendingLap = null;
      }
    }
    this.lastSeenLastLapMs = p.lastLapMs;

    const frame = this.toFrame(p, t, onTrack, paused);
    return { frames: [frame], events };
  }

  private lastSeenLastLapMs = -1;

  private toFrame(p: Gt7Packet, t: number, onTrack: boolean, paused: boolean): NormalisedFrame {
    const fr = emptyFrame('gt7', t, p.packetId);
    fr.gameTime = (p.packetId - this.firstPacketId) / GT7_HZ;
    const ticksThisLap = this.lapStartPacketId >= 0 ? p.packetId - this.lapStartPacketId : null;
    fr.lap = {
      number: onTrack ? p.lapCount : null,
      distance: null,
      currentTimeMs: p.currentLapMs !== null ? p.currentLapMs
        : ticksThisLap !== null && onTrack && p.lapCount >= 1 ? Math.round(ticksThisLap * 1000 / GT7_HZ) : null,
      lastTimeMs: p.lastLapMs > 0 ? p.lastLapMs : null,
      bestTimeMs: p.bestLapMs > 0 ? p.bestLapMs : null,
      sector: null, sector1Ms: null, sector2Ms: null,
      valid: null,
      total: p.lapsInRace > 0 ? p.lapsInRace : null,
    };
    fr.pos = { x: p.position[0], y: p.position[1], z: p.position[2] };
    fr.vel = { x: p.velocity[0], y: p.velocity[1], z: p.velocity[2] };
    fr.speed = p.speed;
    fr.input = {
      throttle: p.throttle / 255,
      brake: p.brake / 255,
      steer: p.wheelRotationRad,
      clutch: p.clutch,
      throttleRaw: p.throttleRaw !== null ? p.throttleRaw / 255 : null,
      brakeRaw: p.brakeRaw !== null ? p.brakeRaw / 255 : null,
    };
    fr.drivetrain = { gear: p.gear, rpm: p.rpm, maxRpm: p.maxAlertRpm > 0 ? p.maxAlertRpm : null, drs: null };
    const ws: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) ws[i] = Math.abs(p.wheelRevs[i]! * p.tyreRadius[i]!);
    fr.wheels = { speed: ws, slipRatio: null, surfaceTemp: p.tyreTemp, innerTemp: null, wear: null, surface: p.surfaceTypes };
    fr.fuel = { level: p.fuelLevel, capacity: p.fuelCapacity > 0 ? p.fuelCapacity : null, lapsRemaining: null };
    fr.flags = { fia: null, safetyCar: null, onTrack, paused, pitting: null };
    fr.race = { position: p.preRacePosition > 0 ? p.preRacePosition : null, sessionType: null, trackId: null };
    fr.assists = {
      tc: null, abs: null,
      tcActive: (p.flags & GT7_FLAG.tcsActive) !== 0,
      asmActive: (p.flags & GT7_FLAG.asmActive) !== 0,
      gearbox: null, racingLine: null,
    };
    return fr;
  }
}
