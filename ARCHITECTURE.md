# ARCHITECTURE.md — Pit Wall

## 1. Processes

```
PS5 (F1 25 / GT7) ──UDP over LAN──▶ Companion (Node 24, Windows)
                                       ├─ adapters: f1 / gt7 → NormalisedFrame
                                       ├─ capture: .pwcap record / replay / synthetic
                                       ├─ analysis: track model, laps, references, fingerprint
                                       ├─ radio: safe zones, queue, calls, TTS, audio out (WASAPI)
                                       ├─ strategy, debrief, llm (optional)
                                       ├─ store: SQLite (node:sqlite) in %LOCALAPPDATA%\PitWall
                                       └─ server: HTTP (PWA static) + WebSocket (channels)
                                              │
                                              ▼
                                  Phone / desktop PWA (React + Vite)
                                  setup · live · radio log · debrief · progress · settings
```

One Node process. No worker threads on the live path except TTS synthesis, which runs in a worker so a slow synthesis never blocks packet handling. Packaged as a tray app (see `DECISIONS.md`).

## 2. Packages (npm workspaces, all TypeScript ESM)

| Package | Responsibility | Depends on |
|---|---|---|
| `core` | `NormalisedFrame`, capability table, event bus, ring buffer, monotonic clock, units | — |
| `adapters/f1` | UDP 20777 listener, format 2024/2025/2026 struct tables, length validation, → frames + events | core |
| `adapters/gt7` | heartbeat sender, Salsa20, A/B/~/C decode, tick timer, → frames | core |
| `capture` | `.pwcap` writer/reader, replay scheduler (1×/N×/as-fast-as-possible), synthetic track + driver generator | core |
| `analysis` | track model, corner detection, lap splitter, micro-sectors, references, per-corner metrics, fingerprint, mistake detectors | core |
| `radio` | safe zones, priority queues, call templates, chattiness, TTS bank, audio output, latency probes | core, analysis |
| `strategy` | fuel, tyres, pit window | core, analysis |
| `debrief` | session summary, top-3 corners, drill, export | analysis |
| `llm` | fact sheet → phrasing, Q&A; cloud with local template fallback | radio, debrief |
| `server` | HTTP + WebSocket, settings, game detection, orchestration | all |
| `ui` | PWA | server protocol only |
| `app` | tray + installer | server |

Rule: arrows point down the table only. `analysis` never imports an adapter; `radio` never imports `server`.

## 3. Normalised telemetry schema

```ts
type NP = null; // "not provided by this game" — distinct from 0 and from "unknown this frame"

interface NormalisedFrame {
  t: number;              // monotonic ms at receive (performance.now())
  gameTime: number | NP;  // seconds since session start as reported by the game
  game: 'f1' | 'gt7';
  seq: number;            // adapter packet counter, for loss detection
  lap: { number: number | NP; distance: number | NP; currentTimeMs: number | NP;
         lastTimeMs: number | NP; bestTimeMs: number | NP; sector: 0|1|2 | NP;
         sector1Ms: number | NP; sector2Ms: number | NP; valid: boolean | NP; total: number | NP };
  pos: { x: number; y: number; z: number } | NP;      // metres, game world frame
  vel: { x: number; y: number; z: number } | NP;      // m/s
  speed: number | NP;                                 // m/s
  input: { throttle: number | NP; brake: number | NP; steer: number | NP; clutch: number | NP;
           throttleRaw: number | NP; brakeRaw: number | NP }; // 0..1; steer -1..1 or radians flagged in caps
  drivetrain: { gear: number | NP; rpm: number | NP; maxRpm: number | NP; drs: boolean | NP };
  wheels: { speed: Wheel4 | NP; slipRatio: Wheel4 | NP; surfaceTemp: Wheel4 | NP;
            innerTemp: Wheel4 | NP; wear: Wheel4 | NP; surface: Wheel4<string> | NP };
  fuel: { level: number | NP; capacity: number | NP; lapsRemaining: number | NP };
  flags: { fia: 'none'|'green'|'blue'|'yellow'|'red' | NP; safetyCar: 'none'|'full'|'virtual'|'formation' | NP;
           onTrack: boolean | NP; paused: boolean | NP; pitting: boolean | NP };
  race: { position: number | NP; sessionType: string | NP; trackId: string | NP };
  assists: { tc: 0|1|2 | NP; abs: boolean | NP; tcActive: boolean | NP; asmActive: boolean | NP;
             gearbox: 'manual'|'manual-suggested'|'auto' | NP; racingLine: 0|1|2 | NP } ;
}
type Wheel4<T = number> = [fl: T, fr: T, rl: T, rr: T]; // always FL, FR, RL, RR (F1 arrays are reordered)
```

Each adapter publishes a `Capabilities` object (which fields are ever non-null, units quirks like "steer is radians at the wheel") that analysis and radio consult. A field that is `null` in the capability table is never mentioned by the engineer.

Adapters also emit discrete events: `session.start`, `session.end`, `lap.complete {lapNumber, timeMs, valid}`, `flag.change`, `safetycar`, `flashback {discardFromT}`, `format.change`, `stream.lost`.

## 4. Data flow and latency budget (time-critical calls)

