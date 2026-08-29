import { randomBytes, randomUUID, createHash } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_ROOT = process.env.ELBOT_STATE_DIR || join(ROOT, 'state');
const KEYS_FILE = join(STATE_ROOT, 'keys.json');
const LOGS_DIR = join(STATE_ROOT, 'logs');
const DAY = 86400000;
const HOUR = 3600000;
const DEFAULT_MAX_DEVICES = 1;

let _writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  _writeQueue = _writeQueue.then(fn).catch(() => {});
  return _writeQueue;
}

function sha256Key(raw) {
  return createHash('sha256').update(String(raw || '').trim().toUpperCase()).digest('hex');
}

function durationHours(rec) {
  return (Math.max(0, parseInt(rec.days, 10) || 0) * 24) + (Math.max(0, parseInt(rec.hours, 10) || 0));
}

function load() {
  try {
    let raw = readFileSync(KEYS_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) {
    return { keys: [] };
  }
}

function save(data) {
  mkdirSync(dirname(KEYS_FILE), { recursive: true });
  const tmp = KEYS_FILE + '.' + process.pid + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, KEYS_FILE);
}

function logFile(keyId) {
  return join(LOGS_DIR, `${keyId}.json`);
}

export function logKeyEvent(keyId, msg) {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    let log = [];
    try {
      let raw = readFileSync(logFile(keyId), 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      log = JSON.parse(raw) || [];
    } catch {}
    log.push({ t: new Date().toISOString(), msg });
    if (log.length > 300) log = log.slice(-300);
    const lf = logFile(keyId);
    const tmp = lf + '.' + process.pid + '.tmp';
    writeFileSync(tmp, JSON.stringify(log, null, 2), 'utf8');
    renameSync(tmp, lf);
  } catch (e) {}
}

