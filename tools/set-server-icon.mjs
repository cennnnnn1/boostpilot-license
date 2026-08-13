import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const token = 'MTUzNjU5MDYxNzM5OTAwNTI3NQ.DISCORD_TOKEN_PURGADO'.trim();
const gid = '1536591772807860314';
const out = [];

(async () => {
  const svg = fs.readFileSync(path.resolve('tools/logo-final/panel.svg'), 'utf8')
    .replace('<svg viewBox="0 0 48 48"', '<svg width="1024" height="1024" viewBox="0 0 48 48"')
    .replace(/stdDeviation="2\.2"/g, 'stdDeviation="0.5"')
    .replace(/dy="2\.4"/g, 'dy="0.6"')
    .replace(/stroke="#ff8fa8" stroke-width="1\.2" opacity="\.35"/g, 'stroke="#ff8fa8" stroke-width="1.2" opacity="0.12"');

  const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  await page.setContent(`<canvas id="c"></canvas>`);

  await page.evaluate(async (url) => {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
    const img = await load(url);
    const c = document.getElementById('c');
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, 1024, 1024);
  }, svgUrl);

  const png = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  await browser.close();

  const b64 = png.split(',')[1];
  const size = Math.round((b64.length * 3) / 4);
  out.push('png approx bytes: ' + size);
  fs.writeFileSync('state/server-icon.png', Buffer.from(b64, 'base64'));
  out.push('png saved: ' + fs.statSync('state/server-icon.png').size + ' bytes');

  const res = await fetch('https://discord.com/api/v10/guilds/' + gid, {
    method: 'PATCH',
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ icon: png }),
  });
  const data = await res.json();
  out.push('patch status: ' + res.status);
  out.push('guild icon set: ' + (data.icon ? 'yes (' + data.icon + ')' : 'no ' + JSON.stringify(data)));
  fs.writeFileSync('state/_icon.txt', out.join('\n'));
})().catch((e) => fs.writeFileSync('state/_icon.txt', 'ERR: ' + (e && e.message ? e.message : e)));
