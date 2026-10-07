/* Panel admin + tienda web SIN el bot de Eldorado.
   Levanta solo el servidor de keys (store): landing web + panel admin de keys.
   Pensado para el due├▒o: correrlo en su PC (o en un VPS) y administrar las
   keys sin tener que abrir la app del bot. No arranca Chrome ni FastMode.

   Requisitos:
     - ELBOT_MASTER_KEY (obligatorio, protege el panel admin)
     - state/github.json con token+repo (para publicar en GitHub)
     - config/license.json (URLs de blacklist/├¡ndice/devices)

   Uso:
     node tools/remote-admin.mjs
     node tools/remote-admin.mjs --port 8080

   Env: ELBOT_MASTER_KEY, ELBOT_STATE_DIR, ELBOT_STORE_PORT
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { createLicenseChecker } from '../src/license.js';
import { startStoreServer } from '../src/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(ROOT, 'config', 'rules.json');

let config = {};
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('[remote-admin] No se pudo leer config/rules.json: ' + String(e.message || e));
  process.exit(1);
}

if (!process.env.ELBOT_MASTER_KEY) {
  console.error('[remote-admin] Falta la variable de entorno ELBOT_MASTER_KEY (protege el panel admin).');
  process.exit(1);
}

const storeCfg = (config.store) || {};
const argPort = process.argv.findIndex((a) => a === '--port');
const storePort = Number(process.env.ELBOT_STORE_PORT || (argPort >= 0 ? process.argv[argPort + 1] : null) || storeCfg.port || 8080);

const STATE_DIR = process.env.ELBOT_STATE_DIR || join(ROOT, 'state');
const LOCK_FILE = join(STATE_DIR, 'remote-admin.lock');

function isAlivePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function acquireLock() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(LOCK_FILE)) {
      let old = null;
      try { old = Number(String(readFileSync(LOCK_FILE, 'utf8') || '').trim()); } catch {}
      if (isAlivePid(old)) {
        console.error('[remote-admin] Ya hay otra instancia corriendo (pid ' + old + '). Saliendo.');
        return false;
      }
      try { unlinkSync(LOCK_FILE); } catch {}
    }
    writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
    return true;
  } catch (e) {
    return true;
  }
}

function releaseLock() {
  try {
    const cur = Number(String(readFileSync(LOCK_FILE, 'utf8') || '').trim());
    if (cur === process.pid) unlinkSync(LOCK_FILE);
  } catch (e) {}
}

if (!acquireLock()) process.exit(0);

async function portAlreadyServed() {
  try {
    const res = await fetch('http://127.0.0.1:' + storePort + '/api/plans');
    if (!res.ok) return false;
    const d = await res.json();
    return !!(d && d.ok && Array.isArray(d.plans));
  } catch (e) {
    return false;
  }
}

const license = createLicenseChecker(() => config, { debug: false });
license.startWatcher();
license.refreshDevices().catch(() => {});

portAlreadyServed().then((served) => {
  if (served) {
    console.error('[remote-admin] El store ya responde en el puerto ' + storePort + '. Saliendo.');
    releaseLock();
    process.exit(0);
  }
  startStoreServer(storePort, license);
  console.log('[remote-admin] Servidor de keys activo (sin el bot de Eldorado).');
  console.log('[remote-admin] Panel admin: http://localhost:' + storePort + '/admin');
  console.log('[remote-admin] Tienda web:  http://localhost:' + storePort + '/');
});

function shutdown() {
  console.log('\n[remote-admin] Detenido.');
  releaseLock();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
