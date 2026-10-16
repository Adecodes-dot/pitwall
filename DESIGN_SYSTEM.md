# DESIGN_SYSTEM.md — Pit Wall UI and voice

Two surfaces: a phone PWA (the driver glances at it on a stand next to the wheel) and a desktop view (laptop screen, debrief). One design system, two breakpoints. Dark by default: the driver is in a dim room looking at a bright TV.

## Principles
1. **Glanceable at arm's length.** Live screens use one big number per card, 48px+ figures, no body text. If you cannot read it in 0.5 s from 80 cm, it is too small.
2. **Calm, not gamer-neon.** Pit-wall grey and carbon; colour is reserved for meaning (green = receiving/good, amber = watch, red = act now, blue = information).
3. **Status always visible.** A persistent header strip shows: game detected, packets/s, receiving light, radio state (quiet/speaking), chattiness mode.
4. **Nothing moves unless the data moves.** No decorative animation; transitions ≤ 150 ms.
5. **Touch targets 48px.** Push-to-talk is a thumb-sized button pinned bottom centre on phone.

## Tokens
```css
:root {
  --bg:        #0f1114;   /* page */
  --bg-raised: #171a1f;   /* cards */
  --bg-sunken: #0a0c0e;   /* traces */
  --line:      #262b33;
  --fg:        #e8eaed;
  --fg-muted:  #9aa3ad;
  --fg-faint:  #5f6873;

  --ok:        #2ecc71;   /* receiving, on target */
  --warn:      #f5a623;   /* losing time, watch */
  --bad:       #ff4d4f;   /* flags, act now */
  --info:      #4da3ff;   /* reference lap, neutral highlight */
  --radio:     #b388ff;   /* engineer speaking */

  --trace-me:  #e8eaed;
  --trace-ref: #4da3ff;
  --trace-delta-pos: #ff4d4f;  /* slower than reference */
  --trace-delta-neg: #2ecc71;  /* faster */

  --font-ui:   "Inter", system-ui, sans-serif;
  --font-num:  "JetBrains Mono", "Roboto Mono", monospace; /* tabular figures for timing */

  --radius: 10px;
  --gap: 12px;
  --shadow: none; /* flat; depth comes from bg tiers */
}
@media (prefers-color-scheme: light) { /* supported but not default; same tokens, inverted */ }
```
Type scale (px): 12 caption, 14 body, 16 label, 24 card title, 48 live number, 72 hero number (phone speed/delta).

Timing text is always monospace with fixed width (`1:32.456`, `-0.312`), coloured by sign: negative delta green, positive red, zero/neutral `--fg`.

## Layout
- Phone (≤ 480px): single column, cards stack. Bottom bar: push-to-talk centre, chattiness toggle left, mute right.
- Tablet/desktop (≥ 900px): 12-column grid; live view = left 8 cols traces, right 4 cols status cards.
- Safe-area insets respected (notch), `100dvh` for full-height screens.

## Screens (v1)
1. **Setup** — one screen per game with the exact in-game settings to change, the laptop's LAN IP in a copyable chip, and a live "receiving" light that turns green on first valid packet. Auto-detects the game and advances.
2. **Live** — speed, gear, throttle/brake bars, current lap and delta to PB, last radio call as a transcript line, status strip.
3. **Radio log** — scrollable transcript of calls with timestamps and the reason (e.g. "T4 brake point vs best").
4. **Debrief** — summary cards (best, theoretical best, consistency), top-3 corners each with a trace overlay (speed, throttle, brake vs reference), one instruction each, next-session drill, export button.
5. **Progress** — per-track history of best lap and consistency over sessions.
6. **Settings** — chattiness (Quiet/Normal/Coach), voice/persona, audio output device, assist profile (GT7), units, cloud LLM toggle.

## Components
- `StatusStrip`, `BigNumber`, `InputBars` (throttle green, brake red, steering centre bar), `DeltaChip`, `TraceOverlay` (uPlot, me vs reference, corner markers), `CornerCard`, `RadioLine`, `PushToTalk`, `SetupStep` (checkbox list with copy chips), `ReceivingLight`.

## Voice and tone of the engineer
The engineer is calm, precise and brief. British-neutral English by default; persona and voice are configurable but the rules are not.

Rules (enforced by tests in `radio/`):
- ≤ 8 words where possible, never more than 12. One idea per call.
- Lead with the place (corner number), then the fact, then the instruction if any.
- Numbers are rounded to what a driver can use: metres to the nearest 5, km/h to the nearest 5, seconds to 0.1 (0.01 for lap times only).
- No exclamation marks, no praise inflation, no filler ("okay so", "basically").
- Never speculate. If the data is missing, say nothing.
- Encouragement is rare and earned: after a PB, after a clean recovery.

Twenty reference calls (deterministic templates; LLM may only rephrase within these bounds):
1. "Turn 4, braking 10 metres early." (coaching: brake point vs own best)
2. "Turn 7, carry 5 more through the apex." (min corner speed vs best)
3. "Turn 9, pick up throttle earlier, you're coasting." (coasting time)
4. "Turn 2, ease off the brake, you're locking." (lockup inferred)
5. "Turn 11 exit, wheelspin, feed the throttle." (wheelspin inferred)
6. "Turn 1, bleed the brake off slower." (trail-brake release shape)
7. "Purple sector two." (encouragement, factual)
8. "That's a new best, one thirty-two four." (PB)
9. "Yellow flag, sector three." (safety)
10. "Safety car, safety car." (safety)
11. "Box this lap, box box." (strategy, pit window)
12. "Fuel, two laps short, lift and coast." (strategy)
13. "Fronts are hot, give them a lap." (tyres, where provided)
14. "Rears are gone, manage the exits." (tyre wear)
15. "Gap ahead one point two, closing." (race info)
16. "Turn 6, you're losing three tenths there." (per-corner delta)
17. "Consistent, keep this rhythm." (consistency, after 3 laps within tolerance)
18. "DRS available." (F1 only, flag)
19. "Rain in two minutes, stay out." (F1 weather forecast only)
20. "Radio check, loud and clear." (setup)

Rejected examples (tests assert these never happen): "Brake later!" (no corner, no number), "Great job, keep it up!!" (empty praise), "You might want to consider…" (hedging), any call longer than 12 words, any call during a braking zone.
