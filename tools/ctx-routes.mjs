import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-7FROPZ3S.js', 'utf8');
let m;
const re = /received-requests/g;
let n = 0;
while ((m = re.exec(t))) {
  const s = Math.max(0, m.index - 300);
  console.log(`--- #${++n} ---`);
  console.log(t.slice(s, m.index + 500).replace(/\s+/g, ' ').slice(0, 800));
}
