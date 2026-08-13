import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.LOGO_OUT || join('C:\\Users\\cenn\\Desktop', 'BoostPilot_logos', 'final');

const svgs = {};
svgs.opencode = fs.readFileSync(join(__dirname, 'logo-final', 'opencode.svg'), 'utf8');
svgs.panel = fs.readFileSync(join(__dirname, 'logo-final', 'panel.svg'), 'utf8');

const preview = 'file:///' + join(__dirname, 'logo-preview-final.html').replace(/\\/g, '/');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });

await page.addInitScript((data) => { window.__SVGS__ = Promise.resolve(data); }, svgs);
await page.goto(preview);
await page.waitForTimeout(500);

const cards = page.locator('.card');
await page.screenshot({ path: join(outDir, '0_comparativa.png'), fullPage: true });

for (let i = 0; i < 2; i++) {
  await cards.nth(i).screenshot({ path: join(outDir, `${i + 1}.png`) });
  await cards.nth(i).locator('.tile.large').screenshot({ path: join(outDir, `grande_${i + 1}.png`) });
  await cards.nth(i).locator('.tile.med').screenshot({ path: join(outDir, `icon_${i + 1}.png`) });
}

await browser.close();
console.log('OK');
