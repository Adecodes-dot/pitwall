// F1 25 adapter: assembles one NormalisedFrame per game frame from the packets that share a frameIdentifier.
// Emits on Motion Ex (the last menu-rate packet of a frame) or when the next frame begins.
import type { Adapter, AdapterOutput } from '../adapter.ts';
import type { AdapterEvent, Capabilities, FiaFlag, NormalisedFrame, SafetyCar, Wheel4 } from '../../core/types.ts';
import { emptyFrame } from '../../core/types.ts';
import type { StructValue } from '../../core/struct.ts';
import { decodeF1, type F1Header } from './codec.ts';
import { SESSION_TYPES, TRACK_IDS, type F1Format } from './layouts.ts';

export const f1Capabilities: Capabilities = {
  game: 'f1', steerUnit: 'normalised', lapDistance: true, currentLapTime: true, sectors: true, tyreWear: true, tyreInnerTemp: true,
  wheelSpeeds: true, slipRatio: true, fuelLapsRemaining: true, raceFlags: true, racePosition: true, trackId: true, assistLevels: true,
  rawPedals: false, nominalHz: 60,
};

const FIA: Record<number, FiaFlag> = { 0: 'none', 1: 'green', 2: 'blue', 3: 'yellow' };
const SC: Record<number, SafetyCar> = { 0: 'none', 1: 'full', 2: 'virtual', 3: 'formation' };
const n = (v: unknown): number => v as number;
const arr = (v: unknown): number[] => v as number[];
/** F1 wheel order RL, RR, FL, FR → FL, FR, RL, RR */
const reorder = (a: number[]): Wheel4 => [a[2]!, a[3]!, a[0]!, a[1]!];

interface SessionState {
  sessionType: string | null; trackId: string | null; totalLaps: number | null; safetyCar: SafetyCar | null;
  gearbox: 'manual' | 'manual-suggested' | 'auto' | null; racingLine: 0 | 1 | 2 | null; brakingAssist: number | null;
  sector2Start: number | null; sector3Start: number | null; trackLength: number | null;
}

export class F1Adapter implements Adapter {
  readonly game = 'f1' as const;
  readonly capabilities = f1Capabilities;
  format: F1Format | null = null;
  /** counters for the status line */
  stats = { accepted: 0, badLength: 0, unknownFormat: 0, ignored: 0 };

  private session: SessionState = { sessionType: null, trackId: null, totalLaps: null, safetyCar: null, gearbox: null, racingLine: null, brakingAssist: null, sector2Start: null, sector3Start: null, trackLength: null };
  private sessionUID: bigint | null = null;
  private status: StructValue | null = null;
  private damage: StructValue | null = null;
  private pending: { frameId: number; t: number; header: F1Header; motion?: StructValue; lap?: StructValue; tel?: StructValue; motionEx?: StructValue; ct2?: StructValue } | null = null;
  private prevLapNum: number | null = null;
  private prevLapInvalid = false;
  private prevFia: FiaFlag | null = null;
  private redFlag = false;

  reset(): void {
    this.format = null; this.session = { sessionType: null, trackId: null, totalLaps: null, safetyCar: null, gearbox: null, racingLine: null, brakingAssist: null, sector2Start: null, sector3Start: null, trackLength: null };
    this.sessionUID = null; this.status = null; this.damage = null; this.pending = null; this.prevLapNum = null; this.prevLapInvalid = false; this.prevFia = null; this.redFlag = false;
  }

