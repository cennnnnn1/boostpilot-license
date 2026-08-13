import http from 'node:http';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { generateKeys, trialUsed, listKeys, getSubscription, revokeKey, extendKey, deleteKey } from './keys.mjs';

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
    return JSON.parse(readFileSync(configPath, 'utf8'));
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
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
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

export function startStoreServer(port = 8080) {
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
        const hours = trial ? (Math.max(1, parseInt(d.hours, 10) || 4)) : 0;
        const days = trial ? 0 : (planId && plans[planId] ? Math.max(1, parseInt(plans[planId].days, 10) || 1) : Math.max(1, parseInt(d.days, 10) || 30));
        const plan = plans[planId];
        const label = trial ? 'Prueba' : (plan ? (plan.label || planId) : (d.plan || d.planLabel || days + ' días'));
        const created = generateKeys({
          owner: String(d.owner || 'Cliente').trim(),
          days,
          hours,
          game,
          trial,
          plan: label,
          count: Math.max(1, parseInt(d.count, 10) || 1),
          note: trial ? `Prueba gratis ${hours}h · juego: ${game || '?'}` : 'Manual (panel)',
          price: trial ? 0 : (Number(d.price) || (plan && Number(plan.price)) || 0),
        });
        json(res, 200, { ok: true, keys: created.map((k) => ({ key: k.key, plan: k.plan, days: k.days, hours: k.hours, game: k.game, trial: k.trial })) });
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
        json(res, out.ok ? 200 : 400, out);
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
        json(res, out.ok ? 200 : 400, out);
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
        json(res, out.ok ? 200 : 400, out);
      } catch (e) {
        json(res, 400, { ok: false, error: String(e.message || e) });
      }
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
    startStoreServer(port + 1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[store] Tienda online en: http://localhost:${port}`);
  });
  return server;
}
