// Build the Windows app: UI → server bundle (esbuild) → staging folder with Node runtime, native addons,
// voice and UI → NSIS installer via electron-builder.
//   npm run build:win            full build → dist/installer/Pit Wall Setup <version>.exe
//   npm run bundle:server        just the server bundle + staging (fast; used to smoke-test the packaged layout)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const bundleOnly = process.argv.includes('--bundle-only');
const run = (cmd: string, args: string[], cwd = root) => { console.log(`> ${cmd} ${args.join(' ')}`); execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }); };

// 1. UI
run('npm', ['run', 'ui:build']);

// 2. server bundle (ESM, Node 24 target; native addons stay external and are copied with their folders)
const outDir = join(root, 'dist', 'server');
rmSync(outDir, { recursive: true, force: true });
const { build } = await import('esbuild');
const external = ['sherpa-onnx-node', 'sherpa-onnx-win-x64', '@echogarden/audio-io', '@anthropic-ai/sdk'];
// esbuild's ESM output needs a require shim for CJS dependencies (ws, tweetnacl)
const banner = { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' };
for (const [entry, out] of [['src/server/main.ts', 'main.mjs'], ['src/radio/tts-worker.ts', 'tts-worker.mjs']] as const) {
  await build({ entryPoints: [join(root, entry)], bundle: true, platform: 'node', format: 'esm', target: 'node24', external, banner, outfile: join(outDir, out), logLevel: 'warning', sourcemap: false });
  console.log(`bundled ${entry} → dist/server/${out}`);
}

// 3. staging folder = everything the companion needs at runtime
const pkgDir = join(root, 'dist', 'pkg');
rmSync(pkgDir, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });
cpSync(outDir, join(pkgDir, 'dist', 'server'), { recursive: true });
cpSync(join(root, 'ui', 'dist'), join(pkgDir, 'ui', 'dist'), { recursive: true });
if (existsSync(join(root, 'models'))) cpSync(join(root, 'models'), join(pkgDir, 'models'), { recursive: true, filter: (p) => !p.endsWith('.tar.bz2') });
else console.warn('WARNING: models/ missing — run npm run voice:get first (the app will be silent)');
for (const dep of ['sherpa-onnx-node', 'sherpa-onnx-win-x64', '@echogarden/audio-io', '@echogarden/wave-codec', '@anthropic-ai/sdk']) {
  const src = join(root, 'node_modules', dep);
  if (existsSync(src)) cpSync(src, join(pkgDir, 'node_modules', dep), { recursive: true });
}
mkdirSync(join(pkgDir, 'node'), { recursive: true });
cpSync(process.execPath, join(pkgDir, 'node', 'node.exe'));
writeFileSync(join(pkgDir, 'VERSION'), `${pkg.version}\n`);
console.log(`staged → ${pkgDir}`);

// 4. smoke test the bundle in the staged layout (no UDP, replay a capture at max speed, hit the API)
const cap = join(root, 'captures', 'synthetic-gt7.pwcap');
if (existsSync(cap)) {
  console.log('smoke test: replaying a capture through the bundled server …');
  const { spawn } = await import('node:child_process');
  const child = spawn(join(pkgDir, 'node', 'node.exe'), [join(pkgDir, 'dist', 'server', 'main.mjs'), 'replay', cap, '--speed', 'max', '--port', '8798', '--no-device-audio', '--no-llm', '--quiet', '--db', join(root, 'dist', 'smoke.db')], { env: { ...process.env, PITWALL_MODELS: join(pkgDir, 'models'), PITWALL_UI: join(pkgDir, 'ui', 'dist'), NODE_PATH: join(pkgDir, 'node_modules') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) { await new Promise((r) => setTimeout(r, 500)); try { const j = await fetch('http://localhost:8798/api/debrief').then((r) => r.json()) as { laps?: number }; if ((j.laps ?? 0) >= 2) ok = true; } catch { /* starting */ } }
  const info = ok ? await fetch('http://localhost:8798/api/settings').then((r) => r.json()) as { ttsLoaded: boolean; version: string } : null;
  child.kill();
  if (!ok) { console.error('SMOKE TEST FAILED\n' + out.slice(-2000)); process.exit(1); }
  console.log(`smoke test passed: bundled server served a debrief; tts loaded: ${info?.ttsLoaded}; version ${info?.version}`);
}
if (bundleOnly) process.exit(0);

// 5. installer
run('npx', ['electron-builder', '--win', 'nsis', '--x64']);
console.log('installer → dist/installer');
