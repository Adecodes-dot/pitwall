# Capture guide — recording real PS5 sessions for Pit Wall

Pit Wall develops and tests entirely on recordings. This page says exactly what to drive and how to save it. Each capture is a `.pwcap` file (raw UDP packets with timestamps) plus the lap times you read from the in-game timing screen, so we can prove the adapters decode correctly.

## Before you start (once)
1. Laptop and PS5 on the same Wi-Fi / router.
2. In a terminal in `pitwall/`:
   ```bash
   npm run dev
   ```
   It prints `phone: http://192.168.x.x:8787`. Open that address on your phone (or `http://localhost:8787` on the laptop). The Setup tab shows the laptop's IP.
3. If Windows shows a firewall prompt for Node.js, allow it on **private** networks. (If you missed it: Windows Security → Firewall → Allow an app → Node.js, tick Private.)

## Recording
Start the companion with recording on. Each run writes one file:
```bash
node src/server/main.ts live --capture captures/<name>.pwcap
```
Stop with Ctrl+C when the session is over. Then create `captures/<name>.json` with the in-game lap times (see below). Verify immediately with:
```bash
npm run demo:m1 -- captures/<name>.pwcap
```
It prints the lap times the adapter decoded; they must match the in-game timing screen (F1 exactly, GT7 within 0.05 s).

## Requests (M1 acceptance)

### Capture 1 — GT7 time trial, 5 laps
- File: `captures/gt7-suzuka-gr3-tt.pwcap`
- Game: Gran Turismo 7 → World Circuits → Suzuka Circuit → Time Trial (or a Custom Race alone, 5+ laps).
- Car: any Gr.3 car. Assists: whatever you normally use. **Write down**: TCS level, ASM on/off, ABS setting, countersteer assist, and the car name.
- Drive 5 clean laps. Do not pause. Do not restart.
- After the session, note the 5 lap times from the results / timing screen into `captures/gt7-suzuka-gr3-tt.json`:
  ```json
  { "track": "Suzuka", "car": "…", "assists": { "tcs": 1, "asm": true, "abs": "default", "countersteer": "off" },
    "lapTimesMs": [123456, 123789, 122999, 124001, 123222] }
  ```
  (milliseconds; 2:03.456 = 123456.)

### Capture 2 — F1 25 time trial, 5 laps
- File: `captures/f1-silverstone-tt.pwcap`
- Game: F1 25 → Time Trial → Silverstone (any car). In-game: Settings → Telemetry Settings → UDP Telemetry **On**, Broadcast **Off**, IP = laptop IP from the Setup tab, Port 20777, Send Rate **60 Hz**, Format **2026** if you own the 2026 Season Pack, else **2025**.
- Assists: your normal ones. Note which (the game also sends them, this is a cross-check).
- Drive 5 laps, including one deliberately scrappy lap (a lockup or a run wide) so we have a mistake to detect. One flashback is fine and useful: note roughly when.
- Note the lap times into `captures/f1-silverstone-tt.json` in the same format (the game shows them to the millisecond).

### Capture 3 — GT7 race, short (for strategy later)
- File: `captures/gt7-race-short.pwcap`
- Any track, Custom Race, 5 laps, with fuel consumption and tyre wear set to a fast rate (e.g. ×5) so fuel and temperatures move. Note the in-game lap times.

## What the files are for
- Capture 1 and 2: M1 acceptance (lap times), M2 corner detection on a real circuit, GT7 track fingerprint.
- Capture 2 also: format 2026 validation (no open-source parser has recordings yet), flashback handling, lockup detection.
- Capture 3: fuel-per-lap and tyre trend logic in M3.

Sizes: GT7 ≈ 2 MB per lap-minute, F1 ≈ 30 MB per lap-minute at 60 Hz (22–24 cars). Keep them in `captures/` (gitignored).
