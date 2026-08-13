import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-UTIYQGSG.js', 'utf8');
const i = t.indexOf('a.Automated');
console.log(t.slice(Math.max(0, i - 200), i + 600).replace(/\s+/g, ' '));
