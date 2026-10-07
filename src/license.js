import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listKeys } from './keys.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_ROOT = process.env.ELBOT_STATE_DIR || join(ROOT, 'state');
const GH_FILE = join(STATE_ROOT, 'github.json');
const LIC_FILE = join(ROOT, 'config', 'license.json');
const API = 'https://api.github.com';
const DEFAULT_POLL_MS = 30000;
const INDEX_FILE = 'keys-index.json';
const DEVICES_FILE = 'devices.json';
const DEVICES_POLL_MS = 120000;
const AGENT = 'BoostPilot/1.7.14';

export function sha256(text) {
  return createHash('sha256').update(String(text || '').trim().toUpperCase()).digest('hex');
}

function readJson(path) {
  try {
    let raw = readFileSync(path, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readGithubConfig() {
  const c = readJson(GH_FILE) || {};
  return {
    token: String(c.token || '').trim(),
    repo: String(c.repo || '').trim(),
    path: String(c.path || 'blacklist.json').trim(),
    branch: String(c.branch || 'main').trim(),
  };
}

export function saveGithubConfig(cfg) {
  mkdirSync(STATE_ROOT, { recursive: true });
  writeFileSync(GH_FILE, JSON.stringify({
    token: String(cfg.token || '').trim(),
    repo: String(cfg.repo || '').trim(),
    path: String(cfg.path || 'blacklist.json').trim(),
    branch: String(cfg.branch || 'main').trim(),
  }, null, 2), 'utf8');
}

function licFileConfig() {
  const c = readJson(LIC_FILE) || {};
  return {
    blacklistUrl: String(c.blacklistUrl || '').trim(),
    keysIndexUrl: String(c.keysIndexUrl || '').trim(),
    pollMs: parseInt(c.pollMs, 10) || DEFAULT_POLL_MS,
  };
}

function devicesConfig() {
  const c = readJson(LIC_FILE) || {};
  return {
    devicesUrl: String(process.env.ELBOT_DEVICES_URL || c.devicesUrl || '').trim(),
    devicesRepo: String(process.env.ELBOT_DEVICES_REPO || c.devicesRepo || '').trim(),
    devicesToken: String(process.env.ELBOT_DEVICES_TOKEN || c.devicesToken || '').trim(),
  };
}

function devicesRepoAndPath(url) {
  const m = String(url || '').match(/\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/);
  if (m) return { repo: m[1], path: decodeURIComponent(m[2]) };
  return { repo: '', path: DEVICES_FILE };
}

function ghHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'User-Agent': AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function createLicenseChecker(getConfig, opts = {}) {
  const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const log = opts.log || ((...a) => console.log('[license]', ...a));
  const cache = new Map();
  const indexCache = new Map();
  let devicesCache = null;

  function resolveUrl() {
    if (process.env.ELBOT_LICENSE_URL && String(process.env.ELBOT_LICENSE_URL).trim()) {
      return String(process.env.ELBOT_LICENSE_URL).trim();
    }
    const f = licFileConfig();
    if (f.blacklistUrl) return f.blacklistUrl;
    const cfg = getConfig ? getConfig() : {};
    const lic = (cfg && cfg.license) || {};
    return String(lic.blacklistUrl || '').trim();
  }

  function resolveKeysIndexUrl() {
    if (process.env.ELBOT_KEYS_INDEX_URL && String(process.env.ELBOT_KEYS_INDEX_URL).trim()) {
      return String(process.env.ELBOT_KEYS_INDEX_URL).trim();
    }
    const f = licFileConfig();
    if (f.keysIndexUrl) return f.keysIndexUrl;
    const cfg = getConfig ? getConfig() : {};
    const lic = (cfg && cfg.license) || {};
    return String(lic.keysIndexUrl || '').trim();
  }

  function pollMs() {
    const f = licFileConfig();
    const cfg = getConfig ? getConfig() : {};
    const lic = (cfg && cfg.license) || {};
    const raw = process.env.ELBOT_LICENSE_URL ? f.pollMs : (parseInt(lic.pollMs, 10) || f.pollMs);
    return Math.max(10000, parseInt(raw, 10) || DEFAULT_POLL_MS);
  }

  function fetchHeaders(url, extra = {}) {
    const h = { Accept: 'application/json', 'User-Agent': AGENT };
    if (String(url).includes('api.github.com')) {
      const t = devicesTarget();
      if (t.token) h.Authorization = 'Bearer ' + t.token;
    }
    return Object.assign(h, extra);
  }

  function unwrapContents(data) {
    if (data && typeof data.content === 'string') {
      try { return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')); }
      catch (e) { return null; }
    }
    return data;
  }

  async function refresh(force = false) {
    const url = resolveUrl();
    if (!url) return null;
    const now = Date.now();
    const cached = cache.get(url);
    if (!force && cached && now - cached.at < pollMs()) return cached;
    if (!fetchFn) return cached || null;
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + now;
    try {
      const res = await fetchFn(fetchUrl, {
        headers: fetchHeaders(fetchUrl),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return cached || null;
      const data = unwrapContents(await res.json().catch(() => null));
      const hashes = new Set((data && Array.isArray(data.revoked) ? data.revoked : []).map((h) => String(h).toLowerCase()));
      const entry = { hashes, at: now, status: 'ok', url };
      cache.set(url, entry);
      return entry;
    } catch (e) {
      if (opts.debug) log('refresh fallo: ' + String(e.message || e));
      return cached || null;
    }
  }

  function check(key) {
    const url = resolveUrl();
    if (!url) return { blocked: false, configured: false, synced: false, count: 0 };
    const entry = cache.get(url);
    if (!entry) return { blocked: false, configured: true, synced: false, count: 0 };
    return { blocked: entry.hashes.has(sha256(key)), configured: true, synced: true, count: entry.hashes.size };
  }

  async function checkAsync(key) {
    await refresh(true);
    return check(key);
  }

  async function refreshIndex(force = false) {
    const url = resolveKeysIndexUrl();
    if (!url) return null;
    const now = Date.now();
    const cached = indexCache.get(url);
    if (!force && cached && now - cached.at < pollMs()) return cached;
    if (!fetchFn) return cached || null;
    const fetchUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + now;
    try {
      const res = await fetchFn(fetchUrl, {
        headers: fetchHeaders(fetchUrl),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return cached || null;
      const data = unwrapContents(await res.json().catch(() => null));
      const entries = new Map();
      const raw = (data && data.entries) || {};
      for (const [h, e] of Object.entries(raw)) {
        if (e && typeof e === 'object') entries.set(String(h).toLowerCase(), e);
      }
      const entry = { entries, at: now, status: 'ok', url };
      indexCache.set(url, entry);
      return entry;
    } catch (e) {
      if (opts.debug) log('índice remoto falló: ' + String(e.message || e));
      return cached || null;
    }
  }

  function getIndexEntry(key) {
    const url = resolveKeysIndexUrl();
    if (!url) return null;
    const entry = indexCache.get(url);
    if (!entry) return null;
    return entry.entries.get(sha256(key).toLowerCase()) || null;
  }

  function indexSynced() {
    const url = resolveKeysIndexUrl();
    if (!url) return false;
    return !!indexCache.get(url);
  }

  async function ensureIndex() {
    const url = resolveKeysIndexUrl();
    const cached = url ? indexCache.get(url) : null;
    if (cached && Date.now() - cached.at < pollMs()) return cached;
    return refreshIndex();
  }

  async function fetchDevices(fresh) {
    const cfg = devicesConfig();
    if (!cfg.devicesUrl) return { configured: false, map: null, sha: null };
    if (!fetchFn) return { configured: true, error: 'no_fetch', map: {}, sha: null };
    const now = Date.now();
    if (!fresh && devicesCache && now - devicesCache.at < DEVICES_POLL_MS) return devicesCache;
    const url = cfg.devicesUrl + (cfg.devicesUrl.includes('?') ? '&' : '?') + '_t=' + now;
    const tgt = devicesTarget();
    const headers = { Accept: 'application/json', 'User-Agent': AGENT };
    if (tgt.token) headers.Authorization = 'token ' + tgt.token;
    try {
      const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) {
        devicesCache = { configured: true, map: {}, sha: null, at: now, status: 'ok' };
        return devicesCache;
      }
      if (!res.ok) return { configured: true, error: 'gh_' + res.status, map: {}, sha: null };
      const data = await res.json().catch(() => null);
      let map = {};
      if (data && typeof data === 'object' && data.content) {
        try {
          map = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) || {};
        } catch (e) { map = {}; }
      } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        map = data;
      }
      devicesCache = { configured: true, map: map || {}, sha: (data && data.sha) || null, at: now, status: 'ok' };
      return devicesCache;
    } catch (e) {
      if (opts.debug) log('registro de dispositivos falló: ' + String(e.message || e));
      return { configured: true, error: 'fetch_failed', map: {}, sha: null };
    }
  }

  function devicesTarget() {
    const cfg = devicesConfig();
    const rp = devicesRepoAndPath(cfg.devicesUrl);
    return {
      repo: cfg.devicesRepo || rp.repo,
      path: rp.path,
      token: cfg.devicesToken,
    };
  }

  async function claimDevice(key, deviceId) {
    const cfg = devicesConfig();
    if (!cfg.devicesUrl) return { ok: true, configured: false, claimed: false };
    const h = sha256(key).toLowerCase();
    const readConflict = async () => {
      let cur = await fetchDevices(true);
      if (cur.error) return { readError: cur };
      const entry = cur.map[h];
      if (entry && entry.device && entry.device !== deviceId && !entry.released) {
        await new Promise((r) => setTimeout(r, 500));
        cur = await fetchDevices(true);
        if (cur.error) return { readError: cur };
        const again = cur.map[h];
        if (again && again.device && again.device !== deviceId && !again.released) return { conflict: true };
      }
      return { cur };
    };
    const chk = await readConflict();
    if (chk.conflict) return { ok: false, error: 'device_used', claimed: false };
    if (chk.readError) return { ok: true, claimed: false, error: chk.readError.error };
    const cur = chk.cur;
    const entry = cur.map[h];
    if (entry && entry.device === deviceId) {
      return { ok: true, claimed: false };
    }
    const tgt = devicesTarget();
    if (!tgt.token) return { ok: true, claimed: false, error: 'no_token' };
    if (!tgt.repo) return { ok: true, claimed: false, error: 'no_repo' };
    const claim = { device: String(deviceId), at: new Date().toISOString() };
    const contentsPath = '/repos/' + tgt.repo + '/contents/' + encodeURIComponent(tgt.path);
    const buildPayload = (map) => ({
      message: 'Device claim: ' + h.slice(0, 8),
      branch: 'main',
      content: Buffer.from(JSON.stringify(map, null, 2), 'utf8').toString('base64'),
    });
    let payload = buildPayload(Object.assign({}, cur.map, { [h]: claim }));
    if (cur.sha) payload.sha = cur.sha;
    let res = await ghPut(contentsPath, tgt.token, payload);
    if (res.status === 409 || res.status === 422) {
      const fresh = await fetchDevices(true);
      if (!fresh.error) {
        const fe = fresh.map[h];
        if (fe && fe.device && fe.device !== deviceId && !fe.released) {
          return { ok: false, error: 'device_used', claimed: false };
        }
        payload = buildPayload(Object.assign({}, fresh.map, { [h]: claim }));
        if (fresh.sha) payload.sha = fresh.sha;
        res = await ghPut(contentsPath, tgt.token, payload);
      }
    }
    if (res.status === 200 || res.status === 201) {
      devicesCache = null;
      return { ok: true, claimed: true };
    }
    return { ok: true, claimed: false, error: 'write_' + res.status, detail: res.data && res.data.message };
  }

  async function resetDevice(key) {
    const cfg = devicesConfig();
    if (!cfg.devicesUrl) return { ok: false, error: 'not_configured' };
    const h = sha256(key).toLowerCase();
    const tgt = devicesTarget();
    const gh = readGithubConfig();
    const token = tgt.token || gh.token;
    if (!tgt.repo || !token) return { ok: false, error: 'not_configured', detail: 'Falta repo/token de dispositivos' };
    if (!fetchFn) return { ok: false, error: 'no_fetch' };
    const cur = await fetchDevices(true);
    if (cur.error) return { ok: false, error: cur.error };
    if (!cur.map[h]) return { ok: true, reset: false, message: 'No había dispositivo registrado para esta key.' };
    const contentsPath = '/repos/' + tgt.repo + '/contents/' + encodeURIComponent(tgt.path);
    const buildPayload = (map) => ({
      message: 'Device reset: ' + h.slice(0, 8),
      branch: 'main',
      content: Buffer.from(JSON.stringify(map, null, 2), 'utf8').toString('base64'),
    });
    const freed = (map) => {
      const copy = Object.assign({}, map);
      delete copy[h];
      return copy;
    };
    let payload = buildPayload(freed(cur.map));
    if (cur.sha) payload.sha = cur.sha;
    let res = await ghPut(contentsPath, token, payload);
    if ((res.status === 409 || res.status === 422) && cur.sha) {
      const fresh = await fetchDevices(true);
      if (!fresh.error) {
        payload = buildPayload(freed(fresh.map));
        if (fresh.sha) payload.sha = fresh.sha;
        res = await ghPut(contentsPath, token, payload);
      }
    }
    if (res.status === 200 || res.status === 201) {
      devicesCache = null;
      return { ok: true, reset: true, freed: true };
    }
    return { ok: false, error: 'write_' + res.status, detail: res.data && res.data.message };
  }

  async function getDevicesMap() {
    const cur = await fetchDevices(false);
    return (cur && cur.map) || {};
  }

  async function refreshDevices(fresh) {
    return fetchDevices(!!fresh);
  }

  async function ghGet(path, token) {
    const res = await fetchFn(API + path, { headers: ghHeaders(token), signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  async function ghPut(path, token, body) {
    const res = await fetchFn(API + path, { method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }

  async function publishHashes(hashes, ghOverride) {
    const gh = ghOverride || readGithubConfig();
    if (!gh.repo || !gh.token) {
      return { published: false, error: 'license_not_configured', detail: 'Falta token/repo en state/github.json' };
    }
    if (!fetchFn) return { published: false, error: 'no_fetch', detail: 'fetch no disponible' };
    const contentsPath = '/repos/' + gh.repo + '/contents/' + encodeURIComponent(gh.path || 'blacklist.json');
    const list = new Set();
    let fileSha = null;

    const existing = await ghGet(contentsPath, gh.token);
    if (existing.status === 200 && existing.data && existing.data.content) {
      try {
        const text = Buffer.from(existing.data.content, 'base64').toString('utf8');
        const parsed = JSON.parse(text);
        for (const h of (parsed.revoked || [])) list.add(String(h).toLowerCase());
      } catch (e) {
        log('blacklist remota con formato invalido, se sobrescribe: ' + String(e.message || e));
      }
      fileSha = existing.data.sha;
    } else if (existing.status !== 404) {
      return { published: false, error: 'gh_read_' + existing.status, detail: existing.data && existing.data.message };
    }

    for (const h of (hashes || [])) list.add(String(h).toLowerCase());
    const payload = { revoked: [...list].sort(), updatedAt: new Date().toISOString() };
    const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64');
    const body = {
      message: 'Revocaciones actualizadas (' + hashes.length + ' nuevas)',
      content,
      branch: gh.branch || 'main',
    };
    if (fileSha) body.sha = fileSha;

    const res = await ghPut(contentsPath, gh.token, body);
    if ((res.status === 409 || res.status === 422) && fileSha) {
      const fresh = await ghGet(contentsPath, gh.token);
      if (fresh.status === 200 && fresh.data && fresh.data.sha) {
        body.sha = fresh.data.sha;
        const retry = await ghPut(contentsPath, gh.token, body);
        return { published: retry.status === 200 || retry.status === 201, status: retry.status, count: list.size };
      }
    }
    return { published: res.status === 200 || res.status === 201, status: res.status, count: list.size };
  }

  async function publishRevocation(key) {
    return publishHashes([sha256(key)]);
  }

  function indexEntryFor(k) {
    return {
      plan: String(k.plan || ''),
      owner: String(k.owner || 'Cliente'),
      days: Math.max(0, parseInt(k.days, 10) || 0),
      hours: Math.max(0, parseInt(k.hours, 10) || 0),
      game: k.game || null,
      trial: !!k.trial,
      active: k.active !== false,
      paid: k.paid !== false,
      vip: false,
      maxDevices: 1,
      kickEpoch: parseInt(k.kickEpoch, 10) || 0,
      pausedMs: Math.max(0, parseInt(k.pausedMs, 10) || 0),
    };
  }

  async function publishIndex(ghOverride) {
    const gh = ghOverride || readGithubConfig();
    if (!gh.repo || !gh.token) {
      return { published: false, error: 'license_not_configured', detail: 'Falta token/repo en state/github.json' };
    }
    if (!fetchFn) return { published: false, error: 'no_fetch', detail: 'fetch no disponible' };
    const contentsPath = '/repos/' + gh.repo + '/contents/' + encodeURIComponent(INDEX_FILE);
    const entries = {};
    for (const k of listKeys()) entries[sha256(k.key)] = indexEntryFor(k);
    const payload = { updatedAt: new Date().toISOString(), entries };
    const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64');
    const body = { message: 'Índice de llaves actualizado (' + Object.keys(entries).length + ')', content, branch: gh.branch || 'main' };

    let fileSha = null;
    const existing = await ghGet(contentsPath, gh.token);
    if (existing.status === 200 && existing.data && existing.data.sha) fileSha = existing.data.sha;
    else if (existing.status !== 404) {
      return { published: false, error: 'gh_read_' + existing.status, detail: existing.data && existing.data.message };
    }
    if (fileSha) body.sha = fileSha;

    const res = await ghPut(contentsPath, gh.token, body);
    if ((res.status === 409 || res.status === 422) && fileSha) {
      const fresh = await ghGet(contentsPath, gh.token);
      if (fresh.status === 200 && fresh.data && fresh.data.sha) {
        body.sha = fresh.data.sha;
        const retry = await ghPut(contentsPath, gh.token, body);
        return { published: retry.status === 200 || retry.status === 201, status: retry.status, count: Object.keys(entries).length };
      }
    }
    return { published: res.status === 200 || res.status === 201, status: res.status, count: Object.keys(entries).length };
  }

  async function publishAll(ghOverride) {
    const gh = ghOverride || readGithubConfig();
    const revoked = listKeys().filter((k) => k.active === false).map((k) => k.key).filter(Boolean);
    const blacklist = await publishHashes(revoked, gh);
    const index = await publishIndex(gh);
    return { blacklist, index };
  }

  function diagnostics() {
    const url = resolveUrl();
    const idxUrl = resolveKeysIndexUrl();
    const gh = readGithubConfig();
    const dc = devicesConfig();
    const entry = url ? cache.get(url) : null;
    const idx = idxUrl ? indexCache.get(idxUrl) : null;
    return {
      url: url || null,
      keysIndexUrl: idxUrl || null,
      onlineCheck: !!url,
      indexCheck: !!idxUrl,
      pushConfigured: !!(gh.repo && gh.token),
      repo: gh.repo || null,
      synced: !!entry,
      indexSynced: !!idx,
      lastSync: entry ? entry.at : null,
      revokedCount: entry ? entry.hashes.size : 0,
      indexCount: idx ? idx.entries.size : 0,
      pollMs: pollMs(),
      devicesUrl: dc.devicesUrl || null,
      devicesConfigured: !!dc.devicesUrl,
      devicesTokenConfigured: !!dc.devicesToken,
      devicesCount: devicesCache ? Object.keys(devicesCache.map || {}).length : 0,
    };
  }

  function startWatcher() {
    refresh().catch(() => {});
    refreshIndex().catch(() => {});
    const timer = setInterval(() => {
      refresh().catch(() => {});
      refreshIndex().catch(() => {});
    }, pollMs());
    if (timer.unref) timer.unref();
    return timer;
  }

  return { refresh, check, checkAsync, refreshIndex, ensureIndex, getIndexEntry, indexSynced, publishRevocation, publishHashes, publishIndex, publishAll, diagnostics, startWatcher, fetchDevices, refreshDevices, claimDevice, resetDevice, getDevicesMap };
}
