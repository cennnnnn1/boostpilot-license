import http from 'node:http';
import { randomBytes } from 'crypto';
import { readFileSync, createReadStream } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ETA_OPTIONS, ETA_MAP } from './rules.js';
import { sendDiscord, embed } from './webhook.mjs';
import { validateLogin, getSubscription, listKeys, findKey, generateKeys, extendKey, revokeKey, deleteKey, markPaid, aggregateMetrics, keyEvents, updateDevices, setKeyVip, mergeRemoteKey } from './keys.mjs';
import { setSessionGameRestriction, clearSessionGameRestriction } from './session.mjs';
import { sha256 as hashKey } from './license.js';

const GAME_NAMES = {
  fc26: 'EA Sports FC',
  brawl_stars: 'Brawl Stars',
  clash_royale: 'Clash Royale',
  valorant: 'Valorant',
  league_of_legends: 'League of Legends',
  rocket_league: 'Rocket League',
  fortnite: 'Fortnite',
  r6_siege: 'R6 Siege',
  marvel_rivals: 'Marvel Rivals',
  apex_legends: 'Apex Legends',
  call_of_duty: 'Call of Duty',
};

let panelHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.html'), 'utf8');
if (panelHtml.charCodeAt(0) === 0xFEFF) panelHtml = panelHtml.slice(1);
panelHtml = panelHtml.replace('__GAME_NAMES__', JSON.stringify(GAME_NAMES));

// Incrustar SVGs de juegos como data URIs para carga instantánea en Precios.
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'games');
const GAME_SVGS = {};
for (const gk of Object.keys(GAME_NAMES)) {
  try {
    let svg = readFileSync(join(ASSETS_DIR, gk + '.svg'), 'utf8');
    GAME_SVGS[gk] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  } catch (e) { /* sin svg */ }
}
panelHtml = panelHtml.replace('__GAME_SVGS__', JSON.stringify(GAME_SVGS));

let APP_VERSION = '1.7.14';
try {
  APP_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version || APP_VERSION;
} catch (e) { /* keep default */ }

