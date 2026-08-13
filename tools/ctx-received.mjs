import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-AMVPT6LT.js', 'utf8');
const i = t.indexOf('lt=[{i');
console.log('--- lt (tabs received) ---');
console.log(t.slice(i, i + 500).replace(/\s+/g, ' '));
const j = t.indexOf('ActiveRequests');
console.log('\n--- ActiveRequests context ---');
console.log(t.slice(Math.max(0, j - 300), j + 300).replace(/\s+/g, ' '));
