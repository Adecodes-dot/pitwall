# TTS latency benchmark — 2026-10-16

Measured, not estimated. Script: a Node 24 ESM script using `sherpa-onnx-node` 1.x with the prebuilt `sherpa-onnx-win-x64` addon, voice `vits-piper-en_GB-alba-medium` (22.05 kHz), CPU provider. Six radio phrases of 5–8 words, 3 rounds, first round discarded as warm-up. Times are full synthesis of the whole phrase (text in → all samples out), which is an upper bound on time-to-first-audio.

Machine: Intel Core i7-9750H @ 2.60 GHz (6C/12T), Windows 11 22000, Node 24.19.0 x64. Model load: ~1.6 s (once, at startup).

| Threads | p50 whole phrase | p95 whole phrase | Mean real-time factor |
|---|---|---|---|
| 1 | 267 ms | 334 ms | 0.119 |
| 2 | 182 ms | 211 ms | 0.078 |
| 4 | **136 ms** | **167 ms** | 0.060 |

Per phrase at 2 threads: "Box this lap, box box." 135 ms (1.6 s of audio); "Turn 4, braking 10 metres early." 191 ms (2.3 s); "Yellow flag, sector three." 148 ms; "Turn 7, carry 5 more through the apex." 226 ms; "That's a new best, one thirty-two four." 157 ms; "Fuel, two laps short, lift and coast." 212 ms.

## What this means for the 300 ms budget
- Fixed phrases (safety, strategy, most coaching templates) come from the startup-synthesised bank: ≈ 0 ms synthesis, so the call starts within ingest + audio-device latency (< 60 ms target).
- Fully dynamic phrases synthesised on the fly fit the budget with 4 threads (p95 167 ms + ≤ 30 ms audio out ≈ 200 ms) and marginally with 2 threads. The radio worker gets 4 threads; the UDP/event loop is unaffected because synthesis runs in a worker.
- Streaming by sentence chunk (the addon supports a callback per chunk) will reduce time-to-first-audio further; the callback was not triggered in this harness configuration, so the whole-phrase number is what we rely on until measured in the real pipeline at M3.

## Voice licence
`en_GB-alba-medium` model card: dataset licence CC BY 4.0 (University of Edinburgh datashare), fine-tuned from the lessac voice. Attribution required in the app's about screen and `THIRD_PARTY.md`.

## Reproduce
```
npm i sherpa-onnx-node
curl -L -o alba.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_GB-alba-medium.tar.bz2 && tar xjf alba.tar.bz2
PATH=node_modules/sherpa-onnx-win-x64:$PATH node bench.mjs 4
```
The benchmark script will be committed as `scripts/bench-tts.mjs` when the radio package is created in M3.
