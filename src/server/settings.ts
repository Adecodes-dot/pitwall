// User settings: a key/value table in the same sqlite file, validated against defaults.
import type { DatabaseSync } from 'node:sqlite';
import type { Chattiness } from '../radio/queue.ts';
import type { Gt7Format } from '../adapters/gt7/crypto.ts';

export interface Settings {
  firstRunDone: boolean;
  game: 'f1' | 'gt7' | null;          // last chosen in onboarding (auto-detect still wins)
  mode: Chattiness;
  muted: boolean;
  deviceAudio: boolean;               // laptop output device sink
  voice: string;                      // folder name under models/
  units: 'metric' | 'imperial';
  gt7Format: Gt7Format;
  gt7Assists: { tcs: number | null; asm: boolean | null; abs: 'off' | 'weak' | 'default' | 'strong' | null; countersteer: boolean | null };
  llm: boolean;                       // use cloud phrasing when credentials exist
  recordSessions: boolean;            // write .pwcap for every live session
  crashLogs: boolean;
}

export const DEFAULTS: Settings = {
  firstRunDone: false, game: null, mode: 'normal', muted: false, deviceAudio: true, voice: 'vits-piper-en_GB-alba-medium', units: 'metric',
  gt7Format: '~', gt7Assists: { tcs: null, asm: null, abs: null, countersteer: null }, llm: true, recordSessions: false, crashLogs: true,
};

export class SettingsStore {
  private db: DatabaseSync;
  private cache: Settings;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec('create table if not exists settings (key text primary key, value text not null)');
    const rows = db.prepare('select key, value from settings').all() as { key: string; value: string }[];
    const loaded: Partial<Settings> = {};
    for (const r of rows) { try { (loaded as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value); } catch { /* ignore bad row */ } }
    this.cache = { ...DEFAULTS, ...loaded, gt7Assists: { ...DEFAULTS.gt7Assists, ...(loaded.gt7Assists ?? {}) } };
  }
  get(): Settings { return this.cache; }
  /** Merge and persist; unknown keys are ignored, types are coerced to the default's type. */
  update(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value');
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULTS)) continue;
      const def = (DEFAULTS as unknown as Record<string, unknown>)[k];
      let val: unknown = v;
      if (typeof def === 'boolean') val = Boolean(v);
      else if (typeof def === 'string' && typeof v !== 'string') continue;
      else if (k === 'gt7Assists' && typeof v === 'object' && v) val = { ...this.cache.gt7Assists, ...(v as object) };
      (this.cache as unknown as Record<string, unknown>)[k] = val;
      stmt.run(k, JSON.stringify(val));
    }
    return this.cache;
  }
}
