// EA SPORTS F1 25 UDP struct layouts, transcribed from the official spec PDFs
// ("Data Output from F1 25 v3" = packetFormat 2025; "F1 25: 2026 Season Pack v1.2" = packetFormat 2026).
// Format 2024 shares every struct we use except Car Damage (no blisters) and Motion Ex (no pitch/camber).
// Wheel arrays in the F1 spec are RL, RR, FL, FR. See docs/research/f1-udp.md.
import type { Layout } from '../../core/struct.ts';
import { layoutSize } from '../../core/struct.ts';

export type F1Format = 2024 | 2025 | 2026;

export const HEADER: Layout = [
  ['packetFormat', 'u16'], ['gameYear', 'u8'], ['gameMajorVersion', 'u8'], ['gameMinorVersion', 'u8'],
  ['packetVersion', 'u8'], ['packetId', 'u8'], ['sessionUID', 'u64'], ['sessionTime', 'f32'],
  ['frameIdentifier', 'u32'], ['overallFrameIdentifier', 'u32'], ['playerCarIndex', 'u8'], ['secondaryPlayerCarIndex', 'u8'],
];
export const HEADER_SIZE = layoutSize(HEADER); // 29

export const PacketId = {
  Motion: 0, Session: 1, LapData: 2, Event: 3, Participants: 4, CarSetups: 5, CarTelemetry: 6, CarStatus: 7,
  FinalClassification: 8, LobbyInfo: 9, CarDamage: 10, SessionHistory: 11, TyreSets: 12, MotionEx: 13,
  TimeTrial: 14, LapPositions: 15, CarTelemetry2: 16,
} as const;

const CAR_MOTION_F32: Layout = [
  ['worldPositionX', 'f32'], ['worldPositionY', 'f32'], ['worldPositionZ', 'f32'],
  ['worldVelocityX', 'f32'], ['worldVelocityY', 'f32'], ['worldVelocityZ', 'f32'],
  ['worldForwardDirX', 'i16'], ['worldForwardDirY', 'i16'], ['worldForwardDirZ', 'i16'],
  ['worldRightDirX', 'i16'], ['worldRightDirY', 'i16'], ['worldRightDirZ', 'i16'],
  ['gForceLateral', 'f32'], ['gForceLongitudinal', 'f32'], ['gForceVertical', 'f32'],
  ['yaw', 'f32'], ['pitch', 'f32'], ['roll', 'f32'],
];
// 2026: g-forces quantised to int16 (divide by 1000)
const CAR_MOTION_I16: Layout = CAR_MOTION_F32.map(([n, t]) => (n.startsWith('gForce') ? [n, 'i16'] : [n, t]) as Layout[number]);

export const LAP_DATA: Layout = [
  ['lastLapTimeInMS', 'u32'], ['currentLapTimeInMS', 'u32'],
  ['sector1TimeMSPart', 'u16'], ['sector1TimeMinutesPart', 'u8'], ['sector2TimeMSPart', 'u16'], ['sector2TimeMinutesPart', 'u8'],
  ['deltaToCarInFrontMSPart', 'u16'], ['deltaToCarInFrontMinutesPart', 'u8'], ['deltaToRaceLeaderMSPart', 'u16'], ['deltaToRaceLeaderMinutesPart', 'u8'],
  ['lapDistance', 'f32'], ['totalDistance', 'f32'], ['safetyCarDelta', 'f32'],
  ['carPosition', 'u8'], ['currentLapNum', 'u8'], ['pitStatus', 'u8'], ['numPitStops', 'u8'], ['sector', 'u8'], ['currentLapInvalid', 'u8'],
  ['penalties', 'u8'], ['totalWarnings', 'u8'], ['cornerCuttingWarnings', 'u8'], ['numUnservedDriveThroughPens', 'u8'], ['numUnservedStopGoPens', 'u8'],
  ['gridPosition', 'u8'], ['driverStatus', 'u8'], ['resultStatus', 'u8'], ['pitLaneTimerActive', 'u8'],
  ['pitLaneTimeInLaneInMS', 'u16'], ['pitStopTimerInMS', 'u16'], ['pitStopShouldServePen', 'u8'],
  ['speedTrapFastestSpeed', 'f32'], ['speedTrapFastestLap', 'u8'],
];
export const LAP_DATA_TRAILER: Layout = [['timeTrialPBCarIdx', 'u8'], ['timeTrialRivalCarIdx', 'u8']];

