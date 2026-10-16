# RESEARCH.md — Pit Wall

Research pass of 2026-10-16. Full detail with every URL lives in `docs/research/` (`f1-udp.md`, `gt7-protocol.md`, `audio-tts-prior-art.md`). This file is the synthesis and the decisions that follow from it.

## 1. The brief's "hard facts", checked

| Claim in the brief | Verdict | What changed |
|---|---|---|
| A PS5 cannot run our code; architecture is PS5 → UDP over LAN → companion on Windows → audio + phone UI | **Confirmed.** | Nothing. |
| EA F1 "current edition, F1 25/26", UDP documented, port 20777, selectable rate | **Partly wrong.** There is **no F1 26**. EA skipped the 2026 title; F1 25 received a paid **2026 Season Pack** (3 June 2026) that adds a new UDP `packetFormat = 2026` (24 cars, new Car Telemetry 2 packet, Session packet grows). The base game still emits 2025 and 2024 formats on request. | We support **formats 2024, 2025 and 2026** in one adapter, selected per packet from the 2-byte header. Default guidance to the driver: format 2026 if they own the pack, else 2025. |
| GT7 undocumented, reverse-engineered, ports 33739/33740, heartbeat, encrypted | **Confirmed**, with corrections: the Salsa20 key is the first 32 bytes of `Simulator Interface Packet GT7 ver 0.0`, not the shorter string I had in mind; there are **four** packet formats selected by the heartbeat byte (`A` 296 B, `B` 316 B, `~` 344 B, `C` 368 B) with different nonce XOR constants. | We send `~` by default (steering wheel angle + unfiltered pedals, which is how we infer TCS/ABS intervention), fall back to `A` for replays, and decode `C` if the console sends it. |
| GT7 may lack steering angle or assist settings | **Confirmed for the base packet; nuanced.** Steering wheel angle exists in B/~/C. Assists: only two bits (TCS active, ASM active), no levels, no ABS flag. No lap distance, no current lap time (except format C), no sectors, no track id, no race flags, no race position after the start, no tyre wear. | Onboarding asks GT7 drivers for their assist settings; behaviour inference uses unfiltered-vs-filtered pedals. Track identity comes from a position fingerprint. |
| The PS5 owns the headset audio; we cannot inject | **Confirmed.** No software path exists. Party chat via a second PSN account on the PS App is the only "in-headset" software route and it is high-friction with unmeasured latency. | Default audio path is a wired earbud from the laptop (see §5). |
| Latency ≤ 300 ms telemetry → radio start | **Feasible but tight only if audio output is wired.** Built-in Bluetooth (SBC) alone is 170–300 ms. | Budget in `ARCHITECTURE.md`; Bluetooth is a documented "it works but late" option, never the default. |

## 2. EA F1 25 (+2026 Season Pack) — what we rely on

- Official spec PDFs for format 2025 ("Data Output from F1 25 v3") and 2026 ("Data Output from F1 25: 2026 Season Pack v1.2") downloaded from the EA forums; URLs in `docs/research/f1-udp.md`.
- Header is 29 bytes and identical across 2024/2025/2026: `packetFormat` (uint16 at 0) selects the struct table; `packetId` (uint8 at 6) selects the packet; `sessionUID`, `sessionTime`, `frameIdentifier`, `playerCarIndex`. We validate datagram length against the per-format size table and drop mismatches.
- Packets we consume and why:

| Packet | ID | Rate | We take |
|---|---|---|---|
| Motion | 0 | menu rate | player world position x,y,z |
| Session | 1 | 2/s | session type, track id, total laps, marshal zone flags, safety car status, sector distance boundaries, **assist settings** (steering, braking, gearbox, pit, ERS, DRS, racing line; 2026 adds ABS/TC assist) |
| Lap Data | 2 | menu rate | lap distance, current/last lap ms, sector 1/2 times, sector index, lap number, position, pit status, invalid-lap flag |
| Event | 3 | on event | SSTA/SEND, FTLP, SCAR, RDFL, DRSE/DRSD, PENA, FLBK (flashback: we must discard the rewound window), CHQF |
| Car Telemetry | 6 | menu rate | speed km/h, throttle, steer, brake, clutch, gear, rpm, DRS, brake temps, tyre surface/inner temps |
| Car Status | 7 | menu rate | TC/ABS live values, fuel in tank, fuel remaining laps, tyre compound, tyre age, FIA flag for this car, ERS |
| Car Damage | 10 | 10/s | tyre wear % per wheel |
| Motion Ex | 13 | menu rate | wheel speed, slip ratio, slip angle per wheel (player only) → lockup and wheelspin detection |
| Car Telemetry 2 | 16 | menu rate (2026 only) | overtake / active aero availability |

