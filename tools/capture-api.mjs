import { chromium } from 'playwright';
import fs from 'fs/promises';
import { resolveEta } from '../src/rules.js';

// Captura todas las llamadas XHR/fetch que hace Eldorado al crear una oferta,
// para descubrir el API real y poder implementar el Fast Mode (~150ms).
// Uso:  node tools/capture-api.mjs  [requestId|url]
// Crea un formulario de oferta con precio 10 / entrega "1 day" y guarda en state/api_capture.json

const root = process.cwd();
const auth = JSON.parse(await fs.readFile(root + '/state/auth.json', 'utf8'));
const config = JSON.parse(await fs.readFile(root + '/config/rules.json', 'utf8'));
const dashboard = JSON.parse(await fs.readFile(root + '/state/dashboard.json', 'utf8'));

let target;
const arg = process.argv[2];
if (arg && arg.includes('http')) {
  target = arg;
} else if (arg) {
  const rec = dashboard.find((r) => r.id.startsWith(arg));
  target = rec ? rec.href : undefined;
}
if (!target) {
  const sorted = [...dashboard].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
  const rec = sorted.find((r) => r.href && r.price != null) || sorted[0];
  target = rec ? rec.href : undefined;
}
if (!target) {
  console.error('No hay request en state/dashboard.json para probar.');
  process.exit(1);
}
console.log('Probando request:', target);

const stealthArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=AutomationControlled',
  '--disable-infobars',
  '--disable-extensions',
  '--no-default-browser-check',
];

const browser = await chromium.launchPersistentContext(root + '/.profile', {
  headless: false,
  channel: 'chrome',
  args: stealthArgs,
  ignoreDefaultArgs: ['--enable-automation'],
});
const page = browser.pages()[0] || await browser.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const captures = [];

function redact(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (/^(authorization|cookie|set-cookie)$/i.test(k)) out[k] = '[REDACTED]';
    else out[k] = v;
  }
  return out;
}

page.on('request', (req) => {
  const rt = req.resourceType();
  if (rt !== 'xhr' && rt !== 'fetch') return;
  const u = req.url();
  if (!/api|offer|boosting|inbox|chat|conversation/i.test(u)) return;
  captures.push({
    t: new Date().toISOString(),
    method: req.method(),
    url: u,
    headers: redact(req.headers()),
    postData: req.postData() ? String(req.postData()).slice(0, 4000) : null,
  });
});

page.on('response', (res) => {
  const req = res.request();
  if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
  const u = req.url();
  if (!/api|offer|boosting|inbox|chat|conversation/i.test(u)) return;
  const entry = captures.find((c) => c.url === u && !c.response);
  res.text().then((body) => {
    if (entry) entry.response = body.slice(0, 8000);
  }).catch(() => {});
});

await page.goto(target, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const btn = page.locator("[data-testid^='create-boosting-offer-button']").first();
if (!(await btn.count())) {
  console.error('No se encontro el boton de crear oferta. Revisa que la sesion este activa.');
  await browser.close();
  process.exit(1);
}
await btn.click();
await page.waitForTimeout(3000);

const priceInput = page.locator("input[aria-label='Numeric input field']").last();
if (await priceInput.count()) await priceInput.fill('10');

const dd = page.locator("[aria-label='Single-select dropdown']").first();
if (await dd.count()) {
  await dd.click();
  await page.waitForTimeout(1500);
  const opts = page.locator('[role="option"]');
  const n = await opts.count();
  for (let i = 0; i < n; i++) {
    const txt = (await opts.nth(i).innerText().catch(() => '')).trim();
    if (txt === resolveEta('1 day')) {
      await opts.nth(i).click();
      break;
    }
  }
}

await page.waitForTimeout(2000);
console.log('Llena el formulario y pulsa "Create offer". Capturando...');
console.log('Esperando confirmacion (hasta 60s)...');

const modal = page.locator('eld-place-boosting-offer-modal');
const start = Date.now();
while (Date.now() - start < 60000) {
  if (!(await modal.count())) break;
  await page.waitForTimeout(2000);
}

await page.waitForTimeout(3000);
const outFile = root + '/state/api_capture.json';
await fs.writeFile(outFile, JSON.stringify(captures, null, 2));
console.log('\n==========================================');
console.log('Capturas guardadas en:', outFile);
console.log('Total llamadas XHR/fetch:', captures.length);
for (const c of captures) {
  console.log(`  ${c.method} ${c.url}`);
  if (c.postData) console.log(`    POST: ${c.postData.slice(0, 200)}`);
  if (c.response) console.log(`    -> ${c.response.slice(0, 200)}`);
}
console.log('==========================================');
await browser.close();