| Stage | Budget | Measured at |
|---|---|---|
| Game → NIC (game send rate 60 Hz, LAN) | ~16 ms sampling + ~2 ms LAN | not ours; recorded as frame interval |
| UDP receive → `NormalisedFrame` | ≤ 2 ms | `t_recv`, `t_frame` |
| Analysis step (event detection on the frame) | ≤ 5 ms | `t_event` |
| Radio: queue, safe-zone check, template | ≤ 2 ms | `t_call` |
| TTS: bank hit (fixed phrase) / dynamic synthesis | ≤ 5 ms / ≤ 120 ms | `t_tts_first_buffer` |
| Audio out (WASAPI shared, wired) | ≤ 30 ms | device-reported latency |
| **Total, fixed phrase** | **≤ 60 ms** | |
| **Total, dynamic phrase** | **≤ 180 ms** (300 ms p95 ceiling) | |

Every call carries these six timestamps; `npm run latency -- <capture>` prints p50/p95 per stage.

Safety calls (flags, safety car) use the immediate queue and fixed phrases only, so they always sit in the ≤ 60 ms class.

## 5. Capture file format (`.pwcap`)

Binary, append-only, one record per datagram: `u32 len | u64 t_monotonic_us | u64 t_wall_ms | u16 srcPort | u8 game | bytes[len]`. File header: magic `PWCAP1`, game hint, adapter version, laptop LAN IP, in-game settings snapshot (free text). GT7 payloads are stored **encrypted as received** so replay exercises the real decoder. Sidecar `.json` with notes (track, car, assists, in-game lap times typed in by the user for verification).

Replay feeds datagrams into the adapter with the original inter-packet gaps (×speed) using a monotonic scheduler; "as fast as possible" mode for tests.

Synthetic generator: a parametric closed track (splines with configurable corners) and a driver model (brake point, min speed, throttle pick-up, noise) that emits either F1-format or GT7-format datagrams, so adapters and analysis are tested end to end without a console.

## 6. Track model

1. Collect position samples for the first clean lap (lap.complete with valid=true, or GT7 lap counter change while onTrack).
2. Resample the path by arc length at 1 m, close the loop, smooth (Savitzky–Golay or Gaussian over ±10 m).
3. Curvature κ(s) from first/second derivatives; corners = contiguous regions where |κ| > κ_min (≈ 1/200 m) with peak merging within 40 m; number in driving order from start/finish.
4. Braking zones: from the driver's own laps, s where brake rises above 10 % until peak-speed-loss ends; union across laps, expanded by 10 m.
5. Safe-to-talk zones: throttle > 90 % for > 2.5 s at current speed, not within 30 m before a braking zone, not inside a corner. A call may start only in a safe zone and must end before the zone does at current speed (TTS clip duration known from the bank).
6. Micro-sectors: fixed 50 m bins over s; sectors from the game where provided, else thirds.
7. Projection: each new frame is projected onto the centre-line (nearest segment search seeded from the last index) to get s for GT7; F1 uses `lapDistance` directly and the projection as a sanity check.
8. Identity: F1 `trackId`; GT7 fingerprint {lap length ±3 %, bounding box, direction} matched against stored models and the CC0 signature DB.

Refinement: each additional clean lap is blended into the centre-line (running median), corners recomputed, stored in SQLite as `tracks(id, game, name, layout_json, version)`.

## 7. Radio

Two queues, after Crew Chief: `immediate` (safety; interrupts) and `queued` (priority-sorted; each entry has priority, dueAfter, expiresAt, messageKey, cooldownKey). Dedupe by messageKey; cooldown per cornerKey (default 3 laps, reset if the metric regresses). Chattiness caps per lap. Engineer goes quiet when: packet loss > 5 % over 2 s, frame age > 250 ms, track model not ready, lap invalid, car not on track, paused.

Call generation is a pure function `(fingerprint, references, frame, trackModel, mode) → Call[]` so it is unit-testable on fixtures.

TTS bank: at startup synthesise every template and every number token ("ten", "metres", "one thirty-two four") to 24 kHz PCM in memory; dynamic sentences are concatenated from bank clips with 40 ms crossfades; only unseen words hit the synthesiser. Audio output via WASAPI with a measured device latency, or to the phone over WebSocket as Opus/WAV for the phone-audio option.

## 8. Server protocol

HTTP serves the PWA and a small REST API (`/api/settings`, `/api/sessions`, `/api/export/:id`). WebSocket channels (after Open Pit Wall): `status` (1 Hz), `telemetry` (20 Hz downsampled frames), `lap`, `radio` (calls + transcript), `debrief`, `ptt` (phone → server audio chunks or text). Clients subscribe per channel.

## 9. Storage

`node:sqlite` (built into Node 24, no native build). Tables: `sessions`, `laps`, `frames` (optional, downsampled to 20 Hz, per session), `tracks`, `fingerprints`, `references`, `calls`, `settings`. Raw captures stay as `.pwcap` files beside the DB.

## 10. Security and privacy
LAN only; the HTTP server binds to the LAN interface and shows a pairing code on first phone connect. No telemetry leaves the machine except opt-in cloud phrasing (fact sheet only, never raw frames) and opt-in crash reports.
