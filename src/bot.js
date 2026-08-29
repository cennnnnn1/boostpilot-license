import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import { execFile, spawn, execSync, spawnSync } from 'node:child_process';
import { notifyWindows } from './notify.js';
import { startDashboardServer } from './dashboard.js';
import { FastMode } from './fast-mode.mjs';
import { startStoreServer } from './store.js';
import { createLicenseChecker } from './license.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(root, 'config', 'rules.json');
function stripBom(s) { return typeof s === 'string' && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }
function readJsonSync(p) { return JSON.parse(stripBom(readFileSync(p, 'utf8'))); }

const _cp1252Rev = new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],[0x2026,0x85],
  [0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],[0x2030,0x89],[0x0160,0x8A],
  [0x2039,0x8B],[0x0152,0x8C],[0x017D,0x8E],[0x2018,0x91],[0x2019,0x92],
  [0x201C,0x93],[0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
  [0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],[0x0153,0x9C],
  [0x017E,0x9E],[0x0178,0x9F],
]);
function fixMojibake(s) {
  if (!s || typeof s !== 'string') return s;
  let cur = s;
  for (let i = 0; i < 5; i++) {
    const bytes = [];
    let ok = true;
    for (const ch of cur) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) { bytes.push(cp); continue; }
      if (cp >= 0xA0 && cp < 0x100) { bytes.push(cp); continue; }
      if (cp >= 0x80 && cp < 0xA0) { bytes.push((_cp1252Rev.get(cp) ?? cp) & 0xFF); continue; }
      const b = _cp1252Rev.get(cp);
      if (b != null) { bytes.push(b); continue; }
      ok = false; break;
    }
    if (!ok) break;
    const dec = Buffer.from(bytes).toString('utf8');
    if (dec.length < cur.length) cur = dec; else break;
  }
  return cur;
}
const CHAT_MSG_KEYS = ['welcomeMessage','prestigeMessage','customRequestMessage','orderAcceptedMessage','followUpMessage','deliveredMessage','orderReceivedMessage'];
function sanitizeChatStrings(chat) {
  if (!chat || typeof chat !== 'object') return chat;
  const out = { ...chat };
  for (const k of CHAT_MSG_KEYS) {
    if (typeof out[k] === 'string') out[k] = fixMojibake(out[k]);
  }
  return out;
}
let config = JSON.parse(stripBom(await fs.readFile(configPath, 'utf8')));
if (config.chat) config.chat = sanitizeChatStrings(config.chat);

const _fastStart = config.bot && config.bot.fastMode;
if (_fastStart && (_fastStart.autoPlace === true || _fastStart.autoPlace === 'auto')) {
  _fastStart.autoPlace = 'confirm';
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log('[fast][SEGURIDAD] El modo AUTOMATICO bajo a SEMI-AUTOMATICO al reiniciar. Solo existen los modos semi y auto; el auto se activa solo desde el panel.');
} else if (_fastStart && (_fastStart.autoPlace === false || _fastStart.autoPlace === 'off')) {
  _fastStart.autoPlace = 'confirm';
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log('[fast] El modo desactivado se migro a SEMI-AUTOMATICO (el modo off ya no existe).');
}
const stateDir = process.env.ELBOT_STATE_DIR || join(root, 'state');
mkdirSync(stateDir, { recursive: true });
const seenFile = join(stateDir, 'seen.json');
const dashboardFile = join(stateDir, 'dashboard.json');
const authFile = join(stateDir, 'auth.json');
const authOwnerFile = join(stateDir, 'auth.owner');
const profileDir = join(dirname(stateDir), 'chrome-profile');
const panelActiveFile = join(stateDir, 'panel-active');
const clientCfgDir = join(stateDir, 'clientcfg');
let activeProfile = null;

function profilePath(keyId) {
  return join(clientCfgDir, String(keyId || '') + '.json');
}

function defaultTemplate() {
  try {
    const tpl = join(root, 'config', 'rules.example.json');
    const raw = existsSync(tpl) ? readFileSync(tpl, 'utf8') : readFileSync(configPath, 'utf8');
    let base = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    if (base.notify && base.notify.discord) {
      base.notify.discord = { ...base.notify.discord, enabled: false, url: '' };
    }
    if (base.store) base.store = { ...base.store, enabled: false };
    return base;
  } catch (e) {
    return readJsonSync(configPath);
  }
}

function mergePricing(stored, tpl) {
  const sp = stored && stored.bot && stored.bot.pricing;
  const tp = tpl && tpl.bot && tpl.bot.pricing;
  if (!tp || !tp.games) return stored;
  if (!sp || !sp.games) {
    return { ...stored, bot: { ...(stored && stored.bot), pricing: JSON.parse(JSON.stringify(tp)) } };
  }
  const games = { ...sp.games };
  let changed = false;
  for (const [game, cats] of Object.entries(tp.games)) {
    if (!games[game]) {
      games[game] = JSON.parse(JSON.stringify(cats));
      changed = true;
      continue;
    }
    let gchanged = false;
    const existing = { ...games[game] };
    for (const [cat, cc] of Object.entries(cats)) {
      if (!existing[cat]) {
        existing[cat] = JSON.parse(JSON.stringify(cc));
        gchanged = true;
        continue;
      }
      if (cc && typeof cc.pacePerDay === 'number' && existing[cat].pacePerDay == null) {
        existing[cat] = { ...existing[cat], pacePerDay: cc.pacePerDay };
        gchanged = true;
      }
    }
    if (gchanged) {
      games[game] = existing;
      changed = true;
    }
  }
  if (!changed) return stored;
  return { ...stored, bot: { ...(stored.bot || {}), pricing: { ...sp, games } } };
}

