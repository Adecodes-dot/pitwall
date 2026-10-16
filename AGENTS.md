# AGENTS.md — map of the Pit Wall repo

This file tells an AI agent (or a new human) where things live and how work flows. Working rules are in `CLAUDE.md`. Product scope is in `PRD.md`. Structure is in `ARCHITECTURE.md`. Every non-obvious choice is in `DECISIONS.md`.

## Documents
| File | Purpose |
|---|---|
| `RESEARCH.md` | Protocols (F1 UDP, GT7), field tables per game, licences of borrowed code, gaps |
| `PRD.md` | What we build for v1, what great looks like, out of scope |
| `ARCHITECTURE.md` | Process layout, modules, data flow, normalised telemetry schema, latency budget |
| `DESIGN_SYSTEM.md` | UI tokens, components, voice and tone of the engineer |
| `DECISIONS.md` | Dated log of every non-obvious decision |
| `handoff.md` | Written at the end of a long session so a fresh session can continue |

## Source layout (single npm package; see DECISIONS.md D9)
```
src/
  core/        normalised schema (types.ts), event bus, clock, binary struct reader
  adapters/    adapter.ts interface; f1/ (layouts, codec, adapter) and gt7/ (crypto, packet, adapter)
  capture/     .pwcap writer/reader, replay scheduler
  synth/       parametric track, driver model, F1/GT7 datagram emitters
  analysis/    (M2) track model, corner detection, laps/sectors, references, fingerprint
  radio/       (M3) safe zones, priority queue, call generator, TTS, audio out
  strategy/    (M3) fuel, tyres, pit window
  debrief/     (M4) summary, top-3 corners, drill, export
  llm/         (M4) phrasing + Q&A, cloud with local fallback
  server/      engine (ingest pipeline), udp sockets + GT7 heartbeat, ws channels, http, main entry
ui/            PWA (Vite + React); built to ui/dist and served by the companion
scripts/       one-command demos per milestone (demo-m1.ts), capture tools
fixtures/      small captures for tests (none yet; synthetic data is generated in-test)
captures/      full captures (gitignored)
docs/          research appendices, milestone evidence, capture guide
```
Run things with plain `node file.ts` (Node 24 strips types; no build step for the server). Tests: `npm test`.

## How work flows
1. Pick the milestone in `PRD.md` (M1–M5). Each has a done condition and a one-command demo.
2. Before code: read the relevant section of `ARCHITECTURE.md`; if the change alters a contract (schema, event names, file formats), update the doc in the same change.
3. Write or extend a test using the synthetic generator or a fixture capture. Then implement.
4. Run `npm test`, then the milestone demo script. Attach evidence (test output, latency numbers, screenshots) to the milestone notes.
5. Log decisions. Update `handoff.md` if the session is long.

## Things an agent must never do
- Send driver inputs to any game, or build anything that could.
- Call a cloud API on the live coaching path.
- Invent a telemetry field a game does not provide.
- Claim a milestone done without the evidence listed in `PRD.md`.
