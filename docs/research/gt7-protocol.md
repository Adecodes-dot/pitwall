# GT7 "Simulator Interface" UDP telemetry — research appendix (2026-10-16)

Source: web research pass over PDTools, Bornhall, gt7dashboard, MacManley/gt7-udp, ThrottleGeist, jegr78, zetetos, MoebiusX. The synthesis is in `../../RESEARCH.md`; this file keeps the detail.

## 1. Protocol mechanics

**Transport.** Client sends a 1-byte UDP heartbeat to the PS5 on **33739**; the PS5 replies to the *sender's* address with a 60 Hz stream on **33740**. Confirmed in PDTools (`ReceivePortGT7 = 33739`, `BindPortGT7 = 33740`; GT Sport/GT6 used 33339/33340) — [SimulatorInterfaceClient.cs](https://raw.githubusercontent.com/Nenkai/PDTools/master/PDTools.SimulatorInterface/SimulatorInterfaceClient.cs); Bornhall — [gt7telemetry.py](https://raw.githubusercontent.com/Bornhall/gt7telemetry/main/gt7telemetry.py); gt7dashboard — [gt7communication.py](https://raw.githubusercontent.com/snipem/gt7dashboard/main/gt7dashboard/gt7communication.py). Send the heartbeat from the same socket bound to 33740 so the PS5 replies to the port you listen on ([ThrottleGeist relay.py](https://raw.githubusercontent.com/ThrottleGeist/gt7-telemetry-relay/main/src/gt7_telemetry_relay/relay.py)).

**Heartbeat characters and packet sizes** (PDTools `"A"u8 / "B"u8 / "~"u8`, sizes `0x128 / 0x13C / 0x158`; MacManley `PACKET_*_SIZE`):

| Heartbeat | Size | Added in | Notes |
|---|---|---|---|
| `A` | 296 (0x128) | launch | base |
| `B` | 316 (0x13C) | GT7 1.42 | +steering wheel angle, sway/heave/surge; reportedly absent in Sport Mode |
| `~` | 344 (0x158) | GT7 1.42 | +unfiltered pedals, torque vectors, energy recovery; **not sent during replays** |
| `C` | 368 (0x170) | "around 1.68" (community claim) | +surface type, current lap ms, wheel steer angles, wheelbase, car category |

