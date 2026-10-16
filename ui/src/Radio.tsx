import { useEffect, useRef, useState } from 'react';
import type { SpokenCall } from '../../src/radio/radio.ts';
import type { Live } from './ws.ts';

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

/** Push-to-talk: speech recognition where the browser has it, a text box everywhere. Sends 'radio.ask'. */
export function PushToTalk({ live }: { live: Live }) {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  useEffect(() => { if (live.lastAnswer) setAnswer(live.lastAnswer); }, [live.lastAnswer]);
  const ask = (q: string) => { if (!q.trim()) return; setAnswer('…'); live.send('radio.ask', { text: q.trim() }); setText(''); };
  const listen = () => {
    if (!SR) return;
    const rec = new SR(); rec.lang = 'en-GB'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ''; setText(t); ask(t); };
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false);
    setListening(true); rec.start();
  };
  return (
    <div className="ptt">
      {answer && <div className="ptt-answer">{answer}</div>}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
        {SR && <button className={`ptt-btn ${listening ? 'on' : ''}`} onClick={listen} aria-label="Push to talk">{listening ? 'Listening…' : 'Push to talk'}</button>}
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }} placeholder={SR ? "or type: how's my fuel?" : "Ask: how's my fuel? where am I losing time?"} style={{ flex: 1, minWidth: 0 }} />
        <button onClick={() => ask(text)}>Ask</button>
      </div>
    </div>
  );
}

interface SpeechRecognitionLike { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void }

export function RadioView({ live, mode, setMode, audio }: { live: Live; mode: Mode; setMode: (m: Mode) => void; audio: ReturnType<typeof useBrowserAudio> & { enabled: boolean; setEnabled: (b: boolean) => void } }) {
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
        <h2>Ask the engineer</h2>
        <PushToTalk live={live} />
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
