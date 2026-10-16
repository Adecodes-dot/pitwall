// Session analyser: wires frames and events into laps, the track model, references and the fingerprint.
// Emits an AnalysisUpdate on every completed lap. Pure with respect to I/O except the optional Store.
import type { AdapterEvent, NormalisedFrame } from '../core/types.ts';
import { buildTrackModel, matchTrack, Projector, type TrackModel } from './track.ts';
import { LapCollector, buildChannels, microSectors, personalBest, projectLap, segmentDeltas, segments, cornerMetrics, type Lap, type SegmentDelta, type CornerMetrics } from './laps.ts';
import { buildFingerprint, type Fingerprint } from './fingerprint.ts';
import type { Store } from './store.ts';

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
  /** per-corner loss vs PB on the last lap, sorted worst first */
  worstCorners: { corner: number; deltaMs: number }[];
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
  listeners: ((u: AnalysisUpdate) => void)[] = [];
  lastUpdate: AnalysisUpdate | null = null;

  constructor(store: Store | null = null) {
    this.store = store;
    if (store) this.knownTracks = store.loadTracks();
  }

  onFrame(f: NormalisedFrame): void {
    if (this.game !== f.game) { this.game = f.game; }
    if (f.race.trackId && this.trackName !== f.race.trackId) { this.trackName = f.race.trackId; this.tryLoadKnown(); }
    if (f.assists.tc !== null) this.assists.tc = f.assists.tc;
    if (f.assists.abs !== null) this.assists.abs = f.assists.abs;
    this.lastFrame = f;
    this.collector.feed(f);
  }

  onEvent(e: AdapterEvent): void {
    if (e.type === 'session.start') { this.reset(); if (this.store && this.game) this.sessionId = this.store.startSession(this.game); }
    if (e.type === 'flashback') { /* the rewound lap is unreliable: mark current buffer invalid by dropping it */ this.collector.current().length = 0; }
    if (e.type === 'lap.complete') this.completeLap(e.lapNumber, e.timeMs, e.valid);
  }

  private reset(): void {
    this.collector.reset(); this.model = null; this.projector = null; this.lastUpdate = null; this.sessionId = null;
  }

  private tryLoadKnown(): void {
    if (this.model || !this.game || !this.trackName) return;
    const id = `${this.game}:${this.trackName}`;
    const known = this.knownTracks.find((t) => t.id === id);
    if (known) this.useModel(known);
  }

  private useModel(m: TrackModel): void { this.model = m; this.projector = new Projector(m); }

  private completeLap(lapNumber: number, timeMs: number, valid: boolean | null): void {
    if (timeMs <= 0) { this.collector.complete(lapNumber, timeMs, valid); this.collector.laps.pop(); return; } // out lap / no time: not a lap
    const lap = this.collector.complete(lapNumber, timeMs, valid);
    if (!lap) return;
    // the session row is created lazily: session.start can arrive before the first frame tells us the game
    if (this.store && this.sessionId === null && this.game) this.sessionId = this.store.startSession(this.game);
    // learn the track from the first clean lap with positions
    if (!this.model && valid !== false && this.game && timeMs > 20000) { // skip out laps / partial laps
      const pts = lap.samples.filter((s) => s.x !== null && s.z !== null).map((s) => ({ x: s.x!, z: s.z! }));
      if (pts.length > 200) {
        try {
          const built = buildTrackModel(pts, { game: this.game, name: this.trackName });
          const known = matchTrack(this.knownTracks, built.fingerprint);
          this.useModel(known ?? built);
          if (!known) { this.knownTracks.push(built); this.store?.saveTrack(built); }
        } catch { /* lap too short or broken; try again next lap */ }
      }
    }
    if (this.model && this.projector) {
      projectLap(lap, this.projector);
      lap.ch = buildChannels(lap, this.model.length);
      // laps completed before the model existed: project and build now
      for (const l of this.collector.laps) if (!l.ch) { projectLap(l, this.projector); l.ch = buildChannels(l, this.model.length); }
    }
    if (this.store && this.sessionId !== null) this.store.saveLap({ session: this.sessionId, number: lapNumber, timeMs, valid, trackId: this.model?.id ?? null });
    this.publish(lap);
  }

  private publish(lastLap: Lap): void {
    const laps = this.collector.laps;
    const pb = personalBest(laps);
    const m = this.model;
    let fp: Fingerprint | null = null, theo: number | null = null, deltas: SegmentDelta[] = [];
    if (m) {
      theo = microSectors(laps, m.length).theoreticalMs || null;
      fp = buildFingerprint(laps, m, this.assists);
      if (pb && lastLap.ch && lastLap !== pb) deltas = segmentDeltas(lastLap, pb, segments(m));
    }
    const summaries: LapSummary[] = laps.map((l) => ({
      number: l.number, timeMs: l.timeMs, valid: l.valid,
      deltaToPbMs: pb && l.timeMs > 0 ? l.timeMs - pb.timeMs : null,
      corners: m && l.ch ? m.corners.map((c) => cornerMetrics(l, c, m.length)).filter((x): x is CornerMetrics => x !== null) : [],
    }));
    const worst = deltas.filter((d) => d.seg.kind === 'corner').map((d) => ({ corner: d.seg.corner!.index, deltaMs: d.deltaMs })).sort((a, b) => b.deltaMs - a.deltaMs).slice(0, 3);
    const u: AnalysisUpdate = {
      trackId: m?.id ?? null, trackName: m?.name ?? this.trackName, trackLength: m?.length ?? null, corners: m?.corners ?? [],
      laps: summaries, pbMs: pb?.timeMs ?? null, pbLap: pb?.number ?? null,
      allTimeBestMs: m && this.store ? this.store.allTimeBest(m.id) : null,
      theoreticalMs: theo,
      lastLapDeltas: deltas.map((d) => ({ label: d.seg.kind === 'corner' ? d.seg.corner!.name : 'straight', kind: d.seg.kind, s0: d.seg.s0, s1: d.seg.s1, deltaMs: d.deltaMs })),
      worstCorners: worst, fingerprint: fp,
    };
    if (this.store && this.sessionId !== null) this.store.updateSession(this.sessionId, { trackId: m?.id ?? null, bestMs: pb?.timeMs ?? null, theoreticalMs: theo, consistency: fp?.consistencyScore ?? null, laps: laps.length, fingerprintJson: fp ? JSON.stringify(fp) : null });
    this.lastUpdate = u;
    for (const l of this.listeners) l(u);
  }
}
