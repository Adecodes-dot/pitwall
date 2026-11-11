import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { Debrief, CornerDebrief } from '../../src/debrief/debrief.ts';
import { fmtTime, type Live } from './ws.ts';

const sgn = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(3)}`;

/** FP1, SQ2, Q3, Race … from the game's session type */
const sessionLabel = (t: string | null) => !t ? 'Session' : t.replace(/^practice(\d)$/, 'FP$1').replace(/^sprint-shootout(\d)$/, 'SQ$1').replace(/^q(\d)$/, 'Q$1').replace(/^race(\d?)$/, (_m: string, n: string) => (n ? `Race ${n}` : 'Race'));

export function DebriefView({ live }: { live: Live }) {
  const [d, setD] = useState<Debrief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lapCount = live.laps.length;
  useEffect(() => {
    fetch('/api/debrief').then((r) => r.json()).then((j) => { if (j.error) { setErr(j.error); setD(null); } else { setD(j as Debrief); setErr(null); } }).catch((e) => setErr(String(e)));
  }, [lapCount, live.analysis]);
  if (!d) return <main><div className="card"><h2>Debrief</h2><span className="na">{err ?? 'loading…'}</span></div></main>;
  const weekend = d.progress.filter((p) => p.laps > 0); // menus between sessions also open a session row, with no laps
  return (
    <main className="live">
      <div className="card wide">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Debrief · {d.trackName ?? d.trackId ?? 'session'} · {d.laps} laps{d.previousSession ? ' · last session' : ''}</h2>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn" href="/api/debrief.html" download>Export HTML</a>
            <a className="btn" href="/api/debrief" download={`pitwall-debrief.json`}>JSON</a>
          </div>
        </div>
        {d.previousSession && <p className="muted" style={{ margin: '10px 0 0' }}>This session has no completed lap yet, so this is the session before it.</p>}
        <p style={{ margin: '10px 0 0', lineHeight: 1.5 }}>{d.summary}</p>
      </div>
      <div className="card"><h2>Best lap</h2><div className="big">{fmtTime(d.bestMs)}</div><div className="muted">lap {d.bestLap ?? '—'}{d.allTimeBestMs ? ` · all-time ${fmtTime(d.allTimeBestMs)}` : ''}</div></div>
      <div className="card"><h2>Theoretical best</h2><div className="big">{fmtTime(d.theoreticalMs)}</div><div className="muted">{d.theoreticalMs && d.bestMs ? `${sgn(d.theoreticalMs - d.bestMs)} vs best` : ''}</div></div>
      <div className="card"><h2>Consistency</h2><div className="big">{d.consistencyScore !== null ? Math.round(d.consistencyScore) : '—'}<span className="unit">/ 100</span></div><div className="muted">{d.mistakes.lockups} lockups · {d.mistakes.wheelspins} wheelspins</div></div>
      <div className="card"><h2>Assists</h2><div className="kv"><span>Traction control</span><span>{d.assists.tc === null ? <span className="na">unknown</span> : ['off', 'medium', 'full'][d.assists.tc]}</span></div><div className="kv"><span>ABS</span><span>{d.assists.abs === null ? <span className="na">unknown</span> : d.assists.abs ? 'on' : 'off'}</span></div></div>
      {d.topCorners.map((c, i) => <CornerCard key={c.corner.index} c={c} rank={i + 1} />)}
      {d.drill && <div className="card wide" style={{ borderColor: 'var(--info)' }}><h2>Next session plan</h2><div style={{ fontSize: 20, margin: '4px 0 6px' }}>{d.drill.text}</div><div className="muted">Target: {d.drill.target}.</div></div>}
      {weekend.length > 0 && (
        <div className="card wide"><h2>Sessions on this track</h2>
          <table className="laps"><thead><tr><th>Session</th><th>Best</th><th>Theoretical</th><th>Consistency</th><th>Laps</th></tr></thead>
            <tbody>{weekend.map((p) => <tr key={p.session}><td>{sessionLabel(p.sessionType)} · {new Date(p.startedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td><td className="num">{fmtTime(p.bestMs)}</td><td className="num">{fmtTime(p.theoreticalMs)}</td><td className="num">{p.consistency !== null ? Math.round(p.consistency) : '—'}</td><td className="num">{p.laps}</td></tr>)}</tbody></table>
        </div>
      )}
    </main>
  );
}

function CornerCard({ c, rank }: { c: CornerDebrief; rank: number }) {
  return (
    <div className="card wide">
      <h2>#{rank} · {c.corner.name} · {c.corner.direction} · lost {(c.lostMs / 1000).toFixed(2)} s this session · worst lap {c.worstLap} ({sgn(c.worstLapDeltaMs)})</h2>
      <div style={{ fontSize: 20, margin: '2px 0 4px' }}>{c.diagnosis.text}</div>
      <div className="muted" style={{ fontSize: 13 }}>{c.diagnosis.reason} · lap {c.worstLap}: brake {c.metrics.lap.brakePointM !== null ? `${Math.round(c.metrics.lap.brakePointM)} m` : '—'}, min {Math.round(c.metrics.lap.minSpeed * 3.6)} km/h · best: brake {c.metrics.best.brakePointM !== null ? `${Math.round(c.metrics.best.brakePointM)} m` : '—'}, min {Math.round(c.metrics.best.minSpeed * 3.6)} km/h</div>
      <Overlay c={c} kind="speed" />
      <Overlay c={c} kind="pedals" />
    </div>
  );
}

function Overlay({ c, kind }: { c: CornerDebrief; kind: 'speed' | 'pedals' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const x = c.traces.lap.s;
    const entry = c.corner.sStart - c.windowS0, apex = c.corner.sApex - c.windowS0;
    const series: uPlot.Series[] = kind === 'speed'
      ? [{}, { label: `lap ${c.worstLap}`, stroke: '#e8eaed', width: 2 }, { label: 'best', stroke: '#4da3ff', width: 2, dash: [6, 4] }]
      : [{}, { label: 'throttle', stroke: '#2ecc71', width: 1.5 }, { label: 'throttle best', stroke: '#2ecc71', width: 1, dash: [4, 3] }, { label: 'brake', stroke: '#ff4d4f', width: 1.5 }, { label: 'brake best', stroke: '#ff4d4f', width: 1, dash: [4, 3] }];
    const data: uPlot.AlignedData = kind === 'speed'
      ? [x, c.traces.lap.speed.map((v) => v * 3.6), c.traces.ref.speed.map((v) => v * 3.6)]
      : [x, c.traces.lap.throttle, c.traces.ref.throttle, c.traces.lap.brake, c.traces.ref.brake];
    const plot = new uPlot({
      width: el.clientWidth, height: kind === 'speed' ? 170 : 110,
      scales: { x: { time: false }, y: kind === 'pedals' ? { range: [0, 1] } : {} },
      axes: [{ stroke: '#5f6873', grid: { stroke: '#262b33' }, label: 'm from window start', labelSize: 14, labelFont: '11px Inter' }, { stroke: '#9aa3ad', grid: { stroke: '#262b33' }, size: 44 }],
      series, legend: { show: true, live: false }, cursor: { show: false },
      hooks: { draw: [(u) => { const ctx = u.ctx; ctx.save(); for (const [sx, col] of [[entry, '#5f6873'], [apex, '#4da3ff']] as const) { const px = u.valToPos(sx, 'x', true); ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, u.bbox.top); ctx.lineTo(px, u.bbox.top + u.bbox.height); ctx.stroke(); } ctx.restore(); }] },
    }, data, el);
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: kind === 'speed' ? 170 : 110 }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.destroy(); };
  }, [c, kind]);
  return <div ref={ref} style={{ width: '100%', marginTop: 8 }} />;
}
