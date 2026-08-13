import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();

const consoleMsgs = [];
const failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) { /* keep only cf/eldorado */ } });

await page.goto('https://login.eldorado.gg', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForTimeout(25000);

console.log('URL:', page.url());
console.log('Title:', await page.title());
console.log('--- Console errores/warnings ---');
console.log(consoleMsgs.slice(0, 30).join('\n') || '(ninguno)');
console.log('--- Requests fallidos ---');
console.log(failedReqs.slice(0, 30).join('\n') || '(ninguno)');
const turnstile = page.frames().some((f) => f.url().includes('challenges.cloudflare.com'));
console.log('Turnstile iframe presente:', turnstile);
const hasPwd = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
console.log('Formulario login visible:', hasPwd);
await page.close();
process.exit(0);
