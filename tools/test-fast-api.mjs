import fs from 'fs/promises';

const BASE = 'https://www.eldorado.gg/api/';
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

async function loadAuth() {
  return JSON.parse(await fs.readFile('state/auth.json', 'utf8'));
}
function cookieHeader(auth, host) {
  return auth.cookies
    .filter((c) => {
      const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
      return d === host || d.endsWith('.' + host);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
function xsrfToken(auth) {
  const c = auth.cookies.find((c) => c.name === '__Host-XSRF-TOKEN');
  return c ? c.value : null;
}

const auth = await loadAuth();
let cookie = cookieHeader(auth, 'eldorado.gg');
console.log('cookie host:', cookie.slice(0, 80) + '...');

async function req(method, path, body) {
  const headers = {
    'user-agent': ua,
    'accept': 'application/json, text/plain, */*',
    'cookie': cookie,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const xsrf = xsrfToken(auth);
    if (xsrf) headers['x-xsrf-token'] = xsrf;
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`\n### ${method} ${path} -> ${res.status}`);
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of setCookies.slice(0, 10)) console.log('   Set-Cookie:', sc.slice(0, 80));
  console.log('   body:', text.slice(0, 600).replace(/\n+/g, ' '));
  return { res, text, setCookies };
}

const refresh = await req('POST', 'authentication/refreshTokens');
for (const sc of refresh.setCookies) {
  const m = sc.match(/^([^=]+)=([^;]*)/);
  if (m) {
    if (cookie.includes(m[1] + '=')) {
      const re = new RegExp('(^|; )' + m[1] + '=[^;]*');
      cookie = cookie.replace(re, '$1' + m[1] + '=' + m[2]);
    } else {
      cookie += '; ' + m[1] + '=' + m[2];
    }
  }
}
await req('GET', 'boostingOffers/me/boostingRequests/received');
await req('GET', 'boostingOffers/boostingRequests/e0478d45-4a30-4c53-97d1-08def2182ca3/details');
await req('POST', 'boostingOffers', {});
