// Microphone capture for hands-free voice: getUserMedia → 16 kHz mono int16 chunks (~85 ms) → callback.
// Echo cancellation and noise suppression are requested from the browser; the server also stops listening
// while the engineer is speaking. Needs a secure context: http://localhost counts, a LAN address does not.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Live } from './ws.ts';

export interface MicHandle { stop(): void }

export async function startMic(onChunk: (pcm: Int16Array) => void, onLevel?: (rms: number) => void): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This page cannot use the microphone (it needs http://localhost or https).');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1); // deprecated but universal; an AudioWorklet needs a separate module file
  const ratio = ctx.sampleRate / 16000;
  proc.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    const n = Math.floor(x.length / ratio), out = new Int16Array(n);
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
      let s = 0; for (let k = a; k < b; k++) s += x[k]!;
      const v = Math.max(-1, Math.min(1, s / (b - a)));
      out[i] = Math.round(v * 32767); sumSq += v * v;
    }
    onLevel?.(Math.min(1, Math.sqrt(sumSq / Math.max(1, n)) * 6));
    onChunk(out);
  };
  src.connect(proc); proc.connect(ctx.destination); // the processor only runs when connected; it writes silence
  return { stop() { proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); } };
}

export interface MicState { on: boolean; error: string | null; level: number; start: () => Promise<void>; stop: () => void }

/** Mic toggle that remembers its state and re-opens on load (the Electron app grants the mic itself). */
export function useMic(live: Live): MicState {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const handle = useRef<MicHandle | null>(null);
  const lastLevel = useRef(0);
  const send = useRef(live.sendBinary); send.current = live.sendBinary;
  const stop = useCallback(() => { handle.current?.stop(); handle.current = null; setOn(false); setLevel(0); try { localStorage.setItem('pw.mic', '0'); } catch { /* private mode */ } }, []);
  const start = useCallback(async () => {
    if (handle.current) return;
    try {
      handle.current = await startMic((pcm) => send.current(pcm.buffer as ArrayBuffer), (l) => { const t = performance.now(); if (t - lastLevel.current > 120) { lastLevel.current = t; setLevel(l); } });
      setOn(true); setError(null);
      try { localStorage.setItem('pw.mic', '1'); } catch { /* private mode */ }
    } catch (e) { setError((e as Error).message || String(e)); setOn(false); }
  }, []);
  useEffect(() => { let was = false; try { was = localStorage.getItem('pw.mic') === '1'; } catch { /* ignore */ } if (was) void start(); return () => { handle.current?.stop(); handle.current = null; }; }, [start]);
  return { on, error, level, start, stop };
}
