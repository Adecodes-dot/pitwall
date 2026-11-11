// WebSocket client with auto-reconnect; mirrors the server's channel protocol.
import { useEffect, useRef, useState } from 'react';
import type { NormalisedFrame, AdapterEvent } from '../../src/core/types.ts';
import type { StatusSnapshot } from '../../src/core/bus.ts';
import type { AnalysisPayload } from './Analysis.tsx';
import type { SpokenCall } from '../../src/radio/radio.ts';
import type { VoiceEvent, CalibrationResult } from '../../src/voice/voice.ts';

export interface LapRow { lapNumber: number; timeMs: number; valid: boolean | null; t: number }

export interface Live {
  connected: boolean;
  status: StatusSnapshot | null;
  frame: NormalisedFrame | null;
  laps: LapRow[];
  log: string[];
  history: { t: number; speed: number; throttle: number; brake: number }[];
  analysis: AnalysisPayload | null;
  radio: SpokenCall[];
  audio: { id: number; wavBase64: string; durationS: number } | null;
  lastAnswer: string | null;
  /** latest hands-free voice event (state, partial transcript) and the last addressed utterance with its answer */
  voice: VoiceEvent | null;
  /** progress and result of teaching the engineer's name (kept apart from `voice`, which is replaced by mic-level events) */
  calibration: { count: number; want: number; heard: string[]; done?: CalibrationResult } | null;
  heard: { text: string; intent: string | null; answer?: string; at: number } | null;
  sendBinary: (buf: ArrayBuffer) => void;
  send: (cmd: string, args?: Record<string, unknown>) => void;
}

export function useLive(): Live {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [frame, setFrame] = useState<NormalisedFrame | null>(null);
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [radio, setRadio] = useState<SpokenCall[]>([]);
  const [audio, setAudio] = useState<Live['audio']>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceEvent | null>(null);
  const [calibration, setCalibration] = useState<Live['calibration']>(null);
  const [heard, setHeard] = useState<Live['heard']>(null);
  const history = useRef<Live['history']>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    const connect = () => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => { setConnected(true); retry = 0; };
      sock.onclose = () => { setConnected(false); if (!closed) setTimeout(connect, Math.min(5000, 500 * 2 ** retry++)); };
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as { ch: string; payload: unknown };
        if (m.ch === 'status') setStatus(m.payload as StatusSnapshot);
        else if (m.ch === 'telemetry') {
          const f = m.payload as NormalisedFrame;
          setFrame(f);
          const h = history.current;
          h.push({ t: f.t, speed: f.speed ?? 0, throttle: f.input.throttle ?? 0, brake: f.input.brake ?? 0 });
          if (h.length > 600) h.splice(0, h.length - 600); // 30 s at 20 Hz
        } else if (m.ch === 'event') {
          const e = m.payload as AdapterEvent;
          if (e.type === 'lap.complete') setLaps((l) => [...l, { lapNumber: e.lapNumber, timeMs: e.timeMs, valid: e.valid, t: e.t }].slice(-50));
          // the server sends the track map again for the new session; the radio list stays so the driver can read what was said
          if (e.type === 'session.start') { setLaps([]); history.current = []; }
          setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${e.type}${'detail' in e ? ' ' + e.detail : ''}${'lapNumber' in e ? ` L${e.lapNumber} ${fmtTime(e.timeMs)}` : ''}`].slice(-100));
        } else if (m.ch === 'analysis') {
          setAnalysis(m.payload as AnalysisPayload);
        } else if (m.ch === 'radio') {
          const c = m.payload as SpokenCall;
          setRadio((r) => [...r, c].slice(-100));
          setLog((l) => [...l, `${new Date().toLocaleTimeString()}  radio: ${c.text}`].slice(-100));
        } else if (m.ch === 'voice') {
          const e = m.payload as VoiceEvent;
          setVoice(e);
          if (e.calibration) setCalibration(e.calibration);
          if (e.heard) setHeard({ text: e.heard, intent: e.intent ?? null, ...(e.answer ? { answer: e.answer } : {}), at: Date.now() });
        } else if (m.ch === 'reply') {
          const p = m.payload as { answer?: { text: string } };
          if (p?.answer) setLastAnswer(p.answer.text);
        } else if (m.ch === 'audio') {
          setAudio(m.payload as Live['audio']);
        } else if (m.ch === 'log') {
          const l = m.payload as { level: string; msg: string };
          setLog((x) => [...x, `${new Date().toLocaleTimeString()}  ${l.msg}`].slice(-100));
        }
      };
    };
    connect();
    return () => { closed = true; ws.current?.close(); };
  }, []);

  return {
    connected, status, frame, laps, log, history: history.current, analysis, radio, audio, lastAnswer, voice, heard, calibration,
    sendBinary: (buf) => { const s = ws.current; if (s && s.readyState === WebSocket.OPEN && s.bufferedAmount < 1_000_000) s.send(buf); },
    send: (cmd, args = {}) => ws.current?.send(JSON.stringify({ cmd, args })),
  };
}

export function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '--:--.---';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
