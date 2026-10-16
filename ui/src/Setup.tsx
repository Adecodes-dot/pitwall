import { useEffect, useState } from 'react';
import type { Live } from './ws.ts';
import type { Settings } from '../../src/server/settings.ts';

type Step = 'game' | 'ingame' | 'receive' | 'audio' | 'assists' | 'done';
const ORDER: Step[] = ['game', 'ingame', 'receive', 'audio', 'assists', 'done'];

export interface SettingsInfo { settings: Settings; restartNeeded: boolean; voices: string[]; llmCredentials: boolean; ttsLoaded: boolean; deviceSink: boolean; version: string; logsDir: string; dbPath: string }

export function useSettings(): { info: SettingsInfo | null; update: (patch: Partial<Settings>) => Promise<void>; reload: () => void } {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const reload = () => { fetch('/api/settings').then((r) => r.json()).then(setInfo).catch(() => undefined); };
  useEffect(reload, []);
  const update = async (patch: Partial<Settings>) => {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then((x) => x.json());
    setInfo((i) => (i ? { ...i, settings: r.settings, restartNeeded: r.restartNeeded } : i));
  };
  return { info, update, reload };
}

/** First-run wizard. Also reachable any time from the Setup tab. */
export function SetupWizard({ live, settings, onDone }: { live: Live; settings: ReturnType<typeof useSettings>; onDone: () => void }) {
  const s = settings.info?.settings;
  const [step, setStep] = useState<Step>('game');
  const [game, setGame] = useState<'f1' | 'gt7' | null>(s?.game ?? null);
  useEffect(() => { if (!game && live.status?.game) setGame(live.status.game); }, [live.status?.game]);
  const [heard, setHeard] = useState<boolean | null>(null);
  const ip = live.status?.lanIp ?? '…';
  const receiving = Boolean(live.status?.receiving);
  const detected = live.status?.game ?? null;
  useEffect(() => { if (step === 'receive' && receiving) { const t = setTimeout(() => setStep('audio'), 1500); return () => clearTimeout(t); } return undefined; }, [step, receiving]);
  const i = ORDER.indexOf(step);
  const next = () => setStep(ORDER[Math.min(ORDER.length - 1, i + 1)]!);
  const back = () => setStep(ORDER[Math.max(0, i - 1)]!);
  const Nav = (p: { nextLabel?: string; canNext?: boolean }) => <WizardNav back={back} next={next} first={i === 0} nextLabel={p.nextLabel} canNext={p.canNext} />;
  return (
    <main className="setup">
      <div className="steps">{ORDER.slice(0, -1).map((st, k) => <span key={st} className={`step ${k < i ? 'done' : k === i ? 'cur' : ''}`}>{k + 1}</span>)}</div>
      {step === 'game' && (
        <div className="card">
          <h2>Step 1 · Which game?</h2>
          <div className="grid2">
            {(['f1', 'gt7'] as const).map((g) => <button key={g} className={game === g ? 'primary' : ''} style={{ minHeight: 72, fontSize: 18 }} onClick={() => { setGame(g); settings.update({ game: g }); }}>{g === 'f1' ? 'EA SPORTS F1 25' : 'Gran Turismo 7'}{detected === g ? ' · detected' : ''}</button>)}
          </div>
          <p className="muted">{detected ? `${detected.toUpperCase()} packets are already arriving.` : 'Both run on PS5. Pit Wall detects the game from its packets; this only chooses which instructions to show.'}</p>
          <Nav canNext={game !== null} />
        </div>
      )}
      {step === 'ingame' && (
        <div className="card">
          <h2>Step 2 · {game === 'f1' ? 'Set these in F1 25' : 'Nothing to change in GT7'}</h2>
          {game === 'f1' && <div className="row" style={{ marginBottom: 10 }}><span className="muted">Laptop address on your home network:</span><span className="chip" style={{ fontSize: 18 }}>{ip}</span></div>}
          {game === 'f1' ? (
            <ol>
              <li>On the PS5: <b>Settings → Telemetry Settings</b></li>
              <li>UDP Telemetry: <b>On</b></li>
              <li>UDP Broadcast Mode: <b>Off</b></li>
              <li>UDP IP Address: <span className="chip">{ip}</span></li>
              <li>UDP Port: <span className="chip">20777</span></li>
              <li>UDP Send Rate: <b>60 Hz</b></li>
              <li>UDP Format: <b>2026</b> if you have the 2026 Season Pack, otherwise <b>2025</b></li>
            </ol>
          ) : (
            <ol>
              <li>PS5 and this laptop on the same Wi-Fi or router.</li>
              <li>Start any race, time trial or licence test. GT7 answers Pit Wall's request automatically.</li>
              <li>Only one telemetry app at a time: close other GT7 dashboards on the network.</li>
            </ol>
          )}
          <p className="muted">Phone dashboard: open <span className="chip">http://{ip}:8787</span> on your phone (same Wi-Fi) and add it to the home screen.</p>
          <p className="muted">If Windows asks about the firewall, allow <b>Node.js</b> (or Pit Wall) on <b>Private</b> networks. Missed it? Windows Security → Firewall & network protection → Allow an app.</p>
          <Nav nextLabel="Drive out, then Next" />
        </div>
      )}
      {step === 'receive' && (
        <div className="card">
          <h2>Step 3 · Waiting for the game</h2>
          <div className="row" style={{ alignItems: 'center', gap: 14 }}>
            <span className={`light big-light ${receiving ? 'on' : ''}`} />
            <div>
              <div style={{ fontSize: 20 }}>{receiving ? `Receiving ${detected?.toUpperCase()} · ${live.status?.packetsPerSec} packets/s` : 'No packets yet'}</div>
              <div className="muted">{receiving ? 'Moving on…' : game === 'f1' ? 'Leave the garage. Check the IP and port on the PS5 match the chip above.' : 'Start a session on the PS5. Give it ten seconds.'}</div>
            </div>
          </div>
          {!receiving && <details style={{ marginTop: 12 }}><summary className="muted">Still nothing after a minute?</summary><ul className="muted"><li>Same network? Phones on guest Wi-Fi cannot see the PS5.</li><li>Firewall: allow Node.js on private networks, then restart Pit Wall.</li><li>F1: Broadcast Mode Off and the exact IP; a VPN on the laptop changes the address.</li><li>GT7: only one telemetry app at a time.</li></ul></details>}
          <Nav nextLabel="Skip for now" />
        </div>
      )}
      {step === 'audio' && (
        <div className="card">
          <h2>Step 4 · Hearing the engineer</h2>
          <p>The game owns your headset. Plug a cheap wired earbud into the laptop and wear it under the headset, or play through the laptop speakers. Bluetooth works but speaks 150–300 ms late.</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={() => { live.send('radio.check'); setHeard(null); }}>Play a radio check</button>
            <button onClick={() => setHeard(true)} className={heard === true ? 'primary' : ''}>I heard it</button>
            <button onClick={() => setHeard(false)} className={heard === false ? 'primary' : ''}>Nothing</button>
          </div>
          {heard === false && <p className="muted">Check the laptop's output device and volume. You can also enable "Play calls here" on the Radio tab to use this phone or browser instead.</p>}
          <Nav />
        </div>
      )}
      {step === 'assists' && (
        <div className="card">
          <h2>Step 5 · Assists</h2>
          {game === 'f1' ? <p>F1 25 sends your assist settings; nothing to enter. Coaching adapts automatically (ABS on: no "locking" calls; traction control on: throttle timing, not modulation).</p> : (
            <>
              <p className="muted">GT7 does not send assist levels. Set what you use so the coaching matches.</p>
              <div className="kv"><span>Traction control (TCS)</span><span className="row" style={{ gap: 6 }}>{[0, 1, 2, 3, 4, 5].map((n) => <button key={n} className={s?.gt7Assists.tcs === n ? 'primary' : ''} onClick={() => settings.update({ gt7Assists: { ...s!.gt7Assists, tcs: n } })} style={{ minWidth: 44, padding: '6px 10px' }}>{n}</button>)}</span></div>
              <div className="kv"><span>ASM (stability)</span><span className="row" style={{ gap: 6 }}>{[['on', true], ['off', false]].map(([l, val]) => <button key={String(l)} className={s?.gt7Assists.asm === val ? 'primary' : ''} onClick={() => settings.update({ gt7Assists: { ...s!.gt7Assists, asm: val as boolean } })}>{l as string}</button>)}</span></div>
              <div className="kv"><span>ABS</span><span className="row" style={{ gap: 6 }}>{(['off', 'weak', 'default', 'strong'] as const).map((l) => <button key={l} className={s?.gt7Assists.abs === l ? 'primary' : ''} onClick={() => settings.update({ gt7Assists: { ...s!.gt7Assists, abs: l } })}>{l}</button>)}</span></div>
              <div className="kv"><span>Countersteer assist</span><span className="row" style={{ gap: 6 }}>{[['on', true], ['off', false]].map(([l, val]) => <button key={String(l)} className={s?.gt7Assists.countersteer === val ? 'primary' : ''} onClick={() => settings.update({ gt7Assists: { ...s!.gt7Assists, countersteer: val as boolean } })}>{l as string}</button>)}</span></div>
            </>
          )}
          <Nav nextLabel="Finish" />
        </div>
      )}
      {step === 'done' && (
        <div className="card">
          <h2>You're set</h2>
          <p>The Live tab shows your data; the engineer talks after your first flying lap. Normal mode: up to two calls a lap. Change it on the Radio tab.</p>
          <button className="primary" onClick={() => { settings.update({ firstRunDone: true }); onDone(); }}>Go to Live</button>
        </div>
      )}
    </main>
  );
}

function WizardNav({ back, next, first, nextLabel = 'Next', canNext = true }: { back: () => void; next: () => void; first: boolean; nextLabel?: string | undefined; canNext?: boolean | undefined }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
      <button onClick={back} disabled={first}>Back</button>
      <button className="primary" onClick={next} disabled={!canNext}>{nextLabel}</button>
    </div>
  );
}

