# EA SPORTS F1 UDP telemetry — research appendix (2026-10-16)

Source: web research pass; §2 and §4 were read directly from the two EA spec PDFs. Synthesis is in `../../RESEARCH.md`.

## 1. Current edition and official spec threads

| Item | Finding | Source |
|---|---|---|
| Current product | **There is no standalone "F1 26".** EA skipped a 2026 title; F1 25 got a paid **"F1 25: 2026 Season Pack"** expansion (PS5/XSX/PC). A "reimagined" game follows in 2027. | [VGC](https://www.videogameschronicle.com/news/ea-sports-says-therell-be-no-f1-26-with-f1-25-getting-a-paid-2026-season-expansion-instead), [Racer](https://racer.com/2025/11/19/no-f1-26-videogame-ea-sports-says) |
| 2026 Season Pack release | **3 June 2026**. Adds Audi, Cadillac (24-car grid), Madring, 2026 regs (active aero, Overtake mode). | [EA FAQ](https://www.ea.com/en/games/f1/f1-25/faq), [EA launch post](https://careers.ea.com/games/f1/news/f1-25-2026-season-pack-launch) |
| F1 25 spec (format 2025) | EA Info-Hub blog "F1® 25 UDP Specification" + discussion thread. PDF "Data Output from F1 25 v3.pdf" (31 pp). | Blog: https://forums.ea.com/blog/f1-games-game-info-hub-en/f1%c2%ae-25-udp-specification/12187347 · Discussion: https://forums.ea.com/discussions/f1-25-general-discussion-en/discussion-f1%C2%AE-25-udp-specification/12187351 · PDF: https://forums.ea.com/t5/s/tghpe58374/attachments/tghpe58374/f1-games-game-info-hub-en/61/4/Data%20Output%20from%20F1%2025%20v3.pdf |
| 2026 Season Pack spec (format 2026) | "F1®25: 2026 Season Pack UDP SPECIFICATION" thread. PDF "Data Output from F1® 25: 2026 Season Pack Version 1.2" (33 pp). | Discussion: https://forums.ea.com/discussions/f1-25-general-discussion-en/discussion-f1%C2%AE25-2026-season-pack-udp-specification/13424444 · PDF: https://forums.ea.com/t5/s/tghpe58374/attachments/tghpe58374/f1-games-game-info-hub-en/61/10/Data%20Output%20from%20F1%2025%202026%20Season%20Pack%20(Season%208).pdf |
| Patch 1.25 (Sept 2026) | "Overtake Enabled" race-control message added to UDP output (OVEN/OVDI/PMEN/PMDI events). | https://forums.ea.com/blog/f1-games-game-info-hub-en/f1%C2%AE-25-2026-season-pack-%E2%80%93-v1-25-%E2%80%93-patch-notes/13694119 |

forums.ea.com HTML returns 403 to scripted fetches, but the PDF attachments download fine.

## 2. Spec details (from the EA PDFs)

All values little-endian, packed, no padding. Max cars **22 (format 2025)** / **24 (format 2026)**. Wheel arrays are ordered RL, RR, FL, FR.

### Packet header (29 bytes, identical in 2024/2025/2026)

| Offset | Type | Field | Comment |
|---|---|---|---|
| 0 | uint16 | m_packetFormat | 2024 / 2025 / 2026 |
| 2 | uint8 | m_gameYear | 25 (**still 25 under the 2026 pack**) |
| 3 | uint8 | m_gameMajorVersion | |
| 4 | uint8 | m_gameMinorVersion | |
| 5 | uint8 | m_packetVersion | starts at 1 |
| 6 | uint8 | m_packetId | see table |
| 7 | uint64 | m_sessionUID | |
| 15 | float | m_sessionTime | seconds |
| 19 | uint32 | m_frameIdentifier | |
| 23 | uint32 | m_overallFrameIdentifier | does not go back after flashbacks |
| 27 | uint8 | m_playerCarIndex | |
| 28 | uint8 | m_secondaryPlayerCarIndex | 255 if none |

### Packet IDs, sizes, frequencies

| ID | Name | F1 24 | F1 25 (2025) | 2026 pack (2026) | Frequency |
|---|---|---|---|---|---|
| 0 | Motion | 1349 | 1349 | 1325 | menu rate |
| 1 | Session | 753 | 753 | 926 | 2/s |
| 2 | Lap Data | 1285 | 1285 | 1399 | menu rate |
| 3 | Event | 45 | 45 | 45 | on event |
| 4 | Participants | 1350 | 1284 | 1470 | every 5 s |
| 5 | Car Setups | 1133 | 1133 | 1233 | 2/s |
| 6 | Car Telemetry | 1352 | 1352 | 1448 | menu rate |
| 7 | Car Status | 1239 | 1239 | 1445 | menu rate |
| 8 | Final Classification | 1020 | 1042 | 1134 | once at race end |
| 9 | Lobby Info | 1306 | 954 | 1062 | 2/s in lobby |
| 10 | Car Damage | 953 | 1041 | 1133 | 10/s |
| 11 | Session History | 1460 | 1460 | 1460 | 20/s cycling cars |
| 12 | Tyre Sets | 231 | 231 | 231 | 20/s cycling cars |
| 13 | Motion Ex | 237 | 273 | 273 | menu rate |
| 14 | Time Trial | 101 | 101 | 104 | 1/s (TT only) |
| 15 | Lap Positions | – | 1131 | 1231 | 1/s |
| 16 | Car Telemetry 2 | – | – | 269 | menu rate |

"Menu rate" = UDP Send Rate (10/20/30/60 Hz). Rate-as-menu packets are emitted together on the same frame: Lap Data, Motion, Car Telemetry, Car Status, Motion Ex (+ Car Telemetry 2 in 2026); Session and Setups every 0.5 s. (F1 24 sizes: [MacManley/f1-24-udp](https://github.com/MacManley/f1-24-udp); 2025/2026 from the PDFs, cross-checked with [MacManley/f1-25-udp](https://github.com/MacManley/f1-25-udp) and [MacManley/f1-26-udp](https://github.com/MacManley/f1-26-udp).)

### Car Telemetry (ID 6) — per-car struct, 60 bytes (2025) / 59 bytes (2026)

| Off | Type | Field |
|---|---|---|
| 0 | uint16 | m_speed (km/h) |
| 2 | float | m_throttle (0..1) |
| 6 | float | m_steer (−1..1) |
| 10 | float | m_brake (0..1) |
| 14 | uint8 | m_clutch (0..100) |
| 15 | int8 | m_gear (1–8, N=0, R=−1) |
| 16 | uint16 | m_engineRPM |
| 18 | uint8 | m_drs (0/1) |
| 19 | uint8 | m_revLightsPercent |
| 20 | uint16 | m_revLightsBitValue |
| 22 | uint16[4] | m_brakesTemperature |
| 30 | uint8[4] | m_tyresSurfaceTemperature |
| 34 | uint8[4] | m_tyresInnerTemperature |
| 38 | uint16 (2025) / **uint8 (2026)** | m_engineTemperature |
| 40 (39) | float[4] | m_tyresPressure (PSI) |
| 56 (55) | uint8[4] | m_surfaceType |

Packet = header + N×struct + `uint8 m_mfdPanelIndex`, `uint8 m_mfdPanelIndexSecondaryPlayer`, `int8 m_suggestedGear` (29+22×60+3 = 1352; 29+24×59+3 = 1448).

### Car Status (ID 7) — per-car struct, 55 bytes (2025) / 59 bytes (2026)

| Off | Type | Field | Enum |
|---|---|---|---|
| 0 | uint8 | m_tractionControl | 0 off, 1 medium, 2 full |
| 1 | uint8 | m_antiLockBrakes | 0 off, 1 on |
| 2 | uint8 | m_fuelMix | 0 lean, 1 standard, 2 rich, 3 max |
| 3 | uint8 | m_frontBrakeBias | % |
| 4 | uint8 | m_pitLimiterStatus | 0/1 |
| 5 | float | m_fuelInTank | kg |
| 9 | float | m_fuelCapacity | |
| 13 | float | m_fuelRemainingLaps | |
| 17 | uint16 | m_maxRPM | |
| 19 | uint16 | m_idleRPM | |
| 21 | uint8 | m_maxGears | |
| 22 | uint8 | m_drsAllowed | 0/1 |
| 23 | uint16 | m_drsActivationDistance | 0 = n/a, else metres |
| 25 | uint8 | m_actualTyreCompound | 16 C5, 17 C4, 18 C3, 19 C2, 20 C1, 21 C0, 22 C6, 7 inter, 8 wet |
| 26 | uint8 | m_visualTyreCompound | 16 soft, 17 medium, 18 hard, 7 inter, 8 wet |
| 27 | uint8 | m_tyresAgeLaps | |
| 28 | int8 | m_vehicleFiaFlags | −1 unknown, 0 none, 1 green, 2 blue, 3 yellow |
| 29 | float | m_enginePowerICE (W) | |
| 33 | float | m_enginePowerMGUK (W) | |
| 37 | float | m_ersStoreEnergy (J) | |
| 41 | uint8 | m_ersDeployMode | 0 none, 1 medium, 2 hotlap, 3 overtake/boost |
| 42 | float | m_ersHarvestedThisLapMGUK | |
| 46 | float | m_ersHarvestedThisLapMGUH | |
| **2026 only: 50** | float | m_ersHarvestedLimitPerLap | new |
| 50 (54) | float | m_ersDeployedThisLap | |
| 54 (58) | uint8 | m_networkPaused | |

**Driver-assist settings live in the Session packet** (player's settings, session-wide): `m_steeringAssist` (0/1), `m_brakingAssist` (0 off, 1 low, 2 med, 3 high), `m_gearboxAssist` (1 manual, 2 manual+suggested, 3 auto), `m_pitAssist`, `m_pitReleaseAssist`, `m_ERSAssist`, `m_DRSAssist` (0/1), `m_dynamicRacingLine` (0 off, 1 corners, 2 full), `m_dynamicRacingLineType` (0 2D, 1 3D). 2026 appends `m_antiLockBrakesAssist` (0/1), `m_tractionControlAssist` (0/1/2), `m_dynamicRacingLineHiVis`, `m_dynamicRacingLineColourBlind`, `m_recurringRewindPrompt`. Car Status `m_tractionControl` / `m_antiLockBrakes` give the per-car live value.

### Where each signal lives

| Signal | Packet / field |
|---|---|
| Lap distance / total distance | Lap Data `m_lapDistance`, `m_totalDistance` (float m, negative before the line) |
| Current / last lap time | Lap Data `m_currentLapTimeInMS`, `m_lastLapTimeInMS` (uint32) |
| Sector times | Lap Data `m_sector1TimeMSPart` (uint16) + `m_sector1TimeMinutesPart` (uint8), same for sector 2; S3 derived. Boundaries: Session `m_sector2LapDistanceStart`, `m_sector3LapDistanceStart` |
| Sector number | Lap Data `m_sector` (0/1/2) |
| World position | Motion `m_worldPositionX/Y/Z` (float m), per car |
| Speed/throttle/brake/steer/gear/RPM/DRS | Car Telemetry |
| Tyre surface/inner temps | Car Telemetry uint8[4] |
| Tyre wear | **Car Damage** `m_tyresWear[4]` (float %), `m_tyreBlisters[4]`, `m_tyresDamage[4]` |
| Fuel in tank / remaining laps, ERS | Car Status |
| Flags | Car Status `m_vehicleFiaFlags`; Session `m_marshalZones[21]` {`m_zoneStart` float, `m_zoneFlag` int8}, `m_safetyCarStatus` (0 none, 1 full, 2 VSC, 3 formation); Event SCAR/RDFL |
| Session type / track | Session `m_sessionType` (0 unk, 1–3 P1–P3, 4 short P, 5–7 Q1–Q3, 8 short Q, 9 OSQ, 10–14 sprint shootouts, 15 race, 16 race 2, 17 race 3, 18 TT), `m_trackId` (int8; 0 Melbourne … 32 Losail; 39–41 reverse layouts), `m_formula` |
| Wheel speed / slip | Motion Ex (player only): `m_wheelSpeed[4]`, `m_wheelSlipRatio[4]`, `m_wheelSlipAngle[4]`, lat/long/vert forces, suspension, local velocity, angular vel/acc, `m_frontWheelsAngle`, `m_chassisYaw/Pitch`, camber |
| 2026 extras | Car Telemetry 2: `m_activeAeroMode`, `m_activeAeroAvailable`, `m_activeAeroActivationDistance`, `m_overtakeAvailable`, `m_overtakeActive`, `m_overtakeActivationDistance`, `m_2026Regulations`, `m_drivingWrongWay`. Session: active-aero zones, DRS zones (max 4), `m_startReactionTime` |

### Event string codes (ID 3; `char[4]` + union)

SSTA Session Started · SEND Session Ended · FTLP Fastest Lap {vehicleIdx, lapTime s} · RTMT Retirement {vehicleIdx, reason} · DRSE/DRSD DRS enabled/disabled {reason} · TMPT Team-mate in pits · CHQF Chequered flag · RCWN Race winner · PENA Penalty {penaltyType, infringementType, vehicleIdx, otherVehicleIdx, time, lapNum, placesGained} · SPTP Speed trap · STLG Start lights {numLights} · LGOT Lights out · DTSV Drive-through served · SGSV Stop-go served · FLBK Flashback {flashbackFrameIdentifier, flashbackSessionTime} · BUTN Buttons · RDFL Red flag · OVTK Overtake · SCAR Safety car {safetyCarType, eventType 0 deployed / 1 returning / 2 returned / 3 resume} · COLL Collision (+severity in 2026). **2026 adds** PMEN/PMDI partial-mode enabled/disabled, OVEN/OVDI overtake-mode enabled/disabled. **There is no "lap complete" event**: detect via Lap Data `m_currentLapNum` incrementing / `m_lastLapTimeInMS` changing, or Session History.

## 3. In-game settings

Options → Settings → "UDP Telemetry Settings" (console: "Settings → Telemetry Settings"). Settings: **UDP Telemetry** (On/Off, default Off), **UDP Broadcast Mode** (On/Off; exists on PS5; "transmits across the subnet, not necessary to set a target IP"), **UDP IP Address**, **UDP Port** (default 20777), **UDP Send Rate** (10/20/30/60 Hz, default 20), **UDP Format** (2026 / 2025 / 2024 under the pack; EA supports "the previous 2 UDP formats"), **Your Telemetry** (Restricted default / Public; Restricted zeroes other players' view of your fuel, mix, brake bias, ERS, engine power, all Car Damage, and the whole Tyre Sets packet), **Show online ID / gamertags** (Off default). The game sends only during an active session. PS5 setup guides: [GTPlanet SimHub/PS5](https://www.gtplanet.net/forum/threads/configuring-f1-25-telemetry-data-to-work-with-simhub-on-the-playstation-5.432377/), [F1Laps PS5](https://www.f1laps.com/faqs/setup-telemetry-playstation-5/), [F1Laps 2026 settings](https://www.f1laps.com/faqs/f1-26-udp-telemetry-settings/). The pack's default format is reportedly 2026.

## 4. Format differences and detection

**F1 24 → F1 25 (2025)**: stop-go time in SGSV; tyre blister % in Car Damage; chassis pitch + camber in Motion Ex (237→273); Participants livery colours and name 48→32 chars (1350→1284; Lobby 1306→954); DRS-disabled reason; retirement reason; **new Lap Positions packet (15)**; result reason in Final Classification (1020→1042); C6 compound. Header unchanged.

**F1 25 → 2026 Season Pack (2026)**: max cars 22→24; Motion g-forces float→int16 (÷1000); Car Telemetry engineTemperature uint16→uint8; Participants driverId/networkId/teamId uint8→uint16; Car Status +`m_ersHarvestedLimitPerLap`; Session +active-aero/DRS zones, start reaction time, ABS/TC/hi-vis/colourblind/rewind assists (753→926); **new Car Telemetry 2 (16)**; Collision +severity; PMEN/PMDI/OVEN/OVDI events. Header unchanged; `m_gameYear` stays 25.

**Detection**: read `uint16` at offset 0 (2024/2025/2026) to select the struct table; `m_packetId` at offset 6; validate datagram length against the size table and reject mismatches (as [Volodrum's app](https://github.com/Volodrum/CrossPlatformF1TelemetryApp) does). Support 2024/2025/2026 simultaneously and key car count (22 vs 24) off packetFormat.

## 5. Open-source parsers

| Project | Lang | Licence | Formats | Last push | Notes |
|---|---|---|---|---|---|
| [racehub-io/f1-telemetry-client](https://github.com/racehub-io/f1-telemetry-client) (npm `@racehub-io/f1-telemetry-client`) | TS/Node | MIT | 2018–2025 tested on recordings; **2026 experimental** | 2026-09-28 | v0.3.0 adds 24/25/2026, typed listeners; npm `latest` still 0.2.12. Best borrow candidate (struct tables). |
| [deltazeroproduction/f1-udp-parser](https://github.com/deltazeroproduction/f1-udp-parser) | TS | MIT (README) | 2022–2025 | 2025-10-07 | No 2026. |
| [MacManley/f1-25-udp](https://github.com/MacManley/f1-25-udp) / [f1-26-udp](https://github.com/MacManley/f1-26-udp) | C++ | MIT | 2025 / 2026 | 2026-07 / 2026-06 | READMEs are near-verbatim spec structs. |
| [Volodrum/CrossPlatformF1TelemetryApp](https://github.com/Volodrum/CrossPlatformF1TelemetryApp) | C# | **none declared** | 2025 + 2026 | 2026-10-15 | Do not copy. |
| [F1Game.UDP](https://github.com/volodymyr-fed/F1Game.UDP) | C# | MIT | 24/25/26 | 2026-06-18 | |
| [f1-packets](https://github.com/P403n1x87/f1-packets) | Python | MIT | spec-generated | 2026-06-05 | |
| [beamuu/f1-telemetry](https://github.com/beamuu/f1-telemetry) | Rust | MIT | 2025 | 2025-09-12 | |

## 6. Community tools (PS5-capable unless noted)

- **SimHub** (Windows, free): 9.11.14 (3 Jun 2026) added the 2026 pack format with legacy fallback; 9.12.5 (9 Sep 2026) added Patch 1.25 events — [changelog](https://www.simhubdash.com/download-2/).
- **F1Laps** (desktop + mobile, freemium): auto-detects format; recommends 2026 format, 20 Hz — [site](https://www.f1laps.com/).
- **Sim Racing Telemetry / SRT** (UNAmedia): v1.19.0 added 2026 — [page](https://www.simracingtelemetry.com/games/F12026/).
- **RaceLab** (PC): recommends latest format, 60 Hz — [docs](https://docs.racelab.app/docs/first-steps/f1).
- **EA Racenet**: time-trial telemetry only, not live UDP.
- **PITWALL ONE** (Steam, live strategy with phone second screen); **Pits n' Giggles** (PC HUD, 2026 support); **Telemetry Tool for F1 25**; **RS Dash**; **Race Dash for Sim Games** (iPad).

## Confidence and gaps
- High: header, sizes, structs, enums, events, settings — read from the EA PDFs; sizes check arithmetically. Byte offsets computed from packed structs.
- Send-rate option list (10/20/30/60, default 20) verified only on EA's F1 22 accessibility page; spec XML default confirms 20.
- Forum report of `m_driverStatus`/`m_gridPosition` ordering in Lap Data unverified against live packets.
- Unknown whether the 2026 pack emits 22 or 24 cars when UDP Format is set to 2025.
- racehub's 2026 support is spec-generated, not validated against recordings.
- Session History, Tyre Sets, Final Classification and Lobby structs not transcribed in detail.
