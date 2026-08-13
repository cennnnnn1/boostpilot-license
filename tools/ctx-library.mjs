import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-O4SA222T.js', 'utf8');
const i = t.indexOf('LIBRARY_ENDPOINT_SLUG=');
console.log(t.slice(Math.max(0, i - 300), i + 300).replace(/\s+/g, ' '));
