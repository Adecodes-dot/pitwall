// Session analyser: wires frames and events into laps, the track model, references and the fingerprint.
// Emits an AnalysisUpdate on every completed lap. Pure with respect to I/O except the optional Store.
import type { AdapterEvent, NormalisedFrame } from '../core/types.ts';
import { buildTrackModel, matchTrack, Projector, type TrackModel } from './track.ts';
import { LapCollector, buildChannels, microSectors, personalBest, projectLap, segmentDeltas, segments, cornerMetrics, type Lap, type SegmentDelta, type CornerMetrics } from './laps.ts';
import { buildFingerprint, type Fingerprint } from './fingerprint.ts';
import type { Store } from './store.ts';

/** longest tolerated hole between frames inside one lap. Real Wi-Fi sessions show 0.3–1.3 s hiccups on most laps; the
 *  trace is interpolated across them (the lap timer is exact on both sides). Longer holes are outages or flashbacks. */
export const GAP_LIMIT_MS = 1500;

export interface LapSummary { number: number; timeMs: number; valid: boolean | null; deltaToPbMs: number | null; corners: CornerMetrics[] }

export interface AnalysisUpdate {
  trackId: string | null;
  trackName: string | null;
  trackLength: number | null;
  corners: TrackModel['corners'];
  laps: LapSummary[];
  pbMs: number | null;
  pbLap: number | null;
  allTimeBestMs: number | null;
  theoreticalMs: number | null;
  /** last completed lap vs PB per segment (corner windows + straights) */
  lastLapDeltas: { label: string; kind: 'corner' | 'straight'; s0: number; s1: number; deltaMs: number }[];
  /** per-corner loss on the last lap against the quickest pass through that corner on any other lap (this session or the
   *  saved reference), worst first; only losses */
  worstCorners: { corner: number; deltaMs: number }[];
  /** there is at least one other lap with a trace to compare the last lap against */
  hasReference: boolean;
  /** lap time of the trace the last lap is drawn against (session best, or the best saved on this track) */
  referenceMs: number | null;
  fingerprint: Fingerprint | null;
}

export class SessionAnalyser {
  readonly collector = new LapCollector();
  model: TrackModel | null = null;
  projector: Projector | null = null;
  private game: 'f1' | 'gt7' | null = null;
  private knownTracks: TrackModel[] = [];
  private store: Store | null;
  private sessionId: number | null = null;
  private trackName: string | null = null;
  private assists: { tc: number | null; abs: boolean | null } = { tc: null, abs: null };
  private lastFrame: NormalisedFrame | null = null;
  /** fastest lap with a trace on this track from earlier sessions (saved in the store); carries a race weekend */
  reference: Lap | null = null;
  /** the session before this one, kept for the debrief until this session completes a lap */
  previous: { update: AnalysisUpdate; laps: Lap[] } | null = null;
  private sessionType: string | null = null;
  listeners: ((u: AnalysisUpdate) => void)[] = [];
  lastUpdate: AnalysisUpdate | null = null;

  constructor(store: Store | null = null) {
    this.store = store;
    if (store) this.knownTracks = store.loadTracks();
  }

  onFrame(f: NormalisedFrame): void {
    if (this.game !== f.game) { this.game = f.game; }
    if (f.race.trackId && this.trackName !== f.race.trackId) { this.trackName = f.race.trackId; this.model = null; this.projector = null; this.reference = null; this.tryLoadKnown(); }
    if (f.race.sessionType) this.sessionType = f.race.sessionType;
    if (f.assists.tc !== null) this.assists.tc = f.assists.tc;
    if (f.assists.abs !== null) this.assists.abs = f.assists.abs;
    this.lastFrame = f;
    this.collector.feed(f);
  }

  onEvent(e: AdapterEvent): void {
    if (e.type === 'session.start') { this.reset(); if (this.store && this.game) this.sessionId = this.store.startSession(this.game); }
    // flashback: the collector cuts the lap back to the rewound timer and keeps it (F1 rewinds the lap timer too)
    if (e.type === 'lap.complete') this.completeLap(e.lapNumber, e.timeMs, e.valid);
  }

  private reset(): void {
    // the next session on the same track (FP → Q1 → Q2 …) keeps the track model and the best lap as its reference;
    // GT7 does not say which track it is, so there everything starts again
    this.keepBest();
    if (this.lastUpdate && this.collector.laps.some((l) => l.timeMs > 0)) this.previous = { update: this.lastUpdate, laps: this.collector.laps };
    this.collector.reset(); this.lastUpdate = null; this.sessionId = null;
    if (!this.trackName) { this.model = null; this.projector = null; this.reference = null; this.previous = null; }
    this.publishTrack(); // the map and the reference are known before the first lap of this session
  }

