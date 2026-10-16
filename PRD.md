# PRD.md — Pit Wall (working name)

An AI race engineer for PS5 sim racers. It listens to the game's live telemetry on the home network, learns how this driver drives, talks to them over the radio during a session like a real engineer, and debriefs them afterwards. Goal: faster laps and more immersion.

Status: v1 scope agreed in principle 2026-10-16; research in `RESEARCH.md`; stack in `DECISIONS.md`.

## 1. Users and jobs

**Primary user:** a PS5 sim racer with a wheel or pad, playing EA F1 25 (with or without the 2026 Season Pack) or Gran Turismo 7, who has a Windows laptop or mini-PC on the same Wi-Fi and a phone. Not technical. Wants to be faster and wants the "race engineer in my ear" feeling.

Jobs to be done:
1. "Tell me where I am losing time, by corner, in words I can act on now."
2. "Tell me the things a real engineer would: flags, fuel, tyres, pit window."
3. "After the session, show me the three things to fix and give me one drill."
4. "Set it up in two minutes without reading a manual."

## 2. Hard constraints (verified; see RESEARCH.md §1)
- The PS5 runs nothing of ours. PS5 → UDP over LAN → companion app on Windows → audio to the driver + PWA on the phone.
- Supported games v1: EA F1 25 (UDP formats 2024/2025/2026) and GT7 (heartbeat formats A/B/~/C).
- We cannot inject audio into the PS5 headset. Default: wired earbud from the laptop under the headset, or laptop speakers.
- Latency: telemetry event → radio call starts ≤ 300 ms p95 for time-critical calls. Measured, not estimated.
- Offline-first: the live path makes no network calls. Cloud LLM only for debrief phrasing and natural-language Q&A, with a local fallback.
- No cheating: no driver inputs are ever automated. We coach a human.
- Fail safe: missing, late or inconsistent data → the engineer goes quiet.

## 3. What great looks like (v1 features)

### F1. Zero-friction setup
- One screen per game listing exactly what to change in the game's menu (F1: UDP Telemetry On, IP = laptop LAN IP shown as a copyable chip, Port 20777, Send Rate 60 Hz, Format 2026/2025; GT7: nothing to change in the game, the app finds the console).
- Game auto-detected from incoming packets (F1 by header `packetFormat` + size table; GT7 by decrypting and checking the `G7S0` magic). Green "receiving" light with packets/s.
- Windows firewall prompt explained in one sentence; a "test radio" button plays a call so the driver confirms they can hear it.
- GT7 onboarding asks assists (TCS level, ASM, ABS, countersteer assist) because the game does not send them.

### F2. Game-agnostic core
- Every adapter maps packets into one `NormalisedFrame` (schema in `ARCHITECTURE.md`): timestamp, lap, lap distance, position xyz, speed, throttle, brake, steering, gear, rpm, tyre temps/wear, fuel, sector, flags, assists… Every field is nullable with an explicit `NotProvided` state and a per-game capability table.
- Adding a PC game (ACC, iRacing, AMS2, Forza) is a new adapter only. No analysis or radio code knows which game is running.

### F3. Track model
- Built from position + speed data on the first clean laps: centre-line, lap length, start/finish, curvature → corners numbered in driving order, straights, braking zones, safe-to-talk zones.
- Works on tracks we have never seen (GT7 fictional circuits, F1 reverse layouts). Stored per track/layout, refined over sessions. F1 track ids and GT7 position fingerprints identify known tracks so history persists.
- Corner count matches the real circuit on at least 3 tracks (M2 acceptance).

### F4. Driver fingerprint (updated every session)
- Braking per corner: brake point vs this driver's best, peak pressure, release shape (trail-braking index).
- Corners: minimum speed, throttle pick-up point, throttle smoothness, coasting time.
- Consistency: lap-to-lap variance per corner and per lap.
- Mistakes: lockups and wheelspin from wheel speed vs car speed (F1 Motion Ex; GT7 rev/s × radius); off-tracks from surface type where provided.
- Assists: F1 from Session/Car Status packets; GT7 from onboarding plus inference (TCS-active bit, unfiltered vs filtered pedals).
- Coaching adapts to assists: with ABS we never say "you're locking", we talk brake point and release; with TC on we talk throttle timing not modulation; no assists unlocks modulation advice.

### F5. References
- Personal best lap (per track, per car class, per assist profile), theoretical best (best micro-sectors stitched), per-corner deltas vs both.
- Coach toward the driver's own best first; theoretical best second; never toward a lap the driver did not drive.

