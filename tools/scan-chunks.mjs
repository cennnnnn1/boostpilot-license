import fs from 'fs/promises';

const t = await fs.readFile('state/bundle_main-ZSA46M57.js', 'utf8');
const names = [...new Set([...t.matchAll(/chunk-[A-Z0-9]+\.js/g)].map((m) => m[0]))];
console.log('chunks en main:', names.length, names.slice(0, 60).join(' '));

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0';
await fs.mkdir('state/chunks', { recursive: true });
const hits = [];
let done = 0;
for (const name of names) {
  const f = 'state/chunks/' + name;
  try {
    let txt;
    try { txt = await fs.readFile(f, 'utf8'); }
    catch {
      const r = await fetch('https://www.eldorado.gg/' + name, { headers: { 'user-agent': ua } });
      txt = await r.text();
      await fs.writeFile(f, txt);
    }
    done++;
    const apiPaths = new Set();
    let m;
    const re = /["'`](?:\.{1,2}\/)*[^"'`]*api\/[a-zA-Z0-9/_-]*|["'`]\/api\/[a-zA-Z0-9/_-]*["'`]|wss?:\/\/[^"'` ]+|graphql[^"'` ]{0,40}/gi;
    while ((m = re.exec(txt))) {
      const v = m[0].replace(/["'`]/g, '').slice(0, 120);
      if (!apiPaths.has(v)) apiPaths.add(v);
    }
    const interesting = /refresh|received|boostingOffer|offer|notifications?\/api|user\b|EldoradoRefreshToken/i.test(txt);
    if (apiPaths.size || interesting) {
      hits.push({ name, size: txt.length, api: [...apiPaths].slice(0, 25), refresh: /refresh/i.test(txt) });
    }
  } catch (err) {
    console.log('ERR', name, err.message.slice(0, 60));
  }
}
console.log('descargados', done, '/', names.length);
for (const h of hits.sort((a, b) => b.size - a.size)) {
  console.log(`\n=== ${h.name} (${h.size}b${h.refresh ? ' REFRESH' : ''}) ===`);
  console.log(h.api.slice(0, 25).join('\n'));
}
