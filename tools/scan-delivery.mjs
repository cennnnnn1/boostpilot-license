import fs from 'fs/promises';
import { readdir } from 'fs/promises';

const files = (await readdir('state/chunks')).filter((f) => f.endsWith('.js'));
for (const f of files) {
  const t = await fs.readFile('state/chunks/' + f, 'utf8');
  let m;
  const re = /Hour1|deliveryTimes|DeliveryTime/g;
  const lines = [];
  let n = 0;
  while ((m = re.exec(t)) && n < 4) {
    const i = m.index;
    const s = Math.max(0, i - 120);
    const frag = t.slice(s, i + 200).replace(/\s+/g, ' ');
    if (/Boosting|boosting|deliveryTime|guaranteedDeliveryTime|Hour1/i.test(frag)) {
      lines.push(frag.slice(0, 380));
      n++;
    }
  }
  if (lines.length) {
    console.log(`\n### ${f}`);
    lines.forEach((l) => console.log('  ', l));
  }
}
