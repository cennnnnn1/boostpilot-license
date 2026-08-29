import http from 'node:http';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { generateKeys, trialUsed, listKeys, getSubscription, revokeKey, extendKey, deleteKey, markPaid, setKeyVip, updateDevices, keyEvents, aggregateMetrics, bumpKick } from './keys.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = dirname(fileURLToPath(import.meta.url));
const configPath = join(ROOT, 'config', 'rules.json');
const landingHtml = readFileSync(join(SRC, 'landing.html'), 'utf8');
const termsHtml = readFileSync(join(SRC, 'terms.html'), 'utf8');
const privacyHtml = readFileSync(join(SRC, 'privacy.html'), 'utf8');
const adminHtml = readFileSync(join(SRC, 'admin.html'), 'utf8');
const ogPath = join(SRC, 'og.png');
const ogPng = existsSync(ogPath) ? readFileSync(ogPath) : null;

function loadConfig() {
  try {
    let raw = readFileSync(configPath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getStore(cfg) {
  const store = (cfg && cfg.store) || {};
  const plans = store.plans || {};
  const payment = store.payment || { currency: 'USD', methods: [], note: '' };
  return { plans, payment };
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
    req.on('end', () => resolve(body));
  });
}

const adminSessions = new Map();
const loginFails = new Map();

function getCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

function adminAuthed(req) {
  const t = getCookie(req, 'elbot_admin');
  return !!t && adminSessions.has(t);
}

function requireAdmin(req, res) {
  if (!adminAuthed(req)) {
    json(res, 401, { ok: false, error: 'admin_required' });
    return true;
  }
  return false;
}

function loginLocked(ip) {
  const r = loginFails.get(ip);
  if (!r) return false;
  if (Date.now() - r.at > 60000) { loginFails.delete(ip); return false; }
  return r.n >= 5;
}

function loginFail(ip) {
  const r = loginFails.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - r.at > 60000) { r.n = 0; r.at = Date.now(); }
  r.n++;
  loginFails.set(ip, r);
}