Sources: [PDTools SimulatorInterfaceClient.cs](https://raw.githubusercontent.com/Nenkai/PDTools/master/PDTools.SimulatorInterface/SimulatorInterfaceClient.cs); [PDTools issue #14](https://github.com/Nenkai/PDTools/issues/14); [MacManley/gt7-udp README](https://github.com/MacManley/gt7-udp) and [GT7UDPParser.cpp](https://raw.githubusercontent.com/MacManley/gt7-udp/main/src/GT7UDPParser.cpp). GT7 1.42 shipped 2024-01-25 ([GTPlanet](https://www.gtplanet.net/?p=131401)); 1.68 shipped 2026-03-12 ([gran-turismo.com](https://www.gran-turismo.com/us/gt7/news/00_8497133.html)). PDTools (pushed 2026-09-07) still has no `C` type.

**Heartbeat interval.** No authoritative value. PDTools 10 s; Bornhall/gt7dashboard every 100 packets (~1.7 s); ThrottleGeist 1.0 s; MacManley claims ~1000 packets tolerance; jegr78 measured the stream lapsing ~8 s after the last heartbeat ([issue #711](https://github.com/jegr78/gt-racing-broadcast/issues/711)). Recommendation: 1–2 s.

**Format switching gotcha.** The *first* heartbeat received fixes the format; sending `~` into a running `A` stream does nothing. Stop heartbeating, wait for the stream to lapse (~8–15 s), then send the new letter. Two apps on the LAN sending different letters fight ([GTPlanet thread, post #247](https://www.gtplanet.net/forum/threads/overview-of-gt7-telemetry-software.418011/page-9)).

**Encryption.**
- Salsa20, key = first 32 bytes of ASCII `Simulator Interface Packet GT7 ver 0.0`, i.e. `Simulator Interface Packet GT7 v` ([PDTools SimulatorInterfaceCryptorGT7.cs](https://raw.githubusercontent.com/Nenkai/PDTools/master/PDTools.Crypto/SimulationInterface/SimulatorInterfaceCryptorGT7.cs); [ThrottleGeist relay.py](https://raw.githubusercontent.com/ThrottleGeist/gt7-telemetry-relay/main/src/gt7_telemetry_relay/relay.py)). Same key for all formats.
- `iv1` = little-endian int32 at **0x40** (the only unencrypted bytes). `iv2 = iv1 XOR K`. 8-byte nonce = `LE(iv2) || LE(iv1)`.
- `K` per format: **A = 0xDEADBEAF** (BEAF, not BEEF), **B = 0xDEADBEEF**, **~ = 0x55FABB4F**, **C = 0xDEADBEEF** (same as B). Because B and C share the nonce, the first 316 bytes of a C packet decrypt as a valid B packet.
- Magic after decryption: `0x47375330` ("G7S0") at offset 0, little-endian. jegr78 auto-detects the format by trying each XOR constant until the magic appears (implies the same magic across formats; inferred, not proven).

## 2. Field table

Offsets from PDTools `SimulatorPacket.Read()` order, cross-checked against Bornhall's `struct.unpack` offsets and MacManley's struct. Little-endian. f = float32.

| Offset | Type | Name | Units / notes |
|---|---|---|---|
| 0x00 | i32 | magic | 0x47375330 |
| 0x04 | f×3 | position x,y,z | m, world coords (y up) |
| 0x10 | f×3 | velocity x,y,z | m/s per axis |
| 0x1C | f×4 | rotation | PDTools: quaternion. Bornhall/MacManley: pitch/yaw/roll + "orientation relative to north" at 0x28. Treat as quaternion until verified. |
| 0x2C | f×3 | angular velocity x,y,z | rad/s |
| 0x38 | f | body height | m |
| 0x3C | f | engine RPM | rpm |
| 0x40 | u8×4 | IV seed | unencrypted; skip |
| 0x44 | f | fuel level | L (kWh for EV) |
| 0x48 | f | fuel capacity | L; 100 most cars, 5 karts, 0 = EV |
| 0x4C | f | speed | **m/s** |
| 0x50 | f | turbo boost | 1.0 = 0 bar |
| 0x54 | f | oil pressure | bar |
| 0x58 | f | water temp | always 85 |
| 0x5C | f | oil temp | always 110 |
| 0x60–0x6C | f×4 | tyre surface temp FL,FR,RL,RR | °C |
| 0x70 | i32 | packet id | monotonic counter |
| 0x74 | i16 | lap count | 0 before start |
| 0x76 | i16 | laps in race | total laps |
| 0x78 | i32 | best lap time | ms, -1 if none |
| 0x7C | i32 | last lap time | ms, -1 if none |
| 0x80 | i32 | time of day progression | ms |
| 0x84 | i16 | pre-race start position | **-1 once race starts** |
| 0x86 | i16 | num cars at pre-race | -1 once race starts |
| 0x88 | i16 | min alert RPM | shift light start |
| 0x8A | i16 | max alert RPM | rev limiter |
| 0x8C | i16 | calculated max speed | km/h |
| 0x8E | i16 | flags | bits below |
| 0x90 | u8 | gears | low nibble = current (0 = R/N), high nibble = suggested (15 = none) |
| 0x91 | u8 | throttle | 0–255 (post-assist) |
| 0x92 | u8 | brake | 0–255 (post-assist) |
| 0x93 | u8 | padding | |
| 0x94 | f×3 | road plane normal | |
| 0xA0 | f | road plane distance | |
| 0xA4–0xB0 | f×4 | wheel rev/s FL,FR,RL,RR | rad/s |
| 0xB4–0xC0 | f×4 | tyre radius ×4 | m |
| 0xC4–0xD0 | f×4 | suspension height ×4 | |
| 0xD4–0xF0 | f×8 | reserved | not set |
| 0xF4 | f | clutch pedal | 0–1 |
| 0xF8 | f | clutch engagement | 0–1 |
| 0xFC | f | RPM after clutch | rpm |
| 0x100 | f | transmission top speed | |
| 0x104–0x120 | f×8 | gear ratios 1–8 | |
| 0x124 | i32 | car code | overwritten by 9th gear ratio on 9+-gear cars |
| **B (316)** | | | |
| 0x128 | f | wheel rotation | steering wheel angle, rad, +ve = left |
| 0x12C | f | steering angular velocity | rad/s (uncertain) |
| 0x130 | f | sway | lateral accel |
| 0x134 | f | heave | vertical accel |
| 0x138 | f | surge | longitudinal accel |
| **~ (344)** | | | |
| 0x13C | u8 | throttle, unfiltered | driver input before TCS |
| 0x13D | u8 | brake, unfiltered | differs from 0x92 under ABS |
| 0x13E | u8 | unk3 | car-specific |
| 0x13F | u8 | unk4 | 0/1 |
| 0x140–0x14C | f×4 | torque vectors ×4 | some cars only |
| 0x150 | f | energy recovery | |
| 0x154 | f | unk7 | |
| **C (368)** | | | |
| 0x158 | char×4 | surface type FL,FR,RL,RR | T tarmac, C kerb, D dirt, G grass, S sand, s snow |
| 0x15C | i32 | current lap time | ms |
| 0x160 | f×2 | wheel steering angle L,R | rad |
| 0x168 | f | wheelbase | m |
| 0x16C | char×4 | car category | e.g. "GR3" |

C offsets derived from MacManley's struct chain `PacketA → PacketB → PacketTilda → PacketC` (296+20+28+24 = 368).

**Flags (0x8E, int16)** from PDTools `SimulatorFlags`: bit0 CarOnTrack, 1 Paused (not set in online pause menus), 2 LoadingOrProcessing, 3 InGear, 4 HasTurbo, 5 RevLimiterBlinkAlertActive, 6 HandBrakeActive, 7 LightsActive, 8 HighBeamActive, 9 LowBeamActive, 10 ASMActive, 11 TCSActive.

## 3. What GT7 provides vs derives

| Item | Provided? | Detail / community derivation |
|---|---|---|
| Steering angle | No in A; yes in B/~/C (0x128) | — |
| Current lap time | No in A/B/~; yes in C (0x15C) | gt7dashboard counts packets (`lap_ticks / 60`) and corrects drift at lap change from last-lap-time |
| Lap distance | No | Integrate speed per tick; or XZ nearest-neighbour projection onto a reference line (MoebiusX, jegr78) |
| Sector times | No | Virtual gates on position |
| Track id / name | No | Position fingerprint: lap length ±3 %, bounding box, mean distance to stored racing line ≤15 m, direction ([jegr78 PR #799](https://github.com/jegr78/gt-racing-broadcast/pull/799)); signature DB of 121 configs, CC0 ([gt7-datalogger-track-data](https://github.com/jbhoorasingh/gt7-datalogger-track-data)) |
| Car id | Yes 0x124 | Names via [ddm999/gt7info](https://github.com/ddm999/gt7info) (MIT-0) |
| Assist settings | Only ASM-active / TCS-active bits; no levels; no ABS flag | `~`/C: compare unfiltered pedals with filtered to detect TCS/ABS intervention |
| Wheel speeds | Yes: rad/s ×4 × radius = m/s | slip vs 0x4C |
| Tyre temps | Surface only | |
| Tyre wear | No | |
| Fuel | Yes level / capacity | |
| Race flags | No | |
| Position in race | Only pre-race | |
| Laps | Yes total and current | |
| Session type | No | Inferred from flags + lap counter (gt-telem) |
| Time of day | Yes ms | |
| Weather | No | |

## 4. Open-source implementations

| Project | Lang | Licence | Last push | Formats | Offers |
|---|---|---|---|---|---|
| [Nenkai/PDTools](https://github.com/Nenkai/PDTools) | C# | MIT | 2026-09-07 | A, B, ~ | Canonical struct and cryptor |
| [snipem/gt7dashboard](https://github.com/snipem/gt7dashboard) | Python/Bokeh | GPL-3.0 | 2026-03-06 | A | Live dashboard, delta vs reference, traces, race-line map, fuel map |
| [Bornhall/gt7telemetry](https://github.com/Bornhall/gt7telemetry) | Python | GPL-3.0 | 2025-10-22 | A | Console dump |
| [MacManley/gt7-udp](https://github.com/MacManley/gt7-udp) | C++ | MIT | 2026-09-18 | A, B, ~, C | Best field docs |
| [gt-telem](https://pypi.org/project/gt-telem/) | Python | GPL-3/LGPL-3 | 2026-02-18 | A, B, ~ | Events incl. lap change |
| [carlos-menezes/gran-turismo-query](https://github.com/carlos-menezes/gran-turismo-query) | Rust | MIT | 2025-01-29 | A | Parser |
| [zetetos/gt-telemetry](https://github.com/zetetos/gt-telemetry) | Go | MIT | 2026 | A, B, ~, C | Circuit match by coordinate, capture/replay |
| [MoebiusX/gt7-telemetry-analyzer](https://github.com/MoebiusX/gt7-telemetry-analyzer) | Node.js | MIT | 2026 | A | HUD, micro-sectors, ghost overlay, own `salsa20.js`, JSONL recordings |
| [ThrottleGeist/gt7-telemetry-relay](https://github.com/ThrottleGeist/gt7-telemetry-relay) | Python | MIT | 2026 | C in; A/B/C out | Fan-out relay |
| [jegr78/gt-racing-broadcast](https://github.com/jegr78/gt-racing-broadcast) | Python | not checked | 2026-10 | auto-detect | Track recognition, steering HUD |
| [NikiforovG/gt7-datalogger](https://github.com/NikiforovG/gt7-datalogger) | Python + TS | MIT | 2026 | selectable | 78-track recognition, MoTeC export |

**Node/TypeScript:** no published npm package exists (npm search for gt7 returns nothing). MoebiusX is the only Node implementation found.

**gt7dashboard internals:** new lap when `current_lap != previous_lap` while CarOnTrack and lap>0; lap time taken from 0x7C at the crossing; laps compared on an integrated-distance x-axis resampled to 10 ms; no track detection.

## 5. Known gotchas
- Same LAN required; PS5 replies only to the heartbeat sender. Firewall must allow UDP 33739/33740.
- Packets flow in menus, pre-race, replays and while paused. Gate on CarOnTrack / Paused / Loading bits. `~` not sent in replays; B reportedly missing in Sport Mode.
- Packet id monotonic; drop packets with id ≤ last seen. Tick-based lap timer drifts and is re-synced from last-lap-time.
- Speed m/s; throttle/brake 0–255 post-assist; gear nibbles; lap times ms with -1 sentinel; race position only pre-race; water/oil temps constant.
- Car code corrupted on 9+-gear cars.
- Format latched by first heartbeat; switching needs ~8–15 s lapse; multiple apps fight.

## Confidence and gaps
- High: ports, A layout, key string, A XOR, nonce order, magic, 60 Hz, flag bits, sizes 296/316/344.
- High: B/~ XOR constants and sizes.
- Medium: `~` byte meanings 0x13C–0x157.
- Medium-low: packet C (one documented source, XOR corroborated by a second; offsets derived from struct chain; "added ~1.68" unverified).
- Low: whether magic is identical for B/~/C.
- Gaps: heartbeat tolerance window; rotation semantics; no npm package to evaluate.
