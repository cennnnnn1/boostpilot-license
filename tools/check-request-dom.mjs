import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, mkdtempSync } from 'fs';
import os from 'os';
import fs from 'fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = join(root, 'state');
mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, 'auth.json');
const dashboard = JSON.parse(await fs.readFile(join(stateDir, 'dashboard.json'), 'utf8'));

const sorted = [...dashboard].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
const target = sorted.find((r) => r.href && r.price != null) || sorted.find((r) => r.href);
console.log('Probando request:', target.game, target.category, '$' + target.price);
console.log('URL:', target.href);

const tmpProfile = mkdtempSync(join(os.tmpdir(), 'eld-check-'));
const browser = await chromium.launchPersistentContext(tmpProfile, {
  headless: true,
  channel: 'chrome',
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});
const page = browser.pages()[0] || await browser.newPage();
try {
  const auth = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  await page.context().addCookies(auth.cookies);
} catch (e) {
  console.error('Sin sesion:', e.message);
  await browser.close();
  process.exit(1);
}

await page.goto(target.href, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const info = await page.evaluate((sel) => {
  const btn = document.querySelector(sel.createOfferButton);
  const title = document.querySelector('.seller-title-date .text-lg.font-bold');
  const loggedIn = !!(document.querySelector('[data-testid^="user-menu"]') || document.querySelector('.profile__username'));
  return { url: location.href, title: title ? title.innerText : null, btn: !!btn, btnTestid: btn ? btn.getAttribute('data-testid') : null, loggedIn };
}, {
  createOfferButton: "[data-testid^='create-boosting-offer-button']",
});
console.log('Antes de pulsar:', JSON.stringify(info));

if (info.btn) {
  await page.locator("[data-testid^='create-boosting-offer-button']").first().click();
  await page.waitForTimeout(4000);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('eld-place-boosting-offer-modal');
    if (!m) return { hasModal: false };
    const inputs = [...m.querySelectorAll('input')].map((i) => ({ label: i.getAttribute('aria-label'), type: i.type, inputmode: i.inputmode, maxlength: i.getAttribute('maxlength'), cls: i.className }));
    const selects = [...m.querySelectorAll('[aria-label="Single-select dropdown"]')].map(() => true);
    return { hasModal: true, inputs, selects };
  });
  console.log('Modal:', JSON.stringify(modal, null, 2));
  const html = await page.content();
  const name = 'offer_' + Date.now();
  await fs.writeFile(join(stateDir, name + '.html'), html);
  console.log('Dump modal:', name + '.html', html.length, 'bytes');
} else {
  const html = await page.content();
  const name = 'check_' + Date.now();
  await fs.writeFile(join(stateDir, name + '.html'), html);
  console.log('Dump pagina:', name + '.html', html.length, 'bytes');
}
await browser.close();