  /** An update with the track and no laps yet: the map from the first metre of a session on a known track. */
  private publishTrack(): void {
    const m = this.model;
    if (!m) return;
    const u: AnalysisUpdate = {
      trackId: m.id, trackName: m.name ?? this.trackName, trackLength: m.length, corners: m.corners, laps: [], pbMs: null, pbLap: null,
      allTimeBestMs: this.store ? this.store.allTimeBest(m.id) : null, theoreticalMs: null, lastLapDeltas: [], worstCorners: [],
      hasReference: false, referenceMs: this.reference?.timeMs ?? null, fingerprint: null,
    };
    this.lastUpdate = u;
    for (const l of this.listeners) l(u);
  }

  /** promote this session's best lap to the reference when it is faster */
  private keepBest(): void {
    const pb = personalBest(this.collector.laps);
    if (!pb || !this.model || (this.reference && this.reference.timeMs <= pb.timeMs)) return;
    this.reference = { ...pb, samples: [] };
    this.store?.saveRef(this.model.id, pb);
  }

  /** laps with a trace usable for zones and comparisons: this session's plus the reference */
  tracedLaps(): Lap[] { return [...this.collector.laps.filter((l) => l.ch), ...(this.reference ? [this.reference] : [])]; }

  private tryLoadKnown(): void {
    if (this.model || !this.game || !this.trackName) return;
    const id = `${this.game}:${this.trackName}`;
    const known = this.knownTracks.find((t) => t.id === id);
    if (known) { this.useModel(known); if (!this.lastUpdate) this.publishTrack(); }
  }

  private useModel(m: TrackModel): void {
    this.model = m; this.projector = new Projector(m);
    const saved = this.store?.loadRef(m.id, m.length) ?? null;
    if (saved && (!this.reference || saved.timeMs < this.reference.timeMs)) this.reference = saved;
    if (this.reference?.ch && this.reference.ch.L !== m.length) this.reference = null;
  }

  private completeLap(lapNumber: number, timeMs: number, valid: boolean | null): void {
    if (timeMs <= 0) { this.collector.complete(lapNumber, timeMs, valid); this.collector.laps.pop(); return; } // out lap / no time: not a lap
    const lap = this.collector.complete(lapNumber, timeMs, valid);
    if (!lap) return;
    // the session row is created lazily: session.start can arrive before the first frame tells us the game
    if (this.store && this.sessionId === null && this.game) this.sessionId = this.store.startSession(this.game);
    // a saved model that does not fit this game's lap distance was learned from a bad lap: forget it and learn again
    if (this.model && !lap.pit && coversLap(lap) && !fitsLap(this.model, lap)) { this.store?.deleteTrack(this.model.id); this.knownTracks = this.knownTracks.filter((t) => t !== this.model); this.model = null; this.projector = null; this.reference = null; }
    // learn the track from the first clean, complete lap with positions
    if (!this.model && valid !== false && !lap.pit && this.game && timeMs > 20000 && lap.maxGapMs <= GAP_LIMIT_MS && coversLap(lap)) { // skip out laps / partial laps / pit lane
      const pts = lap.samples.filter((s) => s.x !== null && s.z !== null).map((s) => ({ x: s.x!, z: s.z! }));
      if (pts.length > 200) {
        try {
          const built = buildTrackModel(pts, { game: this.game, name: this.trackName });
          const match = matchTrack(this.knownTracks, built.fingerprint);
          const known = match && fitsLap(match, lap) ? match : null;
          if (fitsLap(built, lap) || known) {
            this.useModel(known ?? built);
            if (!known) { this.knownTracks = this.knownTracks.filter((t) => t.id !== built.id); this.knownTracks.push(built); this.store?.saveTrack(built); }
          }
        } catch { /* lap too short or broken; try again next lap */ }
      }
    }
    // a lap with a hole (outage or heavy loss) keeps its game lap time but gets no trace, so it cannot become a reference
    // a standing start is not a flying lap: the timer runs from the lights, the trace from the line; nor is an in- or out-lap
    const standing = (l: Lap) => l.number === 1 && !!this.sessionType?.startsWith('race');
    const usable = (l: Lap) => l.maxGapMs <= GAP_LIMIT_MS && coversLap(l) && !standing(l) && !l.pit;
    if (this.model && this.projector) {
      if (usable(lap)) { projectLap(lap, this.projector); lap.ch = buildChannels(lap, this.model.length); }
      // laps completed before the model existed: project and build now
      for (const l of this.collector.laps) if (!l.ch && usable(l)) { projectLap(l, this.projector); l.ch = buildChannels(l, this.model.length); }
    }
    if (this.store && this.sessionId !== null) this.store.saveLap({ session: this.sessionId, number: lapNumber, timeMs, valid, trackId: this.model?.id ?? null });
    this.publish(lap);
  }

