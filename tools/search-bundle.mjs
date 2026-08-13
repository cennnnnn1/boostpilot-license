import fs from 'fs/promises';

const t = await fs.readFile('state/bundle_main-ZSA46M57.js', 'utf8');
const labels = [
  ['boosting', /boosting/gi],
  ['received', /received/gi],
  ['offer', /offer/gi],
  ['requests', /requests/gi],
  ['dashboard', /dashboard/gi],
  ['chunk .js', /\.js"/g],
  ['appConstants', /appConstants/gi],
  ['authorization', /authorization/i],
  ['Authorization', /Authorization/g],
  ['Bearer', /Bearer/g],
];
const out = [];
for (const [label, re] of labels) {
  let m, n = 0;
  while ((m = re.exec(t))) {
    const s = Math.max(0, m.index - 70);
    out.push(`${label} :: ${t.slice(s, m.index + 130).replace(/\s+/g, ' ')}`);
    n++;
    if (n > 8) break;
  }
}
console.log(out.join('\n---\n'));
