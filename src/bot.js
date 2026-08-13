import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import { exec, spawn, execSync, spawnSync } from 'node:child_process';
import { notifyWindows } from './notify.js';
import { startDashboardServer } from './dashboard.js';
import { FastMode } from './fast-mode.mjs';
import { startStoreServer } from './store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'config', 'rules.json');
let config = JSON.parse(await fs.readFile(configPath, 'utf8'));

const _fastStart = config.bot && config.bot.fastMode;
if (_fastStart && (_fastStart.autoPlace === true || _fastStart.autoPlace === 'auto')) {
  _fastStart.autoPlace = false;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log('[fast][SEGURIDAD] El modo AUTOMATICO se desactivo al iniciar. Solo se activa manualmente desde el panel.');
}
const stateDir = process.env.ELBOT_STATE_DIR || join(root, 'state');
mkdirSync(stateDir, { recursive: true });
const seenFile = join(stateDir, 'seen.json');
const dashboardFile = join(stateDir, 'dashboard.json');
const authFile = join(stateDir, 'auth.json');
const profileDir = join(dirname(stateDir), 'chrome-profile');
const panelActiveFile = join(stateDir, 'panel-active');

function panelActive() {
  try {
    return readFileSync(panelActiveFile, 'utf8').trim() !== '0';
  } catch (e) {
    return true;
  }
}

async function reloadConfig() {
  config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (fastModeInstance) fastModeInstance.config = config;
}

async function saveConfig(games) {
  const next = { ...config, games };
  await fs.writeFile(configPath, JSON.stringify(next, null, 2));
  await reloadConfig();
  console.log('[config] Juegos actualizados desde el panel.');
}

async function saveSettings({ filters, chat, fastMode, pricing, notify, hotkeys } = {}) {
  const next = { ...config };
  const prevAutoPlace = config.bot && config.bot.fastMode ? config.bot.fastMode.autoPlace : undefined;
  if (filters && typeof filters === 'object') next.filters = filters;
  if (chat && typeof chat === 'object') next.chat = { ...next.chat, ...chat };
  if (fastMode && typeof fastMode === 'object') {
    next.bot = { ...next.bot, fastMode: { ...next.bot.fastMode, ...fastMode } };
  }
  if (pricing && typeof pricing === 'object') {
    next.bot = { ...next.bot, pricing: { ...next.bot.pricing, ...pricing } };
  }
  if (notify && typeof notify === 'object') {
    next.notify = { ...next.notify, ...notify };
  }
  if (hotkeys && typeof hotkeys === 'object') {
    next.hotkeys = { ...(next.hotkeys || {}), ...hotkeys };
  }
  await fs.writeFile(configPath, JSON.stringify(next, null, 2));
  await reloadConfig();
  if (fastMode && typeof fastMode === 'object' && fastMode.autoPlace !== undefined && String(fastMode.autoPlace) !== String(prevAutoPlace)) {
    const ap = fastMode.autoPlace;
    console.log(ap === true || ap === 'auto'
      ? '[fast] MODO AUTOMÁTICO ACTIVADO: se empiezan a enviar ofertas de forma automática. Buscando nuevas ofertas...'
      : (ap === false || ap === 'off'
        ? '[fast] MODO DESACTIVADO (solo detecta): no se envían ofertas.'
        : '[fast] MODO SEMI-AUTOMÁTICO: las ofertas quedan en Confirmar en el panel.'));
  }
  console.log('[config] Ajustes (filtros/chat/fastMode/precios/webhook) actualizados desde el panel.');
}

let seen = new Set();
try {
  seen = new Set(JSON.parse(await fs.readFile(seenFile, 'utf8')));
} catch {}

let dashboard = [];
try {
  dashboard = JSON.parse(await fs.readFile(dashboardFile, 'utf8'));
} catch {}

const activityFile = join(stateDir, 'activity.json');
let activity = [];
try {
  activity = JSON.parse(await fs.readFile(activityFile, 'utf8'));
} catch {}
if (!Array.isArray(activity)) activity = [];

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

let _writeChain = Promise.resolve();
function enqueueWrite(fn) {
  _writeChain = _writeChain.then(fn).catch(() => {});
  return _writeChain;
}

function recordActivity(level, args) {
  const msg = args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
  activity.push({ t: new Date().toISOString(), level, msg });
  if (activity.length > 500) activity = activity.slice(-500);
  const doc = JSON.stringify(activity);
  enqueueWrite(() => fs.writeFile(activityFile + '.tmp', doc).then(() => fs.rename(activityFile + '.tmp', activityFile)));
}

console.log = (...args) => { recordActivity('log', args); originalLog(...args); };
console.error = (...args) => { recordActivity('error', args); originalError(...args); };
console.warn = (...args) => { recordActivity('warn', args); originalWarn(...args); };

async function saveSeen() {
  await enqueueWrite(() => fs.writeFile(seenFile + '.tmp', JSON.stringify([...seen])).then(() => fs.rename(seenFile + '.tmp', seenFile)));
}