const CAR_TELEMETRY_2025: Layout = [
  ['speed', 'u16'], ['throttle', 'f32'], ['steer', 'f32'], ['brake', 'f32'], ['clutch', 'u8'], ['gear', 'i8'],
  ['engineRPM', 'u16'], ['drs', 'u8'], ['revLightsPercent', 'u8'], ['revLightsBitValue', 'u16'],
  ['brakesTemperature', 'u16', 4], ['tyresSurfaceTemperature', 'u8', 4], ['tyresInnerTemperature', 'u8', 4],
  ['engineTemperature', 'u16'], ['tyresPressure', 'f32', 4], ['surfaceType', 'u8', 4],
];
const CAR_TELEMETRY_2026: Layout = CAR_TELEMETRY_2025.map(([n, t, c]) => (n === 'engineTemperature' ? ['engineTemperature', 'u8'] : [n, t, c]) as Layout[number]);
export const CAR_TELEMETRY_TRAILER: Layout = [['mfdPanelIndex', 'u8'], ['mfdPanelIndexSecondaryPlayer', 'u8'], ['suggestedGear', 'i8']];

const CAR_STATUS_2025: Layout = [
  ['tractionControl', 'u8'], ['antiLockBrakes', 'u8'], ['fuelMix', 'u8'], ['frontBrakeBias', 'u8'], ['pitLimiterStatus', 'u8'],
  ['fuelInTank', 'f32'], ['fuelCapacity', 'f32'], ['fuelRemainingLaps', 'f32'], ['maxRPM', 'u16'], ['idleRPM', 'u16'], ['maxGears', 'u8'],
  ['drsAllowed', 'u8'], ['drsActivationDistance', 'u16'], ['actualTyreCompound', 'u8'], ['visualTyreCompound', 'u8'], ['tyresAgeLaps', 'u8'],
  ['vehicleFiaFlags', 'i8'], ['enginePowerICE', 'f32'], ['enginePowerMGUK', 'f32'], ['ersStoreEnergy', 'f32'], ['ersDeployMode', 'u8'],
  ['ersHarvestedThisLapMGUK', 'f32'], ['ersHarvestedThisLapMGUH', 'f32'], ['ersDeployedThisLap', 'f32'], ['networkPaused', 'u8'],
];
const CAR_STATUS_2026: Layout = (() => {
  const out: Layout[number][] = [];
  for (const f of CAR_STATUS_2025) {
    if (f[0] === 'ersDeployedThisLap') out.push(['ersHarvestedLimitPerLap', 'f32']);
    out.push(f);
  }
  return out;
})();

const CAR_DAMAGE_2024: Layout = [
  ['tyresWear', 'f32', 4], ['tyresDamage', 'u8', 4], ['brakesDamage', 'u8', 4],
  ['frontLeftWingDamage', 'u8'], ['frontRightWingDamage', 'u8'], ['rearWingDamage', 'u8'], ['floorDamage', 'u8'], ['diffuserDamage', 'u8'], ['sidepodDamage', 'u8'],
  ['drsFault', 'u8'], ['ersFault', 'u8'], ['gearBoxDamage', 'u8'], ['engineDamage', 'u8'], ['engineMGUHWear', 'u8'], ['engineESWear', 'u8'], ['engineCEWear', 'u8'],
  ['engineICEWear', 'u8'], ['engineMGUKWear', 'u8'], ['engineTCWear', 'u8'], ['engineBlown', 'u8'], ['engineSeized', 'u8'],
];
const CAR_DAMAGE_2025: Layout = (() => {
  const out: Layout[number][] = [];
  for (const f of CAR_DAMAGE_2024) { out.push(f); if (f[0] === 'brakesDamage') out.push(['tyreBlisters', 'u8', 4]); }
  return out;
})();

const MOTION_EX_2024: Layout = [
  ['suspensionPosition', 'f32', 4], ['suspensionVelocity', 'f32', 4], ['suspensionAcceleration', 'f32', 4],
  ['wheelSpeed', 'f32', 4], ['wheelSlipRatio', 'f32', 4], ['wheelSlipAngle', 'f32', 4], ['wheelLatForce', 'f32', 4], ['wheelLongForce', 'f32', 4],
  ['heightOfCOGAboveGround', 'f32'], ['localVelocityX', 'f32'], ['localVelocityY', 'f32'], ['localVelocityZ', 'f32'],
  ['angularVelocityX', 'f32'], ['angularVelocityY', 'f32'], ['angularVelocityZ', 'f32'],
  ['angularAccelerationX', 'f32'], ['angularAccelerationY', 'f32'], ['angularAccelerationZ', 'f32'],
  ['frontWheelsAngle', 'f32'], ['wheelVertForce', 'f32', 4], ['frontAeroHeight', 'f32'], ['rearAeroHeight', 'f32'],
  ['frontRollAngle', 'f32'], ['rearRollAngle', 'f32'], ['chassisYaw', 'f32'],
];
const MOTION_EX_2025: Layout = [...MOTION_EX_2024, ['chassisPitch', 'f32'], ['wheelCamber', 'f32', 4], ['wheelCamberGain', 'f32', 4]];

