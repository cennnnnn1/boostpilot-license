import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
for (const f of files) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  const i = t.indexOf('ActiveRequests');
  if (i >= 0) {
    console.log(`\n### ${f} @${i}`);
    console.log(t.slice(Math.max(0, i - 300), i + 300).replace(/\s+/g, ' ').slice(0, 650));
  }
}
