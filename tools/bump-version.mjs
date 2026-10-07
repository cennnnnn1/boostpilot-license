import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OLD = '1.7.27';
const NEW = '1.7.28';

const TARGETS = ['./package.json', './launcher/package.json', './launcher/main.js'];

if (process.argv.includes('--vars')) {
  for (const t of TARGETS) {
    const s = fs.readFileSync(t, 'utf8');
    console.log('FILE=' + t);
    if (t.endsWith('main.js')) {
      const m = s.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
      console.log('  VERSION=' + (m ? m[1] : 'NO_MATCH'));
    } else {
      const m = s.match(/"version"\s*:\s*"([^"]+)"/);
      console.log('  version=' + (m ? m[1] : 'NO_MATCH'));
    }
  }
  process.exit(0);
}

let bumped = 0;
for (const t of TARGETS) {
  const s = fs.readFileSync(t, 'utf8');
  if (s.includes(OLD)) {
    const ns = s.split(OLD).join(NEW);
    fs.writeFileSync(t, ns, 'utf8');
    bumped += 1;
  }
}

let mustBeOld = 2; // launcher/package.json requiere bump MANUAL a 1.7.28 (check fiel)
console.log('BUMPED_FILES=' + bumped);
console.log('EXPECT=' + bumped + '==2 o 3 dependiendo si main.js ya tenía 1.7.28');
if (bumped < 2) {
  console.log('BUMP_WARN menos de 2 archivos tocados, revisar');
}

for (const t of ['./package.json', './launcher/package.json', './launcher/main.js']) {
  const s = fs.readFileSync(t, 'utf8');
  const hasOld = s.includes(OLD) && !s.includes('dependencies') && !s.includes('optional')
    ? 'AMBER' : (s.includes(OLD) ? 'AMBER(old en otra seccion)' : 'CLEAN');
  console.log('POST ' + t + ' hasOld=' + hasOld);
}

// node --check fiel (sin tocar dependencias)
for (const f of ['./launcher/main.js']) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('CHECK ' + f + ' =0');
  } catch (e) {
    console.log('CHECK ' + f + ' =NONZERO ' + (e.stderr ? String(e.stderr).slice(0, 120) : ''));
  }
}

for (const t of ['./package.json', './launcher/package.json']) {
  const o = JSON.parse(fs.readFileSync(t, 'utf8'));
  console.log('JSON ' + t + ' version=' + o.version);
}

if (process.env.GATE && process.env.GATE === 'strict' && bumped < 2) {
  process.exit(1);
}
