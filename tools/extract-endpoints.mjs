import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-5DKRNTX3.js', 'utf8');
const i = t.indexOf('api.publicBaseUrl');
console.log('--- CONFIG env ---');
console.log(t.slice(Math.max(0, i - 200), i + 900));

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
console.log(`\n--- buscando literales en ${files.length} chunks ---`);
const wants = /boosting|received|dashboard|offer|offers?|requests?|refreshToken|login|session/i;
const results = new Map();
for (const f of files) {
  const c = await fs.readFile('state/chunks/' + f, 'utf8');
  const segments = new Set();
  let m;
  const re = /["'`]([a-zA-Z0-9_./{}-]*(?:boosting|received|offers?|requests?|refreshToken|received-requests|order)[a-zA-Z0-9_./{}-]*)["'`]/gi;
  while ((m = re.exec(c))) {
    const v = m[1];
    if (v.length > 3 && v.length < 90) segments.add(v);
  }
  if (segments.size) results.set(f, [...segments].slice(0, 30));
}
for (const [f, segs] of results) {
  console.log(`\n=== ${f} ===`);
  console.log(segs.join('\n'));
}
