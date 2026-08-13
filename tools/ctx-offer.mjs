import fs from 'fs/promises';

const t = await fs.readFile('state/chunks/chunk-PK7BQUIP.js', 'utf8');
console.log('############ PK7BQUIP: oferta / dispatch ############');
for (const pat of [/new [A-Za-z$]+\(\{[^}]*boostingRequestId[^}]*\}/g, /dispatch/g, /postBoostingOffer/g, /OfferDetails/g, /Details/g, /offerPrice|price:/g, /guaranteedDeliveryTime|deliveryTime:/g, /messageToBuyer|MessageToBuyer/g]) {
  let m, n = 0;
  while ((m = pat.exec(t))) {
    const s = Math.max(0, m.index - 180);
    console.log(`\n--- ${pat.source} #${++n} ---`);
    console.log(t.slice(s, m.index + 280).replace(/\s+/g, ' ').slice(0, 600));
    if (n >= 5) break;
  }
}