- There is no "lap complete" event; lap boundaries come from `currentLapNum` incrementing with `lastLapTimeInMS` updating.
- In-game settings the setup screen must show: UDP Telemetry On, Broadcast Mode Off + laptop IP (or Broadcast On if the driver prefers), Port 20777, Send Rate 60 Hz (coaching needs it; EA default is 20), Format 2026 or 2025, Your Telemetry = Public is not required for own-car data.
- Borrow: struct tables from `@racehub-io/f1-telemetry-client` (MIT; 2026 support is spec-generated and untested on recordings) and MacManley's `f1-25-udp` / `f1-26-udp` READMEs (MIT). We write our own parser against the PDFs and use theirs to cross-check offsets.

## 3. Gran Turismo 7 — what we rely on

- Transport: send a one-byte heartbeat to PS5:33739 from a socket bound to 33740; the PS5 streams ~60 Hz to that socket. Heartbeat every 1.5 s. The first heartbeat latches the format; changing it needs an ~8–15 s silence. Two apps sending different letters fight, so we warn when packet sizes change mid-session.
- Decryption: Salsa20, key = `Simulator Interface Packet GT7 v` (32 bytes), nonce from the int32 at 0x40 (`iv1`) and `iv2 = iv1 XOR K`, K = 0xDEADBEAF (A), 0xDEADBEEF (B and C), 0x55FABB4F (~). Magic `G7S0` at offset 0 after decryption. No npm implementation exists; we write a ~80-line Salsa20 and test it against the magic on real captures.
- Fields we use (full table in the appendix): position xyz, velocity xyz, rotation, rpm, fuel level/capacity, speed m/s, tyre surface temps, packet id, lap count, laps in race, best/last lap ms, time of day, flags (on track, paused, loading, TCS active, ASM active, rev limiter, handbrake), gear nibbles, throttle/brake 0–255; per wheel rev/s and tyre radius (→ wheel speed → slip); car code; B: steering wheel angle; ~: unfiltered throttle/brake.
- What we derive because GT7 does not provide it: current lap time (packet tick count re-synced from last-lap-time at each crossing, or format C field), lap distance (projection of xz onto the learned centre-line of the track model, with integrated speed as bootstrap), sectors and micro-sectors (virtual gates on the track model), track identity (fingerprint of lap length, bounding box, direction; seeded from the CC0 signature DB), lockups/wheelspin (wheel speed vs car speed), TCS/ABS intervention (unfiltered vs filtered pedals, and the TCS-active bit).
- Not available at all, so the engineer never mentions them for GT7: race flags, race position after the start, tyre wear, weather, session type (inferred coarsely from lap counters and flags).
- Borrow: struct layout and cryptor logic from Nenkai/PDTools (MIT) and MacManley/gt7-udp (MIT); car names from ddm999/gt7info (MIT-0); track signature DB from jbhoorasingh/gt7-datalogger-track-data (CC0). We read gt7dashboard and gt-telem (GPL) for ideas only and copy no code.

## 4. Normalised schema availability

| Field | F1 25 | GT7 |
|---|---|---|
| timestamp, session time | yes | derived from packet id at 60 Hz |
| lap number, laps total | yes | yes |
| lap distance | yes | **derived** |
| current lap time | yes | **derived** (or format C) |
| last/best lap time | yes | yes |
| sector index / times | yes | **derived** (virtual gates) |
| position xyz | yes | yes |
| speed | yes (km/h → m/s) | yes (m/s) |
| throttle, brake | yes 0–1 | yes 0–255 → 0–1, post-assist; raw with `~` |
| steering | yes −1..1 | B/~/C only: wheel angle rad; **absent** with `A` |
| gear, rpm | yes | yes |
| tyre surface temps | yes | yes |
| tyre inner temps | yes | **absent** |
| tyre wear | yes (Car Damage) | **absent** |
| wheel speeds / slip | yes (Motion Ex) | derived from rev/s × radius |
| fuel level, laps remaining | yes | level yes; laps remaining derived |
| flags / safety car | yes | **absent** |
| race position | yes | **absent** after start |
| track id | yes | **derived** (fingerprint) |
| assists | yes (Session + Car Status) | TCS/ASM active bits only; levels asked in onboarding |
| DRS / overtake | yes | n/a |
| weather | yes | **absent** |

