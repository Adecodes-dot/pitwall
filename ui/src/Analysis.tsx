import type { AnalysisUpdate } from '../../src/analysis/session.ts';
import { fmtTime } from './ws.ts';

export type AnalysisPayload = AnalysisUpdate & { svg: string | null };

const sgn = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(3)}`;

export function AnalysisView({ a }: { a: AnalysisPayload | null }) {
  if (!a) return <main><div className="card"><h2>Analysis</h2><span className="na">Complete one lap and the track model appears here.</span></div></main>;
  const fp = a.fingerprint;
  const last = a.laps[a.laps.length - 1];
  return (
    <main className="live">
      <div className="card">
        <h2>Track · {a.trackName ?? a.trackId ?? 'unnamed'} · {a.trackLength ? `${a.trackLength} m` : ''} · {a.corners.length} corners</h2>
        {a.svg ? <div className="map" dangerouslySetInnerHTML={{ __html: a.svg }} /> : <span className="na">no map yet</span>}
      </div>
      <div className="card">
        <h2>References</h2>
        <div className="kv"><span>Personal best</span><span className="num">{fmtTime(a.pbMs)}{a.pbLap ? <span className="muted"> L{a.pbLap}</span> : null}</span></div>
        <div className="kv"><span>All-time best here</span><span className="num">{fmtTime(a.allTimeBestMs)}</span></div>
        <div className="kv"><span>Theoretical best</span><span className="num">{fmtTime(a.theoreticalMs)}{a.theoreticalMs && a.pbMs ? <span className="muted"> ({sgn(a.theoreticalMs - a.pbMs)})</span> : null}</span></div>
        <div className="kv"><span>Consistency</span><span className="num">{fp?.consistencyScore != null ? `${fp.consistencyScore.toFixed(0)} / 100` : <span className="na">—</span>}</span></div>
        <div className="kv"><span>Laps analysed</span><span className="num">{fp?.lapsAnalysed ?? 0}</span></div>
        <div className="kv"><span>Lockups / wheelspin</span><span className="num">{fp ? `${fp.mistakes.filter((m) => m.kind === 'lockup').length} / ${fp.mistakes.filter((m) => m.kind === 'wheelspin').length}` : '—'}</span></div>
        {a.worstCorners.length > 0 && <div className="kv"><span>Losing most (last lap)</span><span className="num delta-pos">{a.worstCorners.map((c) => `T${c.corner} ${sgn(c.deltaMs)}`).join('  ')}</span></div>}
      </div>
      <div className="card wide">
        <h2>Corners · last lap {last ? `L${last.number}` : ''} vs personal best</h2>
        <div className="scroll-x">
        <table className="laps">
          <thead><tr><th>Corner</th><th>Δ PB</th><th>Brake pt</th><th>Min speed</th><th>Throttle pick-up</th><th>Coast</th><th>Best lap brake pt</th><th>Mistakes</th></tr></thead>
          <tbody>
            {a.corners.map((c) => {
              const m = last?.corners.find((x) => x.corner === c.index);
              const d = a.lastLapDeltas.find((x) => x.kind === 'corner' && x.label === c.name);
              const st = fp?.corners.find((x) => x.corner === c.index);
              return (
                <tr key={c.index}>
                  <td>{c.name} <span className="muted">{c.direction === 'left' ? '↰' : '↱'} R{Math.round(c.minRadius)}</span></td>
                  <td className={`num ${d ? (d.deltaMs > 0 ? 'delta-pos' : 'delta-neg') : ''}`}>{d ? sgn(d.deltaMs) : '—'}</td>
                  <td className="num">{m?.brakePointM != null ? `${Math.round(m.brakePointM)} m` : <span className="na">—</span>}</td>
                  <td className="num">{m ? `${Math.round(m.minSpeed * 3.6)} km/h` : '—'}</td>
                  <td className="num">{m?.throttlePickupM != null ? `${m.throttlePickupM >= 0 ? '+' : ''}${Math.round(m.throttlePickupM)} m` : <span className="na">—</span>}</td>
                  <td className="num">{m ? `${m.coastingM} m` : '—'}</td>
                  <td className="num">{st?.best.brakePointM != null ? `${Math.round(st.best.brakePointM)} m` : <span className="na">—</span>}</td>
                  <td className="num">{st ? `${st.lockups}L ${st.wheelspins}W` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </main>
  );
}