async function saveDashboard() {
  await enqueueWrite(() => fs.writeFile(dashboardFile + '.tmp', JSON.stringify(dashboard, null, 2)).then(() => fs.rename(dashboardFile + '.tmp', dashboardFile)));
}

function upsertRecord(rec) {
  const idx = dashboard.findIndex((r) => r.id === rec.id);
  if (idx === -1) dashboard.push(rec);
  else dashboard[idx] = rec;
  dashboard = dashboard
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt) || 0)
    .reverse();
  saveDashboard();
}

let lastBeep = 0;
function beep() {
  if (!config.notify.soundEnabled) return;
  if (!panelActive()) return;
  const now = Date.now();
  if (now - lastBeep < (config.notify.soundDurationMs || 1200)) return;
  lastBeep = now;
  try {
    const wav = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'cash.wav');
    if (existsSync(wav)) {
      exec(`powershell -NoProfile -Command "(New-Object Media.SoundPlayer '${wav}').PlaySync()"`);
    } else {
      exec('powershell -c "[console]::beep(880,300);[console]::beep(1320,300);[console]::beep(1760,500)"');
    }
  } catch {}
}

let fastModeInstance = null;

function resolveChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function resetApiSession() {
  if (!fastModeInstance) return;
  fastModeInstance.api.cookie = '';
  fastModeInstance.api.tokenExpiresAt = 0;
}

async function eldoStatus() {
  if (!fastModeInstance) return { linked: false };
  if (!existsSync(authFile)) return { linked: false };
  try {
    const raw = JSON.parse(readFileSync(authFile, 'utf8'));
    const hasId = (raw.cookies || []).some((c) => c.name === '__Host-EldoradoIdToken' && c.value);
    if (!hasId) return { linked: false };
  } catch (e) {
    return { linked: false };
  }
  try {
    let profile = null;
    try { profile = await fastModeInstance.api.getProfile(); } catch (e) { profile = null; }
    const pic = (profile && profile.picture) || null;
    const PROFILE_IMG_BASE = 'https://fileserviceusprod.blob.core.windows.net/profileimages/';
    return {
      linked: true,
      booster: (profile && profile.username) || null,
      email: (profile && profile.email) || null,
      verified: !!(profile && profile.isVerifiedSeller),
      avatar: pic ? {
        small: pic.smallPicture ? PROFILE_IMG_BASE + pic.smallPicture : null,
        medium: pic.mediumPicture ? PROFILE_IMG_BASE + pic.mediumPicture : null,
        large: pic.largePicture ? PROFILE_IMG_BASE + pic.largePicture : null,
      } : null,
      error: profile ? null : 'profile_unavailable',
    };
  } catch (e) {
    return { linked: true, booster: null, error: String(e.message || e) };
  }
}

const loginState = { busy: false, status: '', detail: '', startedAt: 0 };

function eldoLoginStatus() {
  return { ...loginState };
}

function setLoginStatus(status, detail) {
  loginState.status = status;
  loginState.detail = detail || '';
}