export const CAR_TELEMETRY_2: Layout = [
  ['activeAeroMode', 'u8'], ['activeAeroAvailable', 'u8'], ['activeAeroActivationDistance', 'u16'],
  ['overtakeAvailable', 'u8'], ['overtakeActive', 'u8'], ['overtakeActivationDistance', 'u16'], ['regulations2026', 'u8'], ['drivingWrongWay', 'u8'],
];

function sessionLayout(format: F1Format): Layout {
  const out: Layout[number][] = [
    ['weather', 'u8'], ['trackTemperature', 'i8'], ['airTemperature', 'i8'], ['totalLaps', 'u8'], ['trackLength', 'u16'],
    ['sessionType', 'u8'], ['trackId', 'i8'], ['formula', 'u8'], ['sessionTimeLeft', 'u16'], ['sessionDuration', 'u16'],
    ['pitSpeedLimit', 'u8'], ['gamePaused', 'u8'], ['isSpectating', 'u8'], ['spectatorCarIndex', 'u8'], ['sliProNativeSupport', 'u8'],
    ['numMarshalZones', 'u8'],
  ];
  for (let i = 0; i < 21; i++) out.push([`mz${i}Start`, 'f32'], [`mz${i}Flag`, 'i8']);
  out.push(['safetyCarStatus', 'u8'], ['networkGame', 'u8'], ['numWeatherForecastSamples', 'u8'], ['weatherForecastSamples', 'u8', 64 * 8],
    ['forecastAccuracy', 'u8'], ['aiDifficulty', 'u8'], ['seasonLinkIdentifier', 'u32'], ['weekendLinkIdentifier', 'u32'], ['sessionLinkIdentifier', 'u32'],
    ['pitStopWindowIdealLap', 'u8'], ['pitStopWindowLatestLap', 'u8'], ['pitStopRejoinPosition', 'u8'],
    ['steeringAssist', 'u8'], ['brakingAssist', 'u8'], ['gearboxAssist', 'u8'], ['pitAssist', 'u8'], ['pitReleaseAssist', 'u8'], ['ERSAssist', 'u8'], ['DRSAssist', 'u8'],
    ['dynamicRacingLine', 'u8'], ['dynamicRacingLineType', 'u8'], ['gameMode', 'u8'], ['ruleSet', 'u8'], ['timeOfDay', 'u32'], ['sessionLength', 'u8'],
    ['speedUnitsLeadPlayer', 'u8'], ['temperatureUnitsLeadPlayer', 'u8'], ['speedUnitsSecondaryPlayer', 'u8'], ['temperatureUnitsSecondaryPlayer', 'u8'],
    ['numSafetyCarPeriods', 'u8'], ['numVirtualSafetyCarPeriods', 'u8'], ['numRedFlagPeriods', 'u8'],
    ['equalCarPerformance', 'u8'], ['recoveryMode', 'u8'], ['flashbackLimit', 'u8'], ['surfaceType', 'u8'], ['lowFuelMode', 'u8'], ['raceStarts', 'u8'],
    ['tyreTemperature', 'u8'], ['pitLaneTyreSim', 'u8'], ['carDamage', 'u8'], ['carDamageRate', 'u8'], ['collisions', 'u8'], ['collisionsOffForFirstLapOnly', 'u8'],
    ['mpUnsafePitRelease', 'u8'], ['mpOffForGriefing', 'u8'], ['cornerCuttingStringency', 'u8'], ['parcFermeRules', 'u8'], ['pitStopExperience', 'u8'],
    ['safetyCar', 'u8'], ['safetyCarExperience', 'u8'], ['formationLap', 'u8'], ['formationLapExperience', 'u8'], ['redFlags', 'u8'],
    ['affectsLicenceLevelSolo', 'u8'], ['affectsLicenceLevelMP', 'u8'], ['numSessionsInWeekend', 'u8'], ['weekendStructure', 'u8', 12],
    ['sector2LapDistanceStart', 'f32'], ['sector3LapDistanceStart', 'f32']);
  if (format === 2026) {
    out.push(['activeAeroTrackStatus', 'u8'], ['numActiveAeroZonesFull', 'u8'], ['activeAeroZonesFull', 'f32', 16],
      ['numActiveAeroZonesPartial', 'u8'], ['activeAeroZonesPartial', 'f32', 16], ['numDRSZones', 'u8'], ['drsZones', 'f32', 8],
      ['startReactionTime', 'f32'], ['antiLockBrakesAssist', 'u8'], ['tractionControlAssist', 'u8'], ['dynamicRacingLineHiVis', 'u8'],
      ['dynamicRacingLineColourBlind', 'u8'], ['recurringRewindPrompt', 'u8']);
  }
  return out;
}

