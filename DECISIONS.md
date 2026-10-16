# DECISIONS.md — Pit Wall

Every non-obvious choice, dated, with the why and what was rejected. Newest at the bottom.

---

## 2026-10-16 — D1. Stack: Node 24 + TypeScript for everything, React PWA, packaged as a Windows tray app

**Choice.** One Node 24 process (TypeScript, ESM, strict) does UDP ingest, analysis, radio, TTS and serves a PWA. UI is React 18 + Vite with uPlot for traces. Storage is `node:sqlite` (built into Node 24, verified working on this machine). Tests are vitest + Playwright. Packaging (M5) is Electron + electron-builder NSIS installer, used only as a tray host and installer shell; the PWA stays the UI.

**Why.**
- *Toolchain reality.* The dev machine has Node 24.19 and git only. Python is broken, no Rust, no .NET SDK. Any stack needing those would stall on day one. `node:sqlite` and `node:dgram` mean zero native compile steps for the core.
- *Low-latency UDP on Windows.* `node:dgram` delivers datagrams on the event loop with sub-millisecond overhead at 60 Hz × 9 packets/frame; this is far below the 300 ms budget. The latency risk is TTS and audio output, not ingest.
- *Local TTS.* `sherpa-onnx-node` (Apache-2.0) ships a prebuilt `sherpa-onnx-win-x64` addon via npm and runs Piper VITS voices offline. Installed and loaded on this machine today (benchmark below, D4).
- *Phone UI over LAN.* A PWA served by the companion needs no app-store step and works on both phone platforms; WebSocket channels are the natural transport.
- *Single installable app.* Electron is heavy (≈ 150 MB) but is the one option that gives a tray icon, autostart, Windows installer, auto-update and crash reporting from pure JavaScript. Chosen for M5 only; M1–M4 run as `node` scripts.

**Rejected.**
- *Tauri (Rust shell)* — smallest binaries, but needs a Rust toolchain that is not installed and would make the sidecar story (Node process) more complex.
- *.NET (like SimHub, Crew Chief)* — best Windows audio/TTS story, but no SDK here and it would make the PWA a second codebase.
- *Python (like gt7dashboard, Moment-Up)* — richest telemetry ecosystem, but Python is broken on this machine and packaging Python for non-technical gamers is painful.
- *Node SEA (single executable) + Inno Setup* — viable lighter alternative to Electron; kept as fallback if Electron size is a complaint.

## 2026-10-16 — D2. Support F1 UDP formats 2024, 2025 and 2026 in one adapter; no "F1 26"

There is no F1 26 game. F1 25's paid 2026 Season Pack (June 2026) introduced `packetFormat = 2026` with 24 cars and new packets. The adapter keys every struct table on the 2-byte header `packetFormat` and validates datagram length. The setup screen recommends format 2026 if the driver owns the pack, else 2025. Rejected: supporting 2025 only (the pack defaults to 2026 and users will not know to change it).

## 2026-10-16 — D3. GT7: request format `~` by default, decode A/B/~/C

`~` adds steering wheel angle and unfiltered throttle/brake, which is the only way to infer TCS/ABS intervention on GT7. `~` is not sent in replays, so the adapter accepts whatever length arrives and fills the missing fields with NotProvided. Format `C` (368 B, adds current lap time and surface type) is decoded opportunistically and verified on the first real capture. No npm GT7 package exists; the cipher comes from tweetnacl (see D11) and decoding is validated by the `G7S0` magic on every packet. Heartbeat every 1.5 s. Rejected: format `A` default (loses steering), depending on GPL code (gt7dashboard, gt-telem).

## 2026-10-16 — D4. Local TTS: sherpa-onnx-node + Piper en_GB voice, with a pre-synthesised phrase bank

Live calls must be offline and fast. Engine: sherpa-onnx-node with `vits-piper-en_GB-alba-medium` (voice licence checked per model card). Strategy: at startup synthesise every template and number token into an in-memory PCM bank; dynamic sentences are stitched from bank clips; only unseen words are synthesised live. kokoro-js (nicer voice, slower) is reserved for debrief audio and for pre-rendering the bank offline. Windows SAPI is the last-resort fallback if the addon fails to load. Cloud voices never on the live path.

**Measured on this laptop (2026-10-16, i7-9750H, see `docs/research/tts-benchmark.md`):** whole-phrase synthesis of a 5–8 word call, p50 / p95: 267 / 334 ms at 1 thread, 182 / 211 ms at 2 threads, **136 / 167 ms at 4 threads**. Real-time factor 0.06–0.12. Model load 1.6 s once. Conclusion: dynamic phrases fit the 300 ms budget with 4 threads in a worker; fixed phrases come from the bank at ~0 ms. Voice dataset licence CC BY 4.0 (attribution required).

## 2026-10-16 — D5. Audio to the driver: wired from the laptop by default

Default is a wired earbud from the laptop headphone jack worn under the PS5 headset (or laptop speakers when racing without a headset): ~10–20 ms, zero cost, zero setup. Phone-played audio is supported as a convenience with a measured-latency warning. Built-in Bluetooth works but is labelled "late" (170–300 ms, SBC) and never the default. An aptX-LL USB transmitter is the recommended wireless upgrade. PS App party-chat on a second PSN account is logged as a future experiment; PS Remote Play is rejected because it takes over the console session. Windows 11 build 22000 on this machine has no LE Audio support.

