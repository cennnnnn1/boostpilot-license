import fs from 'fs/promises';

const auth = JSON.parse(await fs.readFile('state/auth.json', 'utf8'));
const cookie = auth.cookies
  .filter((c) => c.domain.endsWith('eldorado.gg'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

const candidates = [
  ['GET', 'https://www.eldorado.gg/api/auth/refresh', null],
  ['POST', 'https://www.eldorado.gg/api/auth/refresh', null],
  ['GET', 'https://api.eldorado.gg/api/auth/refresh', null],
  ['GET', 'https://api.eldorado.gg/', null],
  ['GET', 'https://www.eldorado.gg/api/', null],
  ['GET', 'https://www.eldorado.gg/api/dashboard/boosting/requests', null],
  ['GET', 'https://www.eldorado.gg/api/v1/dashboard/boosting/requests', null],
  ['POST', 'https://www.eldorado.gg/graphql', '{"query":"{__typename}"}'],
];

for (const [method, url, body] of candidates) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        cookie,
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      },
      body,
      redirect: 'manual',
    });
    const ct = res.headers.get('content-type') || '';
    const text = (await res.text()).slice(0, 200);
    console.log(`${res.status}  ${method} ${url}  [${ct.slice(0, 40)}]`);
    if (text && !/^\s*$/.test(text)) console.log('   ->', text.replace(/\n+/g, ' ').slice(0, 180));
  } catch (err) {
    console.log(`ERR  ${method} ${url}  -> ${err.message.slice(0, 120)}`);
  }
}
