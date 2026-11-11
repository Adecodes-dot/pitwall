// Pit Wall desktop shell: starts the companion (bundled Node + server bundle), opens a window on it,
// and lives in the tray. The companion itself is unchanged; this file is only process management + window.
const { app, BrowserWindow, Tray, Menu, shell, dialog, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const PORT = 8787;
const DEV = process.argv.includes('--dev');
const res = DEV ? path.resolve(__dirname, '..') : path.join(process.resourcesPath, 'app');
const nodeExe = DEV ? process.execPath.replace(/electron\.exe$/i, 'node.exe') : path.join(res, 'node', 'node.exe');
const serverEntry = DEV ? path.join(res, 'src', 'server', 'main.ts') : path.join(res, 'dist', 'server', 'main.mjs');

let child = null, win = null, tray = null, quitting = false;

// One Pit Wall at a time: a second launch (an impatient double click) would start a second companion on the same
// port, which crashes and restarts in a loop. The second launch only brings the open window forward.
if (!app.requestSingleInstanceLock()) { app.exit(0); return; }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
const logDir = path.join(app.getPath('userData'), 'shell-logs');
fs.mkdirSync(logDir, { recursive: true });
const shellLog = fs.createWriteStream(path.join(logDir, `shell-${new Date().toISOString().slice(0, 10)}.log`), { flags: 'a' });

let crashes = [];
function startServer() {
  const exe = DEV ? 'node' : nodeExe;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined };
  if (!DEV) { env.PITWALL_MODELS = path.join(res, 'models'); env.PITWALL_UI = path.join(res, 'ui', 'dist'); env.NODE_PATH = path.join(res, 'node_modules'); }
  child = spawn(exe, [serverEntry, 'live', '--port', String(PORT)], { cwd: DEV ? res : app.getPath('userData'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => shellLog.write(d));
  child.stderr.on('data', (d) => shellLog.write(d));
  child.on('exit', (code) => {
    shellLog.write(`server exited with ${code}\n`);
    if (quitting) return;
    // mid-race the driver cannot click a dialog: restart quietly, and ask only if it keeps failing
    crashes = crashes.filter((t) => Date.now() - t < 5 * 60 * 1000); crashes.push(Date.now());
    if (crashes.length <= 3) { shellLog.write('restarting the companion\n'); setTimeout(startServer, 500); return; }
    {
      const r = dialog.showMessageBoxSync({ type: 'error', buttons: ['Restart', 'Open logs', 'Quit'], title: 'Pit Wall', message: `The companion stopped (code ${code}).`, detail: 'A crash report was written to %LOCALAPPDATA%\\PitWall\\logs if crash logs are enabled.' });
      if (r === 0) startServer(); else if (r === 1) { shell.openPath(path.join(app.getPath('localAppData') ?? process.env.LOCALAPPDATA ?? '', 'PitWall', 'logs')); } else app.quit();
    }
  });
}

function waitForServer(tries = 120) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(`http://localhost:${PORT}/api/status`, (r) => { r.resume(); resolve(); }).on('error', () => { if (--tries <= 0) reject(new Error('companion did not start')); else setTimeout(tick, 250); });
    };
    tick();
  });
}

function createWindow() {
  // hands-free voice: the page records the microphone. Grant it to our own local page only, and keep audio flowing while the window is hidden in the tray.
  const ours = (url) => { try { const u = new URL(url); return u.hostname === 'localhost' && u.port === String(PORT); } catch { return false; } };
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && ours(origin));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm === 'media' && ours(details.requestingUrl)));
  win = new BrowserWindow({ width: 1180, height: 820, minWidth: 420, minHeight: 600, backgroundColor: '#0f1114', title: 'Pit Wall', autoHideMenuBar: true, webPreferences: { contextIsolation: true, backgroundThrottling: false } });
  win.loadURL(`http://localhost:${PORT}/`);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const icon = path.join(__dirname, 'tray.png');
  tray = new Tray(icon);
  tray.setToolTip('Pit Wall');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Pit Wall', click: () => { if (win) { win.show(); win.focus(); } else createWindow(); } },
    { label: 'Open on phone: see Setup tab', enabled: false },
    { type: 'separator' },
    { label: 'Logs folder', click: () => shell.openPath(path.join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'PitWall', 'logs')) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.pitwall.companion');
  startServer();
  try { await waitForServer(); } catch (e) { dialog.showErrorBox('Pit Wall', `${e.message}. See ${logDir}.`); app.quit(); return; }
  createTray();
  createWindow();
});
app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; if (child) { try { child.kill(); } catch { /* ignore */ } } });
