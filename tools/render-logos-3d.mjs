import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.LOGO_OUT || join('C:\\Users\\cenn\\Desktop', 'BoostPilot_logos', 'ideas_locas_3d');

const svgs = {};
for (let i = 1; i <= 8; i++) {
  svgs[String(i)] = fs.readFileSync(join(__dirname, 'logo3d', `${i}.svg`), 'utf8');
}

const preview = 'file:///' + join(__dirname, 'logo-preview-3.html').replace(/\\/g, '/');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });

await page.addInitScript((data) => { window.__SVGS__ = Promise.resolve(data); }, svgs);
await page.goto(preview);
await page.waitForTimeout(500);

await page.screenshot({ path: join(outDir, '0_todas_las_ideas.png'), fullPage: true });

const cards = page.locator('.card');
const count = await cards.count();
for (let i = 0; i < count; i++) {
  await cards.nth(i).screenshot({ path: join(outDir, `${i + 1}.png`) });
}

await browser.close();
console.log('OK ' + count + ' cards');
