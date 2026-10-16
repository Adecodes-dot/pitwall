# Pit Wall — your race engineer for PS5

Pit Wall listens to your game's telemetry on your home network, learns how you drive, talks to you over the radio like a real engineer, and gives you a debrief after the session. Works with **EA SPORTS F1 25** (with or without the 2026 Season Pack) and **Gran Turismo 7** on PS5. Runs on a Windows laptop or mini-PC on the same Wi-Fi. No internet needed while you drive.

It coaches you. It never touches your controls.

## What you need
- A PS5 with F1 25 or GT7.
- A Windows 10/11 laptop or mini-PC on the same network as the PS5.
- Something to hear the engineer with: a cheap wired earbud plugged into the laptop and worn under your headset is best. Laptop speakers also work. Bluetooth works but speaks a little late.
- Optional: your phone, to see the dashboard and ask the engineer questions.

## Install
1. Run the installer (`Pit Wall Setup x.y.z.exe` from the releases page). It installs to your user folder; no admin rights needed.
2. Start Pit Wall from the Start menu. A window opens and a flag icon appears in the tray.
3. If Windows asks about the firewall, tick **Private networks** and allow.

Developers: `npm install && npm run voice:get && npm run ui:build && npm run dev` then open http://localhost:8787.

## First run (two minutes)
The setup wizard walks you through it:
1. **Pick your game.**
2. **F1 25 only:** on the PS5 go to Settings → Telemetry Settings and set UDP Telemetry **On**, Broadcast **Off**, IP = the address shown in the wizard, Port **20777**, Send Rate **60 Hz**, Format **2026** (or 2025 without the Season Pack). **GT7:** nothing to change.
3. **Drive out.** The light turns green when packets arrive.
4. **Radio check.** Plug in your earbud and press the button. You should hear "Radio check, loud and clear."
5. **GT7 assists.** Tell Pit Wall your TCS, ASM and ABS settings so the advice fits. F1 sends them by itself.

Open the dashboard on your phone at the address shown in the wizard (for example `http://192.168.1.20:8787`). Add it to your home screen for a full-screen view.

## What the engineer says
- **Safety first:** flags, safety car, VSC. Always, in every mode.
- **Strategy:** fuel laps short, tyres hot or worn.
- **Coaching, one idea at a time:** "Turn 4, braking 10 metres early." "Turn 7, carry 5 more through the apex." Every number comes from your own best lap on this track.
- **Never mid-corner.** Calls only start on straights, after your first flying lap teaches Pit Wall the track.
- Chattiness: **Quiet** (safety and fuel only), **Normal** (up to two calls a lap), **Coach** (lap times and up to four calls a lap).

Ask it things on the Radio tab, by voice or by typing: "how's my fuel", "where am I losing time", "what's my best", "how are the tyres".

## After the session
The Debrief tab shows your best and theoretical lap, a consistency score, the three corners costing you the most time (with your trace against your best), one instruction per corner, and a drill for next session. Export it as a web page or JSON.

## FAQ
**The light never turns green.** Same network? Guest Wi-Fi cannot see the PS5. F1: check the IP matches the wizard exactly and Broadcast is Off. A VPN on the laptop changes its address. GT7: close other telemetry apps; only one can talk to the console at a time. Firewall: Windows Security → Firewall & network protection → Allow an app → Pit Wall (or Node.js) on Private.

**I hear nothing.** Check the laptop's output device and volume. Press "Radio check" in Setup. Or on the Radio tab enable "Play calls here" to use the phone.

**The engineer is quiet.** It needs one clean lap to learn the track. It also goes quiet on purpose when data is missing or you are off track. In Normal mode it only speaks when a corner is more than 0.12 s slower than your best.

**Bluetooth earbuds speak late.** Built-in Bluetooth adds 150–300 ms. A wired earbud or an aptX Low Latency USB transmitter fixes it.

**Where are my files?** Database and logs: `%LOCALAPPDATA%\PitWall`. Recordings (if enabled): the `captures` folder next to the app. Crash reports are written there too and never uploaded.

**Does it work offline?** Yes. Everything while you drive runs on the laptop. Cloud phrasing (optional) only rewords coaching lines and is checked against the facts before it is spoken.

## Not in this version
Multiplayer or team engineer, car setup advice, PC-only sims, phone-only use without a laptop. The architecture is ready for more games: each is one adapter.

## Credits and licences
Voice: Piper `en_GB-alba` (dataset CC BY 4.0, University of Edinburgh). TTS runtime: sherpa-onnx (Apache-2.0). Audio: @echogarden/audio-io (MIT). GT7 protocol knowledge from the open-source community (Nenkai/PDTools, MacManley/gt7-udp, MIT). F1 packet layouts from the EA SPORTS F1 25 UDP specification. See `THIRD_PARTY.md`.
