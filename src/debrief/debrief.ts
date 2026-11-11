// Post-session debrief: summary, the three corners costing the most time with trace overlays and one
// instruction each, a next-session drill, and progress over sessions. Pure functions over analysis state.
import type { SessionAnalyser } from '../analysis/session.ts';
import type { Store } from '../analysis/store.ts';
import type { Corner } from '../analysis/track.ts';
import { cornerMetrics, personalBest, segmentDeltas, segments, type Lap, type CornerMetrics } from '../analysis/laps.ts';
import { diagnoseCorner, INCIDENT_MS, type Diagnosis } from '../radio/calls.ts';

export interface Trace { s: number[]; speed: number[]; throttle: number[]; brake: number[] }

export interface CornerDebrief {
  corner: Corner;
  /** time lost vs PB summed over every non-PB lap, ms */
  lostMs: number;
  /** the lap that lost most here */
  worstLap: number;
  worstLapDeltaMs: number;
  diagnosis: Diagnosis;
  metrics: { lap: CornerMetrics; best: CornerMetrics };
  traces: { lap: Trace; ref: Trace; deltaMs: number[] };
  windowS0: number; windowS1: number;
}

export interface Debrief {
  generatedAt: string;
  game: 'f1' | 'gt7' | null;
  trackId: string | null; trackName: string | null; trackLength: number | null; cornerCount: number;
  laps: number; validLaps: number;
  /** this is the session before the current one, which has no completed lap yet */
  previousSession: boolean;
  bestMs: number | null; bestLap: number | null; theoreticalMs: number | null; allTimeBestMs: number | null;
  consistencyScore: number | null; lapTimeStdMs: number | null;
  assists: { tc: number | null; abs: boolean | null };
  mistakes: { lockups: number; wheelspins: number };
  topCorners: CornerDebrief[];
  drill: { corner: number; text: string; target: string } | null;
  progress: { session: number; sessionType: string | null; startedAt: string; bestMs: number | null; theoreticalMs: number | null; consistency: number | null; laps: number }[];
  /** deterministic engineer summary (template); an LLM may rephrase it elsewhere */
  summary: string;
  lapTable: { number: number; timeMs: number; valid: boolean | null; deltaToPbMs: number | null }[];
}

