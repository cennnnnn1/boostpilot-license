import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
const sizes = [];
for (const f of files) {
  const st = await fs.stat('state/chunks/' + f);
  sizes.push([f, st.size]);
}
sizes.sort((a, b) => b[1] - a[1]);
for (const [f] of sizes.slice(0, 30)) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  const found = [];
  const re = /descriptionValues[^\n]{0,220}/g;
  let m;
  while ((m = re.exec(t))) {
    found.push(m[0].slice(0, 220));
    if (found.length >= 3) break;
  }
  if (found.length) {
    console.log(`\n### ${f} (${(t.length / 1024).toFixed(0)}KB)`);
    found.forEach((x) => console.log('  ', x.slice(0, 200)));
  }
}