export function startDashboardServer(opts, port = 3000) {
  const { getData, getConfig, saveConfig, applyProfile, license } = opts;
  const sessions = new Map();
  const sessionDevices = new Map();
  const sessionKick = new Map();
  const adminSessions = new Map();
  const loginFails = new Map();

  const MAX_BODY = 1024 * 1024;
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let overflow = false;
      req.on('data', (c) => {
        body += c;
        if (body.length > MAX_BODY) { overflow = true; req.destroy(); }
      });
      req.on('end', () => { if (overflow) reject(new Error('Payload too large')); else resolve(body); });
      req.on('error', reject);
    });
  }

  setInterval(() => {
    const now = Date.now();
    for (const [tok, id] of sessions) {
      if (now - (sessionKick.get(tok) || 0) > 3600000 && !sessionDevices.has(tok)) {
        sessions.delete(tok); sessionDevices.delete(tok); sessionKick.delete(tok);
      }
    }
  }, 300000);

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
      sessionDevices.delete(token);
      sessionKick.delete(token);
      clearSessionGameRestriction();
      return null;
    }
    if (license && license.getIndexEntry && license.indexSynced) {
      const entry = license.getIndexEntry(rec.key);
      const want = sessionKick.get(token);
      if (entry && typeof want === 'number' && (parseInt(entry.kickEpoch, 10) || 0) !== want) {
        sessions.delete(token);
        sessionDevices.delete(token);
        sessionKick.delete(token);
        clearSessionGameRestriction();
        return null;
      }
      if (!entry && license.indexSynced()) {
        sessions.delete(token);
        sessionDevices.delete(token);
        sessionKick.delete(token);
        clearSessionGameRestriction();
        return null;
      }
    }
    return { token, sub: getSubscription(rec) };
  }

  function json(res, code, obj, extraHeaders) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(obj));
  }

  async function publishAllNow() {
    if (!license || !license.publishAll) return { published: false, skipped: true };
    try {
      return await license.publishAll();
    } catch (e) {
      return { published: false, error: String(e.message || e) };
    }
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(panelHtml);
      return;
    }
    if (req.url && req.url.startsWith('/assets/')) {
      const rel = (req.url.split('?')[0]).slice('/assets/'.length);
      if (!rel || rel.includes('..') || rel.includes(':') || rel.startsWith('/') || rel.startsWith('\\')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      const ext = rel.split('.').pop().toLowerCase();
      const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
      const file = join(dirname(fileURLToPath(import.meta.url)), 'assets', rel);
      const rs = createReadStream(file);
      rs.on('error', () => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); });
      rs.on('open', () => { res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' }); rs.pipe(res); });
      return;
    }
    if (req.url && req.url.startsWith('/api/')) {
      if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body || '{}');
            let remoteEntry = null;
            if (license && license.ensureIndex && license.getIndexEntry) {
              try {
                await license.ensureIndex();
                remoteEntry = license.getIndexEntry(data.key);
              } catch (e) {
                console.log('[license] Error al consultar el índice remoto en login: ' + String(e.message || e));
              }
            }
            const out = validateLogin(data.key, data.device || null, remoteEntry);
            if (!out.ok) {
              json(res, 401, { ok: false, error: out.error, maxDevices: out.maxDevices, subscription: out.subscription });
              return;
            }
            if (license && license.checkAsync) {
              try {
                const lc = await license.checkAsync(data.key);
                if (lc.blocked) {
                  json(res, 401, { ok: false, error: 'revoked', subscription: out.subscription });
                  return;
                }
              } catch (e) {
                console.log('[license] Error al validar blacklist en login: ' + String(e.message || e));
              }
            }
            if (license && license.indexSynced && license.indexSynced() && !remoteEntry) {
              const localRec = findKey(data.key);
              if (localRec && localRec.remote) {
                json(res, 401, { ok: false, error: 'revoked', subscription: out.subscription });
                return;
              }
            }
            if (data.device && license && license.claimDevice) {
              try {
                const dc = await license.claimDevice(data.key, data.device);
                if (dc.error === 'device_used') {
                  json(res, 401, { ok: false, error: 'device_used', subscription: out.subscription });
                  return;
                }
                if (dc.error && dc.error !== 'no_token') {
                  console.log('[license] Claim de dispositivo no disponible (se permite login): ' + dc.error + (dc.detail ? ' ' + dc.detail : ''));
                }
              } catch (e) {
                console.log('[license] Error en claim de dispositivo: ' + String(e.message || e));
              }
            }
            if (applyProfile) await applyProfile(out.subscription.id);
            const token = randomBytes(24).toString('hex');
            sessions.set(token, out.subscription.id);
            if (data.device) sessionDevices.set(token, String(data.device));
            sessionKick.set(token, parseInt(out.subscription.kickEpoch, 10) || 0);
            if (out.subscription.game && !out.subscription.trial) setSessionGameRestriction([out.subscription.game]);
            else clearSessionGameRestriction();
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Set-Cookie': 'elbot_session=' + token + '; HttpOnly; Path=/; SameSite=Lax',
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
        if (token) { sessions.delete(token); sessionDevices.delete(token); sessionKick.delete(token); }
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const days = Math.max(0, parseInt(d.days, 10) || 30);
          const hours = Math.max(0, parseInt(d.hours, 10) || 0);
          const count = Math.min(50, Math.max(1, parseInt(d.count, 10) || 1));
          const created = generateKeys({
            owner: String(d.owner || 'Cliente').trim(),
            days,
            hours,
            game: String(d.game || '').trim() || null,
            plan: String(d.plan || '').trim(),
            count,
            note: String(d.note || '').trim(),
            paid: d.paid !== false,
            price: Number(d.price) || 0,
            seller: String(d.seller || '').trim() || null,
            vip: !!d.vip,
            maxDevices: parseInt(d.maxDevices, 10) || undefined,
          });
          const online = await publishAllNow();
          json(res, 200, { ok: true, keys: created, online });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/extend' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const days = Math.max(1, parseInt(d.days, 10) || 30);
          const out = extendKey(d.key, days);
          const online = out.ok ? await publishAllNow() : null;
          json(res, out.ok ? 200 : 400, { ...out, online });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/revoke' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const rec = findKey(d.key);
          const out = revokeKey(d.key);
          if (out.ok && rec) {
            for (const [tok, id] of sessions) {
              if (id === rec.id) { sessions.delete(tok); sessionDevices.delete(tok); }
            }
            clearSessionGameRestriction();
            const online = await publishAllNow();
            json(res, 200, { ...out, online });
            return;
          }
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = deleteKey(d.key);
          const online = out.ok ? await publishAllNow() : null;
          json(res, out.ok ? 200 : 400, { ...out, online });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/markpaid' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = markPaid(d.key);
          const online = out.ok ? await publishAllNow() : null;
          json(res, out.ok ? 200 : 400, { ...out, online });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = updateDevices(d.key, {
            maxDevices: d.maxDevices !== undefined ? d.maxDevices : undefined,
            clearDevices: !!d.clearDevices,
            reactivate: typeof d.reactivate === 'boolean' ? d.reactivate : undefined,
          });
          const online = out.ok ? await publishAllNow() : null;
          json(res, out.ok ? 200 : 400, { ...out, online });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/keys/vip' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const d = JSON.parse(body || '{}');
          const out = setKeyVip(d.key, !!d.vip);
          const online = out.ok ? await publishAllNow() : null;
          json(res, out.ok ? 200 : 400, { ...out, online });
        } catch (e) {
          json(res, 400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    if (req.url === '/api/admin/license' && req.method === 'GET') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      json(res, 200, { ok: true, license: license && license.diagnostics ? license.diagnostics() : { onlineCheck: false, pushConfigured: false } });
      return;
    }
    if (req.url === '/api/admin/license/push' && req.method === 'POST') {
      if (!adminAuthed(req)) { json(res, 401, { ok: false, error: 'admin_required' }); return; }
      req.on('end', async () => {
        try {
          if (!license || !license.publishAll) throw new Error('licencia no disponible');
          const out = await publishAllNow();
          json(res, out.published ? 200 : 400, { ok: !!out.published, ...out });
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: APP_VERSION, name: 'BoostPilot' }));
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
    if (req.url === '/api/orders/delivered' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.id) throw new Error('Se requiere id del pedido');
          if (!opts.sendDeliveredById) throw new Error('sendDeliveredById no disponible');
          const out = await opts.sendDeliveredById(data.id);
          res.writeHead(out && out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: !!(out && out.ok), ...out }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/orders/received' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.id) throw new Error('Se requiere id del pedido');
          if (!opts.sendOrderReceivedById) throw new Error('sendOrderReceivedById no disponible');
          const out = await opts.sendOrderReceivedById(data.id);
          res.writeHead(out && out.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: !!(out && out.ok), ...out }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.url === '/api/webhook/test' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!opts.saveSettings) throw new Error('saveSettings no disponible');
          const sess = currentSession(req);
          const out = await opts.saveSettings(data, sess ? sess.sub.id : null);
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
      req.on('data', (c) => { body += c; if (body.length > 1048576) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.games || typeof data.games !== 'object') throw new Error('games requerido');
          const sess = currentSession(req);
          await saveConfig(data.games, sess ? sess.sub.id : null);
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

  if (license && license.refresh && license.check) {
    const kickTimer = setInterval(async () => {
      try {
        await license.refresh();
        if (license.refreshIndex) await license.refreshIndex();
        let devicesMap = null;
        if (license.refreshDevices) {
          try {
            const dres = await license.refreshDevices();
            if (dres && dres.configured && !dres.error && dres.map) devicesMap = dres.map;
          } catch (e) { devicesMap = null; }
        }
        for (const [tok, id] of sessions) {
          const rec = listKeys().find((r) => r.id === id);
          if (!rec) { sessions.delete(tok); sessionDevices.delete(tok); sessionKick.delete(tok); continue; }
          if (license.check(rec.key).blocked) {
            sessions.delete(tok);
            sessionDevices.delete(tok);
            sessionKick.delete(tok);
            clearSessionGameRestriction();
            console.log(`[license] Sesión expulsada por revocación a distancia: ${rec.key}`);
            continue;
          }
            if (devicesMap && sessionDevices.has(tok)) {
              const dev = sessionDevices.get(tok);
              const entry = devicesMap[hashKey(rec.key).toLowerCase()];
              if (!entry || !entry.device || entry.device !== dev || entry.released) {
              sessions.delete(tok);
              sessionDevices.delete(tok);
              sessionKick.delete(tok);
              clearSessionGameRestriction();
              console.log(`[license] Sesión expulsada: HWID liberado o reasignado para ${rec.key}`);
              continue;
            }
          }
          if (license.getIndexEntry && license.indexSynced) {
            const entry = license.getIndexEntry(rec.key);
            const want = sessionKick.get(tok);
            if (entry && typeof want === 'number' && (parseInt(entry.kickEpoch, 10) || 0) !== want) {
              sessions.delete(tok);
              sessionDevices.delete(tok);
              sessionKick.delete(tok);
              clearSessionGameRestriction();
              console.log(`[license] Sesión expulsada: señal de reset para ${rec.key}`);
              continue;
            }
            if (entry) {
              try {
                mergeRemoteKey(rec.key, entry);
                const fresh = listKeys().find((r) => r.id === id);
                const sub = fresh ? getSubscription(fresh) : null;
                if (!fresh || fresh.active === false || (fresh.paid === false && !fresh.trial) || (sub && sub.expired)) {
                  sessions.delete(tok);
                  sessionDevices.delete(tok);
                  sessionKick.delete(tok);
                  clearSessionGameRestriction();
                  console.log(`[license] Sesión cerrada por estado remoto: ${fresh ? fresh.key : id}`);
                }
              } catch (e) {
                console.log('[license] Error al sincronizar estado remoto: ' + String(e.message || e));
              }
            } else if (license.indexSynced()) {
              sessions.delete(tok);
              sessionDevices.delete(tok);
              sessionKick.delete(tok);
              clearSessionGameRestriction();
              console.log(`[license] Sesión expulsada: key remota eliminada para ${rec.key}`);
            }
          }
        }
      } catch (e) {
        console.log('[license] Fallo en chequeo periódico: ' + String(e.message || e));
      }
    }, Math.max(30000, (license.pollMs ? license.pollMs() : 300000)));
    if (kickTimer.unref) kickTimer.unref();
  }

  return server;
}
