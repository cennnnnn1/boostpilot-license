import fs from 'fs/promises';

const auth = JSON.parse(await fs.readFile('state/auth.json', 'utf8'));
const cookie = auth.cookies
  .filter((c) => c.domain.endsWith('eldorado.gg'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0';

for (const [label, url, useCookies] of [
  ['appConstants sin cookies', 'https://www.eldorado.gg/api/appConstants', false],
  ['appConstants con cookies', 'https://www.eldorado.gg/api/appConstants', true],
]) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua, ...(useCookies ? { cookie } : {}) } });
    const t = await res.text();
    console.log(`${res.status}  ${label}  ct=${res.headers.get('content-type')}`);
    console.log('   ->', t.slice(0, 250).replace(/\n+/g, ' '));
  } catch (err) {
    console.log(`ERR  ${label}  -> ${err.message.slice(0, 120)}`);
  }
}
