import fs from 'fs/promises';

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const r = await fetch('https://www.eldorado.gg', { headers: { 'user-agent': ua } });
const t = await r.text();
await fs.writeFile('state/home_shell.html', t);
console.log('guardado', t.length, 'bytes');

const hits = t.match(/https?:\\?\/\\?\/[^"' ]*(?:graphql|api|gateway|wss)[^"' <]*/gi) || [];
console.log('hits url:', [...new Set(hits)].slice(0, 20));
const pathHits = t.match(/["'`]\/[^"'`]*(?:graphql|api|gateway|boosting)[^"'`]*["'`]/gi) || [];
console.log('hits path:', [...new Set(pathHits)].slice(0, 20));
const scripts = t.match(/src="([^"]+\.js)"/g) || [];
console.log('scripts:', scripts.slice(0, 10).join('\n'));