## 2026-10-16 — D6. Capture format `.pwcap` stores raw datagrams, GT7 kept encrypted

Replay must exercise the real decoder, so GT7 payloads are stored as received. Binary records with monotonic microsecond timestamps keep inter-packet timing for realistic replay. Rejected: JSONL of decoded frames (cannot re-test parsing; 10× larger).

## 2026-10-16 — D7. Borrowing policy

Copy or adapt only MIT/Apache/CC0/MIT-0 sources (racehub f1-telemetry-client, PDTools, MacManley gt7-udp and f1-25/26-udp, Crew Chief queue design, Open Pit Wall channel pattern, ddm999/gt7info car names, gt7-datalogger-track-data signatures). GPL projects (gt7dashboard, gt-telem, Bornhall) are read for ideas only. Unlicensed repos (Volodrum) are not copied. Every borrowed file carries its origin and licence in a header comment and in `THIRD_PARTY.md`.

## 2026-10-16 — D8. Deterministic analysis owns the facts; the LLM only rephrases

Every radio call is produced by a pure function over the fingerprint, references, frame and track model, with a fact sheet attached. The optional LLM receives the fact sheet and the persona rules and returns a rephrasing that must pass the same rules test (length, contains the corner number and the number from the fact sheet, no new numbers). If it fails or is unavailable, the template text is spoken. This is the only way to meet "advice must be correct and specific" and "fail safe".

## 2026-10-16 — D9. Single npm package with src/ folders, not npm workspaces

AGENTS.md originally sketched a packages/ monorepo. For one process and one UI, workspaces add package.json churn without isolation benefits. Folder boundaries in src/ carry the same dependency rule (arrows point down the table in ARCHITECTURE.md §2). Revisit if a second deployable (e.g. a PC-only sidecar) appears.

## 2026-10-16 — D10. Node 24 native type stripping; no bundler for the server

Server and scripts run as `node file.ts` (Node 24 strips types natively). Constraint: `erasableSyntaxOnly` in tsconfig, so no enums, no constructor parameter properties, explicit `.ts` import extensions. Removes a build step and a dependency; the UI still builds with Vite.

## 2026-10-16 — D11. GT7 Salsa20 from tweetnacl, not hand-written

tweetnacl (Unlicense, no native code) exposes `lowlevel.crypto_stream_salsa20_xor`, the exact primitive GT7 uses (Salsa20/20, 32-byte key, 8-byte nonce). Writing our own cipher would add risk with no benefit. Round-trip tests cover all four packet formats; the first real capture validates against the console.

## 2026-10-16 — D12. M1 screenshots from the in-app browser; Playwright deferred to M4

Playwright plus a Chromium download (~150 MB) is not needed until the debrief UI (M4) where automated phone/desktop screenshots become part of the test suite. M1 evidence screenshots were taken with the built-in browser at desktop and phone widths and stored in docs/milestones/.

## 2026-10-16 — D13. Corner detection: curvature threshold 1/320 m with 0.6 hysteresis, 25 m same-direction merge

The track model resamples a lap's positions at 1 m, smooths with σ = 7 m, takes heading over ±3 m and curvature as dθ/ds, then marks a corner where |κ| ≥ 1/320 (radius under 320 m) until it falls below 60 % of that. Opposite-sign regions are always separate corners (chicanes); same-sign regions with a sub-threshold gap under 25 m merge (double apex). Stubs under 12 m are dropped. Verified: 10/14/6 corners on three synthetic circuits, radii within 10 % on exactly closed geometry (stadium, rounded square). **Real-circuit validation (Suzuka 18, Silverstone 18) is pending the user's captures**; the threshold is a parameter and may move for real tracks with long sweepers.

## 2026-10-16 — D14. Synthetic circuits close their loop with a linear shear; radii in synthetic tracks are approximate

A list of straights and arcs rarely returns to its origin. `buildTrack` distributes the end-to-start gap linearly along the lap and re-parametrises by true arc length. This keeps the loop closed and corner positions right, but distorts curvature by up to ~2×, so synthetic tests check corner count and position, not radius. Radius accuracy is tested on analytically closed shapes instead.

## 2026-10-16 — D15. Lap time channel convention

Each lap's channels are resampled on the track model's 1 m grid; `t[s]` is milliseconds since the lap start at metre `s`, and `t(L) − t(0)` equals the game's lap time. The model origin is wherever the first learned lap started (within a few metres of the line for GT7; the line itself for F1 where lapDistance is provided), so `t(0)` can be a few ms, not zero. Segment deltas telescope exactly, which is why the "deltas sum to the lap delta" check passes to the millisecond.

## 2026-10-16 — D16. F1 lap numbering: lap 1 is the out lap

The F1 game numbers the out lap from the garage as lap 1 and increments at the first line crossing, so the first flying lap is lap 2 and the lap.complete for lap 1 carries the out-lap time (0 in the synthetic generator). The analyser ignores laps with no time and never learns a track from a lap shorter than 20 s.

