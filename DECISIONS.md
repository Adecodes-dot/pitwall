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

## 2026-10-26 — D26. Real-session findings (first F1 25 career session, Shanghai FP, over Wi-Fi)

Evidence: the installed companion's session log (5 lap times logged), its live `/api/status` (34 % "loss", no packets for 565 s), and no debrief or database rows. Conclusions and changes:
- The "loss" figure was a lifetime total, so a ~5 minute outage inflated it. It is now a rolling 10 s window, relative to the observed frame step (so a 20/30 Hz send rate is not "loss") and ignoring outages over 1 s (reported as stream gaps). GT7 now uses the game's packet id for the same purpose.
- Network is the likely cause of the drop-outs (laptop on a 5G mobile router, PS5 reported disconnecting from Wi-Fi). The app side was hardened anyway: 4 MB UDP receive buffers (Windows default is 64 KB, about 10 F1 frames), event-loop delay measured and logged, and a 10 s diagnostics line (pkt/s, fps, loss, gaps, loop lag, frames accepted/skipped) in the session log so the next session separates network from app.
- A lap with a hole in it (max gap over 300 ms between frames) keeps the game's lap time but gets no trace and cannot become the reference or train the track model.
- F1 `onTrack` also becomes true when the car is clearly moving (> 30 km/h), so a surprising driverStatus/resultStatus reading can never silently disable analysis and the radio. The reason laps never reached the analysis in that session is not proven (no capture existed); live recording is now on by default (one .pwcap per session in %LOCALAPPDATA%\PitWall\captures, oldest pruned beyond 3 GB) so the next session can be replayed exactly.
- Every adapter event is now written to the session log, not only lap times.

## 2026-10-26 — D27. Hands-free voice: wake word over an offline streaming recogniser, mic captured by the page

Requirement (user): talk to the engineer without taking hands off the controller; no trigger phrases, some flexibility in language.
- **Recogniser**: sherpa-onnx streaming zipformer (English, 20M, Apache-2.0) in a worker, CPU, offline; the app already ships the runtime. It runs continuously on 16 kHz audio; each finished utterance goes through a wake gate. Rejected: a dedicated keyword spotter (needs a Python tool to tokenise custom keywords, and one fixed phrase); cloud STT (offline-first is a hard requirement).
- **Wake gate**: loose matching of "engineer" / "hey engineer" / "pit wall" (configurable), tolerant of the recogniser clipping the first syllable ("ineer", "er"); wake word before or after the question; wake word alone opens a 6 s window; after an answer a 7 s follow-up window needs no wake word. A clipped wake or a follow-up acts only if the rest classifies as a racing question, so commentary cannot trigger it.
- **Intent matching, not commands**: words of the right kind in any order, with synonyms, plurals, contractions, one-letter typos and known mis-hearings; deterministic, selects which measured fact to read back (never invents one). No match → "Say again?" (fail safe), or the optional LLM answers from the fact sheet when credentials exist.
- **Half-duplex**: the mic is ignored while the engineer speaks and 350 ms after, then the recogniser resets, so our own voice is never transcribed.
- **Mic path**: the page records with getUserMedia (echo cancellation, noise suppression), downsamples to 16 kHz int16 and streams binary websocket frames. Requires a secure context, so the Electron window (own localhost origin, permission granted only to it) or http://localhost works; a phone on a plain LAN address does not (it would need HTTPS). Rejected: a native capture addon (no prebuilt one for Windows input; audio-io is output only), ffmpeg/dshow (no ffmpeg binary shipped).
- **Privacy**: unaddressed speech is dropped in memory; nothing is stored or logged unless PITWALL_VOICE_DEBUG=1.
- Commands by voice: talk less / talk more / normal (changes and persists the chattiness), say that again, mute / talk to me.

## 2026-10-26 — D28. Speech model: the 20M zipformer stays the default

Measured with `npm run asr:bench` (20 driver phrases from the Piper voice, clean and with car-like noise at 12 dB SNR; the mapping counts only phrases that are both addressed to the engineer and mapped to the right intent):