  feed(data: Uint8Array, t: number): AdapterOutput {
    const d = decodeF1(data);
    if ('error' in d) {
      if (d.error === 'bad-length') this.stats.badLength++; else if (d.error === 'unknown-format') this.stats.unknownFormat++;
      return { frames: [], events: [] };
    }
    const events: AdapterEvent[] = [];
    const frames: NormalisedFrame[] = [];
    if (d.kind === 'ignored') { this.stats.ignored++; return { frames, events }; }
    this.stats.accepted++;
    const h = d.header;
    if (this.format !== h.packetFormat) {
      if (this.format !== null) events.push({ type: 'format.change', t, from: String(this.format), to: String(h.packetFormat) });
      this.format = h.packetFormat as F1Format;
    }
    if (this.sessionUID !== h.sessionUID) {
      if (this.sessionUID !== null) { this.flush(frames); this.prevLapNum = null; this.status = null; this.damage = null; }
      this.sessionUID = h.sessionUID;
      events.push({ type: 'session.start', t, sessionUid: h.sessionUID.toString() });
    }

    // Per-frame packets accumulate in `pending`; a new frameIdentifier flushes the previous one.
    const perFrame = d.kind === 'motion' || d.kind === 'lapData' || d.kind === 'carTelemetry' || d.kind === 'motionEx' || d.kind === 'carTelemetry2';
    if (perFrame) {
      if (this.pending && this.pending.frameId !== h.frameIdentifier) this.flush(frames);
      if (!this.pending) this.pending = { frameId: h.frameIdentifier, t, header: h };
    }

    switch (d.kind) {
      case 'session': {
        const s = d.data;
        const gb = n(s.gearboxAssist);
        this.session = {
          sessionType: SESSION_TYPES[n(s.sessionType)] ?? `type-${n(s.sessionType)}`,
          trackId: TRACK_IDS[n(s.trackId)] ?? (n(s.trackId) >= 0 ? `track-${n(s.trackId)}` : null),
          totalLaps: n(s.totalLaps), safetyCar: SC[n(s.safetyCarStatus)] ?? null,
          gearbox: gb === 1 ? 'manual' : gb === 2 ? 'manual-suggested' : gb === 3 ? 'auto' : null,
          racingLine: ([0, 1, 2].includes(n(s.dynamicRacingLine)) ? n(s.dynamicRacingLine) : null) as 0 | 1 | 2 | null,
          brakingAssist: n(s.brakingAssist),
          sector2Start: n(s.sector2LapDistanceStart), sector3Start: n(s.sector3LapDistanceStart), trackLength: n(s.trackLength),
        };
        break;
      }
      case 'motion': this.pending!.motion = d.car; break;
      case 'lapData': {
        this.pending!.lap = d.car;
        const lapNum = n(d.car.currentLapNum);
        if (this.prevLapNum !== null && lapNum === this.prevLapNum + 1 && this.prevLapNum >= 1) {
          events.push({ type: 'lap.complete', t, lapNumber: this.prevLapNum, timeMs: n(d.car.lastLapTimeInMS), valid: !this.prevLapInvalid });
        }
        this.prevLapNum = lapNum;
        this.prevLapInvalid = n(d.car.currentLapInvalid) === 1;
        break;
      }
      case 'carTelemetry': this.pending!.tel = d.car; break;
      case 'carStatus': {
        this.status = d.car;
        const fia = FIA[n(d.car.vehicleFiaFlags)] ?? null;
        if (fia && fia !== this.prevFia) { events.push({ type: 'flag.change', t, fia }); this.prevFia = fia; if (fia === 'green' || fia === 'none') this.redFlag = false; }
        break;
      }
      case 'carDamage': this.damage = d.car; break;
      case 'motionEx': this.pending!.motionEx = d.data; this.flush(frames); break;
      case 'carTelemetry2': this.pending!.ct2 = d.car; break;
      case 'event': {
        const dv = d.details;
        switch (d.code) {
          case 'SSTA': break; // session.start already derived from sessionUID
          case 'SEND': events.push({ type: 'session.end', t }); break;
          case 'FLBK': events.push({ type: 'flashback', t, toSessionTime: dv.getFloat32(4, true) }); this.prevLapNum = null; break;
          case 'SCAR': {
            const type = SC[dv.getUint8(0)] ?? 'none';
            const phase = (['deployed', 'returning', 'returned', 'resume'] as const)[dv.getUint8(1)];
            events.push({ type: 'safetycar', t, status: phase === 'returned' || phase === 'resume' ? 'none' : type, ...(phase ? { phase } : {}) });
            if (phase === 'deployed') this.session.safetyCar = type; else if (phase === 'returned' || phase === 'resume') this.session.safetyCar = 'none';
            break;
          }
          case 'RDFL': this.redFlag = true; events.push({ type: 'flag.change', t, fia: 'red' }); break;
        }
        break;
      }
    }
    return { frames, events };
  }

