import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-UXZWHNOO.js', 'utf8');
for (const pat of [/postBoostingOffer/g, /POST_BOOSTING_OFFER/g, /boostingOffer\b/g]) {
  let m, n = 0;
  while ((m = pat.exec(t))) {
    const s = Math.max(0, m.index - 180);
    console.log(`\n--- ${pat.source} #${++n} ---`);
    console.log(t.slice(s, m.index + 320).replace(/\s+/g, ' ').slice(0, 600));
    if (n >= 5) break;
  }
}
