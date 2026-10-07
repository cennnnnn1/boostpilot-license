const { app, BrowserWindow, ipcMain, session, shell, globalShortcut, Menu, clipboard, screen, Notification } = require('electron');
const { spawn, execSync } = require('child_process');
const { createHash, randomBytes } = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BOT_DIR = app.isPackaged ? path.join(process.resourcesPath, 'bot') : path.resolve(__dirname, '..');
const BOT_MAIN = 'src/bot.js';
const LOGIN_MAIN = 'src/login.js';
const NODE_BIN = app.isPackaged ? path.join(process.resourcesPath, 'node', 'node.exe') : 'node';
const CDP_PORT = '9222';
const PANEL_HOST = '127.0.0.1';
const START_PORT = 3000;
const MAX_PORT = 3005;
const CONFIG_FILE = path.join(app.getPath('userData'), 'launcher.json');
const VERSION = '1.7.28';
const UPDATE_REPO = 'cennnnnn1/boostpilot-license';
const UPDATE_API = 'https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest';

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
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) {}
}
function stableMachineId() {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SystemInformation',
  ];
  const names = ['MachineGuid', 'BIOSVersion'];
  try {
    for (const k of keys) {
      for (const n of names) {
        try {
          const out = execSync('reg query "' + k + '" /v ' + n, { windowsHide: true, timeout: 5000, encoding: 'utf8' });
          const m = /REG_(SZ|EXPA([^ ]*))\s+([^\s]{4,})/i.exec(out);
          if (m && m[3]) return m[3].toLowerCase();
        } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    const out = execSync('wmic csproduct get uuid', { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    const m = /[0-9a-fA-F-]{16,}/.exec(out.replace(/^[^\n]*\n/, ''));
    if (m && m[0]) return m[0].toLowerCase();
  } catch (e) {}
  return null;
}
function getDeviceId() {
  const cfg = readConfig();
  if (cfg.deviceId && /^[0-9a-f]{24}$/.test(cfg.deviceId)) return cfg.deviceId;
  const mid = stableMachineId();
  const deviceId = mid
    ? createHash('sha256').update('boostpilot:' + mid).digest('hex').slice(0, 24)
    : randomBytes(12).toString('hex');
  writeConfig({ ...cfg, deviceId });
  return deviceId;
}

function getAdminKey() {
  return process.env.ELBOT_MASTER_KEY || '';
}

function httpJson(url, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = (opts && opts.timeoutMs) || timeoutMs || 1500;
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
    req.setTimeout(t, () => { req.destroy(new Error('timeout')); });
    if (opts && opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function isUp(port) {
  return httpJson('http://' + PANEL_HOST + ':' + port + '/api/me', {}).then(() => true).catch(() => false);
}

async function findPort() {
  const ports = [];
  for (let p = START_PORT; p <= MAX_PORT; p++) ports.push(p);
  const results = await Promise.allSettled(ports.map((p) => isUp(p)));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) return ports[i];
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
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
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

function httpsJsonGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BoostPilot/' + VERSION, 'Accept': 'application/vnd.github+json' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}

function versionGt(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function shaFromNotes(body) {
  const m = String(body || '').match(/sha256[\s:=]+([a-f0-9]{64})/i);
  return m ? m[1].toLowerCase() : null;
}

let notifiedVersion = null;
async function checkUpdate() {
  try {
    const { status, data } = await httpsJsonGet(UPDATE_API);
    if (status !== 200 || !data.tag_name) return { ok: false, error: 'fetch_failed' };
    const latest = data.tag_name.replace(/^v/, '');
    const asset = (data.assets || []).find((a) => /\.exe$/i.test(a.name)) || null;
    const available = versionGt(latest, VERSION);
    if (available && notifiedVersion !== latest) {
      notifiedVersion = latest;
      try {
        if (!Notification.isSupported || Notification.isSupported()) {
          new Notification({ title: 'BoostPilot', body: 'Update v' + latest + ' is available' }).show();
        }
      } catch (e) {}
    }
    return {
      ok: true,
      available,
      current: VERSION,
      latest,
      notes: data.body || '',
      url: asset ? asset.browser_download_url : (data.html_url || ''),
      size: asset ? asset.size : 0,
      sha: shaFromNotes(data.body),
    };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 600000);
    const hash = createHash('sha256');
    fetch(url, { headers: { 'User-Agent': 'BoostPilot/' + VERSION }, redirect: 'follow', signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('http_' + res.status);
        const total = Number(res.headers.get('content-length') || 0);
        const reader = res.body.getReader();
        const file = fs.createWriteStream(dest);
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            hash.update(value);
            if (onProgress) onProgress(bytes, total);
            if (!file.write(value)) await new Promise((r) => file.once('drain', r));
          }
          file.end();
          await new Promise((r) => file.once('close', r));
          if (total > 0 && bytes !== total) throw new Error('size_mismatch ' + bytes + '/' + total);
          resolve({ dest, sha256: hash.digest('hex') });
        } catch (e) {
          file.destroy();
          reject(e);
        }
      })
      .catch((e) => { try { fs.unlinkSync(dest); } catch {} reject(e); })
      .finally(() => clearTimeout(timer));
  });
}

async function doUpdate(event) {
  const send = (d) => { try { if (event && event.sender) event.sender.send('update-progress', d); } catch (e) {} };
  let info = null;
  try {
    info = await checkUpdate();
    if (!info.ok || !info.available || !info.url) return { ok: false, error: info.error || 'no_update' };
    const dest = path.join(os.tmpdir(), 'BoostPilot.Setup.' + info.latest + '.exe');
    const attempts = 3;
    let lastErr = null;
    for (let i = 1; i <= attempts; i++) {
      try {
        send({ phase: 'download', pct: 0, received: 0, total: info.size || 0, speed: 0, latest: info.latest, attempt: i });
        let lastSend = 0, lastAt = Date.now(), lastBytes = 0, speed = 0;
        const out = await downloadFile(info.url, dest, (received, total) => {
          const now = Date.now();
          const dt = (now - lastAt) / 1000;
          if (dt >= 0.2) { speed = Math.max(0, (received - lastBytes) / dt); lastAt = now; lastBytes = received; }
          if (now - lastSend < 200 && received !== total) return;
          lastSend = now;
          send({ phase: 'download', pct: total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0, received, total, speed: Math.round(speed), latest: info.latest, attempt: i });
        });
        if (info.sha && out && out.sha256 && out.sha256.toLowerCase() !== info.sha.toLowerCase()) {
          throw new Error('hash_mismatch');
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        try { fs.unlinkSync(dest); } catch (err) {}
        if (i < attempts) {
          send({ phase: 'download', pct: 0, received: 0, total: info.size || 0, speed: 0, latest: info.latest, attempt: i + 1, retrying: true });
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }
    if (lastErr) throw lastErr;
    send({ phase: 'install', pct: 100, latest: info.latest });
    const exePath = app.getPath('exe');
    const cmdline = 'start "" /wait "' + dest + '" /S /currentuser & timeout /t 2 /nobreak >nul & start "" "' + exePath + '"';
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', cmdline], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    setTimeout(() => { quitting = true; try { if (botChild) botChild.kill(); } catch (e) {} app.exit(0); }, 1200);
    return { ok: true, path: dest };
  } catch (e) {
    send({ phase: 'error', latest: info ? info.latest : null });
    return { ok: false, error: String(e.message || e) };
  }
}

ipcMain.handle('check-update', checkUpdate);
ipcMain.handle('apply-update', doUpdate);
ipcMain.handle('clipboard-write', (e, text) => {
  try { clipboard.writeText(String(text == null ? '' : text)); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});


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
      wipeLauncherChrome();
    }
    return ok ? { ok: true, message: 'SesiÃ³n de Eldorado guardada. El bot la estÃ¡ usando.' } : { ok: false, error: 'login_failed' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    loginRunning = false;
  }
}

function wipeLauncherChrome() {
  const profileDir = path.join(app.getPath('userData'), 'chrome-profile');
  try {
    const script = `
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*${profileDir}*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
    execSync('powershell -NoProfile -Command "' + script.replace(/"/g, '\\"').replace(/\n/g, ' ') + '"', { windowsHide: true, timeout: 15000 });
  } catch (e) {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (let i = 0; i < 6; i++) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        if (!fs.existsSync(profileDir)) break;
      } catch (e) {}
      await sleep(1200);
    }
  })();
}

async function injectSession(port, token) {
  try {
    await session.defaultSession.cookies.set({
      url: 'http://' + PANEL_HOST + ':' + port + '/',
      name: 'elbot_session', value: token, httpOnly: true, sameSite: 'lax',
    });
  } catch (e) {}
}

async function doLogin(key, keepSession) {
  try {
    const port = await ensureBot();
    if (port == null) return { ok: false, error: 'bot_down' };
    const r = await httpJson('http://' + PANEL_HOST + ':' + port + '/api/login', { method: 'POST', body: { key: key, device: getDeviceId() } }, 30000);
    if (r.data && r.data.ok && r.data.subscription) {
      const token = extractSession(r.setCookie);
      if (token) await injectSession(port, token);
      const cfg = readConfig();
      cfg.port = port;
      cfg.kickEpoch = (r.data.subscription && r.data.subscription.kickEpoch) || 0;
      if (keepSession) { cfg.key = key.toUpperCase(); cfg.keepSession = true; }
      else { delete cfg.key; cfg.keepSession = false; }
      writeConfig(cfg);
      return { ok: true, subscription: r.data.subscription };
    }
    return { ok: false, error: (r.data && r.data.error) || 'invalid', maxDevices: r.data && r.data.maxDevices };
  } catch (e) {
    return { ok: false, error: 'conn' };
  }
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
  const r = await httpJson('http://' + PANEL_HOST + ':' + port + '/api/login', { method: 'POST', body: { key: cfg.key, device: getDeviceId() } });
  if (r.data && r.data.ok && r.data.subscription) {
    const sub = r.data.subscription;
    const prevKick = cfg.kickEpoch;
    if (typeof prevKick === 'number' && (sub.kickEpoch || 0) !== prevKick) {
      delete cfg.key;
      cfg.keepSession = false;
      writeConfig(cfg);
      closePanelWindow();
      return { ok: false, error: 'reset' };
    }
    const token = extractSession(r.setCookie);
    if (token) await injectSession(port, token);
    cfg.port = port;
    cfg.kickEpoch = sub.kickEpoch || 0;
    writeConfig(cfg);
    return { ok: true, subscription: sub };
  }
  return { ok: false, error: (r.data && r.data.error) || 'invalid', maxDevices: r.data && r.data.maxDevices };
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

function defaultHotkey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'config', 'rules.json'), 'utf8'));
    const h = cfg && cfg.hotkeys && cfg.hotkeys.hide;
    if (h && typeof h === 'string' && h.trim()) return h.trim();
  } catch (e) {}
  return 'F8';
}

function attachContextMenu(win) {
  win.webContents.on('context-menu', (e, params) => {
    const template = [];
    if (params.isEditable) {
      template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      template.push({ role: 'copy' });
    }
    if (params.linkURL && /^https?:\/\//.test(params.linkURL)) {
      template.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
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
  attachContextMenu(panelWin);
  panelWin.loadURL('http://' + PANEL_HOST + ':' + port + '/');
  panelWin.on('closed', () => {
    panelWin = null;
    setPanelActive(false);
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.show();
  });
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.hide();
}

function closePanelWindow() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.destroy();
    panelWin = null;
    setPanelActive(false);
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.show();
  }
}

function savedWindowPos() {
  try {
    const cfg = readConfig();
    if (typeof cfg.winX !== 'number' || typeof cfg.winY !== 'number') return {};
    const W = 420, H = 560;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return cfg.winX + W > a.x && cfg.winX < a.x + a.width && cfg.winY + H > a.y && cfg.winY < a.y + a.height;
    });
    return visible ? { x: cfg.winX, y: cfg.winY } : {};
  } catch (e) { return {}; }
}

function createLauncherWindow() {
  launcherWin = new BrowserWindow(Object.assign({
    width: 420, height: 560, resizable: false, frame: false, backgroundColor: '#000',
    title: 'BoostPilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }, savedWindowPos()));
  launcherWin.setMenuBarVisibility(false);
  attachContextMenu(launcherWin);
  launcherWin.loadFile(path.join(__dirname, 'index.html'));
  let posTimer = null;
  launcherWin.on('moved', () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (!launcherWin || launcherWin.isDestroyed()) return;
      const b = launcherWin.getBounds();
      const cfg = readConfig();
      cfg.winX = b.x; cfg.winY = b.y;
      writeConfig(cfg);
    }, 400);
  });
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
    registerHotkey(defaultHotkey());
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

