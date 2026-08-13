import fs from 'fs/promises';

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0';
const base = 'https://www.eldorado.gg/';
for (const file of ['main-ZSA46M57.js', 'polyfills-XP2AW2VX.js']) {
  try {
    const r = await fetch(base + file, { headers: { 'user-agent': ua } });
    const t = await r.text();
    await fs.writeFile('state/bundle_' + file, t);
    console.log(file, r.status, t.length, 'bytes');
  } catch (err) {
    console.log(file, 'ERR', err.message.slice(0, 100));
  }
}
