import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const preview = 'file:///' + join(__dirname, 'logo-preview-2.html').replace(/\\/g, '/');
const outDir = process.env.LOGO_OUT || join('C:\\Users\\cenn\\Desktop', 'BoostPilot_logos');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });

await page.goto(preview);
await page.waitForTimeout(300);

await page.screenshot({ path: join(outDir, '0_todas_las_ideas.png'), fullPage: true });

const cards = page.locator('.card');
const count = await cards.count();
for (let i = 0; i < count; i++) {
  await cards.nth(i).screenshot({ path: join(outDir, `${i + 1}.png`) });
}

await browser.close();
console.log('OK');
