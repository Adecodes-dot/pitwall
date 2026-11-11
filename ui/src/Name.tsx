import { useEffect, useRef, useState } from 'react';
import { normalise } from '../../src/voice/intent.ts';
import type { Live } from './ws.ts';
import type { MicState } from './mic.ts';
import type { useSettings } from './Setup.tsx';

const EXAMPLES = ['Engineer', 'Bono', 'GP', 'Will Joseph', 'Mac'];

/** How steady the name was heard: fewer distinct spellings = steadier wake word. */
function rating(heard: string[]): { label: string; tone: 'ok' | 'warn' | 'bad'; text: string } {
  const distinct = new Set(heard.map((h) => normalise(h).join(' '))).size;
  if (heard.length < 3) return { label: 'not enough samples', tone: 'warn', text: 'Say the name at least three times.' };
  if (distinct <= 2) return { label: 'steady', tone: 'ok', text: 'It hears this name the same way almost every time.' };
  if (distinct === 3) return { label: 'usable', tone: 'warn', text: 'It hears this name a few different ways. Learned, but expect the odd miss.' };
  return { label: 'unsteady', tone: 'bad', text: 'It hears this name many different ways, so misses and false triggers are likelier. A longer or more distinctive name (two or three syllables) will be steadier.' };
}

export function NameCard({ live, settings, mic }: { live: Live; settings: ReturnType<typeof useSettings>; mic: MicState }) {
  const s = settings.info?.settings;
  const saved = s?.engineerName ?? 'engineer';
  const [name, setName] = useState(saved);
  const [teaching, setTeaching] = useState(false);
  const stopped = useRef(false);
  const cal = live.calibration;
  useEffect(() => { setName(saved); }, [saved]);

  const short = normalise(name).join('').length < 4;
  const save = async (n: string) => { const v = n.trim(); if (v && v.toLowerCase() !== saved.toLowerCase()) await settings.update({ engineerName: v, wakeAliases: [] }); };
  const teach = () => { stopped.current = false; setTeaching(true); live.send('voice.calibrate', { on: true, want: 5 }); };
  const finish = () => { if (stopped.current) return; stopped.current = true; setTeaching(false); live.send('voice.calibrate', { on: false }); setTimeout(settings.reload, 400); };
  useEffect(() => { if (teaching && cal && !cal.done && cal.count >= cal.want) finish(); }, [cal?.count, teaching]);

  const done = cal?.done;
  const r = done ? rating(cal!.heard) : null;
  return (
    <div className="name-card">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted">My engineer's name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void save(name)} onKeyDown={(e) => { if (e.key === 'Enter') void save(name); }} style={{ width: 170 }} aria-label="Engineer's name" />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {EXAMPLES.map((e) => <button key={e} style={{ padding: '4px 10px', minHeight: 32, fontSize: 13 }} className={saved.toLowerCase() === e.toLowerCase() ? 'primary' : ''} onClick={() => { setName(e); void save(e); }}>{e}</button>)}
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '8px 0' }}>
        Pick what you would call your race engineer. Two or three syllables are heard best (Bono, Will Joseph). One or two letters (GP) and everyday words are easy to mishear or trigger by accident.
        {short ? <span style={{ color: 'var(--warn)' }}> “{name}” is very short: teach it below and check the result.</span> : null}
      </p>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="primary" onClick={teaching ? finish : teach} disabled={!mic.on}>{teaching ? 'Finish' : 'Teach it my name'}</button>
        {!mic.on && <span className="muted" style={{ fontSize: 13 }}>Turn the microphone on first.</span>}
      </div>
      {teaching && cal && (
        <div style={{ marginTop: 10 }}>
          <div>Say “<b>{saved}</b>” on its own, {cal.want} times, with a short pause each time.</div>
          <div className="row" style={{ gap: 6, margin: '8px 0' }}>{Array.from({ length: cal.want }, (_, i) => <span key={i} className={`step ${i < cal.count ? 'done' : ''}`}>{i + 1}</span>)}</div>
          {cal.heard.length > 0 && <div className="muted" style={{ fontSize: 13 }}>it heard: {cal.heard.map((h) => `“${h}”`).join('  ')}</div>}
        </div>
      )}
      {!teaching && done && r && (
        <div style={{ marginTop: 10 }}>
          <div>Heard “{saved}” correctly <b>{done.matched}</b> of <b>{done.total}</b> times{done.aliases.length ? <>, and learned how it hears you otherwise: {done.aliases.map((a) => `“${a}”`).join(', ')}</> : null}.</div>
          <div style={{ color: r.tone === 'ok' ? 'var(--ok)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--bad)', marginTop: 4 }}>Reliability: {r.label}. {r.text}</div>
          {done.rejected > 0 && <div className="muted" style={{ fontSize: 13 }}>{done.rejected} sample{done.rejected > 1 ? 's were' : ' was'} too long (sentences); say just the name next time.</div>}
        </div>
      )}
      {(s?.wakeAliases.length ?? 0) > 0 && !teaching && !done && <p className="muted" style={{ fontSize: 13 }}>Also answers to: {s!.wakeAliases.map((a) => `“${a}”`).join(', ')}</p>}
    </div>
  );
}
