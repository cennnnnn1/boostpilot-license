import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
for (const f of files) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  const i = t.indexOf('Automated');
  if (i >= 0 && i < 500000) {
    console.log(`\n### ${f} @${i}`);
    console.log(t.slice(Math.max(0, i - 500), i + 120).replace(/\s+/g, ' ').slice(0, 700));
  }
}
