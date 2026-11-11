# THIRD_PARTY.md — sources we borrow from

Policy is in `DECISIONS.md` D7. This list is updated whenever a file or idea is taken from outside.

| Source | Licence | What we use | Where |
|---|---|---|---|
| EA SPORTS F1 25 UDP spec PDFs (format 2025, 2026) | EA documentation, publicly posted | Struct layouts, enums, event codes | `src/adapters/f1` (transcribed by us) |
| racehub-io/f1-telemetry-client | MIT | Cross-check of struct tables | reference only until code is copied |
| MacManley/f1-25-udp, f1-26-udp | MIT | Cross-check of struct tables and sizes | reference only |
| Nenkai/PDTools | MIT | GT7 packet layout, Salsa20 key/nonce scheme, flag bits | `src/adapters/gt7` (reimplemented in TS) |
| MacManley/gt7-udp | MIT | GT7 formats B/~/C field names and sizes | `src/adapters/gt7` |
| ddm999/gt7info | MIT-0 | GT7 car id → name table | `src/adapters/gt7/data` (planned) |
| jbhoorasingh/gt7-datalogger-track-data | CC0 | GT7 track signature DB | `src/analysis/data` (planned) |
| Crew Chief V4 (mr_belowski) | MIT | Radio queue design (immediate vs queued, priority, due/expiry, dedupe, pause) | `src/radio` (design, no code copied) |
| IAmTomShaw/open-pit-wall | MIT | WebSocket channel-subscription pattern | `src/server` (design) |
| sherpa-onnx (k2-fsa) | Apache-2.0 | TTS runtime via `sherpa-onnx-node` | dependency |
| rhasspy/piper-voices `en_GB-alba-medium` | per model card (check before shipping) | Default engineer voice | bundled model |
| @echogarden/audio-io | MIT | Prebuilt audio output addon (MME on Windows) for the laptop sink | dependency |
| sherpa-onnx-node + sherpa-onnx-win-x64 | Apache-2.0 | Offline TTS runtime (worker thread) | dependency |

Read for ideas only, no code copied: snipem/gt7dashboard (GPL-3.0), gt-telem (GPL/LGPL), Bornhall/gt7telemetry (GPL-3.0). Not used: Volodrum/CrossPlatformF1TelemetryApp (no licence).

| sherpa-onnx streaming zipformer en-20M (2023-02-17), k2-fsa | Apache-2.0 | Offline speech recognition for hands-free voice | `models/` (downloaded by `npm run voice:get`) |
