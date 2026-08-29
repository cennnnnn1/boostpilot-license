import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import fs from 'fs/promises';
import net from 'net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.ELBOT_STATE_DIR || join(root, 'state');
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, 'auth.json');

function findFreePort(start = 9222) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(String(p))); });
    srv.on('error', () => resolve(findFreePort(start + 1)));
  });
}

const cdpPort = process.env.CDP_PORT || await findFreePort();
const cdpBase = `http://127.0.0.1:${cdpPort}`;
const loginTimeoutMs = Number(process.env.LOGIN_TIMEOUT || 120000);
const cfStuckTimeoutMs = Number(process.env.CF_STUCK_TIMEOUT || 30000);

const SESSION_COOKIES = ['__Host-EldoradoIdToken', '__Host-EldoradoRefreshToken'];

class CloudflareStuckError extends Error {
  constructor(ray) {
    super('Cloudflare no avanzó la verificación' + (ray ? ' (Ray ID: ' + ray + ')' : ''));
    this.ray = ray;
  }
}

const CF_PROBE = `(function () {
  var t = (document.title || '');
  var b = '';
  try { b = (document.body ? document.body.innerText : '') || ''; } catch (e) {}
  var isCf = /just a moment|un momento|verificando su navegador/i.test(t);
  var ray = '';
  var m = b.match(/Ray ID:\\s*([0-9a-fA-F]+)/i);
  if (m) ray = m[1];
  if (!isCf && ray) isCf = /verificaci[o\\u00f3]n de seguridad|checking your browser|isn't a robot|not a robot|security check|protege(r)? contra bots/i.test(b);
  var hasForm = false;
  try { hasForm = !!document.querySelector('input[type=password], input[name=password], input[type=email], input[name=email], input[name=username]'); } catch (e) {}
  return { isCf: isCf, hasForm: hasForm, ray: ray, t: t };
})()`;

function log(msg) {
  console.log('[login] ' + msg);
}

async function getJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let seq = 0;
function cdpCall(ws, method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMsg);
      ws.removeEventListener('error', onErr);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result || {});
    };
    const onErr = () => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('websocket cerrado'));
    };
    ws.addEventListener('message', onMsg);
    ws.addEventListener('error', onErr);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('no se pudo conectar por WebSocket')));
  });
}

async function waitCdp() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const v = await getJson(cdpBase + '/json/version');
      if (v.webSocketDebuggerUrl) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('No hay Chrome con depuración activa en el puerto ' + cdpPort);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findOrOpenTab(ws) {
  const list = await getJson(cdpBase + '/json/list');
  let target = (list || []).find((t) => t.type === 'page' && t.url && t.url.includes('eldorado'));
  if (!target) {
    try {
      const r = await fetch(cdpBase + '/json/new?https%3A%2F%2Fwww.eldorado.gg', { method: 'PUT' });
      if (r.ok) target = await r.json();
    } catch {}
  }
  if (!target) target = (list || []).find((t) => t.type === 'page');
  if (!target || !target.webSocketDebuggerUrl) throw new Error('No se pudo abrir una pestaña');
  const pageWs = await connectWs(target.webSocketDebuggerUrl);
  await cdpCall(pageWs, 'Page.enable');
  if (target.url && !target.url.includes('eldorado')) {
    await cdpCall(pageWs, 'Page.navigate', { url: 'https://www.eldorado.gg' });
  }
  return pageWs;
}

async function waitForSession(pageWs) {
  await cdpCall(pageWs, 'Network.enable');
  await cdpCall(pageWs, 'Runtime.enable');
  const deadline = Date.now() + loginTimeoutMs;
  log('Esperando que inicies sesión en Eldorado en la ventana de Chrome...');
  let cookies = [];
  let cfSince = 0;
  let formLogged = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    let state = null;
    try {
      const ev = await cdpCall(pageWs, 'Runtime.evaluate', { expression: CF_PROBE, returnByValue: true });
      state = (ev.result && ev.result.value) || null;
    } catch (e) {
      state = null;
    }
    const isCf = !!(state && state.isCf);
    const hasForm = !!(state && state.hasForm);
    if (isCf) {
      if (!cfSince) {
        cfSince = Date.now();
        log('Verificación de Cloudflare detectada. Esperando que avance (hasta ' + Math.round(cfStuckTimeoutMs / 1000) + 's)...');
      }
      if (Date.now() - cfSince > cfStuckTimeoutMs) {
        log('La verificación de Cloudflare no avanzó' + (state && state.ray ? ' (Ray ID: ' + state.ray + ')' : '') + '. Saliendo para reintentar.');
        throw new CloudflareStuckError(state && state.ray);
      }
    } else {
      cfSince = 0;
      if (hasForm && !formLogged) {
        formLogged = true;
        log('Formulario de login detectado. Ingresá tus datos en la ventana de Chrome.');
      }
    }
    try {
      const res = await cdpCall(pageWs, 'Network.getAllCookies');
      cookies = (res && res.cookies) || [];
      if (cookies.some((c) => SESSION_COOKIES.includes(c.name))) {
        log('Sesión detectada (' + cookies.length + ' cookies).');
        return cookies;
      }
    } catch {}
  }
  throw new Error('Tiempo agotado: no se detect\u00f3 la sesi\u00f3n. Vuelve a intentarlo e inicia sesi\u00f3n en Eldorado.');
}

function toStorageState(cookies) {
  const sameSiteMap = { Strict: 'Strict', Lax: 'Lax', None: 'None' };
  return {
    cookies: cookies
      .filter((c) => c && c.domain)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        expires: typeof c.expires === 'number' ? c.expires : -1,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        sameSite: sameSiteMap[c.sameSite] || 'Lax',
      })),
    origins: [],
  };
}

async function closeBrowser() {
  if (process.env.ELBOT_CLOSE_CHROME !== '1') return;
  try {
    const v = await getJson(cdpBase + '/json/version');
    if (!v || !v.webSocketDebuggerUrl) return;
    const ws = await connectWs(v.webSocketDebuggerUrl);
    await cdpCall(ws, 'Browser.close');
    try { ws.close(); } catch (e) {}
  } catch (e) {}
}

try {
  log('Conectando a Chrome (CDP) en ' + cdpBase + ' ...');
  await waitCdp();
  const pageWs = await findOrOpenTab();
  log('Navegando a eldorado.gg ...');
  const cookies = await waitForSession(pageWs);
  const auth = toStorageState(cookies);
  const tmpFile = stateFile + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify(auth));
  await fs.rename(tmpFile, stateFile);
  log('Sesión guardada en: ' + stateFile + ' (' + auth.cookies.length + ' cookies)');
  try { pageWs.close(); } catch (e) {}
  await closeBrowser();
  process.exit(0);
} catch (err) {
  const msg = err && err.message ? err.message : err;
  console.error('[login] Error: ' + msg);
  await closeBrowser();
  process.exit(err instanceof CloudflareStuckError ? 3 : 1);
}