  tick(t: number): AdapterOutput {
    const frames: NormalisedFrame[] = [];
    if (this.pending && t - this.pending.t > 40) this.flush(frames);
    return { frames, events: [] };
  }

  private flush(out: NormalisedFrame[]): void {
    const p = this.pending;
    this.pending = null;
    if (!p || !p.tel) return; // no telemetry for this frame: nothing worth emitting
    const fr = emptyFrame('f1', p.t, p.header.overallFrameIdentifier);
    fr.gameTime = p.header.sessionTime;
    const tel = p.tel, lap = p.lap, mo = p.motion, mx = p.motionEx, st = this.status, dm = this.damage, s = this.session;
    fr.lap = {
      number: lap ? n(lap.currentLapNum) : null,
      distance: lap ? n(lap.lapDistance) : null,
      currentTimeMs: lap ? n(lap.currentLapTimeInMS) : null,
      lastTimeMs: lap && n(lap.lastLapTimeInMS) > 0 ? n(lap.lastLapTimeInMS) : null,
      bestTimeMs: null, // F1 gives best lap via Session History; derived by analysis from lap.complete events
      sector: lap ? (n(lap.sector) as 0 | 1 | 2) : null,
      sector1Ms: lap && (n(lap.sector1TimeMSPart) > 0 || n(lap.sector1TimeMinutesPart) > 0) ? n(lap.sector1TimeMinutesPart) * 60000 + n(lap.sector1TimeMSPart) : null,
      sector2Ms: lap && (n(lap.sector2TimeMSPart) > 0 || n(lap.sector2TimeMinutesPart) > 0) ? n(lap.sector2TimeMinutesPart) * 60000 + n(lap.sector2TimeMSPart) : null,
      valid: lap ? n(lap.currentLapInvalid) === 0 : null,
      total: s.totalLaps,
    };
    fr.pos = mo ? { x: n(mo.worldPositionX), y: n(mo.worldPositionY), z: n(mo.worldPositionZ) } : null;
    fr.vel = mo ? { x: n(mo.worldVelocityX), y: n(mo.worldVelocityY), z: n(mo.worldVelocityZ) } : null;
    fr.speed = n(tel.speed) / 3.6;
    fr.input = { throttle: n(tel.throttle), brake: n(tel.brake), steer: n(tel.steer), clutch: n(tel.clutch) / 100, throttleRaw: null, brakeRaw: null };
    fr.drivetrain = { gear: n(tel.gear), rpm: n(tel.engineRPM), maxRpm: st ? n(st.maxRPM) : null, drs: n(tel.drs) === 1 };
    fr.wheels = {
      speed: mx ? reorder(arr(mx.wheelSpeed)) : null,
      slipRatio: mx ? reorder(arr(mx.wheelSlipRatio)) : null,
      surfaceTemp: reorder(arr(tel.tyresSurfaceTemperature)),
      innerTemp: reorder(arr(tel.tyresInnerTemperature)),
      wear: dm ? reorder(arr(dm.tyresWear)) : null,
      surface: reorder(arr(tel.surfaceType)).map(String) as Wheel4<string>,
    };
    fr.fuel = st ? { level: n(st.fuelInTank), capacity: n(st.fuelCapacity), lapsRemaining: n(st.fuelRemainingLaps) } : { level: null, capacity: null, lapsRemaining: null };
    const fia = st ? (FIA[n(st.vehicleFiaFlags)] ?? null) : null;
    fr.flags = {
      fia: this.redFlag ? 'red' : fia,
      safetyCar: s.safetyCar,
      onTrack: lap ? n(lap.driverStatus) !== 0 && n(lap.resultStatus) >= 2 : null,
      paused: st ? n(st.networkPaused) === 1 : null,
      pitting: lap ? n(lap.pitStatus) !== 0 : null,
    };
    fr.race = { position: lap ? n(lap.carPosition) : null, sessionType: s.sessionType, trackId: s.trackId };
    fr.assists = {
      tc: st ? (n(st.tractionControl) as 0 | 1 | 2) : null,
      abs: st ? n(st.antiLockBrakes) === 1 : null,
      tcActive: null, asmActive: null,
      gearbox: s.gearbox, racingLine: s.racingLine,
    };
    out.push(fr);
  }
}