function killBotChrome() {
  const script = `
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*${profileDir}*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  try {
    spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 });
  } catch (e) {}
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runLoginAttempt() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    setLoginStatus('opening', 'Abriendo Chrome... (intento ' + attempt + '/3)');
    console.log('[eldo][login] Intento ' + attempt + '/3');
    killBotChrome();
    await sleepMs(1800);
    if (!existsSync(profileDir)) {
      try { await fs.mkdir(profileDir, { recursive: true }); } catch (e) {}
    }
    const chromeChild = spawn(resolveChrome(), [
      '--remote-debugging-port=9222',
      '--user-data-dir=' + profileDir,
      '--no-first-run',
      '--no-default-browser-check',
      'https://www.eldorado.gg',
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    chromeChild.unref();
    const code = await new Promise((resolve) => {
      const login = spawn(process.execPath, [join(root, 'src', 'login.js')], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, ELBOT_STATE_DIR: stateDir, CDP_PORT: '9222', LOGIN_TIMEOUT: '180000', CF_STUCK_TIMEOUT: '30000' },
      });
      login.stdout.on('data', (d) => { const s = d.toString().trim(); if (!s) return; if (s.includes('Verificaci\u00f3n de Cloudflare detectada')) setLoginStatus('cf', 'Cloudflare est\u00e1 verificando el navegador...'); else if (s.includes('Formulario de login detectado')) setLoginStatus('waiting', 'Complet\u00e1 tu usuario y contrase\u00f1a en la ventana de Chrome.'); console.log('[login] ' + s); });
      login.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.error('[login] ' + s); });
      login.on('exit', resolve);
    });
    if (code === 0) {
      resetApiSession();
      if (fastModeInstance) fastModeInstance._noSession = false;
      setLoginStatus('done', 'Sesión de Eldorado guardada.');
      console.log('[eldo][login] Sesión guardada correctamente.');
      return;
    }
    if (code === 3 && attempt < 3) {
      setLoginStatus('retry', 'La verificación de Cloudflare no avanzó. Reintentando... (' + attempt + '/3)');
      console.warn('[eldo][login] Cloudflare no avanzó, se reintenta con una ventana nueva.');
      continue;
    }
    setLoginStatus('failed', code === 3 ? 'La verificación de Cloudflare no avanzó. Vuelve a intentarlo.' : 'No se pudo iniciar sesión en Eldorado. Vuelve a intentarlo.');
    console.error('[eldo][login] El login termin\u00f3 con c\u00f3digo ' + code + ' (no se guard\u00f3 sesi\u00f3n).');
    return;
  }
  setLoginStatus('failed', 'No se pudo completar el login. Revis\u00e1 tu conexi\u00f3n y volv\u00e9 a intentarlo.');
}

function eldoLogin() {
  if (loginState.busy) return { ok: false, error: 'login_already_running' };
  if (!resolveChrome()) return { ok: false, error: 'chrome_not_found' };
  loginState.busy = true;
  loginState.startedAt = Date.now();
  setLoginStatus('starting', '');
  runLoginAttempt().finally(() => {
    loginState.busy = false;
  });
  return { ok: true, started: true };
}

async function eldoLogout() {
  try { await fs.unlink(authFile); } catch (e) {}
  resetApiSession();
  if (fastModeInstance) {
    fastModeInstance._noSession = true;
    fastModeInstance._waitAuth();
  }
  return { ok: true };
}

async function eldoSetSession(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return { ok: false, error: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid_json' };
  let list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cookies) ? parsed.cookies : null);
  if (!list) {
    list = Object.keys(parsed).map((name) => ({ name, value: String(parsed[name] == null ? '' : parsed[name]) }));
  }
  list = (list || []).filter((c) => c && c.name && typeof c.value === 'string');
  if (!list.length) return { ok: false, error: 'no_cookies' };
  const cookies = list.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.eldorado.gg',
    path: c.path || '/',
    expires: typeof c.expires === 'number' ? c.expires : -1,
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite: c.sameSite || 'Lax',
  }));
  if (!cookies.some((c) => c.name === '__Host-EldoradoIdToken' && c.value)) {
    return { ok: false, error: 'invalid_session' };
  }
  try {
    await fs.writeFile(authFile, JSON.stringify({ cookies, origins: [] }));
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  resetApiSession();
  if (fastModeInstance) {
    fastModeInstance._noSession = false;
    fastModeInstance._waitAuth();
  }
  console.log('[eldo][login] Sesi\u00f3n importada desde el panel.');
  return { ok: true };
}

startDashboardServer({
  getData: () => dashboard,
  getConfig: () => config,
  saveConfig,
  saveSettings,
  getActivity: () => activity,
  getFastStats: () => (fastModeInstance ? { ...fastModeInstance.stats, running: !!fastModeInstance.running, noSession: !!fastModeInstance._noSession } : null),
  getPending: () => (fastModeInstance ? fastModeInstance.getPending() : []),
  getOrders: () => (fastModeInstance ? fastModeInstance.getOrders() : []),
  sendReminder: async (id) => (fastModeInstance ? fastModeInstance.sendReminder(id) : { ok: false, error: 'fast mode no disponible' }),
  backup: () => { let k = {}; try { k = JSON.parse(readFileSync(join(stateDir, 'keys.json'), 'utf8')); } catch (e) {} return { keys: k, dashboard, activity, seen: [...seen] }; },
  confirmPlace: async (id, overrides) => fastModeInstance.placePending(id, overrides),
  confirmMessageOnly: async (id, overrides) => fastModeInstance.sendMessageOnly(id, overrides),
  confirmDiscard: async (id) => fastModeInstance.discardPending(id),
  updateOrderPrice: async (id, price) => {
    const out = await fastModeInstance.updateOrderPrice(id, price);
    if (out.ok) {
      const idx = dashboard.findIndex((r) => r.id === id);
      if (idx !== -1) {
        dashboard[idx].price = Number(price);
        saveDashboard();
      }
    }
    return out;
  },
  pause: () => fastModeInstance.pause(),
  resume: () => fastModeInstance.resume(),
  eldoStatus,
  eldoLogin,
  eldoLoginStatus,
  eldoLogout,
  eldoSetSession,
  stop: () => {
    console.log('[panel] Detenido desde el panel. Cerrando el programa...');
    process.exit(0);
  },
}, config.bot.panelPort || 3000);

if (config.store && config.store.enabled) {
  startStoreServer(config.store.port || 8080);
}

if (config.bot.fastMode && config.bot.fastMode.enabled) {
  fastModeInstance = new FastMode({
    config,
    stateDir,
    isSeen: (id) => seen.has(id),
    markSeen: (id) => { seen.add(id); saveSeen(); },
    upsertRecord,
    beep,
    notify: (title, message) => { if (panelActive()) notifyWindows(title, message); },
    onError: (err) => console.error('[fast][error]', err.message),
  });
  await fastModeInstance.start();
} else {
  console.error('[error] FastMode desactivado en config/rules.json. No hay otro modo disponible.');
  process.exit(1);
}