async function loadProfile(keyId) {
  const p = profilePath(keyId);
  if (existsSync(p)) {
    const stored = JSON.parse(stripBom(await fs.readFile(p, 'utf8')));
    if (stored.chat) stored.chat = sanitizeChatStrings(stored.chat);
    const merged = mergePricing(stored, defaultTemplate());
    if (merged !== stored) await fs.writeFile(p, JSON.stringify(merged, null, 2));
    return merged;
  }
  const base = defaultTemplate();
  mkdirSync(clientCfgDir, { recursive: true });
  await fs.writeFile(p, JSON.stringify(base, null, 2));
  return base;
}

async function persistConfig(next, keyId = null) {
  const file = keyId ? profilePath(keyId) : configPath;
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, file);
  config = next;
  activeProfile = keyId || null;
  if (fastModeInstance) fastModeInstance.config = config;
}

async function applyProfile(keyId) {
  if (!keyId) {
    activeProfile = null;
    config = JSON.parse(stripBom(await fs.readFile(configPath, 'utf8')));
    if (fastModeInstance) fastModeInstance.config = config;
    return;
  }
  const isNewKey = !existsSync(profilePath(keyId));
  if (readAuthOwner() !== keyId) {
    await clearEldoSession();
    console.log('[config] Cambio de llave: sesi\u00f3n de Eldorado cerrada.');
  }
  writeAuthOwner(keyId);
  const next = await loadProfile(keyId);
  config = next;
  activeProfile = keyId;
  if (isNewKey) {
    await resetBotHistory();
    console.log('[config] Llave nueva: historial y paneles en cero.');
  }
  if (fastModeInstance) fastModeInstance.config = config;
  if (fastModeInstance && !fastModeInstance.running) {
    fastModeInstance.start()
      .then(() => console.log('[fast] Sesión iniciada: el bot ya está recibiendo ofertas.'))
      .catch((e) => console.error('[fast] Error al iniciar la sesión: ' + String(e.message || e)));
  }
  console.log('[config] Perfil cargado para la llave activa.');
}

async function resetBotHistory() {
  seen = new Set();
  dashboard = [];
  activity = [];
  if (fastModeInstance) await fastModeInstance.resetHistory();
  await enqueueWrite(() => fs.writeFile(seenFile + '.tmp', JSON.stringify([])).then(() => fs.rename(seenFile + '.tmp', seenFile)));
  await enqueueWrite(() => fs.writeFile(dashboardFile + '.tmp', JSON.stringify([])).then(() => fs.rename(dashboardFile + '.tmp', dashboardFile)));
  await enqueueWrite(() => fs.writeFile(activityFile + '.tmp', JSON.stringify([])).then(() => fs.rename(activityFile + '.tmp', activityFile)));
}

function panelActive() {
  try {
    return readFileSync(panelActiveFile, 'utf8').trim() !== '0';
  } catch (e) {
    return true;
  }
}

async function saveConfig(games, keyId = null) {
  const current = keyId ? await loadProfile(keyId) : config;
  const next = { ...current, games };
  await persistConfig(next, keyId);
  console.log('[config] Juegos actualizados desde el panel.');
}

async function saveSettings({ filters, chat, fastMode, pricing, notify, hotkeys } = {}, keyId = null) {
  const current = keyId ? await loadProfile(keyId) : { ...config };
  const next = { ...current };
  const prevAutoPlace = current.bot && current.bot.fastMode ? current.bot.fastMode.autoPlace : undefined;
  if (filters && typeof filters === 'object') next.filters = filters;
  if (chat && typeof chat === 'object') next.chat = { ...next.chat, ...sanitizeChatStrings(chat) };
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
  await persistConfig(next, keyId);
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
  seen = new Set(JSON.parse(stripBom(await fs.readFile(seenFile, 'utf8'))));
} catch {}

let dashboard = [];
try {
  dashboard = JSON.parse(stripBom(await fs.readFile(dashboardFile, 'utf8')));
} catch {}

const activityFile = join(stateDir, 'activity.json');
let activity = [];
try {
  activity = JSON.parse(stripBom(await fs.readFile(activityFile, 'utf8')));
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
  if (dashboard.length > 500) dashboard = dashboard.slice(0, 500);
  saveDashboard();
}