export function keyEvents(keyId) {
  try {
    let raw = readFileSync(logFile(keyId), 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function newKey() {
  const groups = [];
  for (let i = 0; i < 4; i++) groups.push(randomBytes(2).toString('hex').toUpperCase());
  return groups.join('-');
}

export function generateKeys({ owner, days, plan, count = 1, note = '', paid = true, price = 0, seller = null, hours = 0, game = null, trial = false }) {
  const data = load();
  const created = [];
  for (let i = 0; i < count; i++) {
    const rec = {
      id: randomUUID(),
      key: newKey(),
      owner: owner || 'Cliente',
      plan: plan || `${days} días`,
      days,
      hours: Math.max(0, parseInt(hours, 10) || 0),
      game: game || null,
      trial: !!trial,
      note,
      createdAt: new Date().toISOString(),
      activatedAt: null,
      expiresAt: null,
      active: true,
      paid: paid !== false,
      price: Number(price) || 0,
      seller: seller || null,
      vip: false,
      maxDevices: 1,
      devices: [],
      kickEpoch: 0,
      pausedMs: 0,
      pausedAt: null,
    };
    data.keys.push(rec);
    created.push(rec);
    logKeyEvent(rec.id, `Llave generada (${rec.plan}, ${rec.days}d${rec.hours ? ' ' + rec.hours + 'h' : ''}, ${rec.price ? '$' + rec.price : 'gratis'})${rec.game ? ' juego=' + rec.game : ''}${seller ? ' por ' + seller : ''}.`);
  }
  save(data);
  return created;
}

export function findKey(raw) {
  const k = String(raw || '').trim().toUpperCase();
  const data = load();
  return data.keys.find((r) => r.key.toUpperCase() === k) || null;
}

export function getSubscription(rec) {
  if (!rec) return null;
  const now = Date.now();
  const activated = rec.activatedAt ? new Date(rec.activatedAt).getTime() : null;
  const expires = rec.expiresAt ? new Date(rec.expiresAt).getTime() : null;
  let daysLeft = rec.days;
  let hoursLeft = 0;
  let expired = false;
  if (activated && expires) {
    daysLeft = Math.max(0, Math.ceil((expires - now) / DAY));
    hoursLeft = Math.max(0, Math.ceil((expires - now) / HOUR));
    expired = now >= expires;
  }
  return {
    id: rec.id,
    key: rec.key,
    owner: rec.owner,
    plan: rec.plan,
    days: rec.days,
    hours: Math.max(0, parseInt(rec.hours, 10) || 0),
    game: rec.game || null,
    trial: !!rec.trial,
    daysLeft,
    hoursLeft,
    expired,
    active: rec.active,
    paid: rec.paid !== false,
    vip: !!rec.vip,
    maxDevices: Math.max(1, parseInt(rec.maxDevices, 10) || 1),
    deviceCount: Array.isArray(rec.devices) ? rec.devices.length : 0,
    activatedAt: rec.activatedAt,
    expiresAt: rec.expiresAt,
    createdAt: rec.createdAt,
    price: Number(rec.price) || 0,
    seller: rec.seller || null,
    note: rec.note || '',
    remote: !!rec.remote,
    kickEpoch: parseInt(rec.kickEpoch, 10) || 0,
    pausedMs: Math.max(0, parseInt(rec.pausedMs, 10) || 0),
  };
}

export function registerDevice(rec, deviceId) {
  if (!rec) return { ok: false, error: 'invalid' };
  if (!deviceId) return { ok: true, deviceCount: Array.isArray(rec.devices) ? rec.devices.length : 0 };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  if (!r) return { ok: false, error: 'invalid' };
  if (!Array.isArray(r.devices)) r.devices = [];
  if (r.devices.includes(deviceId)) return { ok: true, deviceCount: r.devices.length };
  if (r.devices.length >= 8) r.devices = r.devices.slice(-7);
  r.devices.push(deviceId);
  if (rec) {
    if (!Array.isArray(rec.devices)) rec.devices = [];
    if (!rec.devices.includes(deviceId)) rec.devices.push(deviceId);
  }
  logKeyEvent(r.id, `Dispositivo registrado (local, informativo): ${deviceId} (${r.devices.length}).`);
  save(data);
  return { ok: true, deviceCount: r.devices.length };
}

export function updateDevices(raw, { clearDevices, reactivate } = {}) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (clearDevices) {
    const removed = (r.devices || []).length;
    r.devices = [];
    logKeyEvent(r.id, `Se desvincularon ${removed} dispositivo(s) (local).`);
  }
  if (reactivate !== undefined && typeof reactivate === 'boolean') {
    r.active = reactivate;
    if (reactivate) {
      const pausedMs = Math.max(0, parseInt(r.pausedMs, 10) || 0);
      if (r.pausedAt) {
        const delta = Date.now() - Date.parse(r.pausedAt);
        if (!Number.isNaN(delta) && delta > 0) r.pausedMs = pausedMs + delta;
      }
      r.pausedAt = null;
      logKeyEvent(r.id, reactivate ? `Llave reactivada (tiempo congelado: +${Math.round(r.pausedMs / 86400000 * 10) / 10} días en total).` : 'Llave desactivada.');
    } else {
      logKeyEvent(r.id, 'Llave desactivada.');
    }
  }
  save(data);
  return { ok: true, key: rec.key, maxDevices: 1, deviceCount: r.devices.length, active: r.active };
}

export function mergeRemoteKey(raw, entry) {
  const k = String(raw || '').trim().toUpperCase();
  if (!k || !entry || typeof entry !== 'object') return { ok: false, error: 'invalid' };
  const data = load();
  let r = data.keys.find((x) => x.key.toUpperCase() === k) || null;
  let created = false;
  if (!r) {
    r = {
      id: 'remote-' + sha256Key(k),
      key: k,
      owner: entry.owner || 'Cliente',
      plan: entry.plan || `${entry.days || 0} días`,
      days: Math.max(0, parseInt(entry.days, 10) || 0),
      hours: Math.max(0, parseInt(entry.hours, 10) || 0),
      game: entry.game || null,
      trial: !!entry.trial,
      note: 'Activada remotamente',
      createdAt: new Date().toISOString(),
      activatedAt: null,
      expiresAt: null,
      active: entry.active !== false,
      paid: entry.paid !== false,
      price: 0,
      seller: null,
      vip: false,
      maxDevices: 1,
      devices: [],
      remote: true,
      kickEpoch: parseInt(entry.kickEpoch, 10) || 0,
      pausedMs: Math.max(0, parseInt(entry.pausedMs, 10) || 0),
      pausedAt: null,
    };
    data.keys.push(r);
    created = true;
  }

  const prevDur = durationHours(r);
  r.active = entry.active !== false;
  r.paid = entry.paid !== false;
  r.vip = false;
  r.trial = !!entry.trial;
  r.game = entry.game || r.game || null;
  r.plan = entry.plan || r.plan;
  r.maxDevices = 1;
  if (r.hours > 0 || (entry.hours && entry.hours > 0)) r.hours = Math.max(0, parseInt(entry.hours, 10) || 0);
  r.days = Math.max(0, parseInt(entry.days, 10) || 0);

  const newDur = durationHours(r);
  if (r.activatedAt && r.expiresAt && newDur > prevDur) {
    const base = Math.max(Date.now(), new Date(r.expiresAt).getTime());
    const deltaH = newDur - prevDur;
    r.expiresAt = new Date(base + deltaH * HOUR).toISOString();
  }

  r.kickEpoch = parseInt(entry.kickEpoch, 10) || 0;
  const entryPaused = Math.max(0, parseInt(entry.pausedMs, 10) || 0);
  const localPaused = Math.max(0, parseInt(r.pausedMs, 10) || 0);
  if (entryPaused > localPaused) {
    const deltaMs = entryPaused - localPaused;
    if (r.expiresAt) {
      r.expiresAt = new Date(new Date(r.expiresAt).getTime() + deltaMs).toISOString();
    } else if (r.activatedAt) {
      r.activatedAt = new Date(new Date(r.activatedAt).getTime() + deltaMs).toISOString();
      r.expiresAt = new Date(Date.now() + durationHours(r) * HOUR + deltaMs).toISOString();
    }
    r.pausedMs = entryPaused;
    logKeyEvent(r.id, `Tiempo congelado aplicado al reactivar: +${Math.round(deltaMs / 86400000 * 10) / 10} días.`);
  } else {
    r.pausedMs = entryPaused;
  }

  save(data);
  if (created) logKeyEvent(r.id, 'Llave activada desde el índice remoto.');
  else logKeyEvent(r.id, 'Estado sincronizado con el índice remoto.');
  return { ok: true, rec: r, created };
}

export function validateLogin(raw, deviceId = null, remoteEntry = null) {
  let rec = findKey(raw);
  if (remoteEntry) {
    const merged = mergeRemoteKey(raw, remoteEntry);
    if (!merged.ok) return { ok: false, error: 'invalid' };
    rec = findKey(raw);
    if (!rec) return { ok: false, error: 'invalid' };
  }
  if (!rec) return { ok: false, error: 'invalid' };
  if (!rec.active) return { ok: false, error: 'revoked' };
  if (rec.paid === false && !rec.trial) return { ok: false, error: 'unpaid' };
  if (!rec.activatedAt) {
    rec.activatedAt = new Date().toISOString();
    const dur = rec.hours > 0 ? rec.hours * HOUR : rec.days * DAY;
    rec.expiresAt = new Date(Date.now() + dur).toISOString();
    const data = load();
    const r = data.keys.find((x) => x.id === rec.id);
    if (r) {
      r.activatedAt = rec.activatedAt;
      r.expiresAt = rec.expiresAt;
    }
    save(data);
    logKeyEvent(rec.id, `Llave activada por primera vez (${rec.hours > 0 ? rec.hours + ' horas' : rec.days + ' días'} desde hoy).`);
  }
  const dev = registerDevice(rec, deviceId);
  if (!dev.ok) return { ok: false, error: dev.error, maxDevices: dev.maxDevices };
  const sub = getSubscription(rec);
  if (sub.expired) return { ok: false, error: 'expired', subscription: sub };
  logKeyEvent(rec.id, 'Login exitoso.');
  return { ok: true, subscription: sub };
}

export function listKeys() {
  return load().keys;
}

export function revokeKey(raw) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  r.active = false;
  r.pausedAt = new Date().toISOString();
  save(data);
  logKeyEvent(r.id, 'Llave revocada (pausa iniciada).');
  return { ok: true, key: rec.key };
}

export function deleteKey(raw) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  data.keys = data.keys.filter((x) => x.id !== rec.id);
  save(data);
  logKeyEvent(rec.id, 'Llave eliminada definitivamente.');
  return { ok: true, key: rec.key };
}

