import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
const re = /"games?[a-zA-Z/_-]*"|`games?\/\$\{|games?\/[a-zA-Z]*|boostingCategories?\/\$\{/g;
for (const f of files) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  let m, n = 0;
  while ((m = re.exec(t)) && n < 3) {
    const s = Math.max(0, m.index - 90);
    console.log(`\n### ${f}`);
    console.log(t.slice(s, m.index + 130).replace(/\s+/g, ' ').slice(0, 320));
    n++;
  }
}