export function SettingsView({ settings }: { settings: ReturnType<typeof useSettings> }) {
  const info = settings.info;
  const [logs, setLogs] = useState<string[] | null>(null);
  if (!info) return <main><div className="card"><span className="na">loading settings…</span></div></main>;
  const s = info.settings;
  const Toggle = ({ k, label, hint }: { k: keyof Settings; label: string; hint?: string }) => (
    <div className="kv"><span>{label}{hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}</span><button className={s[k] ? 'primary' : ''} onClick={() => settings.update({ [k]: !s[k] } as Partial<Settings>)}>{s[k] ? 'On' : 'Off'}</button></div>
  );
  return (
    <main className="live">
      {info.restartNeeded && <div className="card wide" style={{ borderColor: 'var(--warn)' }}>Restart Pit Wall to apply audio, voice, GT7 format or cloud changes.</div>}
      <div className="card">
        <h2>Engineer</h2>
        <div className="kv"><span>Chattiness</span><span className="row" style={{ gap: 6 }}>{(['quiet', 'normal', 'coach'] as const).map((m) => <button key={m} className={s.mode === m ? 'primary' : ''} onClick={() => settings.update({ mode: m })}>{m}</button>)}</span></div>
        <Toggle k="muted" label="Mute the radio" />
        <div className="kv"><span>Voice</span><select value={s.voice} onChange={(e) => settings.update({ voice: e.target.value })}>{(info.voices.length ? info.voices : [s.voice]).map((v) => <option key={v} value={v}>{v.replace(/^vits-piper-/, '')}</option>)}</select></div>
        <Toggle k="llm" label="Cloud phrasing" hint={info.llmCredentials ? 'Rephrases coaching lines; never on the live safety path. Facts are checked before speaking.' : 'No API key found. Set ANTHROPIC_API_KEY and restart to enable.'} />
      </div>
      <div className="card">
        <h2>Audio</h2>
        <Toggle k="deviceAudio" label="Laptop speakers / headphone jack" hint={info.deviceSink ? 'Active' : 'Not active in this run'} />
        <p className="muted" style={{ fontSize: 13 }}>Phones and other browsers can also play calls: Radio tab → "Play calls here".</p>
      </div>
      <div className="card">
        <h2>Games</h2>
        <div className="kv"><span>GT7 packet format<div className="muted" style={{ fontSize: 12 }}>~ adds steering and raw pedals; A is the original; C adds lap time (GT7 1.68+)</div></span><span className="row" style={{ gap: 6 }}>{(['A', 'B', '~', 'C'] as const).map((f) => <button key={f} className={s.gt7Format === f ? 'primary' : ''} onClick={() => settings.update({ gt7Format: f })}>{f}</button>)}</span></div>
        <div className="kv"><span>Units</span><span className="row" style={{ gap: 6 }}>{(['metric', 'imperial'] as const).map((u) => <button key={u} className={s.units === u ? 'primary' : ''} onClick={() => settings.update({ units: u })}>{u === 'metric' ? 'km/h, m' : 'mph, ft'}</button>)}</span></div>
      </div>
      <div className="card">
        <h2>Data</h2>
        <Toggle k="recordSessions" label="Record every live session" hint="Writes .pwcap files to the captures folder (GT7 ≈ 2 MB/min, F1 ≈ 30 MB/min)" />
        <Toggle k="crashLogs" label="Crash and session logs" hint={info.logsDir} />
        <div className="kv"><span>Database</span><span className="muted" style={{ fontSize: 12 }}>{info.dbPath}</span></div>
        <div className="kv"><span>Version</span><span className="num">{info.version}</span></div>
        <button onClick={() => fetch('/api/logs').then((r) => r.json()).then((j) => setLogs(j.lines))}>Show recent log</button>
        {logs && <div className="log" style={{ marginTop: 8 }}>{logs.join('\n')}</div>}
      </div>
    </main>
  );
}