## 2026-10-16 — D17. Laptop audio through a prebuilt MME addon with a permanently open stream

`@echogarden/audio-io` (MIT) ships a prebuilt Windows x64 addon, so no toolchain is needed. Opening the device costs ~65 ms; we open it once per session and feed it from a queue inside the 40 ms buffer callback, so a call starts within one buffer of being chosen. Measured decision → sound p95 80 ms including the buffer (`docs/milestones/M3.md`). Rejected: `speaker`/`naudiodon` (need node-gyp), PowerShell `SoundPlayer` (process spawn ≈ 300 ms), WASAPI exclusive mode (not exposed by the addon; MME shared mode is already within budget).

## 2026-10-16 — D18. Time-critical calls come from a pre-synthesised bank; dynamic calls are synthesised a lap ahead

Safety and strategy phrases (23 at startup, ~4 s to prime) are synthesised once and served from memory in under 1 ms. Coaching calls are built at lap completion and synthesised immediately, so by the time a safe zone comes they are ready; whole-sentence synthesis measures 136/167 ms p50/p95 at 4 threads uncontended, which would fit the budget even if it were on the critical path.

## 2026-10-16 — D19. Before the track model exists, only safety calls may be spoken, gated by a "flat out and straight" heuristic

With no model there are no braking zones to respect, so coaching is withheld entirely (there is nothing to coach yet either) and safety calls wait until the driver has been at > 80 % throttle, no brake and near-zero steering for 1.5 s. Once a lap is learned, every call is gated by the zone map: not in a braking zone (any lap, +10 m), not in a corner (+5 m), and enough safe road ahead to finish the clip at the current speed (+0.4 s). The replay tests assert zero violations on both games.

## 2026-10-16 — D20. The LLM only rephrases; every number is checked

`AnthropicPhraser` (SDK `@anthropic-ai/sdk`, model `claude-opus-5-5` by default, effort low, 256 tokens, 2.5 s timeout, no retries) receives the deterministic template, its fact sheet and the persona rules, and returns one line. The line is accepted only if it passes the same persona rules as a template call **and** contains exactly the same set of numbers; otherwise the template is spoken. It runs only for priority 3–4 calls (which have a lap of lead time) and never for safety or strategy. Without credentials the `TemplatePhraser` is used and nothing changes on the radio. A refusal stop reason is treated as "no rephrase".

## 2026-10-16 — D21. Q&A is rules first, LLM second, "I don't have that" last

Ten intents (fuel, tyres, losing time, best, last lap, consistency, position, laps left, track, flags) are answered by code from the latest frame and analysis update, so push-to-talk works offline and answers are auditable. Free-form questions go to the LLM with the same fact sheet (≤ 16 words, no exclamation marks) when enabled; otherwise the engineer says "I don't have that." Answers are queued as priority-2 calls and still obey the safe-zone rule. Speech input uses the browser's Web Speech API (Chrome/Android; Safari partially) with a text box fallback; no on-device STT model in v1.

## 2026-10-16 — D22. Playwright screenshots join the toolchain at M4

`@playwright/test` plus Chromium (downloaded once) drive `npm run screenshots`: a companion replaying a synthetic capture at max speed, four tabs, phone (390×844, 2×) and desktop (1440×900). M1–M3 evidence came from the in-app browser (D12).

## 2026-10-16 — D23. Packaging: Electron shell + bundled Node runtime, not Electron's Node

The companion keeps running on a copy of the Node 24 binary it was developed on (`dist/pkg/node/node.exe`, ~80 MB), launched by a small Electron main process that owns the tray icon and the window. Reasons: Electron 44 ships Node 22, whose `node:sqlite` needs a flag and whose type stripping differs; N-API addons (sherpa-onnx, audio-io) load fine under either, but one runtime for dev and prod removes a class of "works on my machine" bugs. The server is bundled with esbuild (ESM, natives external) so no TypeScript stripping is needed at runtime; the build script smoke-tests the staged layout by replaying a capture through the bundled server before packaging. Cost: installer ~250 MB (Electron ~170 MB + Node 80 MB + voice 60 MB, compressed by NSIS). Rejected: Node SEA + Inno Setup (no tray/window without more native code), running the server inside Electron's main process (addon ABI and sqlite flag risk).

## 2026-10-16 — D24. Crash reporting is local-only in v1

Uncaught errors write `%LOCALAPPDATA%\PitWall\logs\crash-<time>.txt` with the error, the last 300 log lines, versions and OS info; the Electron shell offers Restart / Open logs / Quit. Session logs are pruned after 14 days. No upload endpoint exists yet, so nothing leaves the machine; the README says so. Opt-in upload is a freemium-era feature.

## 2026-10-16 — D25. Settings live in the same sqlite file and apply live where they can

A key/value `settings` table with typed defaults. Chattiness, mute and crash logging apply immediately; audio device, voice, GT7 format and cloud phrasing need a restart (the UI says so). GT7 assist levels are entered in onboarding because the game never sends them (RESEARCH.md §3).
