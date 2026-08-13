import http from 'node:http';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ETA_OPTIONS, ETA_MAP } from './rules.js';
import { sendDiscord, embed } from './webhook.mjs';
import { validateLogin, getSubscription, listKeys, generateKeys, extendKey, revokeKey, deleteKey, markPaid, aggregateMetrics, keyEvents, updateDevices, setKeyVip } from './keys.mjs';
import { setSessionGameRestriction, clearSessionGameRestriction } from './session.mjs';

const GAME_NAMES = {
  fc26: 'EA Sports FC',
  brawl_stars: 'Brawl Stars',
  clash_royale: 'Clash Royale',
  valorant: 'Valorant',
  league_of_legends: 'League of Legends',
  rocket_league: 'Rocket League',
  fortnite: 'Fortnite',
  osrs: 'OSRS',
  r6_siege: 'R6 Siege',
  marvel_rivals: 'Marvel Rivals',
  apex_legends: 'Apex Legends',
  call_of_duty: 'Call of Duty',
};

const panelHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.html'), 'utf8').replace('__GAME_NAMES__', JSON.stringify(GAME_NAMES));

export function startDashboardServer(opts, port = 3000) {
  const { getData, getConfig, saveConfig } = opts;
  const sessions = new Map();
  const adminSessions = new Map();
  const loginFails = new Map();

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

  function adminAuthed(req) {
    const t = getCookie(req, 'elbot_admin');
    return !!(t && adminSessions.get(t));
  }

  function getCookie(req, name) {
    const raw = req.headers.cookie || '';
    const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function loginEnabled() {
    const cfg = getConfig() || {};
    return !(cfg.bot && cfg.bot.login && cfg.bot.login.enabled === false);
  }

  function currentSession(req) {
    const token = getCookie(req, 'elbot_session');
    if (!token) return null;
    const keyId = sessions.get(token);
    if (!keyId) return null;
    const rec = listKeys().find((r) => r.id === keyId);
    if (!rec || !rec.active) {
      sessions.delete(token);
      clearSessionGameRestriction();
      return null;
    }
    return { token, sub: getSubscription(rec) };
  }

  function json(res, code, obj, extraHeaders) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(obj));
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(panelHtml);
      return;
    }
    if (req.url && req.url.startsWith('/api/')) {
      if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            const out = validateLogin(data.key, data.device || null);
            if (!out.ok) {
              json(res, 401, { ok: false, error: out.error, maxDevices: out.maxDevices, subscription: out.subscription });
              return;
            }
            const token = randomBytes(24).toString('hex');
            sessions.set(token, out.subscription.id);
            if (out.subscription.game) setSessionGameRestriction([out.subscription.game]);
            else clearSessionGameRestriction();
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Set-Cookie': 'elbot_session=' + token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000',
            });
            res.end(JSON.stringify({ ok: true, subscription: out.subscription }));
          } catch (e) {
            json(res, 400, { ok: false, error: String(e.message || e) });
          }
        });
        return;
      }
      if (req.url === '/api/me') {
        if (!loginEnabled()) {
          json(res, 200, { ok: true, login: false });
          return;
        }
        const s = currentSession(req);
        if (s && !s.sub.expired) {
          json(res, 200, { ok: true, login: true, subscription: s.sub });
        } else if (s && s.sub.expired) {
          json(res, 401, { ok: false, error: 'expired', subscription: s.sub });
        } else {
          json(res, 401, { ok: false, error: 'login_required' });
        }
        return;
      }
      if (req.url === '/api/logout' && req.method === 'POST') {
        const token = getCookie(req, 'elbot_session');
        if (token) sessions.delete(token);
        clearSessionGameRestriction();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'elbot_session=; HttpOnly; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const isAdminRoute = req.url.startsWith('/api/admin/');
      const isPublic = req.url === '/api/version' || req.url === '/api/plans';
      if (loginEnabled() && !isAdminRoute && !isPublic) {
        const s = currentSession(req);
        if (!s) {
          json(res, 401, { ok: false, error: 'login_required' });
          return;
        }
        if (s.sub.expired) {
          json(res, 401, { ok: false, error: 'expired', subscription: s.sub });
          return;
        }
      }
    }
    if (req.url === '/api/eldo/session' && req.method === 'GET') {
      opts.eldoStatus().then((st) => json(res, 200, { ok: true, ...st, login: opts.eldoLoginStatus ? opts.eldoLoginStatus() : null })).catch((e) => json(res, 500, { ok: false, error: String(e.message || e) }));
      return;
    }
    if (req.url === '/api/eldo/session' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          opts.eldoSetSession(data.authJson).then((out) => {
            json(res, out.ok ? 200 : 400, { ok: !!out.ok, error: out.error || null });
          }).catch((e) => json(res, 500, { ok: false, error: String(e.message || e) }));
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/eldo/login' && req.method === 'POST') {
      const out = opts.eldoLogin();
      json(res, out.ok ? 200 : 400, { ok: !!out.ok, error: out.error || null, started: !!out.started });
      return;
    }
    if (req.url === '/api/eldo/session' && req.method === 'DELETE') {
      opts.eldoLogout().then(() => json(res, 200, { ok: true })).catch((e) => json(res, 500, { ok: false, error: String(e.message || e) }));
      return;
    }
    if (req.url === '/api/admin/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const master = process.env.ELBOT_MASTER_KEY || '';
          const ip = req.socket.remoteAddress || 'local';
          if (loginLocked(ip)) { json(res, 429, { ok: false, error: 'too_many_attempts' }); return; }
          if (!master || String(data.masterKey || '').trim() !== master) {
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
      });
      return;
    }
    if (req.url === '/api/admin/logout' && req.method === 'POST') {
      const t = getCookie(req, 'elbot_admin');
      if (t) adminSessions.delete(t);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'elbot_admin=; HttpOnly; Path=/; Max-Age=0',
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url.startsWith('/api/admin/keys') && req.method === 'GET' && !req.url.startsWith('/api/admin/keys/logs')) {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      const u = new URL(req.url, 'http://localhost');
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      const status = String(u.searchParams.get('status') || 'all');
      const plan = String(u.searchParams.get('plan') || 'all');
      let rows = listKeys().map((r) => getSubscription(r));
      if (q) {
        rows = rows.filter((r) =>
          String(r.key).toLowerCase().includes(q) ||
          String(r.owner || '').toLowerCase().includes(q) ||
          String(r.seller || '').toLowerCase().includes(q) ||
          String(r.note || '').toLowerCase().includes(q)
        );
      }
      if (status !== 'all') {
        rows = rows.filter((r) => {
          if (status === 'active') return r.active && r.paid !== false && !r.expired;
          if (status === 'expired') return r.active && r.expired;
          if (status === 'revoked') return !r.active;
          if (status === 'unpaid') return r.active && r.paid === false;
          if (status === 'unused') return r.active && !r.activatedAt;
          return true;
        });
      }
      if (plan !== 'all') rows = rows.filter((r) => r.plan === plan);
      rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || 0);
      const plans = Object.keys((getConfig() || {}).store?.plans || {}).map((id) => ((getConfig() || {}).store.plans[id].label));
      json(res, 200, { ok: true, keys: rows, plans });
      return;
    }
    if (req.url === '/api/admin/keys/generate' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const days = Math.max(1, parseInt(d.days, 10) || 30);
          const count = Math.min(50, Math.max(1, parseInt(d.count, 10) || 1));
          const created = generateKeys({
            owner: String(d.owner || 'Cliente').trim(),
            days,
            plan: String(d.plan || '').trim(),
            count,
            note: String(d.note || '').trim(),
            paid: d.paid !== false,
            price: Number(d.price) || 0,
            seller: String(d.seller || '').trim() || null,
            vip: !!d.vip,
            maxDevices: parseInt(d.maxDevices, 10) || undefined,
          });
          json(res, 200, { ok: true, keys: created });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/extend' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const days = Math.max(1, parseInt(d.days, 10) || 30);
          const out = extendKey(d.key, days);
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/revoke' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = revokeKey(d.key);
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/delete' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = deleteKey(d.key);
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/markpaid' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = markPaid(d.key);
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/stats' && req.method === 'GET') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      json(res, 200, { ok: true, stats: aggregateMetrics() });
      return;
    }
    if (req.url && req.url.split('?')[0] === '/api/admin/keys/logs' && req.method === 'GET') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      const u = new URL(req.url, 'http://localhost');
      const key = String(u.searchParams.get('key') || '').trim();
      if (!key) { json(res, 400, { ok: false, error: 'key_required' }); return; }
      const rec = listKeys().find((r) => r.key.toUpperCase() === key.toUpperCase());
      if (!rec) { json(res, 404, { ok: false, error: 'not_found' }); return; }
      json(res, 200, { ok: true, key: rec.key, owner: rec.owner, log: keyEvents(rec.id) });
      return;
    }
    if (req.url === '/api/admin/keys/update' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = updateDevices(d.key, {
            maxDevices: d.maxDevices !== undefined ? d.maxDevices : undefined,
            clearDevices: !!d.clearDevices,
            reactivate: typeof d.reactivate === 'boolean' ? d.reactivate : undefined,
          });
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/vip' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = setKeyVip(d.key, !!d.vip);
          json(res, out.ok ? 200 : 400, out);
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/export' && req.method === 'GET') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      const rows = listKeys().map((r) => getSubscription(r));
      const head = ['key', 'owner', 'plan', 'price', 'seller', 'vip', 'state', 'paid', 'daysLeft', 'expiresAt', 'createdAt'];
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv = [head.join(',')].concat(rows.map((r) => {
        const state = !r.active ? 'revoked' : r.paid === false ? 'unpaid' : r.expired ? 'expired' : r.activatedAt ? 'active' : 'unused';
        return [r.key, r.owner, r.plan, r.price, r.seller, r.vip ? 'si' : 'no', state, r.paid !== false ? 'si' : 'no', r.daysLeft, r.expiresAt, r.createdAt].map(esc).join(',');
      })).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="keys.csv"' });
      res.end('\ufeff' + csv);
      return;
    }
    if (req.url === '/api/admin/backup' && req.method === 'GET') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      const backup = {
        generatedAt: new Date().toISOString(),
        keys: opts.backup ? opts.backup().keys : { error: 'backup no disponible' },
        dashboard: opts.backup ? opts.backup().dashboard : [],
        activity: opts.backup ? opts.backup().activity : [],
        seen: opts.backup ? opts.backup().seen : [],
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="elbot-backup-' + Date.now() + '.json"' });
      res.end(JSON.stringify(backup, null, 2));
      return;
    }
    if (req.url === '/api/dashboard') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ requests: getData() }));
      return;
    }
    if (req.url === '/api/version') {
      const v = (getConfig() || {}).store?.payment || null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: '1.5.0', name: 'BoostPilot' }));
      return;
    }
    if (req.url === '/api/plans' && req.method === 'GET') {
      const store = (getConfig() || {}).store || {};
      const plans = store.plans || {};
      const payment = store.payment || { currency: 'USD', methods: [], note: '' };
      const list = Object.keys(plans).map((id) => ({ id, ...plans[id] }));
      json(res, 200, { ok: true, plans: list, payment, storePort: store.port || 8080 });
      return;
    }
    if (req.url === '/api/stats') {
      const rows = getData() || [];
      const placed = rows.filter((r) => r.status === 'placed' && r.price != null);
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const weekStart = Date.now() - 7 * 24 * 3600 * 1000;
      const revenueToday = placed
        .filter((r) => { const t = new Date(r.seenAt || r.createdAt || 0); return t >= dayStart; })
        .reduce((s, r) => s + Number(r.price), 0);
      const revenueWeek = placed
        .filter((r) => { const t = Date.parse(r.seenAt || r.createdAt || 0); return Number.isFinite(t) && t >= weekStart; })
        .reduce((s, r) => s + Number(r.price), 0);
      const stats = {
        total: rows.length,
        placed: rows.filter((r) => r.status === 'placed').length,
        opened: rows.filter((r) => r.status === 'opened').length,
        skipped: rows.filter((r) => r.status === 'skipped').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        unresolved: rows.filter((r) => r.status === 'unresolved' || r.status === 'seen').length,
        pending: rows.filter((r) => r.status === 'pending').length,
        canceled: rows.filter((r) => r.status === 'canceled').length,
        value: placed.reduce((s, r) => s + Number(r.price), 0),
        revenueToday: Math.round(revenueToday * 100) / 100,
        revenueWeek: Math.round(revenueWeek * 100) / 100,
        perGame: rows.reduce((m, r) => { m[r.game] = (m[r.game] || 0) + 1; return m; }, {}),
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ stats }));
      return;
    }
    if (req.url === '/api/orders' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ orders: opts.getOrders ? opts.getOrders() : [] }));
      return;
    }
    if (req.url === '/api/orders' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.id || !opts.updateOrderPrice) throw new Error('updateOrderPrice no disponible');
          const out = await opts.updateOrderPrice(data.id, data.price);
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: !!out.ok, ...out }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/webhook/test' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const cfg = getConfig() || {};
          const d = cfg.notify || {};
          const url = data.url || (d.discord && d.discord.url) || '';
          if (!url) throw new Error('Sin URL de webhook de Discord configurada.');
          const out = await sendDiscord({
            url,
            username: (d.discord && d.discord.username) || 'BoostPilot',
            embeds: [embed({
              color: 0x2ecc71,
              title: 'BoostPilot - Webhook de prueba',
              description: 'Conexion correcta. A partir de ahora recibiras las notificaciones del bot aqui.',
              timestamp: new Date().toISOString(),
              footer: 'BoostPilot',
            })],
          });
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(out));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/faststats') {
      const fast = opts.getFastStats ? opts.getFastStats() : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ fast, paused: fast ? !!fast.paused : false }));
      return;
    }
    if (req.url === '/api/pause' && req.method === 'POST') {
      try {
        if (!opts.pause) throw new Error('pause no disponible');
        opts.pause();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
      return;
    }
    if (req.url === '/api/resume' && req.method === 'POST') {
      try {
        if (!opts.resume) throw new Error('resume no disponible');
        opts.resume();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
      return;
    }
    if (req.url === '/api/stop' && req.method === 'POST') {
      if (!opts.stop) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'stop no disponible' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(() => opts.stop(), 150);
      }
      return;
    }
    if (req.url === '/api/pending') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ pending: opts.getPending ? opts.getPending() : [] }));
      return;
    }
    if (req.url === '/api/confirm' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (data.action === 'place' && opts.confirmPlace) {
            const out = await opts.confirmPlace(data.id, { price: data.price, deliveryTime: data.deliveryTime, message: data.message, vip: !!data.vip });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, ...out }));
          } else if (data.action === 'msg' && opts.confirmMessageOnly) {
            const out = await opts.confirmMessageOnly(data.id, { message: data.message });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, ...out }));
          } else if (data.action === 'discard' && opts.confirmDiscard) {
            const out = await opts.confirmDiscard(data.id);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: !!out.ok, ...out }));
          } else {
            throw new Error('accion no valida');
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/remind' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.id || !opts.sendReminder) throw new Error('remind no disponible');
          const out = await opts.sendReminder(data.id);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: !!out.ok, ...out }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/log') {
      const list = opts.getActivity ? opts.getActivity() : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ log: list }));
      return;
    }
    if (req.url === '/api/config' && req.method === 'GET') {
      const cfg = getConfig();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        games: cfg.games,
        filters: cfg.filters,
        chat: cfg.chat,
        bot: cfg.bot ? { fastMode: cfg.bot.fastMode, pricing: cfg.bot.pricing } : undefined,
        notify: cfg.notify,
        hotkeys: cfg.hotkeys,
        store: cfg.store ? { plans: cfg.store.plans } : undefined,
        etas: ETA_OPTIONS,
        etaMap: ETA_MAP,
      }));
      return;
    }
    if (req.url === '/api/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!opts.saveSettings) throw new Error('saveSettings no disponible');
          const out = await opts.saveSettings(data);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, ...out }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.games || typeof data.games !== 'object') throw new Error('games requerido');
          await saveConfig(data.games);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('error', () => {
    console.log(`[panel] Puerto ${port} ocupado, probando ${port + 1}...`);
    startDashboardServer(opts, port + 1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[panel] Abre el panel en: http://localhost:${port}`);
  });
  return server;
}
