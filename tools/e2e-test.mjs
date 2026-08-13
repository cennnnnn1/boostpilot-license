import { chromium } from 'playwright';
import fs from 'fs/promises';
import { resolveEta } from '../src/rules.js';

const root = process.cwd();
const auth = JSON.parse(await fs.readFile(root + '/state/auth.json', 'utf8'));

const price = process.argv[2] || '10';

const sel = {
  detailTitle: '.seller-title-date .text-lg.font-bold',
  detailDescription: '.request-description',
  createOfferButton: "[data-testid^='create-boosting-offer-button']",
  offerPriceInput: "input[aria-label='Numeric input field']",
  offerEtaDropdown: "[aria-label='Single-select dropdown']",
  offerEtaOption: "[role='option']",
};

const url = 'https://www.eldorado.gg/boosting-request/8d02aa3e-e608-48af-fe89-08def1f6e434';

const stealthArgs = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=AutomationControlled',
  '--disable-infobars',
  '--disable-extensions',
  '--no-default-browser-check',
];

const browser = await chromium.launchPersistentContext(root + '/.profile', {
  headless: true,
  channel: 'chrome',
  args: stealthArgs,
  ignoreDefaultArgs: ['--enable-automation'],
});
const page = browser.pages()[0] || await browser.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const title = (await page.locator(sel.detailTitle).first().innerText().catch(() => '')) || '';
const desc = (await page.locator(sel.detailDescription).first().innerText().catch(() => '')) || '';
const text = `${title} ${desc}`;
console.log('TITULO:', title);
console.log('DESCRIPCION:', desc.replace(/\s+/g, ' ').trim().slice(0, 300));

console.log('PRECIO DE PRUEBA:', price);

const btn = page.locator(sel.createOfferButton).first();
console.log('Boton create offer count:', await btn.count());
await btn.click();
await page.waitForTimeout(3000);

const priceInput = page.locator(sel.offerPriceInput).last();
console.log('Input precio count:', await priceInput.count());
await priceInput.fill(String(price));
console.log('Precio llenado:', await priceInput.inputValue());

const etaLabel = resolveEta('1 day');
const dd = page.locator(sel.offerEtaDropdown).first();
await dd.click();
await page.waitForTimeout(1500);
const opts = page.locator(sel.offerEtaOption);
const count = await opts.count();
console.log('Opciones ETA:', count);
let found = false;
for (let i = 0; i < count; i++) {
  const txt = (await opts.nth(i).innerText().catch(() => '')).trim();
  if (txt === etaLabel) {
    await opts.nth(i).click();
    found = true;
    console.log('ETA seleccionado:', txt);
    break;
  }
}
console.log('ETA encontrado:', found);

await page.waitForTimeout(1500);
const ddValue = (await dd.innerText().catch(() => '')).trim();
console.log('Dropdown ahora muestra:', ddValue.slice(0, 60));

const cancelBtn = page.locator('button[aria-label="Cancel"]').last();
console.log('Boton Cancel count:', await cancelBtn.count());
await cancelBtn.click().catch(() => {});
await page.waitForTimeout(1000);
console.log('Formulario cancelado. OK.');

await browser.close();
