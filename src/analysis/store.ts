// Persistence with node:sqlite (built into Node 24). Tracks, sessions and lap summaries.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deserializeTrack, serializeTrack, type TrackModel } from './track.ts';

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
    `);
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
  updateSession(id: number, u: { trackId?: string | null; bestMs?: number | null; theoreticalMs?: number | null; consistency?: number | null; laps?: number; fingerprintJson?: string | null; ended?: boolean }): void {
    this.db.prepare('update sessions set track_id = coalesce(?, track_id), best_ms = coalesce(?, best_ms), theoretical_ms = coalesce(?, theoretical_ms), consistency = coalesce(?, consistency), laps = coalesce(?, laps), fingerprint_json = coalesce(?, fingerprint_json), ended_at = case when ? then ? else ended_at end where id = ?')
      .run(u.trackId ?? null, u.bestMs ?? null, u.theoreticalMs ?? null, u.consistency ?? null, u.laps ?? null, u.fingerprintJson ?? null, u.ended ? 1 : 0, new Date().toISOString(), id);
  }
  /** Best lap per past session on a track (for progress over sessions). */
  history(trackId: string): { session: number; startedAt: string; bestMs: number | null; theoreticalMs: number | null; consistency: number | null; laps: number }[] {
    return this.db.prepare('select id as session, started_at as startedAt, best_ms as bestMs, theoretical_ms as theoreticalMs, consistency, laps from sessions where track_id = ? order by started_at').all(trackId) as ReturnType<Store['history']>;
  }
  /** All-time personal best on a track across sessions, ms. */
  allTimeBest(trackId: string): number | null {
    const r = this.db.prepare('select min(time_ms) as ms from laps where track_id = ? and (valid is null or valid = 1) and time_ms > 0').get(trackId) as { ms: number | null } | undefined;
    return r?.ms ?? null;
  }
  close(): void { this.db.close(); }
}