  private publish(lastLap: Lap): void {
    const laps = this.collector.laps;
    const pb = personalBest(laps);
    const m = this.model;
    let fp: Fingerprint | null = null, theo: number | null = null, deltas: SegmentDelta[] = [], ref: Lap | null = null;
    const worstBy = new Map<number, number>();
    if (m) {
      theo = microSectors(laps, m.length).theoreticalMs || null;
      fp = buildFingerprint(laps, m, this.assists);
      const others = this.tracedLaps().filter((l) => l !== lastLap && !l.rewound && l.ch !== lastLap.ch && l.timeMs > 0 && l.valid !== false);
      ref = personalBest(others);
      if (ref && lastLap.ch) {
        const segs = segments(m);
        deltas = segmentDeltas(lastLap, ref, segs);
        // each corner against its quickest pass on any other lap, so the best lap of the day still has somewhere to improve
        for (const o of others) for (const d of segmentDeltas(lastLap, o, segs)) if (d.seg.kind === 'corner') worstBy.set(d.seg.corner!.index, Math.max(worstBy.get(d.seg.corner!.index) ?? -Infinity, d.deltaMs));
      }
    }
    const summaries: LapSummary[] = laps.map((l) => ({
      number: l.number, timeMs: l.timeMs, valid: l.valid,
      deltaToPbMs: pb && l.timeMs > 0 ? l.timeMs - pb.timeMs : null,
      corners: m && l.ch ? m.corners.map((c) => cornerMetrics(l, c, m.length)).filter((x): x is CornerMetrics => x !== null) : [],
    }));
    const worst = [...worstBy].map(([corner, deltaMs]) => ({ corner, deltaMs })).filter((w) => w.deltaMs >= 30).sort((a, b) => b.deltaMs - a.deltaMs).slice(0, 3);
    const u: AnalysisUpdate = {
      trackId: m?.id ?? null, trackName: m?.name ?? this.trackName, trackLength: m?.length ?? null, corners: m?.corners ?? [],
      laps: summaries, pbMs: pb?.timeMs ?? null, pbLap: pb?.number ?? null,
      allTimeBestMs: m && this.store ? this.store.allTimeBest(m.id) : null,
      theoreticalMs: theo,
      lastLapDeltas: deltas.map((d) => ({ label: d.seg.kind === 'corner' ? d.seg.corner!.name : 'straight', kind: d.seg.kind, s0: d.seg.s0, s1: d.seg.s1, deltaMs: d.deltaMs })),
      worstCorners: worst, hasReference: ref !== null && !!lastLap.ch, referenceMs: ref?.timeMs ?? null, fingerprint: fp,
    };
    if (this.store && this.sessionId !== null) this.store.updateSession(this.sessionId, { sessionType: this.sessionType, trackId: m?.id ?? null, bestMs: pb?.timeMs ?? null, theoreticalMs: theo, consistency: fp?.consistencyScore ?? null, laps: laps.length, fingerprintJson: fp ? JSON.stringify(fp) : null });
    this.keepBest(); // saved as it happens, so closing the app mid-session keeps it
    this.lastUpdate = u;
    for (const l of this.listeners) l(u);
  }
}

/** The samples run from the line to the line: first timer reading near 0, last near the lap time (no timer: trust it). */
export function coversLap(l: Lap): boolean {
  let first: number | null = null, last: number | null = null;
  for (const s of l.samples) if (s.lapTimeMs !== null) { if (first === null) first = s.lapTimeMs; last = s.lapTimeMs; }
  return first === null || (first <= 3000 && last! >= l.timeMs - 3000);
}

/** Where the game reports lap distance, a track model must be within 8 % of the distance driven in a full lap. */
export function fitsLap(m: TrackModel, l: Lap): boolean {
  let maxS = -Infinity;
  for (const s of l.samples) if (s.s !== null && s.s > maxS) maxS = s.s;
  return maxS === -Infinity || maxS < 100 || Math.abs(m.length - maxS) / maxS < 0.08;
}
