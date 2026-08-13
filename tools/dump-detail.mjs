import { chromium } from 'playwright';
import fs from 'fs/promises';

const root = process.cwd();
const auth = JSON.parse(await fs.readFile(root + '/state/auth.json', 'utf8'));

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
await page.context().addCookies(auth.cookies);
const url = process.argv[2] || 'https://www.eldorado.gg/boosting-request/a340fff1-f402-41a4-73a2-08def1f6e7ba';
const outFile = root + '/state/request_detail.html';
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const html = await page.content();
await fs.writeFile(outFile, html);
console.log('Titulo:', await page.title());
console.log('URL:', page.url());
console.log('Bytes:', html.length);
await browser.close();
