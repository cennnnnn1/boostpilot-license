import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
const re = /apiService\.(get|post|put|delete)\([^)]{2,60}\)/g;
const seen = new Set();
for (const f of files) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  let m;
  while ((m = re.exec(t))) {
    const v = m[0];
    if (/boosting|categor|catalog|game|library|marketplace/i.test(v)) {
      const key = v.replace(/[A-Za-z$][A-Za-z0-9$]*\./g, '').replace(/\$\{/g, '{').replace(/\}/g, '}').slice(0, 60);
      seen.add(key);
    }
  }
}
console.log([...seen].sort().join('\n'));
