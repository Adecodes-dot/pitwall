// Pit Wall normalised telemetry schema. See ARCHITECTURE.md §3.
// Every field a game may not provide is `T | null`; null means "not provided by this game"
// (or not yet known this frame). Adapters never fabricate a value.

export type GameId = 'f1' | 'gt7';

/** Wheel order is always FL, FR, RL, RR. F1 arrays (RL, RR, FL, FR) are reordered by the adapter. */
export type Wheel4<T = number> = [fl: T, fr: T, rl: T, rr: T];

export type FiaFlag = 'none' | 'green' | 'blue' | 'yellow' | 'red';
export type SafetyCar = 'none' | 'full' | 'virtual' | 'formation';
export type GearboxAssist = 'manual' | 'manual-suggested' | 'auto';

export interface NormalisedFrame {
  /** Monotonic ms at receive (performance.now()). Replay preserves original spacing. */
  t: number;
  /** Game-reported session time in seconds, if any. */
  gameTime: number | null;
  game: GameId;
  /** Adapter packet counter for loss detection (game-provided where possible). */
  seq: number;
  lap: {
    number: number | null;
    /** Metres along the lap; may be negative before the line (F1). Null for GT7 until the track model projects it. */
    distance: number | null;
    currentTimeMs: number | null;
    lastTimeMs: number | null;
    bestTimeMs: number | null;
    sector: 0 | 1 | 2 | null;
    sector1Ms: number | null;
    sector2Ms: number | null;
    valid: boolean | null;
    total: number | null;
  };
  pos: { x: number; y: number; z: number } | null;
  vel: { x: number; y: number; z: number } | null;
  /** m/s */
  speed: number | null;
  input: {
    /** 0..1 after any driver assist (what the car received) */
    throttle: number | null;
    brake: number | null;
    /** -1..1 normalised where the game gives a normalised value; see Capabilities.steerUnit */
    steer: number | null;
    clutch: number | null;
    /** 0..1 before assists (driver's foot), where provided */
    throttleRaw: number | null;
    brakeRaw: number | null;
  };
  drivetrain: { gear: number | null; rpm: number | null; maxRpm: number | null; drs: boolean | null };
  wheels: {
    /** m/s per wheel */
    speed: Wheel4 | null;
    slipRatio: Wheel4 | null;
    surfaceTemp: Wheel4 | null;
    innerTemp: Wheel4 | null;
    /** percent */
    wear: Wheel4 | null;
    surface: Wheel4<string> | null;
  };
  fuel: { level: number | null; capacity: number | null; lapsRemaining: number | null };
  flags: {
    fia: FiaFlag | null;
    safetyCar: SafetyCar | null;
    onTrack: boolean | null;
    paused: boolean | null;
    pitting: boolean | null;
  };
  race: { position: number | null; sessionType: string | null; trackId: string | null };
  assists: {
    tc: 0 | 1 | 2 | null;
    abs: boolean | null;
    tcActive: boolean | null;
    asmActive: boolean | null;
    gearbox: GearboxAssist | null;
    racingLine: 0 | 1 | 2 | null;
  };
}

/** What a game adapter can ever provide. Analysis and radio consult this before mentioning a field. */
export interface Capabilities {
  game: GameId;
  /** 'normalised' = -1..1 at full lock; 'wheel-rad' = physical wheel rotation in radians */
  steerUnit: 'normalised' | 'wheel-rad' | null;
  lapDistance: boolean;
  currentLapTime: boolean;
  sectors: boolean;
  tyreWear: boolean;
  tyreInnerTemp: boolean;
  wheelSpeeds: boolean;
  slipRatio: boolean;
  fuelLapsRemaining: boolean;
  raceFlags: boolean;
  racePosition: boolean;
  trackId: boolean;
  assistLevels: boolean;
  rawPedals: boolean;
  /** Nominal frames per second from the game */
  nominalHz: number;
}

export type AdapterEvent =
  | { type: 'session.start'; t: number; sessionUid?: string }
  | { type: 'session.end'; t: number }
  | { type: 'lap.complete'; t: number; lapNumber: number; timeMs: number; valid: boolean | null }
  | { type: 'flag.change'; t: number; fia: FiaFlag }
  | { type: 'safetycar'; t: number; status: SafetyCar; phase?: 'deployed' | 'returning' | 'returned' | 'resume' }
  | { type: 'flashback'; t: number; toSessionTime: number }
  | { type: 'format.change'; t: number; from: string; to: string }
  | { type: 'stream.lost'; t: number }
  | { type: 'stream.found'; t: number; detail: string };

export const emptyFrame = (game: GameId, t: number, seq: number): NormalisedFrame => ({
  t,
  gameTime: null,
  game,
  seq,
  lap: {
    number: null, distance: null, currentTimeMs: null, lastTimeMs: null, bestTimeMs: null,
    sector: null, sector1Ms: null, sector2Ms: null, valid: null, total: null,
  },
  pos: null,
  vel: null,
  speed: null,
  input: { throttle: null, brake: null, steer: null, clutch: null, throttleRaw: null, brakeRaw: null },
  drivetrain: { gear: null, rpm: null, maxRpm: null, drs: null },
  wheels: { speed: null, slipRatio: null, surfaceTemp: null, innerTemp: null, wear: null, surface: null },
  fuel: { level: null, capacity: null, lapsRemaining: null },
  flags: { fia: null, safetyCar: null, onTrack: null, paused: null, pitting: null },
  race: { position: null, sessionType: null, trackId: null },
  assists: { tc: null, abs: null, tcActive: null, asmActive: null, gearbox: null, racingLine: null },
});