let lastBeep = 0;
function beep() {
  if (!config.notify.soundEnabled) { return; }
  if (!panelActive()) { return; }
  const now = Date.now();
  if (now - lastBeep < (config.notify.soundDurationMs || 1200)) return;
  lastBeep = now;
  try {
    const wav = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'cash.wav');
    if (existsSync(wav)) {
      const psCmd = `(New-Object Media.SoundPlayer '${wav}').PlaySync()`;
      execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true }, (err) => { if (err) console.error('[beep] error:', err.message); });
    } else {
      execFile('powershell.exe', ['-NoProfile', '-Command', '[console]::beep(880,300);[console]::beep(1320,300);[console]::beep(1760,500)'], { windowsHide: true }, (err) => { if (err) console.error('[beep] fallback error:', err.message); });
    }
  } catch (e) { console.error('[beep] exception:', e.message); }
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
    const raw = JSON.parse(stripBom(readFileSync(authFile, 'utf8')));
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

async function wipeBotProfile() {
  killBotChrome();
  for (let i = 0; i < 6; i++) {
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
      if (!existsSync(profileDir)) break;
    } catch (e) {}
    await sleepMs(1200);
  }
  if (existsSync(profileDir)) {
    console.warn('[eldo][login] No se pudo borrar el perfil de Chrome: ' + profileDir);
  } else {
    console.log('[eldo][login] Perfil de Chrome del bot borrado: la sesion de Google quedo cerrada.');
  }
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
    const net = await import('net');
    const freePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(String(p))); });
      srv.on('error', () => resolve('9222'));
    });
    const chromeChild = spawn(resolveChrome(), [
      '--remote-debugging-port=' + freePort,
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
        env: { ...process.env, ELBOT_STATE_DIR: stateDir, CDP_PORT: freePort, LOGIN_TIMEOUT: '180000', CF_STUCK_TIMEOUT: '30000', ELBOT_CLOSE_CHROME: '1' },
      });
      login.stdout.on('data', (d) => { const s = d.toString().trim(); if (!s) return; if (s.includes('Verificaci\u00f3n de Cloudflare detectada')) setLoginStatus('cf', 'Cloudflare est\u00e1 verificando el navegador...'); else if (s.includes('Formulario de login detectado')) setLoginStatus('waiting', 'Complet\u00e1 tu usuario y contrase\u00f1a en la ventana de Chrome.'); console.log('[login] ' + s); });
      login.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) console.error('[login] ' + s); });
      login.on('exit', resolve);
    });
    if (code === 0) {
      resetApiSession();
      writeAuthOwner(activeProfile);
      if (fastModeInstance) fastModeInstance._noSession = false;
      setLoginStatus('done', 'Sesión de Eldorado guardada.');
      console.log('[eldo][login] Sesión guardada correctamente.');
      await wipeBotProfile();
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
  await clearEldoSession();
  return { ok: true };
}

function readAuthOwner() {
  try {
    const v = readFileSync(authOwnerFile, 'utf8').trim();
    return v || null;
  } catch (e) {
    return null;
  }
}

function writeAuthOwner(id) {
  fs.writeFile(authOwnerFile, String(id || '')).catch(() => {});
}

async function clearEldoSession() {
  try { await fs.unlink(authFile); } catch (e) {}
  try { await fs.unlink(authOwnerFile); } catch (e) {}
  resetApiSession();
  if (fastModeInstance) {
    fastModeInstance._noSession = true;
    fastModeInstance._waitAuth();
  }
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
  writeAuthOwner(activeProfile);
  resetApiSession();
  if (fastModeInstance) {
    fastModeInstance._noSession = false;
    fastModeInstance._waitAuth();
  }
  console.log('[eldo][login] Sesi\u00f3n importada desde el panel.');
  return { ok: true };
}

const license = createLicenseChecker(() => config);
license.startWatcher();

startDashboardServer({
  getData: () => dashboard,
  getConfig: () => config,
  saveConfig,
  saveSettings,
  applyProfile,
  license,
  getActivity: () => activity,
  getFastStats: () => (fastModeInstance ? { ...fastModeInstance.stats, running: !!fastModeInstance.running, noSession: !!fastModeInstance._noSession } : null),
  getPending: () => (fastModeInstance ? fastModeInstance.getPending() : []),
  getOrders: () => (fastModeInstance ? fastModeInstance.getOrders() : []),
  sendReminder: async (id) => (fastModeInstance ? fastModeInstance.sendReminder(id) : { ok: false, error: 'fast mode no disponible' }),
  sendDeliveredById: async (id) => (fastModeInstance ? fastModeInstance.sendDeliveredById(id) : { ok: false, error: 'fast mode no disponible' }),
  sendOrderReceivedById: async (id) => (fastModeInstance ? fastModeInstance.sendOrderReceivedById(id) : { ok: false, error: 'fast mode no disponible' }),
  backup: () => { let k = {}; try { k = readJsonSync(join(stateDir, 'keys.json')); } catch (e) {} return { keys: k, dashboard, activity, seen: [...seen] }; },
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
  startStoreServer(config.store.port || 8080, license);
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
  console.log('[fast] Fast Mode listo. Se inicia cuando entres al panel con tu llave.');
} else {
  console.error('[error] FastMode desactivado en config/rules.json. No hay otro modo disponible.');
  process.exit(1);
}
