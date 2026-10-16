# handoff.md — Pit Wall (written 2026-10-16, end of M5)

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
- Nothing committed to git yet (repo initialised, user has not asked for commits).

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
- `scripts/demo-m1.ts`, `scripts/demo-m2.ts`, `scripts/dev/*` (debug prints).
- Launch configs for the in-app browser are in `C:\ade_project_house\.claude\launch.json` (names `pitwall-synth-gt7`, `pitwall-synth-f1`, `pitwall-live`, `pitwall-replay-gt7-4x`).

## Gotchas learned
- Node 24 type stripping: no enums, no constructor parameter properties, `.ts` import extensions (tsconfig `erasableSyntaxOnly`).
- Bash heredocs with backticks inside `node -e` strings get mangled by the shell; use the Write/Edit tools or `node - <<'EOF'`.
- Replay statistics must use the process clock, not the recorded timestamps (fixed in engine.ts).
- F1 has no lap-complete event; lap boundaries come from `currentLapNum` incrementing. GT7 publishes last-lap-time possibly a few packets after the lap counter changes; the adapter waits up to 30 packets.
- GT7 format is latched by the first heartbeat the console receives; the companion sends `~` every 1.5 s to broadcast until a stream appears, then to the console's address.
- sherpa-onnx-node needs `node_modules/sherpa-onnx-win-x64` on PATH before require (the worker sets it). Node 24 runs `.ts` worker files directly.
- Transcript entries are recorded synchronously at speak time (sink promises never resolve inside a synchronous replay loop); audioStart is patched when the device takes the buffer.
- In Normal mode a short session with tiny lap deltas produces no coaching calls by design (nothing ≥ 0.12 s per corner).
- npm's allow-scripts policy on this machine blocks postinstall scripts: `electron` (binary download), `esbuild`, `sherpa-onnx-node`. After `npm install` run `node node_modules/electron/install.js` for the Electron binary; esbuild and sherpa work without their scripts because the platform packages are plain optional deps. electron-builder downloads its own Electron for packaging regardless.
- electron-builder downloads NSIS and winCodeSign from GitHub on first use; a slow network hits its 10-minute request timeout (`Timeout awaiting 'request'`). Retry; or (what worked here) curl the archives `winCodeSign-2.6.0/winCodeSign-2.6.0.7z`, `nsis-3.0.4.1/nsis-3.0.4.1.7z`, `nsis-resources-3.4.1/nsis-resources-3.4.1.7z`, `7zip@1.0.0/7zip-win-x64.tar.gz` from `github.com/electron-userland/electron-builder-binaries/releases/download/`, serve the folder over HTTP (any static server that ignores the path), and build with `ELECTRON_BUILDER_BINARIES_MIRROR=http://localhost:9911/ ELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true`. Once cached in `%LOCALAPPDATA%electron-builderCache` the mirror is no longer needed. The built installer is `dist/installer/Pit Wall Setup 0.1.0.exe` (207 MB).

## Next steps (after M5)
1. **Real captures.** Run `npm run demo:m1 -- <file>` … `demo:m4` on the user's GT7/F1 recordings; check lap times vs the in-game screen, corner counts (Suzuka 18, Silverstone 18), mistake thresholds, flag and fuel calls. Tune `kEnter`/merge gap and lockup/wheelspin ratios; write `docs/milestones/REAL_CAPTURES.md`.
2. Install `dist/installer/Pit Wall Setup 0.1.0.exe` on a clean Windows VM: first-run wizard, firewall prompt wording, tray behaviour, audio on the default device, uninstall. (The unpacked app was launched here and its companion came up; the installer exe itself has not been run.) Fix the libuv assertion printed when the bundled server is killed (seen in the smoke test; likely worker/audio teardown on SIGTERM — add a graceful shutdown that stops the TTS worker and audio sink before exit).
3. Electron shell polish: "Open on phone" menu item showing the LAN URL + QR; autostart option; app icon as .ico for the taskbar.
4. GT7: car names from ddm999/gt7info; track names from the CC0 signature DB (match by fingerprint) so debriefs say "Suzuka" not "fp-9c4cfc24".
5. Freemium seam (PRD §6): a `features` capability object; everything on the live path stays free.