## 5. Audio to the driver

Options ranked (detail in appendix A):

| Option | Latency | Default? |
|---|---|---|
| Wired earbud from laptop jack, worn under the PS5 headset; or laptop speakers | ~10–20 ms | **Default** |
| aptX-LL USB transmitter + aptX-LL buds | ~40 ms | Recommended upgrade |
| Phone PWA plays the audio (phone speaker / wired to phone) | 50–150 ms | Supported, with iOS caveats |
| Passive 3.5 mm mixer at the DualSense | ~0 ms | Documented, untested |
| Laptop built-in Bluetooth (SBC) | 170–300 ms | Supported, labelled "late" |
| PS App party chat on a second PSN account | unknown, high friction | Future experiment |
| PS Remote Play as mic path | takes over the console | Rejected |

The companion measures its own output path at startup (WASAPI device latency) and the PWA reports `AudioContext.outputLatency`, so the UI can show the driver the real number.

## 6. Local TTS

Candidates (detail in appendix B): sherpa-onnx-node with a Piper VITS en_GB voice (Apache-2.0 runtime, MIT voices, pure npm, multithreaded); Piper standalone exe (MIT, archived); kokoro-js (Apache-2.0, better voice, slower); Windows SAPI (built in, robotic). Internet voices (edge-tts, cloud) are allowed only for debrief audio.

Strategy regardless of engine: pre-synthesise every fixed phrase and every number fragment at startup into an in-memory WAV bank, so a fixed call starts in under 20 ms and a dynamic call only synthesises the variable part. Measured time-to-first-audio on this laptop is recorded in `DECISIONS.md` (benchmark, not an estimate).

## 7. Prior art and what we take from it

| Source | Licence | We take |
|---|---|---|
| Crew Chief V4 | MIT | The two-queue radio model (immediate vs queued, priority insertion, due/expiry, dedupe per message name, max queue length), "don't wake in hard parts", pause-queue, hold-channel limit, chatter rate limits that go silent in the last laps |
| Open Pit Wall | MIT | WebSocket channel subscription (`telemetry`, `lap`, `racecontrol`…) and the replay-as-simulated-live server pattern |
| F1 Race Replay | MIT | Track map + timing tower + click-to-select telemetry panel; playback speed and keyboard shortcuts for the replay harness UI |
| Moment-Up/pitwall | proprietary | Validation that the product category works on PS5 (F1 25 + GT7); its rules "speak at calm moments, max two messages per lap" and 1 m-grid lap comparison are sensible defaults we adopt independently. Its Windows path is untested, which is our opening |
| gt7dashboard | GPL-3.0 | Ideas only: throttle/brake/coast coloured race line, delta-by-distance |
| Trophi.ai, Coach Dave Delta, Track Titan | commercial | Feature bar for per-corner insights; none is offline + console + real-time + Windows |
| Curvature-peak segmentation (2024), Perantoni & Limebeer (2015) | papers | Corner detection method: smoothed curvature of the centre-line, peaks → corners, merge close peaks, straights between |

## 8. Gaps and risks carried forward
1. **GT7 format C** is documented by one source; we decode it opportunistically and verify on a real capture.
2. **Heartbeat tolerance** on GT7 is unmeasured (claims from 1 s to 16 s); we send every 1.5 s and watch for stream lapses.
3. **F1 2026 format** has no recordings in any open parser; the first real capture from the user's console is the acceptance test.
4. **TTS latency on this CPU** is being benchmarked; if dynamic synthesis is too slow we move more content into the pre-synthesised bank.
5. **iOS PWA audio** is fragile; phone audio is a convenience path, the laptop audio path is the one we guarantee.
6. **F1 Lap Data field order** (`gridPosition`/`driverStatus`) had a forum report of a spec inconsistency; verified on the first capture.
7. **GT7 Sport Mode** reportedly omits format B; `~` behaviour in Sport Mode is unknown. The adapter degrades to `A` fields when a packet is shorter than requested.
