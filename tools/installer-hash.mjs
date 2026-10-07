// installer-hash.mjs — imprime el SHA256 del instalador actual (verificación).
//
// Uso:
//   node tools/installer-hash.mjs            → hash del instalador de la versión actual
//   node tools/installer-hash.mjs --version=1.7.6   → hash de una versión específica
//
// Sirve para que clientes verifiquen que el archivo que bajan es el oficial
// (y para reportar a antivirus con datos). Nunca imprime secretos.
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, def) {
  for (const a of process.argv.slice(2)) {
    const m = a.match(new RegExp('^--' + name + '=(.+)$'));
    if (m) return m[1];
  }
  return def;
}

const version = arg('version', null) || JSON.parse(readFileSync(join(ROOT, 'launcher', 'package.json'), 'utf8')).version;
const exe = join(ROOT, 'release', `BoostPilot Setup ${version}.exe`);
if (!existsSync(exe)) {
  console.error('No existe: ' + exe);
  console.error('  (Corré primero: npm run dist dentro de launcher/)');
  process.exit(1);
}

const hash = createHash('sha256').update(readFileSync(exe)).digest('hex').toUpperCase();
console.log('\n· BoostPilot v' + version + ' — verificación oficial\n');
console.log('  Archivo : BoostPilot Setup ' + version + '.exe');
console.log('  SHA256  : ' + hash);
console.log('\n  Cómo verificar en Windows:');
console.log('   1) Baja el instalador desde #downloads (nunca de otro sitio).');
console.log('   2) PowerShell: Get-FileHash "BoostPilot Setup ' + version + '.exe" -Algorithm SHA256');
console.log('   3) Compará el hash con el de arriba (debe coincidir).');
console.log('\n  ¿Antivirus marca falso positivo?');
console.log('   1) Verificá el hash (arriba) para confirmar que el archivo es el oficial.');
console.log('   2) Subilo a VirusTotal y hacé click en "request analysis":');
console.log('      https://www.virustotal.com/gui/home/upload');
console.log('   3) Agregá el archivo a exclusiones de tu antivirus si el hash coincide.');
console.log('\n  (El exe no está firmado; el aviso de Windows se salta con Más información → Ejecutar de todas formas.)\n');
