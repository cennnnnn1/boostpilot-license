// sanitize-config.mjs ΓÇö copia config/ ΓåÆ launcher/build/config/ SIN secretos.
//
// El instalador empaqueta config/rules.json (viaja a cada cliente). Esa copia
// NO debe incluir el webhook del Discord del due├▒o (notify.discord.url), que
// en config/rules.json real est├í con el token. Este script:
//   1) vac├¡a notify.discord.url y desactiva notify.discord.enabled en rules.json
//   2) copia el resto de config/*.json tal cual (license.json viaja con el
//      devicesToken, necesario para el registro de dispositivos).
// Se ejecuta autom├íticamente al correr `npm run dist` en launcher/.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'config');
const DST = join(ROOT, 'launcher', 'build', 'config');

rmSync(DST, { recursive: true, force: true });
mkdirSync(DST, { recursive: true });

let copied = 0;
for (const f of readdirSync(SRC)) {
  if (!/\.json$/i.test(f)) continue;
  const src = join(SRC, f);
  const dst = join(DST, f);
  if (f === 'rules.json') {
    const cfg = JSON.parse(readFileSync(src, 'utf8').replace(/^\uFEFF/, ''));
    if (cfg.notify && cfg.notify.discord) {
      cfg.notify.discord.enabled = false;
      cfg.notify.discord.url = '';
    }
    if (typeof cfg.webhook === 'string') cfg.webhook = '';
    writeFileSync(dst, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log('  (rules.json sanitizado: webhook vac├¡o)');
  } else {
    copyFileSync(src, dst);
  }
  copied++;
}
if (!existsSync(join(DST, 'license.json'))) {
  console.error('[sanitize-config] AVISO: no se copi├│ config/license.json');
}
console.log('[sanitize-config] ' + copied + ' archivos de config listos en ' + DST);
