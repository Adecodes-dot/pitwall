// Crash reporting: local only. Keeps a ring of recent log lines and, on an uncaught error, writes a crash
// file with the error, the log tail, versions and OS info to %LOCALAPPDATA%\PitWall\logs. No upload in v1.
import { appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { Bus } from '../core/bus.ts';

export const VERSION = '0.1.0';

export class CrashReporter {
  readonly dir: string;
  private ring: string[] = [];
  private enabled = true;
  private logFile: string;
  constructor(dir: string, bus: Bus) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.logFile = join(dir, `session-${new Date().toISOString().slice(0, 10)}.log`);
    bus.on('log', (l) => this.note(`[${l.level}] ${l.msg}`));
    bus.on('event', (e) => this.note(e.type === 'lap.complete' ? `event lap.complete L${e.lapNumber} ${e.timeMs} ms valid=${e.valid}` : `event ${JSON.stringify(e)}`));
    this.prune();
  }
  setEnabled(on: boolean): void { this.enabled = on; }
  note(line: string): void {
    const stamped = `${new Date().toISOString()} ${line}`;
    this.ring.push(stamped); if (this.ring.length > 300) this.ring.shift();
    if (this.enabled) { try { appendFileSync(this.logFile, stamped + '\n'); } catch { /* disk full etc. */ } }
  }
  install(): void {
    const handler = (kind: string) => (err: unknown) => {
      const file = this.write(kind, err);
      console.error(`\n[pitwall] ${kind}: ${(err as Error)?.stack ?? String(err)}\n[pitwall] crash report: ${file ?? '(disabled)'}`);
      process.exit(1);
    };
    process.on('uncaughtException', handler('uncaughtException'));
    process.on('unhandledRejection', handler('unhandledRejection'));
  }
  write(kind: string, err: unknown): string | null {
    if (!this.enabled) return null;
    const file = join(this.dir, `crash-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    const body = [
      `Pit Wall ${VERSION} crash report`, `kind: ${kind}`, `time: ${new Date().toISOString()}`,
      `node: ${process.version} ${process.arch}  electron: ${process.versions.electron ?? '-'}`, `os: ${os.type()} ${os.release()} (${os.arch()}), ${os.cpus()[0]?.model ?? '?'}, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
      `uptime: ${Math.round(process.uptime())} s`, '', 'error:', (err as Error)?.stack ?? String(err), '', `last ${this.ring.length} log lines:`, ...this.ring, '',
      'No data is uploaded. Attach this file when reporting a problem.',
    ].join('\n');
    try { writeFileSync(file, body); return file; } catch { return null; }
  }
  /** keep the logs folder small: delete session logs older than 14 days */
  private prune(): void {
    try {
      const cutoff = Date.now() - 14 * 86400e3;
      for (const f of readdirSync(this.dir)) { const p = join(this.dir, f); if (f.startsWith('session-') && statSync(p).mtimeMs < cutoff) { try { unlinkSync(p); } catch { /* ignore */ } } }
    } catch { /* ignore */ }
  }
  tail(n = 100): string[] { return this.ring.slice(-n); }
}