export function startStoreServer(port = 8080, license = null) {
  const publishAllNow = async () => {
    if (!license || !license.publishAll) return { published: false, skipped: true };
    try {
      return await license.publishAll();
    } catch (e) {
      return { published: false, error: String(e.message || e) };
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(landingHtml);
      return;
    }
    if (url === '/terms') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(termsHtml);
      return;
    }
    if (url === '/privacy') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(privacyHtml);
      return;
    }
    if ((url === '/og.png' || url === '/apple-touch-icon.png') && ogPng) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(ogPng);
      return;
    }
    if (url === '/api/plans') {
      const { plans, payment } = getStore(loadConfig());
      const list = Object.keys(plans).map((id) => ({ id, ...plans[id] }));
      const cfg = loadConfig();
      const games = Object.keys((cfg.games) || {}).map((id) => ({
        id,
        label: id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      }));
      json(res, 200, { ok: true, plans: list, payment, games });
      return;
    }
    if (url === '/admin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(adminHtml);
      return;
    }
    if (url === '/api/admin/session' && req.method === 'GET') {
      json(res, 200, { ok: true, authed: adminAuthed(req) });
      return;
    }
    if (url === '/api/admin/login' && req.method === 'POST') {
      try {
        const ip = req.socket.remoteAddress || 'local';
        if (loginLocked(ip)) { json(res, 429, { ok: false, error: 'too_many_attempts' }); return; }
        const d = JSON.parse(await readBody(req) || '{}');
        const master = process.env.ELBOT_MASTER_KEY || '';
        if (!master || String(d.masterKey || '').trim() !== master) {
          loginFail(ip);
          json(res, 401, { ok: false, error: 'invalid' });
          return;
        }
        loginFails.delete(ip);
        const token = randomBytes(24).toString('hex');
        adminSessions.set(token, true);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'elbot_admin=' + token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000',
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/admin/logout' && req.method === 'POST') {
      const t = getCookie(req, 'elbot_admin');
      if (t) adminSessions.delete(t);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'elbot_admin=; HttpOnly; Path=/; Max-Age=0',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === '/api/keys' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      const keys = listKeys().map((r) => ({ ...getSubscription(r), raw: r }));
      json(res, 200, { ok: true, keys });
      return;
    }
    if (url === '/api/keys/generate' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const cfg = loadConfig();
        const plans = (cfg.store && cfg.store.plans) || {};
        const planId = String(d.plan || '').trim();
        const trial = !!d.trial;
        const game = String(d.game || '').trim() || null;
        const hours = Math.max(0, parseInt(d.hours, 10) || 0);
        const plan = plans[planId];
        const days = Math.max(0, parseInt(d.days, 10) || (plan && plan.days) || 30);
        const label = plan ? (plan.label || planId) : (d.plan || d.planLabel || (days + ' días'));
        const created = generateKeys({
          owner: String(d.owner || 'Cliente').trim(),
          days,
          hours,
          game,
          trial,
          plan: label,
          count: Math.max(1, parseInt(d.count, 10) || 1),
          note: d.note ? String(d.note).trim() : 'Manual (panel)',
          price: Number(d.price) || (plan && Number(plan.price)) || 0,
          paid: d.paid !== false,
          seller: String(d.seller || '').trim() || null,
        });
        const online = await publishAllNow();
        json(res, 200, { ok: true, keys: created.map((k) => ({ key: k.key, plan: k.plan, days: k.days, hours: k.hours, game: k.game, trial: k.trial })), online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/extend' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const days = Math.max(1, parseInt(d.days, 10) || 7);
        const out = extendKey(String(d.key || ''), days);
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/revoke' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const out = revokeKey(String(d.key || ''));
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/delete' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const out = deleteKey(String(d.key || ''));
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/paid' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const out = markPaid(String(d.key || ''));
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/vip' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const out = setKeyVip(String(d.key || ''), !!d.vip);
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/devices' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const out = updateDevices(String(d.key || ''), {
          maxDevices: d.maxDevices !== undefined ? d.maxDevices : undefined,
          clearDevices: !!d.clearDevices,
          reactivate: typeof d.reactivate === 'boolean' ? d.reactivate : undefined,
        });
        const online = out.ok ? await publishAllNow() : null;
        json(res, out.ok ? 200 : 400, { ...out, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/keys/reset-device' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const key = String(d.key || '').trim();
        const remote = license && license.resetDevice ? await license.resetDevice(key) : { ok: false, error: 'license_not_available' };
        const local = updateDevices(key, { clearDevices: true });
        const kick = bumpKick(key);
        const online = (remote.ok || kick.ok) ? await publishAllNow() : null;
        json(res, 200, { ok: true, key, remote, local, kick, online });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/admin/devices' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      try {
        const map = license && license.getDevicesMap ? await license.getDevicesMap() : {};
        json(res, 200, { ok: true, devices: map });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url && url.split('?')[0] === '/api/keys/logs' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      const u = new URL(req.url, 'http://localhost');
      const key = String(u.searchParams.get('key') || '').trim();
      if (!key) { json(res, 400, { ok: false, error: 'key_required' }); return; }
      const rec = listKeys().find((r) => r.key.toUpperCase() === key.toUpperCase());
      if (!rec) { json(res, 404, { ok: false, error: 'not_found' }); return; }
      json(res, 200, { ok: true, key: rec.key, owner: rec.owner, log: keyEvents(rec.id) });
      return;
    }
    if (url === '/api/admin/metrics' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      json(res, 200, { ok: true, stats: aggregateMetrics() });
      return;
    }
    if (url === '/api/admin/export' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      const rows = listKeys().map((r) => ({ ...getSubscription(r) }));
      const head = ['key', 'owner', 'plan', 'price', 'seller', 'state', 'paid', 'daysLeft', 'deviceCount', 'expiresAt', 'createdAt'];
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = [head.join(',')].concat(rows.map((r) => {
        const state = !r.active ? 'revoked' : (!r.paid ? 'unpaid' : (r.expired ? 'expired' : (r.activatedAt ? 'active' : 'unused')));
        return [r.key, r.owner, r.plan, r.price, r.seller, state, r.paid ? '1' : '0', r.daysLeft, r.deviceCount, r.expiresAt, r.createdAt].map(esc).join(',');
      })).join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="keys.csv"',
      });
      res.end('\uFEFF' + csv);
      return;
    }
    if (url === '/api/buy' && req.method === 'POST') {
      try {
        const d = JSON.parse(await readBody(req) || '{}');
        const cfg = loadConfig();
        const { plans, payment } = getStore(cfg);
        const planId = String(d.plan || '').trim();
        const plan = plans[planId];
        if (!plan) { json(res, 400, { ok: false, error: 'invalid_plan' }); return; }
        const owner = String(d.owner || 'Cliente').trim();
        if (Number(plan.price) === 0 && trialUsed(owner)) {
          json(res, 400, { ok: false, error: 'trial_used' });
          return;
        }
        const [created] = generateKeys({
          owner,
          days: Math.max(1, parseInt(plan.days, 10) || 1),
          plan: plan.label || planId,
          count: 1,
          note: 'Compra landing (' + planId + ')',
          paid: Number(plan.price) === 0,
          price: Number(plan.price) || 0,
        });
        json(res, 200, {
          ok: true,
          key: created.key,
          plan: { id: planId, label: plan.label, days: plan.days, price: plan.price },
          payment,
        });
        void publishAllNow();
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (url === '/api/admin/license' && req.method === 'GET') {
      if (requireAdmin(req, res)) return;
      json(res, 200, { ok: true, license: license && license.diagnostics ? license.diagnostics() : { onlineCheck: false, pushConfigured: false } });
      return;
    }
    if (url === '/api/admin/license/push' && req.method === 'POST') {
      if (requireAdmin(req, res)) return;
      try {
        if (!license || !license.publishHashes) throw new Error('licencia no disponible');
        const hashes = listKeys().filter((r) => !r.active).map((r) => r.key).filter(Boolean);
        if (hashes.length === 0) { json(res, 200, { ok: true, published: true, count: 0, message: 'No hay llaves revocadas que sincronizar.' }); return; }
        const out = await license.publishHashes(hashes);
        json(res, out.published ? 200 : 400, { ok: !!out.published, ...out });
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', () => {
    console.log(`[store] Puerto ${port} ocupado, probando ${port + 1}...`);
    startStoreServer(port + 1, license);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[store] Tienda online en: http://localhost:${port}`);
  });
  return server;
}
