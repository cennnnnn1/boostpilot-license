const { app, BrowserWindow, ipcMain, session, shell, globalShortcut } = require('electron');
const { spawn, execSync } = require('child_process');
const { randomBytes } = require('crypto');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BOT_DIR = app.isPackaged ? path.join(process.resourcesPath, 'bot') : path.resolve(__dirname, '..');
const BOT_MAIN = 'src/bot.js';
const LOGIN_MAIN = 'src/login.js';
const NODE_BIN = app.isPackaged ? path.join(process.resourcesPath, 'node', 'node.exe') : 'node';
const CDP_PORT = '9222';
const PANEL_HOST = '127.0.0.1';
const START_PORT = 3000;
const MAX_PORT = 3005;
const CONFIG_FILE = path.join(app.getPath('userData'), 'launcher.json');
const VERSION = '1.5.0';

let botChild = null;
let botStartedByUs = false;
let panelPort = null;
let launcherWin = null;
let panelWin = null;
let quitting = false;
let respawnTimer = null;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; }
}
function writeConfig(c) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); } catch (e) {}
}
function getDeviceId() {
  const cfg = readConfig();
  if (cfg.deviceId) return cfg.deviceId;
  const deviceId = randomBytes(12).toString('hex');
  writeConfig({ ...cfg, deviceId });
  return deviceId;
}

function getAdminKey() {
  return process.env.ELBOT_MASTER_KEY || '';
}

function httpJson(url, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: (opts && opts.method) || 'GET', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const out = { status: res.statusCode, data: {}, setCookie: res.headers['set-cookie'] || [] };
        try { out.data = JSON.parse(body); } catch (e) {}
        resolve(out);
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(new Error('timeout')); });
    if (opts && opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function isUp(port) {
  return httpJson('http://' + PANEL_HOST + ':' + port + '/api/me', {}).then(() => true).catch(() => false);
}

async function findPort() {
  for (let p = START_PORT; p <= MAX_PORT; p++) {
    if (await isUp(p)) return p;
  }
  return null;
}

function ensureBotState() {
  if (!app.isPackaged) return;
  const seedDir = path.join(process.resourcesPath, 'bot', 'state');
  const dest = path.join(app.getPath('userData'), 'bot-state');
  if (fs.existsSync(dest)) return;
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(seedDir)) {
      const src = path.join(seedDir, f);
      const dst = path.join(dest, f);
      if (fs.statSync(src).isDirectory()) fs.mkdirSync(dst, { recursive: true });
      else fs.copyFileSync(src, dst);
    }
  } catch {}
}

function botStateDir() {
  return path.join(app.getPath('userData'), 'bot-state');
}

function setPanelActive(active) {
  try {
    const dir = botStateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'panel-active'), active ? '1' : '0');
  } catch (e) {}
}

function sessionStateDir() {
  return app.isPackaged ? botStateDir() : path.join(BOT_DIR, 'state');
}

function startBot() {
  if (botChild) return;
  if (quitting) return;
  try {
    ensureBotState();
    const botState = botStateDir();
    botChild = spawn(NODE_BIN, [BOT_MAIN], {
      cwd: BOT_DIR,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ELBOT_STATE_DIR: botState, ELBOT_MASTER_KEY: getAdminKey() },
    });
    botStartedByUs = true;
    botChild.on('exit', () => {
      botChild = null;
      if (!quitting) {
        clearTimeout(respawnTimer);
        respawnTimer = setTimeout(() => {
          if (!quitting) startBot();
        }, 4000);
      }
    });
  } catch (e) {
    botChild = null;
  }
}

async function ensureBot() {
  panelPort = await findPort();
  if (panelPort != null) return panelPort;
  startBot();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 400));
    panelPort = await findPort();
    if (panelPort != null) return panelPort;
  }
  return null;
}

function extractSession(cookies) {
  if (!cookies) return null;
  for (const c of cookies) {
    const m = /elbot_session=([a-f0-9]{24,})/i.exec(c);
    if (m) return m[1];
  }
  return null;
}

function resolveChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function httpGet(u) {
  return new Promise((resolve, reject) => {
    const req = http.get(u, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
  });
}

function cdpReady() {
  return httpGet('http://127.0.0.1:' + CDP_PORT + '/json/version').then(() => true).catch(() => false);
}

let loginRunning = false;

async function runLogin() {
  if (loginRunning) return { ok: false, error: 'login_in_progress' };
  loginRunning = true;
  try {
    const chrome = resolveChrome();
    if (!chrome) return { ok: false, error: 'chrome_not_found' };
    const profileDir = path.join(app.getPath('userData'), 'chrome-profile');
    const alreadyUp = await cdpReady();
    if (!alreadyUp) {
      const child = spawn(chrome, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profileDir,
        '--no-first-run',
        '--no-default-browser-check',
        'https://www.eldorado.gg',
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      let ready = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await cdpReady()) { ready = true; break; }
      }
      if (!ready) return { ok: false, error: 'chrome_cdp_timeout' };
    }
    const exitCode = await new Promise((resolve) => {
      const bot = spawn(NODE_BIN, [LOGIN_MAIN], {
        cwd: BOT_DIR,
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, ELBOT_STATE_DIR: sessionStateDir(), CDP_PORT, LOGIN_TIMEOUT: String(180000), ELBOT_CLOSE_CHROME: alreadyUp ? '0' : '1' },
      });
      bot.on('exit', (code) => resolve(code == null ? 1 : code));
      bot.on('error', () => resolve(2));
    });
    if (exitCode !== 0) return { ok: false, error: 'login_failed' };
    const authFile = path.join(sessionStateDir(), 'auth.json');
    const ok = fs.existsSync(authFile);
    if (ok) {
      if (botChild) { try { botChild.kill(); } catch (e) {} }
      botChild = null;
      clearTimeout(respawnTimer);
      startBot();
    }
    return ok ? { ok: true, message: 'Sesión de Eldorado guardada. El bot la está usando.' } : { ok: false, error: 'login_failed' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    loginRunning = false;
  }
}

async function injectSession(port, token) {
  try {
    await session.defaultSession.cookies.set({
      url: 'http://' + PANEL_HOST + ':' + port + '/',
      name: 'elbot_session', value: token, httpOnly: true, sameSite: 'lax',
      expirationDate: Math.floor(Date.now() / 1000) + 2592000,
    });
  } catch (e) {}
}

async function doLogin(key, keepSession) {
  const port = await ensureBot();
  if (port == null) return { ok: false, error: 'bot_down' };
  const r = await httpJson('http://' + PANEL_HOST + ':' + port + '/api/login', { method: 'POST', body: { key: key, device: getDeviceId() } });
  if (r.data && r.data.ok && r.data.subscription) {
    const token = extractSession(r.setCookie);
    if (token) await injectSession(port, token);
    const cfg = readConfig();
    cfg.port = port;
    if (keepSession) { cfg.key = key.toUpperCase(); cfg.keepSession = true; }
    else { delete cfg.key; cfg.keepSession = false; }
    writeConfig(cfg);
    return { ok: true, subscription: r.data.subscription };
  }
  return { ok: false, error: (r.data && r.data.error) || 'invalid', maxDevices: r.data && r.data.maxDevices };
}

ipcMain.handle('login', (e, key, keepSession) => doLogin(String(key || '').trim(), !!keepSession));

ipcMain.handle('set-keep-session', (e, keep) => {
  const cfg = readConfig();
  cfg.keepSession = !!keep;
  if (!cfg.keepSession) delete cfg.key;
  writeConfig(cfg);
  return { ok: true, keepSession: !!keep };
});

ipcMain.on('panel-logout', () => {
  quitting = true;
  app.quit();
});

ipcMain.handle('login-eldorado', runLogin);

ipcMain.handle('refresh', async () => {
  const port = await ensureBot();
  if (port == null) return { ok: false, error: 'bot_down' };
  const cfg = readConfig();
  if (!cfg.key) return { ok: false, error: 'no_key' };
  return doLogin(cfg.key, !!cfg.keepSession);
});

ipcMain.handle('open-panel', async () => {
  const port = await ensureBot();
  if (port == null) return { ok: false };
  openPanelWindow(port);
  return { ok: true };
});