export const EVENT: Layout = [['eventStringCode', 'char', 4], ['details', 'u8', 12]];

export interface FormatTable {
  format: F1Format;
  cars: number;
  /** expected datagram size by packet id; packets not listed are ignored */
  sizes: Record<number, number>;
  motion: Layout; session: Layout; lapData: Layout; carTelemetry: Layout; carStatus: Layout; carDamage: Layout; motionEx: Layout;
  carTelemetry2: Layout | null;
}

function table(format: F1Format): FormatTable {
  const cars = format === 2026 ? 24 : 22;
  const motion = format === 2026 ? CAR_MOTION_I16 : CAR_MOTION_F32;
  const session = sessionLayout(format);
  const carTelemetry = format === 2026 ? CAR_TELEMETRY_2026 : CAR_TELEMETRY_2025;
  const carStatus = format === 2026 ? CAR_STATUS_2026 : CAR_STATUS_2025;
  const carDamage = format === 2024 ? CAR_DAMAGE_2024 : CAR_DAMAGE_2025;
  const motionEx = format === 2024 ? MOTION_EX_2024 : MOTION_EX_2025;
  const carTelemetry2 = format === 2026 ? CAR_TELEMETRY_2 : null;
  const sizes: Record<number, number> = {
    [PacketId.Motion]: HEADER_SIZE + cars * layoutSize(motion),
    [PacketId.Session]: HEADER_SIZE + layoutSize(session),
    [PacketId.LapData]: HEADER_SIZE + cars * layoutSize(LAP_DATA) + layoutSize(LAP_DATA_TRAILER),
    [PacketId.Event]: HEADER_SIZE + layoutSize(EVENT),
    [PacketId.CarTelemetry]: HEADER_SIZE + cars * layoutSize(carTelemetry) + layoutSize(CAR_TELEMETRY_TRAILER),
    [PacketId.CarStatus]: HEADER_SIZE + cars * layoutSize(carStatus),
    [PacketId.CarDamage]: HEADER_SIZE + cars * layoutSize(carDamage),
    [PacketId.MotionEx]: HEADER_SIZE + layoutSize(motionEx),
  };
  if (carTelemetry2) sizes[PacketId.CarTelemetry2] = HEADER_SIZE + cars * layoutSize(carTelemetry2);
  return { format, cars, sizes, motion, session, lapData: LAP_DATA, carTelemetry, carStatus, carDamage, motionEx, carTelemetry2 };
}

export const FORMATS: Record<F1Format, FormatTable> = { 2024: table(2024), 2025: table(2025), 2026: table(2026) };

/** Official packet sizes from the EA specs, used by tests to prove the transcription is byte-exact. */
export const OFFICIAL_SIZES: Record<F1Format, Record<number, number>> = {
  2024: { 0: 1349, 1: 753, 2: 1285, 3: 45, 6: 1352, 7: 1239, 10: 953, 13: 237 },
  2025: { 0: 1349, 1: 753, 2: 1285, 3: 45, 6: 1352, 7: 1239, 10: 1041, 13: 273 },
  2026: { 0: 1325, 1: 926, 2: 1399, 3: 45, 6: 1448, 7: 1445, 10: 1133, 13: 273, 16: 269 },
};

export const SESSION_TYPES: Record<number, string> = {
  0: 'unknown', 1: 'practice1', 2: 'practice2', 3: 'practice3', 4: 'short-practice', 5: 'q1', 6: 'q2', 7: 'q3', 8: 'short-qualifying',
  9: 'one-shot-qualifying', 10: 'sprint-shootout1', 11: 'sprint-shootout2', 12: 'sprint-shootout3', 13: 'short-sprint-shootout',
  14: 'one-shot-sprint-shootout', 15: 'race', 16: 'race2', 17: 'race3', 18: 'time-trial',
};

export const TRACK_IDS: Record<number, string> = {
  0: 'melbourne', 1: 'paul-ricard', 2: 'shanghai', 3: 'sakhir', 4: 'catalunya', 5: 'monaco', 6: 'montreal', 7: 'silverstone', 8: 'hockenheim',
  9: 'hungaroring', 10: 'spa', 11: 'monza', 12: 'singapore', 13: 'suzuka', 14: 'abu-dhabi', 15: 'texas', 16: 'brazil', 17: 'austria', 18: 'sochi',
  19: 'mexico', 20: 'baku', 21: 'sakhir-short', 22: 'silverstone-short', 23: 'texas-short', 24: 'suzuka-short', 25: 'hanoi', 26: 'zandvoort',
  27: 'imola', 28: 'portimao', 29: 'jeddah', 30: 'miami', 31: 'las-vegas', 32: 'losail', 39: 'silverstone-reverse', 40: 'austria-reverse',
  41: 'zandvoort-reverse', 42: 'madrid',
};
