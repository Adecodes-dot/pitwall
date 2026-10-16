# Audio routing, local TTS and prior art — research appendix (2026-10-16)

Source: web research pass. Synthesis is in `../../RESEARCH.md`.

## A. Getting engineer audio into the driver's ears

### A1. Bluetooth from the Windows laptop

| Path | Latency (published) | Caveats |
|---|---|---|
| SBC (Windows default) | 173 ms ([rtings](https://www.rtings.com/headphones/learn/latency)); typically 200–250 ms ([soundstagesolo](https://www.soundstagesolo.com/index.php/features/185-latency-a-new-concern-for-audiophiles)) | Eats most of the 300 ms budget on its own. |
| AAC | 120–150 ms ([outeraudio](https://www.outeraudio.com/bluetooth-speaker-latency-explained/)) | Windows generally negotiates SBC/aptX, not AAC. |
| aptX | 166 ms RTINGS; 70–110 ms TechHive | |
| aptX Low Latency | 34–40 ms ([nextpit](https://www.nextpit.de/news/ldac-aptx-aac-was-ist-der-beste-bluetooth-audio-codec)) | Built-in laptop radios rarely transmit aptX LL; needs a USB transmitter (e.g. Avantree DG60P, claims 40 ms LL: [avantree](https://avantree.com/dg60p-bluetooth-usb-audio-transmitter)) plus aptX-LL buds. |
| aptX Adaptive | 40–80 ms | Same transmitter caveat. |
| LE Audio / LC3 | ~25 ms end-to-end quoted | **Not available on this machine.** Windows LE Audio needs 22H2 (build 22621) or newer ([Microsoft](https://support.microsoft.com/windows/check-if-a-windows-11-device-supports-bluetooth-low-energy-audio-2b79c085-0353-4467-8306-ebb2657a91de)). This laptop is 10.0.22000 (21H2). |

"One earbud under the headset": a documented console/Discord workaround ([earlygame](https://earlygame.com/de/sonstiges/discord-auf-konsole)); the earbud inherits whatever latency its source has.

### A2. Phone PWA audio (LAN WebSocket → Web Audio)
- LAN hop is negligible; the cost is the phone's audio stack. `AudioContext.outputLatency` exists on Chrome Android 102+ and iOS Safari 18.4+ ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency)). Many Android devices still see >100 ms output latency ([superpowered](https://superpowered.com/androidaudiopathlatency)). Measure on the target phone.
- **iOS PWA caveat**: installed home-screen PWAs on iOS 26 can lose Web Audio / `AudioContext.resume()` never resolves ([WebKit bug 291892](https://bugs.webkit.org/show_bug.cgi?id=291892)); lock-screen audio dies after ~30 s; Wake Lock unsupported. Run in a Safari tab, keep the screen on, pre-unlock audio with a tap (sathwik-e/Pitwall does this).

### A3. Laptop speakers / wired headphones from the laptop
Windows audio engine latency ~1.3 ms; default shared-mode buffer 10 ms; `IAudioClient3` can expose 1–5 ms buffers; exclusive mode bypasses the engine ([Microsoft Learn](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio)). A wired 3.5 mm earbud from the laptop is ~10–20 ms end-to-end. From Node: `@echogarden/audio-io` (precompiled addons, Windows via MME) or `naudiodon`/PortAudio ([audio-io](https://classic.yarnpkg.com/en/package/@echogarden/audio-io)).

### A4. PS5-side routing
- **Party chat via PS App on a phone (second PSN account)**: party members can join from PS App and talk; parties hold 16; Voice Chat Balance slider appears while in a party ([PS5 party voice chat](https://www.playstation.com/en-us/support/games/ps5-party-voice-chat/), [PS App features](https://www.playstation.com/support/games/playstation-app-features/)). Plausible "engineer in your headset" path (TTS into a virtual mic on an Android phone running PS App on a throwaway account). Unverified: routing into the local player's headset is normal party behaviour but not documented; PSN party latency unpublished; anecdotes 150–400 ms. High friction.
- **PS Remote Play on PC as mic path**: Remote Play takes over the console session; not viable while the driver races locally ([Sony](https://www.playstation.com/en-au/support/games/remote-play-settings/)).
- **Audio Focus** is an EQ preset, not a mixer.
- **Hardware mixers**: Astro MixAmp Pro TR has an Aux line-in that blends a second source ([Logitech](https://www.logitechg.com/en-us/products/gaming-audio/mixamp-tr-gen-4.html)). SteelSeries Nova Pro base station switches between two USB sources rather than mixing; simultaneous is 2.4 GHz + Bluetooth (SBC) only. PS5 USB is output-only; DualSense 3.5 mm TRRS is the documented wired path; a passive 2-in/1-out mixer adds ~0 ms but may lose the DualSense mic.

### A5. Options summary

| Option | Latency | Friction | Cost |
|---|---|---|---|
| **Default: wired earbud from laptop jack, worn under the PS5 headset** (or laptop speakers if no headset) | ~10–20 ms | Trivial | $0 |
| aptX-LL USB transmitter + aptX-LL buds | ~40 ms | Buy two items | ~$30 + buds |
| Passive 3.5 mm mixer at DualSense | ~0 ms | Cable mess; mic may break | ~$15 |
| Phone PWA + phone-paired buds | 100–300 ms + iOS PWA fragility | Medium | $0 |
| PS App party on second account | unknown, likely 150–400 ms; needs Android virtual mic | High | $0 |
| Astro MixAmp aux-in | ~0 ms | Hardware + HDMI adapter | ~$130+ |
| Built-in Bluetooth SBC | 170–300 ms | Trivial | $0, blows the budget |

## B. Local TTS from Node 24 on Windows (no Python/Rust/.NET)

| Engine | Windows/Node path | Licence | Speed evidence | Quality |
|---|---|---|---|---|
| **Piper** | Prebuilt `piper_windows_amd64.zip` in archived rhasspy/piper 2023.11.14-2 — spawn exe from Node. Successor OHF-Voice/piper1-gpl is pip-only and GPL-3.0. No maintained native Node binding. | rhasspy/piper **MIT** (archived Oct 2025); voices MIT, check per-voice cards ([HF](https://huggingface.co/rhasspy/piper-voices)) | RTF ~0.15 on a laptop CPU ([cekura](https://www.cekura.ai/discover/piper-tts)); "sub-second for short sentences" ([mustafa.net](https://mustafa.net/2026/08/31/piper-review-after-6-months-running-local-tts-in-production/)) | Good, slightly robotic; en_GB alba/cori suit a radio engineer |
| **sherpa-onnx-node** | npm `sherpa-onnx-node` with optional dep `sherpa-onnx-win-x64`; node-addon-api, multithreaded, examples for vits-piper, matcha, kokoro ([examples](https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/nodejs-addon-examples/README.md)) | **Apache-2.0** | No published x86 laptop number; Piper-VITS via sherpa is the fast path | Same voices as Piper/Kokoro |
| **kokoro-js** | npm, CPU via @huggingface/transformers, q8/q4 dtypes, streaming splitter ([npm](https://www.npmjs.com/package/kokoro-js)) | **Apache-2.0** | ~985 ms per sentence fp32 on an Arm server CPU ([HF](https://huggingface.co/dlyog/af_heart_arm_tts)); likely 300–800 ms to first audio on a laptop CPU | Best natural quality offline |
| **Windows SAPI5** | PowerShell `System.Speech`; keep one persistent process | Built-in | Near-instant | Robotic; Windows 11 "natural" voices are locked to Narrator |
| **edge-tts** | needs internet | LGPL-3.0 | — | Excellent; debrief-only, never live |

**Caching strategy from real projects**: Crew Chief ships pre-recorded clip folders and composes messages from fragments, TTS only for driver names ([AudioPlayer.cs](https://gitlab.com/mr_belowski/CrewChiefV4/-/raw/master/CrewChiefV4/Audio/AudioPlayer.cs)). gt7-engineer uses Piper en_GB-alba-medium live. Moment-Up/pitwall uses system voices with optional Kokoro.

## C. Prior art

| Project | URL | Lang | Licence | Borrow |
|---|---|---|---|---|
| **Crew Chief V4** | https://gitlab.com/mr_belowski/CrewChiefV4 | C# | MIT | Two queues: `immediateClips` (spotter, interrupts) vs `queuedClips` (priority-sorted, `dueTime`, `expiryTime`, dedupe by `messageName`, max queue length per message). Won't wake for regular messages in "hard parts"; `keepQuiet`/`mute`; `pauseQueue`; hold channel open max 6 s; breath clip after 3 s; chatter rate-limited, disabled in last laps; `justTheFacts` mode. Persona = recorded clip folders per voice. |
| **SimHub** | https://www.simhubdash.com | C#/.NET | Proprietary; core not open | Output-plugin SDK only. Supports F1 25 incl. 2026 format and GT7 subset. Borrow: property-based data model, dashboard editor UX. |
| **Open Pit Wall** | https://github.com/IAmTomShaw/open-pit-wall | Python | MIT | Headless FastF1 replay served as simulated-live WebSocket; clients subscribe to channels `telemetry`, `leaderboard`, `weather`, `lap`, `racecontrol`, scoped like `telemetry.drivers.VER`; CLI play/pause/seek/speed. Borrow the channel-subscription pattern. |
| **F1 Race Replay** | https://github.com/IAmTomShaw/f1-race-replay | Python | MIT | Track map with car dots, timing tower, click-to-select driver telemetry panel, 0.5–4× playback, keyboard shortcuts. |
| **Moment-Up/pitwall** (closest competitor) | https://github.com/Moment-Up/pitwall | Python/FastAPI + React | Proprietary | Local-first iPad coach for F1 25 + GT7 on PS5; rules-based coaching, LLM optional and fact-sheet-gated; 1 m-grid lap comparison; "speaks at calm moments, max two messages per lap"; push-to-talk via F1 25 UDP button; sherpa-onnx Parakeet STT; Kokoro TTS; GT7 lap distance from velocity. Windows path untested with a game. |
| **gt7-engineer** | https://github.com/baruta1/gt7-engineer | Python | MIT | Discord-bot delivery, Piper alba voice, OpenAI LLM, fuel alerts. Shows the audio-routing problem unsolved. |
| **sathwik-e/Pitwall** (Forza) | https://github.com/sathwik-e/Pitwall | Python/Flask | none | Phone HUD on LAN, iOS audio-unlock tap. |
| **Simulator Controller** | https://github.com/SeriousOldMan/Simulator-Controller | AutoHotkey/C# | CC BY-NC-SA | Hybrid rule engine + optional GPT per assistant; F1 25, no GT7. |
| **gt7dashboard** | https://github.com/snipem/gt7dashboard | Python | GPL-3.0 | Race-line plot colour-coded throttle/brake/coast; time-diff vs reference lap. |

**Commercial coaching tools**: Coach Dave **Delta** (GT7 + F1, per-corner auto insights, post-session, £11.99/mo); **Track Titan** (PC sims, ~$15/mo); **Garage 61** (iRacing only, free tier); **Trophi.ai** (real-time voice coach, PC-only, $89.99/yr); **Popometer**; **RaceLab** (overlays); **VRS** (iRacing). **Gap**: nothing is offline + console + real-time voice + Windows + no Discord.

**Track map / corner detection methods**:
- FastF1 `CircuitInfo.corners` (hand-made, F1 real circuits only) ([fastf1](https://docs.fastf1.dev/circuit_info.html)).
- Curvature-peak segmentation: find ± curvature peaks → cut, merge close cuts, fill long straights with equidistant cuts, add cuts at sign changes ([SciTePress 2024](https://scitepress.org/publishedPapers/2024/127286/pdf/index.html)).
- Perantoni & Limebeer 2015: Frenet–Serret curvature model fit to noisy GPS with smoothing and closure constraints ([Oxford ORA](https://ora.ox.ac.uk/objects/uuid:3a7cfbe2-facf-479f-9208-089b1b22b2ae)).
- Greedy circular-arc fitting with ~1 m error threshold ([BJRBE](https://bjrbe-journals.rtu.lv/bjrbe/article/download/bjrbe.2011.21/201/372)).
- Practical GT7 approach: speed valleys = corners; integrate velocity for lap distance.

## Confidence and gaps
- High: Windows 11 22000 lacks LE Audio; BT SBC 170–300 ms; WASAPI ≤10 ms; Piper Windows binary + MIT; sherpa-onnx-node Apache-2.0 with win-x64 dep; kokoro-js Apache-2.0; Crew Chief MIT and queue logic; Open Pit Wall / F1 Race Replay MIT; SimHub proprietary; Moment-Up proprietary.
- Medium: aptX-LL dongle latency (vendor claims); Kokoro CPU latency on x86 (extrapolated); PS App party as audio path.
- Low / untested: PSN party latency; passive 3.5 mm mixer products; sherpa-onnx-node PATH needs on Windows; Piper time-to-first-audio on this CPU (benchmark pending, see DECISIONS.md).
