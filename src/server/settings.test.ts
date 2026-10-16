import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SettingsStore, DEFAULTS } from './settings.ts';
import { CrashReporter } from './crash.ts';
import { Bus } from '../core/bus.ts';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('settings store', () => {
  it('starts from defaults, persists patches, ignores unknown keys, coerces booleans, merges assists', () => {
    const db = new DatabaseSync(':memory:');
    const s = new SettingsStore(db);
    expect(s.get()).toEqual(DEFAULTS);
    s.update({ mode: 'coach', muted: 'yes' as unknown as boolean, gt7Assists: { tcs: 2 } as never, bogus: 1 } as never);
    expect(s.get().mode).toBe('coach');
    expect(s.get().muted).toBe(true);
    expect(s.get().gt7Assists).toEqual({ ...DEFAULTS.gt7Assists, tcs: 2 });
    expect((s.get() as unknown as Record<string, unknown>).bogus).toBeUndefined();
    // a second store on the same db sees the persisted values
    const again = new SettingsStore(db);
    expect(again.get().mode).toBe('coach');
    expect(again.get().gt7Assists.tcs).toBe(2);
  });
});

describe('crash reporter', () => {
  it('writes a crash file with the error and the recent log tail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-crash-'));
    const bus = new Bus();
    const cr = new CrashReporter(dir, bus);
    bus.emit('log', { level: 'info', msg: 'hello' });
    bus.emit('log', { level: 'warn', msg: 'world' });
    const file = cr.write('test', new Error('boom'))!;
    const body = readFileSync(file, 'utf8');
    expect(body).toContain('Error: boom');
    expect(body).toContain('[warn] world');
    expect(body).toContain('No data is uploaded');
    expect(readdirSync(dir).some((f) => f.startsWith('session-'))).toBe(true);
    cr.setEnabled(false);
    expect(cr.write('test', new Error('quiet'))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