ipcMain.handle('get-status', async () => {
  const port = await findPort();
  const cfg = readConfig();
  let online = false;
  let version = null;
  if (port != null) {
    try {
      const v = await httpJson('http://' + PANEL_HOST + ':' + port + '/api/version', {});
      online = true;
      version = v.data && v.data.version;
    } catch (e) { online = false; }
  }
  return {
    ok: true,
    online,
    botVersion: version,
    launcherVersion: VERSION,
    autostart: app.getLoginItemSettings().openAtLogin,
    key: cfg.key || null,
    port: cfg.port || port,
    session: fs.existsSync(path.join(sessionStateDir(), 'auth.json')),
    keepSession: !!cfg.keepSession,
    loginRunning,
  };
});

ipcMain.handle('set-autostart', (e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return { ok: true, autostart: !!enabled };
});

ipcMain.handle('restart-bot', async () => {
  if (botChild) { try { botChild.kill(); } catch (e) {} }
  botChild = null;
  clearTimeout(respawnTimer);
  startBot();
  return { ok: true };
});

ipcMain.handle('open-store', async () => {
  try {
    const port = await ensureBot();
    const plans = await httpJson('http://' + PANEL_HOST + ':' + port + '/api/plans', {});
    const storePort = plans.data && plans.data.storePort;
    const storeUrl = 'http://' + PANEL_HOST + ':' + (storePort || 8080) + '/';
    shell.openExternal(storeUrl);
    return { ok: true, url: storeUrl };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('quit-app', () => { quitting = true; app.quit(); });

function normalizeAccelerator(str) {
  return String(str || '')
    .split('+')
    .map(function (s) {
      s = s.trim();
      if (!s) return '';
      var low = s.toLowerCase();
      if (low === 'ctrl') return 'Control';
      if (low === 'cmd' || low === 'win') return 'Command';
      if (low === 'opt') return 'Alt';
      if (low === 'esc') return 'Escape';
      if (low === 'del') return 'Delete';
      if (low === 'ins') return 'Insert';
      if (s.length === 1 && /[a-z]/i.test(s)) return s.toUpperCase();
      return s;
    })
    .filter(Boolean)
    .join('+');
}

function togglePanelVisibility() {
  if (panelWin && !panelWin.isDestroyed()) {
    if (panelWin.isVisible()) panelWin.hide();
    else { panelWin.show(); panelWin.focus(); }
    return;
  }
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.show();
    launcherWin.focus();
  }
}

let registeredHotkey = null;
function registerHotkey(accel) {
  const norm = normalizeAccelerator(accel);
  try { if (registeredHotkey) globalShortcut.unregister(registeredHotkey); } catch (e) {}
  registeredHotkey = null;
  if (!norm) return;
  try {
    if (globalShortcut.register(norm, togglePanelVisibility)) registeredHotkey = norm;
    else console.log('[hotkey] No se pudo registrar: ' + norm);
  } catch (e) {
    console.log('[hotkey] Error al registrar: ' + norm);
  }
}

ipcMain.handle('set-hotkey', (e, accel) => {
  registerHotkey(accel);
  return { ok: true, registered: registeredHotkey };
});

function openPanelWindow(port) {
  if (panelWin && !panelWin.isDestroyed()) { panelWin.focus(); return; }
  setPanelActive(true);
  panelWin = new BrowserWindow({
    width: 1240, height: 820, frame: false, backgroundColor: '#0b101f', title: 'BoostPilot',
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.setMenuBarVisibility(false);
  panelWin.loadURL('http://' + PANEL_HOST + ':' + port + '/');
  panelWin.on('closed', () => {
    panelWin = null;
    setPanelActive(false);
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.show();
  });
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.hide();
}

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 420, height: 560, resizable: false, frame: false, backgroundColor: '#000',
    title: 'BoostPilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  launcherWin.setMenuBarVisibility(false);
  launcherWin.loadFile(path.join(__dirname, 'index.html'));
  launcherWin.on('closed', () => { launcherWin = null; });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (launcherWin && !launcherWin.isDestroyed()) {
      if (launcherWin.isMinimized()) launcherWin.restore();
      launcherWin.show();
      launcherWin.focus();
    }
  });

  app.whenReady().then(() => {
    setPanelActive(false);
    registerHotkey('Ctrl+Z');
    createLauncherWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createLauncherWindow();
    });
  });

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch (e) {}
  });

  app.on('window-all-closed', () => {
    quitting = true;
    if (botStartedByUs && botChild) { try { botChild.kill(); } catch (e) {} }
    app.quit();
  });
}
