import type { Live } from './ws.ts';
import type { MicState } from './mic.ts';

/** Hands-free voice: mic switch, live level, what it is hearing, what it understood. Used on the Radio tab and in the wizard. */
export function VoiceCard({ live, mic, wakeWord = 'engineer', available = true }: { live: Live; mic: MicState; wakeWord?: string; available?: boolean }) {
  const v = live.voice, h = live.heard;
  const fresh = h && Date.now() - h.at < 20000;
  return (
    <div className="voice">
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={mic.on ? 'primary' : ''} onClick={() => (mic.on ? mic.stop() : void mic.start())} disabled={!available}>{mic.on ? 'Microphone on' : 'Turn on microphone'}</button>
        <div className="bar mic-bar" style={{ flex: 1, minWidth: 80 }}><i style={{ width: `${Math.round((mic.on ? mic.level : 0) * 100)}%`, background: 'var(--radio)' }} /></div>
        <span className={`light ${mic.on && v?.state === 'listening' ? 'on' : mic.on ? 'warn' : ''}`} title={v?.state ?? 'off'} />
      </div>
      {!available && <p className="muted" style={{ fontSize: 13 }}>The speech model is not installed. Run <span className="chip">npm run voice:get</span> and restart.</p>}
      {mic.error && <p style={{ color: 'var(--bad)', fontSize: 13 }}>{mic.error}</p>}
      {mic.on && (
        <div style={{ marginTop: 10, minHeight: 44 }}>
          {v?.partial ? <div className="muted">hearing: <span style={{ color: 'var(--fg)' }}>{v.partial}</span></div> : <div className="muted">Say “{wakeWord}, how's my fuel?”</div>}
          {fresh && <div style={{ marginTop: 4 }}>You: <b>{h.text}</b>{h.answer ? <> → Engineer: <span style={{ color: 'var(--radio)' }}>{h.answer}</span></> : null}</div>}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
        No fixed commands: say the wake word, then ask naturally (“how are my tyres”, “where am I losing time”, “how many laps to go”). Right after an answer you can follow up without the wake word. “{wakeWord}, talk less”, “more feedback”, “say that again” and “mute” work too. Everything is understood on this laptop, offline; audio is not stored.
      </p>
    </div>
  );
}
