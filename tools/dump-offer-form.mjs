import { chromium } from 'playwright';
import fs from 'fs/promises';

const root = process.cwd();
const auth = JSON.parse(await fs.readFile(root + '/state/auth.json', 'utf8'));
const url = process.argv[2] || 'https://www.eldorado.gg/boosting-request/8d02aa3e-e608-48af-fe89-08def1f6e434';

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
await page.waitForTimeout(3500);

await page.locator('[data-testid^="create-boosting-offer-button"]').first().click();
await page.waitForTimeout(2500);

const dd = page.locator('[aria-label="Single-select dropdown"]').first();
console.log('Dropdown count:', await dd.count());
if (await dd.count()) {
  await dd.click();
  await page.waitForTimeout(1500);
  const options = await page.locator('[role="option"], .dropdown-menu [role="option"], .dropdown-option').allInnerTexts();
  console.log('OPCIONES DEL DROPDOWN:');
  console.log(JSON.stringify(options, null, 2));
}

const html = await page.content();
await fs.writeFile(root + '/state/offer_form.html', html);
await browser.close();
