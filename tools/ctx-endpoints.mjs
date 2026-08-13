import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-UXZWHNOO.js', 'utf8');
const i = t.indexOf('class s{constructor');
console.log('--- SERVICIO UXZWHNOO (completo) ---');
console.log(t.slice(i, i + 4000).replace(/\s+/g, ' '));