const fmt = (ms: number | null) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`);
const sgn = (ms: number) => `${ms >= 0 ? '+' : '−'}${(Math.abs(ms) / 1000).toFixed(3)}`;

function trace(lap: Lap, s0: number, s1: number, L: number, step = 2): Trace {
  const ch = lap.ch!;
  const at = (a: Float32Array, s: number) => a[((Math.round(s) % L) + L) % L]!;
  const out: Trace = { s: [], speed: [], throttle: [], brake: [] };
  for (let s = s0; s <= s1; s += step) { out.s.push(s - s0); out.speed.push(at(ch.speed, s)); out.throttle.push(at(ch.throttle, s)); out.brake.push(at(ch.brake, s)); }
  return out;
}

export function buildDebrief(an: SessionAnalyser, store: Store | null): Debrief | null {
  // until the new session completes a lap, the debrief stays on the one before it
  const usePrevious = !an.collector.laps.some((l) => l.timeMs > 0) && an.previous !== null;
  const u = usePrevious ? an.previous!.update : an.lastUpdate, m = an.model;
  if (!u) return null;
  const laps = usePrevious ? an.previous!.laps : an.collector.laps;
  if (!laps.length) return null; // a known track but no lap yet: nothing to debrief
  const pb = personalBest(laps);
  const fp = u.fingerprint;
  const top: CornerDebrief[] = [];
  if (m && pb && fp) {
    const segs = segments(m);
    const L = m.length;
    // time lost per corner across laps, and the worst lap per corner
    const lost = new Map<number, { total: number; worstLap: number; worstDelta: number }>();
    for (const l of laps) {
      if (l === pb || !l.ch || l.rewound || l.valid === false) continue;
      for (const d of segmentDeltas(l, pb, segs)) {
        if (d.seg.kind !== 'corner' || d.deltaMs > INCIDENT_MS) continue; // a spin or off is not a technique to fix
        const idx = d.seg.corner!.index;
        const e = lost.get(idx) ?? { total: 0, worstLap: l.number, worstDelta: -Infinity };
        e.total += Math.max(0, d.deltaMs);
        if (d.deltaMs > e.worstDelta) { e.worstDelta = d.deltaMs; e.worstLap = l.number; }
        lost.set(idx, e);
      }
    }
    const ranked = [...lost.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 3);
    for (const [idx, e] of ranked) {
      const corner = m.corners.find((c) => c.index === idx)!;
      const worst = laps.find((l) => l.number === e.worstLap)!;
      const mLap = cornerMetrics(worst, corner, L), mBest = cornerMetrics(pb, corner, L);
      const st = fp.corners.find((c) => c.corner === idx);
      if (!mLap || !mBest || !st) continue;
      const lockedHere = fp.mistakes.some((x) => x.kind === 'lockup' && x.lap === worst.number && x.corner === idx);
      const spunHere = fp.mistakes.some((x) => x.kind === 'wheelspin' && x.lap === worst.number && x.corner === idx);
      const diagnosis = diagnoseCorner(idx, mLap, st.best, e.worstDelta, { lockedHere, spunHere }, fp.assists);
      const s0 = mLap.windowS0, s1 = mLap.windowS1;
      const tl = trace(worst, s0, s1, L), tr = trace(pb, s0, s1, L);
      const deltaMs: number[] = [];
      const tAt = (l: Lap, s: number) => { const ch = l.ch!; const i = ((Math.round(s) % L) + L) % L; return ch.t[i]!; };
      for (let s = s0; s <= s1; s += 2) deltaMs.push((tAt(worst, s) - tAt(worst, s0)) - (tAt(pb, s) - tAt(pb, s0)));
      top.push({ corner, lostMs: e.total, worstLap: e.worstLap, worstLapDeltaMs: e.worstDelta, diagnosis, metrics: { lap: mLap, best: st.best }, traces: { lap: tl, ref: tr, deltaMs }, windowS0: s0, windowS1: s1 });
    }
  }
  const first = top[0];
  const drill = first ? {
    corner: first.corner.index,
    text: `Ten laps, ${first.corner.name} only. ${first.diagnosis.text.replace(/^Turn \d+,? ?/, '').replace(/^\w/, (c) => c.toUpperCase())}`,
    target: targetFor(first),
  } : null;
  const validLaps = laps.filter((l) => l.valid !== false && l.timeMs > 0).length;
  const summary = pb
    ? `${laps.length} laps. Best ${fmt(pb.timeMs)} on lap ${pb.number}${u.theoreticalMs ? `, theoretical ${fmt(u.theoreticalMs)} (${sgn(u.theoreticalMs - pb.timeMs)})` : ''}. ` +
      (fp?.consistencyScore !== null && fp?.consistencyScore !== undefined ? `Consistency ${Math.round(fp.consistencyScore)} out of 100. ` : '') +
      (top.length ? `Most time lost at ${top.map((c) => `${c.corner.name} (${(c.lostMs / 1000).toFixed(1)} s)`).join(', ')}. ` : '') +
      (drill ? `Next session: ${drill.text}` : '')
    : `${laps.length} laps, no valid reference lap yet.`;
  return {
    generatedAt: new Date().toISOString(), game: laps[0] ? (an.model?.game ?? null) : null, previousSession: usePrevious,
    trackId: u.trackId, trackName: u.trackName, trackLength: u.trackLength, cornerCount: u.corners.length,
    laps: laps.length, validLaps,
    bestMs: pb?.timeMs ?? null, bestLap: pb?.number ?? null, theoreticalMs: u.theoreticalMs, allTimeBestMs: u.allTimeBestMs,
    consistencyScore: fp?.consistencyScore ?? null, lapTimeStdMs: fp?.lapTimeStdMs ?? null,
    assists: fp?.assists ? { tc: fp.assists.tc, abs: fp.assists.abs } : { tc: null, abs: null },
    mistakes: { lockups: fp?.mistakes.filter((x) => x.kind === 'lockup').length ?? 0, wheelspins: fp?.mistakes.filter((x) => x.kind === 'wheelspin').length ?? 0 },
    topCorners: top, drill,
    progress: m && store ? store.history(m.id) : [],
    summary,
    lapTable: u.laps.map((l) => ({ number: l.number, timeMs: l.timeMs, valid: l.valid, deltaToPbMs: l.deltaToPbMs })),
  };
}

/** Saves the debrief (called after every completed lap), so closing the app keeps it. Whatever buildDebrief shows is the
 *  newest session with laps: the one in progress, or the one before it from this run. */
export function saveDebrief(an: SessionAnalyser, store: Store | null): void {
  const d = store ? buildDebrief(an, store) : null;
  if (d) store!.saveDebrief(JSON.stringify(d));
}

/** The live debrief; after an app restart, until a lap is completed, the last one saved (with the sessions table as it is now). */
export function currentDebrief(an: SessionAnalyser, store: Store | null): Debrief | null {
  const live = buildDebrief(an, store);
  if (live || !store) return live;
  const json = store.lastDebrief();
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Debrief;
    return { ...d, previousSession: true, progress: d.trackId ? store.history(d.trackId) : d.progress };
  } catch { return null; } // a damaged row: show nothing rather than guess
}

function targetFor(c: CornerDebrief): string {
  const b = c.metrics.best;
  const parts: string[] = [];
  // the bend can begin before the braking point on a fast entry: then the brake point is measured into the bend
  if (b.brakePointM !== null) parts.push(b.brakePointM >= 0 ? `brake ${Math.round(b.brakePointM)} m before the turn` : `brake ${Math.round(-b.brakePointM)} m after the bend begins`);
  parts.push(`minimum ${Math.round(b.minSpeed * 3.6)} km/h`);
  if (b.throttlePickupM !== null) parts.push(`throttle ${b.throttlePickupM <= 0 ? Math.abs(Math.round(b.throttlePickupM)) + ' m before' : Math.round(b.throttlePickupM) + ' m after'} the apex`);
  return parts.join(', ');
}

/** Self-contained HTML export (inline SVG traces, no scripts, no external assets). */
export function debriefHtml(d: Debrief): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const svg = (c: CornerDebrief) => {
    const W = 560, H = 180, pad = 28;
    const n = c.traces.lap.s.length;
    const xs = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
    const vmax = Math.max(...c.traces.lap.speed, ...c.traces.ref.speed, 1);
    const line = (arr: number[], scale: (v: number) => number, color: string, w = 2, dash = '') => `<polyline fill="none" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''} points="${arr.map((v, i) => `${xs(i).toFixed(1)},${scale(v).toFixed(1)}`).join(' ')}"/>`;
    const ySpeed = (v: number) => pad + (1 - v / vmax) * (H - 2 * pad);
    const yPedal = (v: number) => H - pad - v * 40;
    const apexX = xs(Math.round((c.corner.sApex - c.windowS0) / 2));
    const entryX = xs(Math.round((c.corner.sStart - c.windowS0) / 2));
    return `<svg viewBox="0 0 ${W} ${H + 60}" width="100%" style="max-width:${W}px"><rect width="${W}" height="${H + 60}" fill="#0f1114" rx="8"/>
