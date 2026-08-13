import fs from 'fs/promises';

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0';
const file = 'chunk-MRC2CX5X.js';
try {
  const r = await fetch('https://www.eldorado.gg/' + file, { headers: { 'user-agent': ua } });
  const t = await r.text();
  await fs.writeFile('state/chunks/' + file, t);
  console.log(file, r.status, t.length);
} catch (err) {
  console.log('ERR', err.message.slice(0, 100));
}