| Model | Download | Load | Clean | Noisy (12 dB) |
|---|---|---|---|---|
| zipformer en-20M (2023-02-17) | ~125 MB | 0.9 s | 17–18 / 20 | 16 / 20 |
| zipformer en (2023-06-26) | ~310 MB | 3.4 s | 17 / 20 | 17 / 20 |

The larger model is not meaningfully better here and costs 4x the load time and ~3x the CPU, so it is not bundled. Typical misses are single mis-heard words ("attires", "tex" for tips, "meet" for mute); the matcher carries aliases for the common ones and the engineer asks "Say again?" for the rest. These are synthetic voices: a real microphone, accents and a loud room will do worse, which is why the first real hands-free session is the next measurement (turn on `PITWALL_VOICE_DEBUG=1` to log what it hears).


## 2026-10-26 — D29. The driver names their engineer; the wake word is learned from their voice

Trigger: the user asked for a wake word that is a personal name (the way Max has GP, Kimi has Bono, Lando has Will Joseph) instead of the generic "engineer", for more consistent wake-ups.
- **Setting**: `engineerName` (default "engineer") plus `wakeAliases`. Wake phrases are derived: the name, "hey <name>", spelled-out letters for 2–3 letter names ("g p"), and the aliases. The old free-form `wakeWords` list is gone. "Pit wall" remains a wake phrase only for the default name.
- **"Teach it my name"**: the driver says the name five times; the listener acts on nothing while teaching (`voice.calibrate`). Utterances that already wake the gate count as matched; short (≤4 word) ones that do not become aliases (how the recogniser actually spells that driver's voice); sentences are rejected. Aliases are stored and reset when the name changes.
- **Honest reliability readout** in the UI: steady / usable / unsteady from how many different spellings were heard, plus a warning for names under 4 letters.
- **Measured** (Piper voice, `voice.test.ts`): "Bono" 1/3 straight, learned `onov`/`bonau`, then 5/5 questions answered; "Will Joseph" 5/5 straight, 4/5 questions; "GP" 0/3 straight and 0/5 questions with the synthetic voice (the synthetic voice mispronounces "GP", so this is a lower bound, but two-letter names are the weak case). Recommendation shown to the driver: two or three syllables.
- Rejected: a trained keyword-spotting model per name (no toolchain here, and a custom model per name defeats "type any name"); phonetic matching of arbitrary names (unreliable for short names, which learned aliases cover better).

## 2026-10-26 — D30. F1 frames close on the next frame, not on MotionEx; replies may speak on a straight before the track is learned

First real practice session with the installed app (Shanghai FP, 5 laps, auto-recorded 360 MB `.pwcap`): live telemetry arrived but the Analysis and Debrief tabs stayed empty and the engineer never answered the driver while driving.
- **Cause 1 (adapter).** The adapter assumed MotionEx was the last per-frame packet and closed the frame there. The real 2026 game sends LapData, Motion, MotionEx, CarTelemetry, CarStatus, CarTelemetry2. Every frame was closed before telemetry arrived, so it was dropped and the next packets formed a frame with no lap, motion or position. Result: 52 248 of 52 248 frames had `lap.number = null`, the analyser skipped all of them (`skipNoLap=50158` in the diag line) and no lap, track model or debrief was ever built. Synthetic data had used a different order, which is why tests passed. Fix: a frame is emitted when the next frame's first per-frame packet arrives (or on `tick`). Order-independent; costs at most one frame (16 ms at 60 Hz) of latency. Regression test uses the real order.
- **Cause 2 (radio).** Until a track model exists the radio only allowed priority-1 safety calls (a "straight" heuristic gate), and replies are priority 2, so every spoken answer was held until it expired (20 s). Fix: replies (keys `qa:`, `say:`, `repeat:`, `voice:`) are allowed under the heuristic too, still only on a straight. With no live car (no data, stale > 3 s, off track, paused) they speak at once. Answers now wait up to 45 s for a safe window; "Say again?" and confirmations still expire at 20 s.
- **Measured on the real recording** (replayed through the real pipeline, `scripts/dev/*`): 5 laps found (1:35.131 best, theoretical 1:33.601), Shanghai track model with 14 corners, debrief built; lap 2 correctly flagged (14.7 s gap from the flashback). 18 questions asked one every 37 s while driving: all answered, median wait 2.4 s, p90 13 s, max 16 s (the wait is the safe-zone rule: only 53 % of the lap is safe road and long answers need a long straight).
- Rejected: flushing on CarTelemetry2 (only exists in 2026), speaking replies inside braking zones (violates the non-negotiable), dropping the 20 s expiry on everything.

## 2026-10-26 — D31. Race weekends: out laps, menus and one-lap sessions

Second live run (fixed build; practice continued, then Sprint Qualifying SQ1–SQ3, one lap each): Analysis and Debrief showed their panels but no data, "where am I losing time" always said "No reference lap yet", and no track map appeared. Diagnosed by replaying the five auto-recorded captures of the day (`scripts/dev/weekend-replay.ts`).
- **Menus are sessionUID 0.** After each session the game sends packets with sessionUID 0; the adapter treated that as a new session and the analyser wiped everything, so the tabs were empty between sessions. Now uid 0 starts nothing, and returning to the same session continues it.
- **Out laps share the flying lap's number.** Qualifying: before the line, lap distance is negative and the timer reads 0. Practice (sent back on track): the timer reads 0 while the distance is already far along. The collector took both as part of the lap, so the first "lap" was out lap + flying lap and the track model came out 8 022 m long for Shanghai's 5 451 m (the debrief sent to the user earlier was built on it and was wrong). Now: samples with negative distance, or timer 0 more than 100 m from the line, are skipped (`skipOutLap` in the diag line); the lap restarts if the timer goes back; a model is learned only from a lap that runs line to line (`coversLap`) and only if its length is within 8 % of the distance the game reports (`fitsLap`). A saved model that fails this on a complete lap is deleted and learned again, which repairs the bad model already in the user's database.
- **Wi-Fi hiccups of 0.3–1.3 s on most laps.** The 300 ms hole limit threw out 5 of the 9 laps of the day, including all three later practice laps. Raised to 1 500 ms: the trace is interpolated across the hole and the game's lap timer is exact on both sides. Flashbacks and real outages are longer and still excluded.
- **The next session keeps the track and a reference.** Within one track the model survives session changes, and the fastest traced lap is the reference, saved in a new `refs` table (6 channels × track metres as float32, about 130 kB per track) and reloaded on restart. A one-lap qualifying session is compared with the best lap so far this weekend. Radio safe zones come from the reference from the first metre of the next session. GT7 sends no track id, so there everything still restarts per session.
- **"Where am I losing time" compares each corner with its quickest pass on any other lap** (this session or the reference), so the best lap of the day still has an answer. If nothing is 30 ms slower: "Nowhere big, you matched your best through every corner."
- Measured on the day's captures: practice laps 1–8 all traced except the flashback lap; Shanghai model 5 381 m (game 5 441 m), 10 corners; SQ1 compared with practice (1:35.131), SQ2 with SQ1 (1:34.275), SQ3 with SQ2 (1:33.301); answers e.g. "Turn 3, two tenths, and Turn 7, a tenth."
- Known limit: corner numbers are Pit Wall's own (10 detected bends at Shanghai, the official map has 16 turns; combined bends such as T1–T3 count as one). The Analysis map shows the numbering.
- Rejected: persisting every lap's trace (size, and only the best is used); comparing against the theoretical best (built from pieces of different laps, which the driver never drove).

## 2026-11-01 — D32. Race-day hardening before Miami FP1

- **Silent restart.** If the companion process exits, the Electron shell used to show a modal dialog (Restart / Open logs / Quit). A driver with a controller in hand cannot click it, so the engineer would stay dead for the rest of the race. Now the shell restarts it after 0.5 s, up to 3 times in 5 minutes, and only then asks. The page reconnects on its own; in-session laps are lost on a restart, but the track model and reference lap are in the database.
- **Honest reply on laps with no trace.** After a flashback or an outage, "where am I losing time" said "No reference lap yet" although a reference existed. Now: "Lost data on that lap, ask me after the next one."
- **Regression captures kept.** Auto-recording prunes the oldest `.pwcap` above 3 GB in `captures/` (top level only). The Shanghai weekend (2.2 GB) was moved to `captures/shanghai-2026-10-26/` so Miami cannot push it out.
- Seen at Miami startup: the running app reported default settings (engineer name "engineer", setup not finished) although the database holds "Paradox", coach mode and firstRunDone. Reading the same file with the bundled Node returns the saved values. Cause not found before FP1; checked again after the restart that installs this build.

## 2026-11-07 — D33. Miami sprint weekend fixes

Driver's checklist after SQ1–SQ3 and the 10-lap sprint, checked against the recordings (`scripts/dev/race-dump.ts`, `reply-latency.ts`, `weekend-replay.ts`, `lap-sanity.ts`):
- **Fuel calls were wrong.** F1's `fuelRemainingLaps` is the figure on the in-car fuel display: laps of fuel beyond the finish (+2.9 to +3.5 in the sprint), not laps left. Treated as laps left, a 10-lap race read "five laps short … one lap short". The adapter now sets laps left = display margin + race distance still to run, in race sessions only (no finish elsewhere → null). "Fuel is good" is spoken once, then only when the picture changes.
- **Tyre answer was unreadable.** "Fronts 77, rears 93, wear 46 percent" mixed average temperatures (no unit) with the worst wear. Now "Front right worst, 46 percent wear."; asked about temperature: "Surface temps: fronts 77 and 76, rears 94 and 92 degrees." Short on purpose (below).
- **Lap times** read "one thirty three" for 1:30.3; now "one thirty point three". Deltas of 10 tenths or more are said in seconds.
- **Answers that never came.** Every call over 12 words is dropped by the persona rules without a sound; a test now runs every Q&A answer through the rules. Replies go before other priority-2 calls. Before the track is known, "on a straight" no longer needs full throttle when under 145 km/h or behind the safety car. Measured on the sprint with the saved track: 32/34 answered, median 6.0 s, p90 16 s (was 30/34, 7.8 s, 25 s). The remaining wait is the safe-zone rule (51 % of Miami is safe road, three stretches fit a 3 s answer), kept on purpose.
- **Map and analysis empty at each new session.** The analyser already kept the track model across sessions (diag `track=f1:miami` from the first second), but nothing was sent until a lap completed and the page cleared the map on every session start. Now the analyser publishes the track at session start (and on load after a restart), and the page keeps the map and the radio list.
- **"Data never stores across sessions."** It was stored (sessions and laps tables) but not shown. The debrief now stays on the previous session until the new one completes a lap (labelled "last session"), and lists every session on the track with its type (FP1, SQ2, Race…); `sessions.session_type` added with an in-place migration.
- **Flashback laps were thrown away** (6 of 9 sprint laps). The collector now cuts a lap back to the rewound lap timer and keeps it; holes are measured on the lap timer, so the time spent in the flashback menu is not a gap. Those laps are marked `rewound` and kept out of the reference, the theoretical best and the debrief ranking, because their traces are not proven exact (with them the sprint's theoretical best came out 5 s under the best lap; without, 1.7 s). Race lap 1 (standing start) gets no trace.
- **Safety:** zones are never built from zero traced laps (that would have marked all non-corner road safe, braking zones included).
- **Also:** single-instance lock in the Electron shell (three launches gave a crash loop on port 8787); the radio mode on the Settings and Radio tabs follows voice commands; the session log records every spoken call and every utterance addressed to the engineer; empty text never wakes the gate.
- Known limit left: the track model is ~1 % shorter than the game's lap distance (5 354 m vs 5 410 m), so the last ~50 m of a lap fold into the final metres of the trace.

## 2026-11-08 — D34. The debrief survives closing the app

D33 kept the previous session's debrief in memory only: after a restart (FP on Friday, quali on Saturday) the Debrief tab said "no completed laps yet" until a lap. Now the finished debrief JSON is saved after every completed lap in a one-row table `last_debrief`, and served (marked "last session", sessions table re-read) while the running app has no lap. Saved as built rather than rebuilt from stored laps: it is already plain JSON (~100 KB with traces), so nothing new needs persisting and a restart shows exactly what the driver last saw. The save runs on `setImmediate` after the lap update, off the lap-call path, and a failed save is logged, never thrown. Rejected: storing every lap's channels and re-running the analysis on start (more data, more code, same screen).
- Build: `build.electronDist = node_modules/electron/dist`. electron-builder re-fetched Electron's SHASUMS256.txt from GitHub on every build despite the cached zip; on 2026-11-08 that download stalled at 0 bytes and the build failed after 10+ minutes. The unpacked Electron in node_modules is the same pinned version (44.8.0), so the installer now builds offline.

## 2026-11-08 — D35. Miami race: unanswered questions, pit laps, incidents

From the 28-lap Miami race log and recording (scratchpad `race-check.ts` replays it through analysis + coaching + debrief):
- **7 of 9 questions got silence.** The driver says "Atlas", pauses, then asks; the question arrived as its own utterance and the gate marked it a follow-up (`wake: false`), and an unclassified follow-up is dropped without a word. Now a window opened by the wake word alone marks the next utterance addressed (`wake: true`), so an unclear question gets "Say again?"; the follow-up window after an answer still drops chatter. Rejected: answering every follow-up (TV commentary would get "Say again?").
- **Mishearings of this driver's voice** added as tested cases: "my few / sioux / well" → fuel, "toura", "tie away" → tyres. Only after "my" for fuel, so "a few laps" stays laps-left.
- **Pit stop coached as technique.** Laps 16-17 (in/out lap) gave "Turn 1, carry 190 more through the apex" (pit limiter) and topped the debrief. Laps that touch the pit lane (`flags.pitting`, F1 pitStatus) are marked `pit` and get no trace, so they never feed coaching, zones, the reference, the theoretical best or the ranking; they never teach or reject the track model either. Marked only on accepted frames, so a qualifying out lap from the pits (skipped, lap n−1 distance) does not taint the flying lap.
- **Incidents:** a single corner pass more than `INCIDENT_MS` = 2 s slower is a spin, off or contact, not technique: no coaching call, not counted in the debrief ranking. Real technique losses that race were up to 0.8 s a corner.
- Result on the race: debrief ranks T15 / T12 / T10 (worst pass 0.71 s), theoretical −2.2 s (was −3.6). Consistency stays 0/100: lap std 0.99 s vs the score's 1 %-of-best scale (0.89 s), a definition question for race stints, not a data error; left as is.
- Open: the last two laps produced "braking 80 / 185 metres early". Probably traffic or lifting to the flag, not brake technique; not capped yet without the traces to prove it.

## 2026-11-08 — D36. No "Say again?" to room audio when no game is running

The app sat idle from 13:08 to 18:37 (no telemetry) and said "Say again?" 7 times. The recogniser heard songs and talk with the alias "at last" in them ("at last night it seems that I dreamed about you"). The wake gate took each one as a command with the wake word, and an unclear command gets "Say again?".
- Now an unclear voice phrase gets no reply when no frame has arrived for 60 s (`NO_GAME_MS` in `radio.ts`): nobody is driving, so it is room audio. Questions the rules understand ("radio check", "what's my best") are still answered with no game. With the game sending (garage, track), unclear questions still get "Say again?" (D35).
- Rejected: dropping "at last" as an alias (it is how the recogniser hears this driver's "Atlas"; all real commands today used it); a word cap on commands (a full question can be as long as the song lines); requiring the wake word at the start ("at last night…" starts with it).
- Limit: music or TV while driving can still get "Say again?".
