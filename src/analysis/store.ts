// Persistence with node:sqlite (built into Node 24). Tracks, sessions and lap summaries.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deserializeTrack, serializeTrack, type TrackModel } from './track.ts';
import type { Lap, LapChannels } from './laps.ts';

const CH = ['t', 'speed', 'throttle', 'brake', 'steer', 'gear'] as const;

export interface LapRecord { session: number; number: number; timeMs: number; valid: boolean | null; trackId: string | null }

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists tracks (id text primary key, game text not null, name text, length real not null, json text not null, updated_at text not null);
      create table if not exists sessions (id integer primary key autoincrement, game text not null, track_id text, started_at text not null, ended_at text, best_ms integer, theoretical_ms integer, consistency real, laps integer default 0, fingerprint_json text);
      create table if not exists laps (session integer not null, number integer not null, time_ms integer not null, valid integer, track_id text, primary key (session, number));
      create table if not exists refs (track_id text primary key, time_ms integer not null, lap_number integer, length integer not null, ch blob not null, saved_at text not null);
      create table if not exists last_debrief (id integer primary key check (id = 1), json text not null, saved_at text not null);
    `);
    // added for the weekend table (Miami, D33): databases from before have no column for it
    const cols = (this.db.prepare('pragma table_info(sessions)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('session_type')) this.db.exec('alter table sessions add column session_type text');
  }

  saveTrack(m: TrackModel): void {
    this.db.prepare('insert into tracks (id, game, name, length, json, updated_at) values (?, ?, ?, ?, ?, ?) on conflict(id) do update set json = excluded.json, length = excluded.length, name = coalesce(excluded.name, tracks.name), updated_at = excluded.updated_at')
      .run(m.id, m.game, m.name, m.length, serializeTrack(m), new Date().toISOString());
  }
  loadTracks(game?: 'f1' | 'gt7'): TrackModel[] {
    const rows = (game ? this.db.prepare('select json from tracks where game = ?').all(game) : this.db.prepare('select json from tracks').all()) as { json: string }[];
    return rows.map((r) => deserializeTrack(r.json));
  }
  loadTrack(id: string): TrackModel | null {
    const r = this.db.prepare('select json from tracks where id = ?').get(id) as { json: string } | undefined;
    return r ? deserializeTrack(r.json) : null;
  }

  startSession(game: 'f1' | 'gt7'): number {
    const r = this.db.prepare('insert into sessions (game, started_at) values (?, ?)').run(game, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }
  saveLap(rec: LapRecord): void {
    this.db.prepare('insert or replace into laps (session, number, time_ms, valid, track_id) values (?, ?, ?, ?, ?)').run(rec.session, rec.number, rec.timeMs, rec.valid === null ? null : rec.valid ? 1 : 0, rec.trackId);
  }
  updateSession(id: number, u: { sessionType?: string | null; trackId?: string | null; bestMs?: number | null; theoreticalMs?: number | null; consistency?: number | null; laps?: number; fingerprintJson?: string | null; ended?: boolean }): void {
    this.db.prepare('update sessions set session_type = coalesce(?, session_type), track_id = coalesce(?, track_id), best_ms = coalesce(?, best_ms), theoretical_ms = coalesce(?, theoretical_ms), consistency = coalesce(?, consistency), laps = coalesce(?, laps), fingerprint_json = coalesce(?, fingerprint_json), ended_at = case when ? then ? else ended_at end where id = ?')
      .run(u.sessionType ?? null, u.trackId ?? null, u.bestMs ?? null, u.theoreticalMs ?? null, u.consistency ?? null, u.laps ?? null, u.fingerprintJson ?? null, u.ended ? 1 : 0, new Date().toISOString(), id);
  }
  /** Best lap per past session on a track (for progress over sessions). */
  history(trackId: string): { session: number; sessionType: string | null; startedAt: string; bestMs: number | null; theoreticalMs: number | null; consistency: number | null; laps: number }[] {
    return this.db.prepare('select id as session, session_type as sessionType, started_at as startedAt, best_ms as bestMs, theoretical_ms as theoreticalMs, consistency, laps from sessions where track_id = ? order by started_at').all(trackId) as ReturnType<Store['history']>;
  }
  /** All-time personal best on a track across sessions, ms. */
  allTimeBest(trackId: string): number | null {
    const r = this.db.prepare('select min(time_ms) as ms from laps where track_id = ? and (valid is null or valid = 1) and time_ms > 0').get(trackId) as { ms: number | null } | undefined;
    return r?.ms ?? null;
  }
  /** The fastest lap with a trace on a track, kept across sessions: the reference for "where am I losing time". */
  saveRef(trackId: string, lap: Lap): void {
    const ch = lap.ch!; const L = ch.L;
    const buf = new Float32Array(L * CH.length);
    CH.forEach((k, i) => buf.set(ch[k].subarray(0, L), i * L));
    this.db.prepare('insert or replace into refs (track_id, time_ms, lap_number, length, ch, saved_at) values (?, ?, ?, ?, ?, ?)')
      .run(trackId, Math.round(lap.timeMs), lap.number, L, new Uint8Array(buf.buffer), new Date().toISOString());
  }
  /** null when there is none, or it was recorded on a track model of a different length */
  loadRef(trackId: string, length: number): Lap | null {
    const r = this.db.prepare('select time_ms, lap_number, length, ch from refs where track_id = ?').get(trackId) as { time_ms: number; lap_number: number; length: number; ch: Uint8Array } | undefined;
    if (!r || r.length !== length) return null;
    const all = new Float32Array(r.ch.buffer.slice(r.ch.byteOffset, r.ch.byteOffset + r.ch.byteLength));
    const ch = { L: r.length } as LapChannels;
    CH.forEach((k, i) => { ch[k] = all.subarray(i * r.length, (i + 1) * r.length); });
    return { number: r.lap_number, maxGapMs: 0, timeMs: r.time_ms, valid: true, samples: [], ch };
  }
  /** The debrief of the latest session with laps, as JSON: one row, so it is there after the app restarts. */
  saveDebrief(json: string): void { this.db.prepare('insert or replace into last_debrief (id, json, saved_at) values (1, ?, ?)').run(json, new Date().toISOString()); }
  lastDebrief(): string | null { return (this.db.prepare('select json from last_debrief where id = 1').get() as { json: string } | undefined)?.json ?? null; }
  deleteTrack(id: string): void { this.db.prepare('delete from tracks where id = ?').run(id); this.db.prepare('delete from refs where track_id = ?').run(id); }
  close(): void { this.db.close(); }
}
