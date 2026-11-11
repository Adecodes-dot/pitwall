# handoff.md — Pit Wall (updated 2026-10-26, after the first real session and hands-free voice)

## Goal
AI race engineer companion for PS5 sim racers (F1 25 incl. 2026 Season Pack, GT7). Full product scope in `PRD.md`; milestones M1–M5 with done conditions in PRD §4.

## State
- Research, PRD, architecture, design system, decisions: done (`RESEARCH.md`, `PRD.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `DECISIONS.md` D1–D12, `THIRD_PARTY.md`, `docs/research/*`).
- **M1 complete on synthetic data** (`docs/milestones/M1.md`): ingest, replay, dashboard.
- **M2 complete on synthetic data** (`docs/milestones/M2.md`): track model + corner detection (10/14/6 on three synthetic circuits), lap channels, PB/theoretical best, segment deltas (sum exactly), per-corner metrics, fingerprint with lockup/wheelspin, sqlite store, Analysis tab in the UI. 43 tests green, `npm run demo:m2` passes.
- **M3 complete on synthetic data** (`docs/milestones/M3.md`): safe zones, Crew-Chief-style queue, deterministic calls + persona rules, Piper TTS in a worker with a phrase bank, laptop audio via prebuilt MME addon + browser playback, Radio tab. Measured decision → sound p95 71 ms; replay tests assert zero calls in braking zones. 57 tests green.
- **M4 complete on synthetic data** (`docs/milestones/M4.md`): debrief (summary, top-3 corners with trace overlays and one instruction each, next-session drill, progress, HTML/JSON export), LLM rephrasing with template fallback and number checks, Q&A (10 rule intents + optional LLM), push-to-talk in the PWA, Playwright screenshots. 74 tests green.
- **M5 complete** (`docs/milestones/M5.md`): onboarding wizard (5 steps, persisted firstRunDone), Settings tab (chattiness, mute, voice, cloud phrasing, device audio, GT7 format, units, recording, crash logs, log viewer), local crash reporting, gamer README, Electron tray shell + bundled Node runtime + esbuild server bundle + NSIS installer via electron-builder (`npm run build:win`), usability pass fixes. 76 tests green.
- Awaiting real captures from the user (`docs/CAPTURE_GUIDE.md`): needed to validate corner detection on Suzuka/Silverstone, the mistake thresholds and real flags/fuel. **This is the most valuable next step.**
- **Post-M5 (2026-10-26, `docs/milestones/M6.md`)**: first real F1 25 session (Shanghai FP over a 5G router) → rolling loss, gap-aware laps, UDP buffers, diagnostics, auto-recording; hands-free voice (wake word + offline recogniser + natural intent matching, DECISIONS D26–D28). 189 tests green. **Uncommitted since the v0.1.0 baseline** (commit only when the user asks).

## Files that matter
- `src/core/types.ts` — NormalisedFrame + Capabilities (the contract everything else uses).
- `src/adapters/f1/layouts.ts` — struct tables per format; `codec.ts` decode/encode; `adapter.ts` frame assembly + events.
- `src/adapters/gt7/crypto.ts` (Salsa20 via tweetnacl, XOR constants), `packet.ts` (offsets), `adapter.ts` (lap detection, tick timer).
- `src/capture/pwcap.ts`, `replay.ts`; `src/synth/{track,driver,emit}.ts`.
- `src/server/{engine,udp,ws,http,main}.ts`; `ui/src/{App.tsx,ws.ts,styles.css}`.
- `src/analysis/track.ts` (model, corners, Projector, SVG), `laps.ts` (LapCollector, channels, references, segments, cornerMetrics), `fingerprint.ts`, `session.ts` (SessionAnalyser → bus 'analysis'), `store.ts` (node:sqlite).
- `ui/src/Analysis.tsx` (Analysis tab), `ui/src/Radio.tsx` (Radio tab + Web Audio playback).
- `src/radio/safezones.ts`, `queue.ts`, `calls.ts` (templates), `rules.ts` (persona rules + 20 reference calls), `tts.ts` + `tts-worker.ts`, `audio.ts` (DeviceSink/BusSink/NullSink), `radio.ts` (orchestrator, transcript with per-stage timestamps).
- `scripts/latency.ts` (real-time measurement), `scripts/demo-m3.ts`, `scripts/get-voice.ts` (downloads the Piper voice into models/, gitignored).
- `src/debrief/debrief.ts` (buildDebrief, debriefHtml), `src/llm/phrase.ts` (AnthropicPhraser/TemplatePhraser), `src/llm/qa.ts` (answerByRule, factSheet), `ui/src/Debrief.tsx`, push-to-talk in `ui/src/Radio.tsx`, `scripts/demo-m4.ts`, `scripts/screenshots.ts` (Playwright).
- Tabs are hash-routed (`#setup`, `#live`, `#analysis`, `#radio`, `#debrief`, `#settings`, `#log`).
- `src/server/settings.ts` (SettingsStore), `src/server/crash.ts` (CrashReporter), `ui/src/Setup.tsx` (wizard + SettingsView), `app/main.cjs` (Electron shell), `scripts/build-win.ts` (bundle, stage, smoke test, installer), `scripts/make-icons.ts`, `README.md` (gamer docs).
- Settings endpoints: GET/PUT `/api/settings`, `/api/logs`; ws cmd `settings.update`.
- Voice: `src/voice/{intent,wake,asr,asr-worker,voice}.ts`, `ui/src/{mic.ts,Voice.tsx}`, ws binary frames = 16 kHz int16 mic audio, ws channel `voice`; models in `models/` via `npm run voice:get`; `npm run voice:e2e` (real browser, fake mic), `npm run asr:bench`, `scripts/dev/asr-probe.ts`.
- Diagnostics: `Engine.diag()`, loss window in `src/server/engine.ts`, `GAP_LIMIT_MS` in `src/analysis/session.ts`.
- `scripts/demo-m1.ts`, `scripts/demo-m2.ts`, `scripts/dev/*` (debug prints).
- Launch configs for the in-app browser are in `C:\ade_project_house\.claude\launch.json` (names `pitwall-synth-gt7`, `pitwall-synth-f1`, `pitwall-live`, `pitwall-replay-gt7-4x`).

## Gotchas learned
- Node 24 type stripping: no enums, no constructor parameter properties, `.ts` import extensions (tsconfig `erasableSyntaxOnly`).
- Bash heredocs with backticks inside `node -e` strings get mangled by the shell; use the Write/Edit tools or `node - <<'EOF'`. A heredoc whose body contains an unbalanced apostrophe aborts the whole command; and backslashes in `sed` replacement text vanish (`/\s+/` became `/s+/` once): use the Edit tool for regexes.
- Replay statistics must use the process clock, not the recorded timestamps (fixed in engine.ts).
- F1 has no lap-complete event; lap boundaries come from `currentLapNum` incrementing. GT7 publishes last-lap-time possibly a few packets after the lap counter changes; the adapter waits up to 30 packets.
- GT7 format is latched by the first heartbeat the console receives; the companion sends `~` every 1.5 s to broadcast until a stream appears, then to the console's address.
- sherpa-onnx-node needs `node_modules/sherpa-onnx-win-x64` on PATH before require (the worker sets it). Node 24 runs `.ts` worker files directly.
- Transcript entries are recorded synchronously at speak time (sink promises never resolve inside a synchronous replay loop); audioStart is patched when the device takes the buffer.
- In Normal mode a short session with tiny lap deltas produces no coaching calls by design (nothing ≥ 0.12 s per corner).
- npm's allow-scripts policy on this machine blocks postinstall scripts: `electron` (binary download), `esbuild`, `sherpa-onnx-node`. After `npm install` run `node node_modules/electron/install.js` for the Electron binary; esbuild and sherpa work without their scripts because the platform packages are plain optional deps. electron-builder downloads its own Electron for packaging regardless.
- electron-builder downloads NSIS and winCodeSign from GitHub on first use; a slow network hits its 10-minute request timeout (`Timeout awaiting 'request'`). Retry; or (what worked here) curl the archives `winCodeSign-2.6.0/winCodeSign-2.6.0.7z`, `nsis-3.0.4.1/nsis-3.0.4.1.7z`, `nsis-resources-3.4.1/nsis-resources-3.4.1.7z`, `7zip@1.0.0/7zip-win-x64.tar.gz` from `github.com/electron-userland/electron-builder-binaries/releases/download/`, serve the folder over HTTP (any static server that ignores the path), and build with `ELECTRON_BUILDER_BINARIES_MIRROR=http://localhost:9911/ ELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true`. Once cached in `%LOCALAPPDATA%electron-builderCache` the mirror is no longer needed. The built installer is `dist/installer/Pit Wall Setup 0.1.0.exe` (207 MB).

## Next steps (current)
0. **Next real session**: the app now records every live session to `%LOCALAPPDATA%\PitWall\captures` and logs a diag line every 10 s. Replay it with `npm run demo:m1..m4 -- <file>` to prove why laps did not reach the analysis last time (suspects: Lap Data field order/onTrack, session.start wiping state, frames missing Car Telemetry under loss). Run hands-free with `PITWALL_VOICE_DEBUG=1` and read what the recogniser actually hears; tune `src/voice/intent.ts` aliases from that.
0b. Voice follow-ups: phone as microphone needs HTTPS (self-signed cert + pairing); optional larger/other speech model per D28; a distinctive wake word if "engineer" mis-triggers; spoken answers could be shortened further.

## Next steps (after M5)
1. **Real captures.** Run `npm run demo:m1 -- <file>` … `demo:m4` on the user's GT7/F1 recordings; check lap times vs the in-game screen, corner counts (Suzuka 18, Silverstone 18), mistake thresholds, flag and fuel calls. Tune `kEnter`/merge gap and lockup/wheelspin ratios; write `docs/milestones/REAL_CAPTURES.md`.
2. Install `dist/installer/Pit Wall Setup 0.1.0.exe` on a clean Windows VM: first-run wizard, firewall prompt wording, tray behaviour, audio on the default device, uninstall. (The unpacked app was launched here and its companion came up; the installer exe itself has not been run.) Fix the libuv assertion printed when the bundled server is killed (seen in the smoke test; likely worker/audio teardown on SIGTERM — add a graceful shutdown that stops the TTS worker and audio sink before exit).
3. Electron shell polish: "Open on phone" menu item showing the LAN URL + QR; autostart option; app icon as .ico for the taskbar.
4. GT7: car names from ddm999/gt7info; track names from the CC0 signature DB (match by fingerprint) so debriefs say "Suzuka" not "fp-9c4cfc24".
5. Freemium seam (PRD §6): a `features` capability object; everything on the live path stays free.

## 2026-10-26 (later) — driver-chosen engineer name (D29)
- Settings `engineerName` + `wakeAliases` replace `wakeWords`; `wakeWordsFor()` in src/voice/wake.ts derives the wake phrases; `VoiceListener.startCalibration/finishCalibration` + ws cmd `voice.calibrate` teach the name; UI `ui/src/Name.tsx` (wizard voice step and Settings).
- 194 tests pass, tsc clean. Installer rebuilt (dist/installer/Pit Wall Setup 0.1.0.exe), installed over the old app and launched; smoke test passed.
- Measured with the synthetic voice: Bono 5/5 after learning, Will Joseph 4/5, GP 0/5 (weak; synthetic voice garbles it). Real microphone still untested.
- Next: user's first real hands-free test with PITWALL_VOICE_DEBUG=1; still nothing committed after v0.1.0.

## 2026-10-26 (evening) — first real live session: analysis empty + voice silent (D30)
- Cause 1: real 2026 packet order is LapData, Motion, MotionEx, CarTelemetry, CarStatus, CarTelemetry2; adapter closed frames at MotionEx so every frame lost lap/motion data (52 248/52 248 lap=null). Fixed: frame closes on next frame. Cause 2: radio held every priority-2 reply until a track model existed; fixed (replies allowed on a straight; instant with no live car; 45 s lifetime).
- Verified by replaying the real 360 MB capture (`scripts/dev/analyse-capture.ts`, `reply-latency.ts`): 5 laps, Shanghai 14 corners, debrief built, 18/18 questions answered while driving (median 2.4 s, p90 13 s).
- Not verified live: the user has not yet rerun with the fixed build. Content of coaching on real data (e.g. T5 drill) unchecked against the driver's own view. Nothing committed after v0.1.0.

## 2026-10-26 (sprint weekend) — empty tabs, no reference, no map (D31)
- Causes found on the day's 5 captures: menus send sessionUID 0 (wiped analysis), out laps share the flying lap's number (8 km Shanghai model saved in the user's db), 0.3–1.3 s Wi-Fi holes on most laps (300 ms limit rejected them), one-lap quali sessions had nothing to compare with.
- Fixed in adapter (uid 0), LapCollector (out-lap skip, timer restart), SessionAnalyser (coversLap/fitsLap, self-healing model, model + reference kept across sessions, `refs` table), radio zones from the reference, per-corner "losing time". 206 tests pass.
- `scripts/dev/weekend-replay.ts <db> <captures…>` replays a weekend; scratch db with the rebuilt Shanghai model + SQ3 reference: scratchpad/weekend.db; `scripts/dev/seed-weekend.cjs <weekend.db>` swaps it into the user's db (app closed).
- Done after the sprint race: installed, seeded (the saved model had become 1 320 m during the race), relaunched; a replay of SQ1 against a copy of the real db compares with the 1:32.657 reference. Race laps without a trace were flashbacks and one 4.8 s outage. Still to do: when the last lap has no trace but a reference exists, the "losing time" answer says "No reference lap yet" (misleading; should say the lap had a gap). Not verified live yet.

## 2026-11-03 (Miami sprint weekend, FP1 done live)
- FP1 worked live: voice, best time, losing time, debrief. Real app (launched by the user): Miami model, laps 1:30.801 / 1:30.174 / 1:29.210, engineer "Atlas", coach mode.
- Root cause of every "settings reset": Claude desktop is MSIX; my tools' writes to %LOCALAPPDATA%\PitWall go to `Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\PitWall`. Shanghai model/reference and the Nov 1 restore exist only there. Use the HTTP API to see the real app; never launch the app from my tools.
- Bugs found, to fix after the weekend (app is live, do not rebuild mid-weekend): (1) no single-instance lock: opening the app 3 times gave EADDRINUSE crash loops and dialogs; (2) Settings tab and Radio tab mode do not refresh after a voice mode change; (3) nothing logs what the engineer said or what it heard when addressed, so "what else did it say?" cannot be answered; (4) empty-text wake guard (already fixed in source, not built). Also merge the Shanghai data into the real db (needs a process outside the MSIX container).

## 2026-11-07 (Miami SQ + sprint) — D33
- Fixed from the driver's checklist and verified on the recordings: fuel display margin, tyre answer, lap time wording, 12-word drops, reply priority/heuristic, map at session start, last-session debrief + sessions table (session_type migration), flashback laps kept (marked rewound, out of reference/theoretical/ranking), standing-start lap 1 untraced, zones never from zero traced laps, single-instance lock, mode refresh, radio/heard logging. 234 tests pass. Installer built 22:51 (smoke test passed); NOT installed: the user's app was running.
- Sprint replay now: fuel "good, push" once (was "five laps short" … "one lap short"); 9/9 laps traced (was 3/9); theoretical 1:27.761 vs best 1:29.436; replies 32/34, median 6.0 s, p90 16 s.
- Install: the user closes Pit Wall and runs dist/installer/Pit Wall Setup 0.1.0.exe, then opens Pit Wall from the Start menu. Never launch the app from my tools (MSIX redirection, see memory).

## 2026-11-08 — D33 build installed; D34 debrief survives a restart
- D33 build installed 10:52 (closed the user's app while no telemetry for 3 min; silent `/S` install; installed main.mjs hash = built). User opened it from the Start menu: Atlas, coach mode, voice on, real DB; Miami map loaded before the first lap.
- D34: debrief JSON saved after every lap (`last_debrief` table, `saveDebrief` on setImmediate in main.ts); `/api/debrief(.html)` use `currentDebrief` = live, else the saved one (previousSession, progress re-read). Tests in debrief.test.ts. Verified end to end: Miami sprint replay into a scratch DB, then `pitwall-restart-ui` (an empty capture on the same DB) → same 9 laps, best 1:29.436, T7/T14/T2, HTML export with SVG, Debrief tab shows "last session". 236 tests pass, typecheck clean.
- D34 built (offline now: `electronDist`, see D34) and installed 12:07 after the user's 28-lap Miami race (best 1:28.879). That race ran on the D33 build, so its debrief was only in memory: exported to `debriefs/miami-race-2026-11-08.html` + `.json` before closing. The Debrief tab in the new build is empty until the next completed lap, then survives restarts. 236 tests pass, smoke test passed, installed bundle hash = built.
- D35 (voice "Say again?" after name+pause, driver mishearings, pit laps untraced, 2 s incident rule): 249 tests pass, replay of the race checked, installer built 14:05 with smoke test passed. Installed 2026-11-08 (silent /S, installed main.mjs hash = built); checked running 20:10, voice and audio loaded, Debrief empty until the first lap on D34+.
- D36 (no "Say again?" to room audio when no frame for 60 s; the idle app had answered 7 song lines with "at last" in them): 250 tests pass, typecheck clean, installer smoke test passed. Installed 2026-11-11 (installed main.mjs hash = built); not yet checked running.
- 2026-11-11: committed (M6 voice + D-series fixes) and pushed to the public repo https://github.com/Adecodes-dot/pitwall; commit emails use the GitHub no-reply address. Open item: "braking 185 m early" on the last laps (see D35).
