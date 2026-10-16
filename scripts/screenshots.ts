// Playwright screenshots of every tab at phone and desktop widths, against a companion replaying a
// synthetic capture at max speed (so laps, analysis and debrief exist). Writes docs/milestones/<prefix>-*.png.
//   npm run screenshots -- [--prefix m4] [--capture captures/synthetic-gt7.pwcap]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: v } = parseArgs({ options: { prefix: { type: 'string', default: 'm4' }, capture: { type: 'string', default: 'captures/synthetic-gt7.pwcap' }, port: { type: 'string', default: '8799' }, tabs: { type: 'string', default: 'live,analysis,radio,debrief' } } });
const port = Number(v.port);
const outDir = join(root, 'docs', 'milestones');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(root, 'ui/dist/index.html'))) { console.error('UI not built: npm run ui:build'); process.exit(2); }
if (!existsSync(resolve(root, v.capture))) { console.error(`capture missing: ${v.capture} (run npm run demo:m1 or npm run capture:synth)`); process.exit(2); }

const server = spawn(process.execPath, [join(root, 'src/server/main.ts'), 'replay', resolve(root, v.capture), '--speed', 'max', '--port', String(port), '--no-device-audio', '--no-llm', '--quiet', '--db', join(root, 'dist', 'screenshots.db')], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* ignore */ } };
process.on('exit', stop);

async function waitFor(url: string, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) { const j = await r.json() as { laps?: number; error?: string }; if (!j.error && (j.laps ?? 0) >= 2) return; } } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)); }
  throw new Error(`server at ${url} did not become ready`);
}

try {
  await waitFor(`http://localhost:${port}/api/debrief`, 60000);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const sizes = [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1440, height: 900, mobile: false }];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, colorScheme: 'dark' });
    const page = await ctx.newPage();
    for (const tab of v.tabs.split(',')) {
      await page.goto(`http://localhost:${port}/#${tab}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(tab === 'debrief' ? 1500 : 800);
      const file = join(outDir, `${v.prefix}-${tab}-${s.name}.png`);
      await page.screenshot({ path: file, fullPage: tab === 'debrief' || tab === 'analysis' || tab === 'settings' });
      console.log(`wrote ${file}`);
    }
    await ctx.close();
  }
  await browser.close();
} finally { stop(); }
