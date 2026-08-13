import { randomBytes, randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_ROOT = process.env.ELBOT_STATE_DIR || join(ROOT, 'state');
const KEYS_FILE = join(STATE_ROOT, 'keys.json');
const LOGS_DIR = join(STATE_ROOT, 'logs');
const DAY = 86400000;
const HOUR = 3600000;
const DEFAULT_MAX_DEVICES = 1;

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
  writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function logFile(keyId) {
  return join(LOGS_DIR, `${keyId}.json`);
}

export function logKeyEvent(keyId, msg) {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    let log = [];
    try {
      log = JSON.parse(readFileSync(logFile(keyId), 'utf8')) || [];
    } catch {}
    log.push({ t: new Date().toISOString(), msg });
    if (log.length > 300) log = log.slice(-300);
    writeFileSync(logFile(keyId), JSON.stringify(log, null, 2), 'utf8');
  } catch (e) {}
}

export function keyEvents(keyId) {
  try {
    return JSON.parse(readFileSync(logFile(keyId), 'utf8')) || [];
  } catch {
    return [];
  }
}

function newKey() {
  const groups = [];
  for (let i = 0; i < 4; i++) groups.push(randomBytes(2).toString('hex').toUpperCase());
  return groups.join('-');
}

export function generateKeys({ owner, days, plan, count = 1, note = '', paid = true, price = 0, seller = null, vip = false, maxDevices = DEFAULT_MAX_DEVICES, hours = 0, game = null, trial = false }) {
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
      vip: !!vip,
      maxDevices: Math.max(1, parseInt(maxDevices, 10) || DEFAULT_MAX_DEVICES),
      devices: [],
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
    maxDevices: Math.max(1, parseInt(rec.maxDevices, 10) || DEFAULT_MAX_DEVICES),
    deviceCount: Array.isArray(rec.devices) ? rec.devices.length : 0,
    activatedAt: rec.activatedAt,
    expiresAt: rec.expiresAt,
    createdAt: rec.createdAt,
    price: Number(rec.price) || 0,
    seller: rec.seller || null,
    note: rec.note || '',
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
  const max = Math.max(1, parseInt(r.maxDevices, 10) || DEFAULT_MAX_DEVICES);
  if (r.devices.length >= max) return { ok: false, error: 'device_limit', maxDevices: max };
  r.devices.push(deviceId);
  if (rec) {
    if (!Array.isArray(rec.devices)) rec.devices = [];
    if (!rec.devices.includes(deviceId)) rec.devices.push(deviceId);
  }
  logKeyEvent(r.id, `Dispositivo registrado: ${deviceId} (${r.devices.length}/${max}).`);
  save(data);
  return { ok: true, deviceCount: r.devices.length };
}

export function updateDevices(raw, { maxDevices, clearDevices, reactivate } = {}) {
  const rec = findKey(raw);
  if (!rec) return { ok: false, error: 'not_found' };
  const data = load();
  const r = data.keys.find((x) => x.id === rec.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (maxDevices !== undefined) {
    r.maxDevices = Math.max(1, parseInt(maxDevices, 10) || DEFAULT_MAX_DEVICES);
    logKeyEvent(r.id, `Limite de dispositivos actualizado a ${r.maxDevices}.`);
  }
  if (clearDevices) {
    const removed = (r.devices || []).length;
    r.devices = [];
    logKeyEvent(r.id, `Se desvincularon ${removed} dispositivo(s).`);
  }
  if (reactivate !== undefined && typeof reactivate === 'boolean') {
    r.active = reactivate;
    logKeyEvent(r.id, reactivate ? 'Llave reactivada.' : 'Llave desactivada.');
  }
  save(data);
  return { ok: true, key: rec.key, maxDevices: r.maxDevices, deviceCount: r.devices.length, active: r.active };
}

export function validateLogin(raw, deviceId = null) {
  const rec = findKey(raw);
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
  save(data);
  logKeyEvent(r.id, 'Llave revocada.');
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
