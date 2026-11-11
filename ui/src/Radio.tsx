import { useEffect, useRef, useState } from 'react';
import type { SpokenCall } from '../../src/radio/radio.ts';
import type { Live } from './ws.ts';
import type { MicState } from './mic.ts';
import { VoiceCard } from './Voice.tsx';

export type Mode = 'quiet' | 'normal' | 'coach';

/** Plays clips from the 'audio' channel through Web Audio and reports the device's output latency back. */
export function useBrowserAudio(live: Live, enabled: boolean): { unlocked: boolean; unlock: () => void; latencyMs: number | null } {
  const ctx = useRef<AudioContext | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [latencyMs, setLatency] = useState<number | null>(null);
  const lastId = useRef(0);
  const unlock = () => {
    if (!ctx.current) ctx.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    ctx.current.resume().then(() => {
      setUnlocked(true);
      const ol = (ctx.current as AudioContext & { outputLatency?: number }).outputLatency;
      const ms = Math.round(((ol ?? ctx.current!.baseLatency) || 0) * 1000);
      setLatency(ms); live.send('audio.latency', { ms });
    });
  };
  useEffect(() => {
    const clip = live.audio;
    if (!enabled || !clip || !ctx.current || clip.id === lastId.current) return;
    lastId.current = clip.id;
    const bytes = Uint8Array.from(atob(clip.wavBase64), (c) => c.charCodeAt(0));
    ctx.current.decodeAudioData(bytes.buffer.slice(0)).then((buf) => { const src = ctx.current!.createBufferSource(); src.buffer = buf; src.connect(ctx.current!.destination); src.start(); });
  }, [live.audio, enabled]);
  return { unlocked, unlock, latencyMs };
}

/** Typed questions (offline). Spoken questions go through the hands-free voice card instead. */
export function TypedAsk({ live }: { live: Live }) {
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  useEffect(() => { if (live.lastAnswer) setAnswer(live.lastAnswer); }, [live.lastAnswer]);
  const ask = (q: string) => { if (!q.trim()) return; setAnswer('…'); live.send('radio.ask', { text: q.trim() }); setText(''); };
  return (
    <div className="ptt">
      {answer && <div className="ptt-answer">{answer}</div>}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }} placeholder="Type a question: how's my fuel?" style={{ flex: 1, minWidth: 0 }} />
        <button onClick={() => ask(text)}>Ask</button>
      </div>
    </div>
  );
}

export function RadioView({ live, mode, setMode, audio, mic, voiceAvailable, wakeWord }: { wakeWord: string; live: Live; mode: Mode; setMode: (m: Mode) => void; mic: MicState; voiceAvailable: boolean; audio: ReturnType<typeof useBrowserAudio> & { enabled: boolean; setEnabled: (b: boolean) => void } }) {
  const calls = live.radio;
  return (
    <main className="live">
      <div className="card">
        <h2>Engineer</h2>
        <div className="row" style={{ gap: 8 }}>
          {(['quiet', 'normal', 'coach'] as Mode[]).map((m) => <button key={m} className={mode === m ? 'primary' : ''} onClick={() => { setMode(m); live.send('radio.mode', { mode: m }); }}>{m[0]!.toUpperCase() + m.slice(1)}</button>)}
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Quiet: flags and fuel only. Normal: up to two calls a lap. Coach: lap times and up to four calls a lap.</p>
      </div>
      <div className="card">
        <h2>Audio on this device</h2>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button className={audio.enabled && audio.unlocked ? 'primary' : ''} onClick={() => { audio.unlock(); audio.setEnabled(!audio.enabled || !audio.unlocked); }}>{audio.enabled && audio.unlocked ? 'Playing here' : 'Play calls here'}</button>
          <button onClick={() => live.send('radio.check')}>Radio check</button>
          <span className="muted" style={{ fontSize: 13 }}>{audio.latencyMs !== null ? `this device adds ~${audio.latencyMs} ms` : 'tap to allow audio'}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Lowest latency: a wired earbud from the laptop. Bluetooth adds 150–300 ms.</p>
      </div>
      <div className="card wide">
        <h2>Hands-free voice</h2>
        <VoiceCard live={live} mic={mic} available={voiceAvailable} wakeWord={wakeWord} />
      </div>
      <div className="card wide">
        <h2>Ask the engineer (typed)</h2>
        <TypedAsk live={live} />
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Answered from your data: fuel, tyres, where you are losing time, best lap, last lap, consistency, position, laps left, flags.</p>
      </div>
      <div className="card wide">
        <h2>Radio log</h2>
        {calls.length === 0 ? <span className="na">nothing said yet</span> : (
          <table className="laps"><thead><tr><th>Lap</th><th>Call</th><th>Why</th><th>Latency</th></tr></thead>
            <tbody>{[...calls].reverse().map((c, i) => (
              <tr key={i}><td className="num">{c.lap ?? '—'}</td><td style={{ textAlign: 'left', color: c.priority === 1 ? 'var(--bad)' : c.priority === 2 ? 'var(--warn)' : 'var(--fg)' }}>{c.text}</td><td className="muted" style={{ textAlign: 'left', fontSize: 12 }}>{c.reason}</td><td className="num">{c.priority === 1 ? `${Math.round(c.latencyMs)} ms` : '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </main>
  );
}

export type { SpokenCall };
