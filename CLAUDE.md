# Pit Wall — working rules for AI agents and humans

Pit Wall is an AI race engineer for PS5 sim racers (EA F1 25 incl. the 2026 Season Pack, Gran Turismo 7).
Read `AGENTS.md` for the map of the repo and `DECISIONS.md` before changing anything non-trivial.

## The four rules
1. **Think before coding.** State the problem, the data you have, and the smallest change that solves it. For anything touching telemetry parsing, timing, or radio rules, write the test first.
2. **Simplicity first.** One normalised telemetry schema, one event bus, deterministic analysis. No framework for a job a function does. No new dependency without a line in `DECISIONS.md`.
3. **Surgical changes.** Touch only the files the task needs. Keep game adapters, analysis, radio and UI separate. Never let an LLM invent a fact: it may only rephrase deterministic output.
4. **Verify before claiming done.** `npm test` passes, the replay harness runs, latency numbers are measured not estimated, and UI changes have Playwright screenshots at phone and desktop width. Say what you did not verify.

## Non-negotiables
- Everything must run with no PS5 attached (recordings, replay, synthetic generator) and with no internet (live coaching path).
- Fail safe: if data is missing, late or inconsistent, the engineer goes quiet. Guessing is a bug.
- Never talk in a braking zone or mid-corner. The test `radio/safe-zone` enforces this on every replayed session.
- No automation of driver inputs, ever. We coach the human.
- Every field in the normalised schema is nullable with an explicit "not provided by this game" state. Adapters never fabricate a field.
- Log every non-obvious choice in `DECISIONS.md` (date, choice, why, alternatives rejected).

## Conventions
- TypeScript, strict mode, ESM. Node 24. No Python, Rust or .NET in the build (not installed on the dev machine).
- Units: SI internally (m, m/s, s, kg, °C). Convert at the UI edge only.
- Timestamps: monotonic `performance.now()` ms for latency, wall-clock ISO for files.
- Tests: `vitest`. Fixtures live in `fixtures/`; real captures in `captures/` (gitignored, large).
- Commits: small, imperative subject, body says what was verified.

## When a session gets long
Write `handoff.md` (goal, current state, files touched, what failed, next steps) before stopping.