### F6. Live engineer radio
- Safe-zone rule: never talk in braking zones or mid-corner. Calls only start in zones the track model marks safe (straights, long full-throttle sections) and must fit before the next braking point at current speed.
- One idea per call, ≤ 8 words where possible, 12 hard cap.
- Priority queue: safety/flags > strategy (fuel, tyres, pit window) > coaching > encouragement. Immediate queue interrupts for safety only.
- Chattiness modes: Quiet (safety + strategy only, max 1 coaching call per 3 laps), Normal (max 2 calls per lap), Coach (max 4 per lap, more detail). Never repeat a tip the driver has just fixed; cool-down per corner.
- Deterministic calls from analysis (e.g. "Turn 4, braking 10 metres early"). An LLM may only rephrase into the persona's voice from a fact sheet; it cannot add facts. Local TTS with a configurable voice.
- Optional push-to-talk from the phone ("how's my fuel?", "where am I losing time?") answered from data.
- Twenty reference calls and the rejected-examples list live in `DESIGN_SYSTEM.md` and are the persona test set.

### F7. Post-session debrief
- Summary: best lap, theoretical best, consistency score, laps, assist profile.
- The three corners costing the most time, each with a speed/throttle/brake trace overlay vs reference and one concrete instruction.
- Progress over sessions on this track.
- Next-session plan: one focus drill (e.g. "10 laps, Turn 4 only: brake at the 100 board, release to the apex").
- Shown in the PWA (phone and desktop); exportable as a self-contained HTML file and JSON.

### F8. Strategy (race sessions)
- Fuel per lap, laps remaining on fuel vs laps remaining in race, "lift and coast" call when short.
- Tyre temperature trend both games; tyre wear trend and pit window F1 only. GT7 pit window from fuel only.

## 4. Milestones and done conditions

Each milestone ends with `npm test` green and a one-command demo. Evidence is attached to the milestone note in `docs/milestones/`.

| M | Scope | Done when | Demo |
|---|---|---|---|
| M1 Ingest | Both adapters, normalised schema, capture + replay harness, synthetic generator, live dashboard (speed, inputs, lap) | A recorded F1 session and a recorded GT7 session replay with lap times matching the in-game times (F1: exact ms; GT7: within 50 ms, the tick-timer tolerance) | `npm run demo:m1 -- captures/<file>` |
| M2 Analysis | Track map, corner detection, lap/sector/micro-sector split, PB + theoretical best, per-corner metrics, fingerprint | Corner count matches the real circuit on ≥ 3 tracks; per-corner deltas sum to the lap delta within 0.1 s | `npm run demo:m2` prints corners + deltas, writes track map SVG |
| M3 Radio | Safe-zone detection, priority queue, deterministic call generator, TTS, chattiness, audio routing | Measured latency ≤ 300 ms p95 (telemetry packet receive → first audio sample out); replayed sessions produce zero calls starting in braking zones (automated test); 20 persona calls pass the rules test | `npm run demo:m3` replays a session and speaks |
| M4 Debrief + Q&A | Debrief UI with overlays, top-3 corners, drill, LLM phrasing with local fallback, push-to-talk Q&A | Debrief renders at phone and desktop widths (Playwright screenshots); export opens standalone; Q&A answers 10 scripted questions from data with no LLM available | `npm run demo:m4` |
| M5 Polish + packaging | Onboarding wizard, settings, Windows installer, crash reporting, docs for gamers | Fresh Windows VM: install → see receiving light → hear a call with no console attached (using bundled replay) in under 5 minutes; usability pass written up | installer in `dist/` |

## 5. Verification policy
- Replay harness and synthetic generator for everything; real captures requested from the owner with exact instructions (game, track, car, laps, assists, filename).
- Unit tests for parsing (fixtures per format), timing, safe zones, priority queue, call templates.
- Latency measured in-process with monotonic timestamps at: packet receive, frame normalised, event detected, call chosen, TTS first buffer, audio device callback. Reported as p50/p95 over a replayed session.
- Playwright screenshots at 390×844 and 1440×900 for every UI milestone.

## 6. Out of scope for v1 (future work)
Multiplayer/team engineer, setup tuning advice, PC-only sims (adapter architecture ready), mobile-only mode without a laptop, monetisation. The architecture keeps a freemium seam: a `features` capability object gates debrief history length, cloud phrasing and extra personas; everything on the live path stays free.

## 7. Risks
| Risk | Mitigation |
|---|---|
| GT7 lacks lap distance / lap time / sectors | Track model + projection; tick timer re-synced each lap; format C used when present |
| Bluetooth latency breaks the 300 ms budget | Wired default; measured output latency shown in UI; "late audio" warning |
| TTS too slow for dynamic phrases | Pre-synthesised phrase + number bank; dynamic part only |
| Corner detection wrong on street circuits | Curvature smoothing tuned on ≥ 3 real captures; manual corner-count override in settings |
| F1 2026 format untested in any OSS parser | First real capture is the acceptance test; length validation rejects bad packets |
| iOS PWA audio fragility | Audio from laptop is the guaranteed path; phone audio optional |
| Flashbacks (F1) corrupt lap data | FLBK event discards the rewound window; GT7 has no flashback in races |
