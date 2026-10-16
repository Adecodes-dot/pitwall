import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useLive, fmtTime, type Live } from './ws.ts';
import { AnalysisView } from './Analysis.tsx';
import { RadioView, useBrowserAudio, type Mode } from './Radio.tsx';
import { DebriefView } from './Debrief.tsx';
import { SetupWizard, SettingsView, useSettings } from './Setup.tsx';

type Tab = 'setup' | 'live' | 'radio' | 'analysis' | 'debrief' | 'settings' | 'log';
const TABS: Tab[] = ['setup', 'live', 'radio', 'analysis', 'debrief', 'settings', 'log'];
const tabFromHash = (): Tab | null => { const h = location.hash.replace('#', '') as Tab; return TABS.includes(h) ? h : null; };

export function App() {
  const live = useLive();
  const [tab, setTabState] = useState<Tab>(() => tabFromHash() ?? 'setup');
  const setTab = (t: Tab) => { setTabState(t); location.hash = t; };
  useEffect(() => { const on = () => { const t = tabFromHash(); if (t) setTabState(t); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const autoSwitched = useRef(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const browserAudio = useBrowserAudio(live, audioEnabled);
  const settings = useSettings();
  const units = settings.info?.settings.units ?? 'metric';
  // first run: stay on the wizard until it is finished
  useEffect(() => { if (settings.info && !settings.info.settings.firstRunDone && !tabFromHash()) setTabState('setup'); }, [settings.info?.settings.firstRunDone]);
  useEffect(() => {
    if (live.status?.receiving && !autoSwitched.current && !tabFromHash() && settings.info?.settings.firstRunDone) { autoSwitched.current = true; setTab('live'); }
  }, [live.status?.receiving]);
  return (
    <div className="app">
      <Strip live={live} />
      {live.radio.length > 0 && <div className="radio-line"><span className="dot" />{live.radio[live.radio.length - 1]!.text}</div>}
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
      </nav>
      {tab === 'setup' && <SetupWizard live={live} settings={settings} onDone={() => setTab('live')} />}
      {tab === 'settings' && <SettingsView settings={settings} />}
      {tab === 'live' && <LiveView live={live} units={units} />}
      {tab === 'radio' && <RadioView live={live} mode={mode} setMode={setMode} audio={{ ...browserAudio, enabled: audioEnabled, setEnabled: setAudioEnabled }} />}
      {tab === 'analysis' && <AnalysisView a={live.analysis} />}
      {tab === 'debrief' && <DebriefView live={live} />}
      {tab === 'log' && <main><div className="card"><h2>Events and log</h2><div className="log">{live.log.join('\n') || 'nothing yet'}</div></div></main>}
    </div>
  );
}

function Strip({ live }: { live: Live }) {
  const s = live.status;
  const light = !live.connected ? '' : s?.receiving ? 'on' : s?.game ? 'warn' : '';
  return (
    <header className="strip">
      <span className={`light ${light}`} title="receiving" />
      <strong>Pit Wall</strong>
      <span className="muted">{!live.connected ? 'connecting to companion…' : s?.receiving ? `${(s.game ?? '').toUpperCase()} · ${s.detail}` : s?.game ? s.detail : 'waiting for packets'}</span>
      <span className="spacer" />
      {s && <span className="muted num">{s.packetsPerSec} pkt/s · {s.framesPerSec} fps{s.lossPct > 0.5 ? ` · loss ${s.lossPct.toFixed(1)}%` : ''}</span>}
      {s?.mode && s.mode !== 'live' && <span className="chip">{s.mode}</span>}
    </header>
  );
}

function LiveView({ live, units }: { live: Live; units: 'metric' | 'imperial' }) {
  const f = live.frame;
  const kph = f?.speed != null ? Math.round(f.speed * (units === 'metric' ? 3.6 : 2.23694)) : null;
  const gear = f?.drivetrain.gear;
  const best = live.laps.filter((l) => l.timeMs > 0).reduce<number | null>((m, l) => (m === null || l.timeMs < m ? l.timeMs : m), null);
  return (
    <main className="live">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="big hero">{kph ?? '—'}</span><span className="unit">{units === 'metric' ? 'km/h' : 'mph'}</span></div>
          <div><span className="big hero">{gear == null ? '—' : gear === 0 ? 'N' : gear < 0 ? 'R' : gear}</span><span className="unit">gear</span></div>
          <div><span className="big" style={{ fontSize: 32 }}>{f?.drivetrain.rpm != null ? Math.round(f.drivetrain.rpm) : '—'}</span><span className="unit">rpm</span></div>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <Bar kind="throttle" v={f?.input.throttle ?? null} label="Throttle" />
          <Bar kind="brake" v={f?.input.brake ?? null} label="Brake" />
          <SteerBar v={f?.input.steer ?? null} unit={f?.game === 'gt7' ? 'wheel-rad' : 'normalised'} />
        </div>
      </div>
      <div className="card">
        <h2>Lap</h2>
        <div className="kv"><span>Lap</span><span className="num">{f?.lap.number ?? <span className="na">—</span>}{f?.lap.total ? <span className="muted"> / {f.lap.total}</span> : null}</span></div>
        <div className="kv"><span>Current</span><span className="num">{fmtTime(f?.lap.currentTimeMs)}</span></div>
        <div className="kv"><span>Last</span><span className="num">{fmtTime(f?.lap.lastTimeMs)}</span></div>
        <div className="kv"><span>Best (this session)</span><span className="num">{fmtTime(best ?? f?.lap.bestTimeMs)}</span></div>
        <div className="kv"><span>Lap distance</span><span className="num">{f?.lap.distance != null ? `${Math.round(f.lap.distance)} m` : <span className="na">not provided</span>}</span></div>
        <div className="kv"><span>Sector</span><span className="num">{f?.lap.sector != null ? f.lap.sector + 1 : <span className="na">not provided</span>}</span></div>
        <div className="kv"><span>Fuel</span><span className="num">{f?.fuel.level != null ? `${f.fuel.level.toFixed(1)}${f.fuel.lapsRemaining != null ? ` · ${f.fuel.lapsRemaining.toFixed(1)} laps` : ''}` : <span className="na">—</span>}</span></div>
        <div className="kv"><span>Tyres (surface °C)</span><span className="num">{f?.wheels.surfaceTemp ? f.wheels.surfaceTemp.map((x) => Math.round(x)).join(' ') : <span className="na">—</span>}</span></div>
        <div className="kv"><span>Track</span><span>{f?.race.trackId ?? <span className="na">{f?.game === 'gt7' ? 'learned later' : '—'}</span>}</span></div>
      </div>
      <div className="card wide">
        <h2>Last 30 s · speed, throttle, brake</h2>
        <Trace live={live} />
      </div>
      <div className="card wide">
        <h2>Laps</h2>
        {live.laps.length === 0 ? <span className="na">no completed laps yet</span> : (
          <table className="laps"><thead><tr><th>Lap</th><th>Time</th><th>Δ best</th><th>Valid</th></tr></thead>
            <tbody>{live.laps.map((l) => <tr key={l.lapNumber}><td>{l.lapNumber}</td><td className="num">{fmtTime(l.timeMs)}</td><td className={`num ${best !== null && l.timeMs - best > 0 ? 'delta-pos' : ''}`}>{best !== null && l.timeMs > 0 ? `+${((l.timeMs - best) / 1000).toFixed(3)}` : ''}</td><td>{l.valid === null ? <span className="na">n/a</span> : l.valid ? 'yes' : 'no'}</td></tr>)}</tbody></table>
        )}
      </div>
    </main>
  );
}

function Bar({ kind, v, label }: { kind: 'throttle' | 'brake'; v: number | null; label: string }) {
  return <div className={`bar ${kind}`}><i style={{ width: `${Math.round((v ?? 0) * 100)}%` }} /><label>{label} {v == null ? '—' : `${Math.round(v * 100)}%`}</label></div>;
}

function SteerBar({ v, unit }: { v: number | null; unit: 'normalised' | 'wheel-rad' }) {
  // GT7 gives the physical wheel angle in radians; show ±450° as full scale
  const norm = v == null ? 0 : unit === 'wheel-rad' ? Math.max(-1, Math.min(1, v / (Math.PI * 2.5))) : v;
  const text = v == null ? 'not provided' : unit === 'wheel-rad' ? `${Math.round((v * 180) / Math.PI)}°` : `${Math.round(v * 100)}%`;
  return <div className="bar steer"><i style={{ left: `calc(50% + ${(norm * 50).toFixed(1)}% - 2px)`, width: 4, background: 'var(--fg)' }} /><label>Steering {text}</label></div>;
}

function Trace({ live }: { live: Live }) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const opts: uPlot.Options = {
      width: el.clientWidth, height: 160,
      scales: { x: { time: false }, y: { range: [0, 1] }, kph: { range: (_u, _min, max) => [0, Math.max(100, Math.ceil((max || 0) / 50) * 50)] } },
      axes: [{ show: false }, { scale: 'kph', stroke: '#9aa3ad', grid: { stroke: '#262b33' }, ticks: { stroke: '#262b33' } }],
      series: [{}, { label: 'km/h', scale: 'kph', stroke: '#e8eaed', width: 2 }, { label: 'thr', stroke: '#2ecc71', width: 1 }, { label: 'brk', stroke: '#ff4d4f', width: 1 }],
      legend: { show: false }, cursor: { show: false },
    };
    plot.current = new uPlot(opts, [[0], [0], [0], [0]], el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: 160 }));
    ro.observe(el);
    const id = setInterval(() => {
      const h = live.history;
      if (!h.length) return;
      const t0 = h[0]!.t;
      plot.current?.setData([h.map((p) => (p.t - t0) / 1000), h.map((p) => p.speed * 3.6), h.map((p) => p.throttle), h.map((p) => p.brake)]);
    }, 100);
    return () => { clearInterval(id); ro.disconnect(); plot.current?.destroy(); };
  }, [live.history]);
  return <div className="trace" ref={ref} />;
}