export function bumpKick(raw) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  if (!r) return { ok: false, error: 'not_found' };
  r.kickEpoch = (parseInt(r.kickEpoch, 10) || 0) + 1;
  save(data);
  logKeyEvent(r.id, 'Señal de expulsión enviada (reset HWID).');
  return { ok: true, key: rec.key, kickEpoch: r.kickEpoch };
}

export function markPaid(raw) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  r.paid = true;
  save(data);
  logKeyEvent(r.id, 'Pago confirmado (marcada como pagada).');
  return { ok: true, key: rec.key, plan: r.plan };
}

export function extendKey(raw, extraDays) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  r.days += extraDays;
  if (r.expiresAt) {
    const base = Math.max(Date.now(), new Date(r.expiresAt).getTime());
    r.expiresAt = new Date(base + extraDays * DAY).toISOString();
  }
  save(data);
  logKeyEvent(r.id, `Renovada/extendida +${extraDays} d\u00edas.`);
  return { ok: true, key: rec.key, days: r.days, expiresAt: r.expiresAt };
}

export function setKeyVip(raw, vip) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  r.vip = !!vip;
  save(data);
  logKeyEvent(r.id, vip ? 'Marcada como VIP.' : 'Quitada de VIP.');
  return { ok: true, key: rec.key, vip: !!vip };
}

export function trialUsed(owner) {
  const o = String(owner || '').trim().toLowerCase();
  if (!o) return false;
  return load().keys.some((k) => String(k.owner || '').trim().toLowerCase() === o && k.plan === 'Prueba');
}

export function aggregateMetrics() {
  const keys = listKeys();
  const now = Date.now();
  const stats = {
    total: keys.length,
    active: 0,
    expired: 0,
    revoked: 0,
    unpaid: 0,
    used: 0,
    unused: 0,
    vip: 0,
    revenue: 0,
    revenuePaid: 0,
    perPlan: {},
    perSeller: {},
  };
  for (const k of keys) {
    const sub = getSubscription(k);
    if (!sub.active) stats.revoked++;
    else if (!sub.paid) stats.unpaid++;
    else if (sub.expired) stats.expired++;
    else stats.active++;
    if (sub.activatedAt) stats.used++; else stats.unused++;
    if (sub.vip) stats.vip++;
    stats.revenue += sub.price || 0;
    if (sub.paid) stats.revenuePaid += sub.price || 0;
    stats.perPlan[sub.plan] = (stats.perPlan[sub.plan] || 0) + 1;
    const seller = sub.seller || 'directo';
    stats.perSeller[seller] = (stats.perSeller[seller] || 0) + 1;
  }
  return stats;
}