<line x1="${entryX.toFixed(1)}" y1="${pad}" x2="${entryX.toFixed(1)}" y2="${H - pad}" stroke="#262b33"/><line x1="${apexX.toFixed(1)}" y1="${pad}" x2="${apexX.toFixed(1)}" y2="${H - pad}" stroke="#4da3ff" stroke-dasharray="3 3"/>
${line(c.traces.ref.speed, ySpeed, '#4da3ff', 2, '5 4')}${line(c.traces.lap.speed, ySpeed, '#e8eaed', 2)}
<g transform="translate(0,${H})">${line(c.traces.ref.throttle, yPedal, '#2ecc71', 1, '4 3')}${line(c.traces.lap.throttle, yPedal, '#2ecc71', 1.5)}${line(c.traces.ref.brake, yPedal, '#ff4d4f', 1, '4 3')}${line(c.traces.lap.brake, yPedal, '#ff4d4f', 1.5)}</g>
<text x="${pad}" y="16" fill="#9aa3ad" font-size="11" font-family="sans-serif">speed · white = lap ${c.worstLap}, blue dashed = best lap · entry | apex</text>
<text x="${pad}" y="${H + 58}" fill="#9aa3ad" font-size="11" font-family="sans-serif">throttle (green) and brake (red), dashed = best lap · ${Math.round(c.windowS1 - c.windowS0)} m window</text></svg>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pit Wall debrief · ${esc(d.trackName ?? d.trackId ?? 'session')}</title>
<style>body{background:#0f1114;color:#e8eaed;font-family:Inter,system-ui,sans-serif;margin:0;padding:16px;max-width:900px;margin:0 auto}h1{font-size:22px;margin:8px 0}h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#9aa3ad;margin:18px 0 8px}.card{background:#171a1f;border:1px solid #262b33;border-radius:10px;padding:14px;margin-bottom:12px}.num{font-family:"JetBrains Mono",Consolas,monospace}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.big{font-size:28px;font-family:"JetBrains Mono",Consolas,monospace}.muted{color:#9aa3ad;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 4px;border-bottom:1px solid #262b33;text-align:right}td:first-child,th:first-child{text-align:left}.pos{color:#ff4d4f}.neg{color:#2ecc71}.instr{font-size:18px;margin:8px 0}</style></head><body>
<h1>Pit Wall debrief — ${esc(d.trackName ?? d.trackId ?? 'session')}</h1><div class="muted">${esc(new Date(d.generatedAt).toLocaleString())} · ${d.game?.toUpperCase() ?? ''} · ${d.laps} laps · ${d.cornerCount} corners · ${d.trackLength ?? '?'} m</div>
<div class="card"><p>${esc(d.summary)}</p></div>
<div class="grid"><div class="card"><h2>Best lap</h2><div class="big">${fmt(d.bestMs)}</div><div class="muted">lap ${d.bestLap ?? '—'}</div></div><div class="card"><h2>Theoretical best</h2><div class="big">${fmt(d.theoreticalMs)}</div><div class="muted">${d.theoreticalMs && d.bestMs ? sgn(d.theoreticalMs - d.bestMs) : ''}</div></div><div class="card"><h2>Consistency</h2><div class="big">${d.consistencyScore !== null ? Math.round(d.consistencyScore) : '—'}<span class="muted"> / 100</span></div></div><div class="card"><h2>Mistakes</h2><div class="big">${d.mistakes.lockups}<span class="muted"> lockups</span></div><div class="muted">${d.mistakes.wheelspins} wheelspins</div></div></div>
<h2>The three corners costing the most time</h2>
${d.topCorners.map((c, i) => `<div class="card"><div class="muted">#${i + 1} · ${esc(c.corner.name)} · ${c.corner.direction} · R ${Math.round(c.corner.minRadius)} m · lost ${(c.lostMs / 1000).toFixed(2)} s over the session, worst lap ${c.worstLap} (${sgn(c.worstLapDeltaMs)})</div><div class="instr">${esc(c.diagnosis.text)}</div><div class="muted">${esc(c.diagnosis.reason)} · this lap: brake ${c.metrics.lap.brakePointM !== null ? Math.round(c.metrics.lap.brakePointM) + ' m' : '—'}, min ${Math.round(c.metrics.lap.minSpeed * 3.6)} km/h · best: brake ${c.metrics.best.brakePointM !== null ? Math.round(c.metrics.best.brakePointM) + ' m' : '—'}, min ${Math.round(c.metrics.best.minSpeed * 3.6)} km/h</div>${svg(c)}</div>`).join('')}
${d.drill ? `<h2>Next session plan</h2><div class="card"><div class="instr">${esc(d.drill.text)}</div><div class="muted">Target: ${esc(d.drill.target)}.</div></div>` : ''}
<h2>Laps</h2><div class="card"><table><tr><th>Lap</th><th>Time</th><th>Δ best</th><th>Valid</th></tr>${d.lapTable.map((l) => `<tr><td>${l.number}</td><td class="num">${fmt(l.timeMs)}</td><td class="num ${l.deltaToPbMs && l.deltaToPbMs > 0 ? 'pos' : ''}">${l.deltaToPbMs !== null && l.timeMs > 0 ? sgn(l.deltaToPbMs) : ''}</td><td>${l.valid === null ? 'n/a' : l.valid ? 'yes' : 'no'}</td></tr>`).join('')}</table></div>
${d.progress.length > 1 ? `<h2>Progress on this track</h2><div class="card"><table><tr><th>Session</th><th>Best</th><th>Theoretical</th><th>Consistency</th><th>Laps</th></tr>${d.progress.map((p) => `<tr><td>${esc(new Date(p.startedAt).toLocaleDateString())}</td><td class="num">${fmt(p.bestMs)}</td><td class="num">${fmt(p.theoreticalMs)}</td><td class="num">${p.consistency !== null ? Math.round(p.consistency) : '—'}</td><td class="num">${p.laps}</td></tr>`).join('')}</table></div>` : ''}
<div class="muted">Generated by Pit Wall. Advice comes from your own laps: every number above is measured, not estimated.</div></body></html>`;
}
