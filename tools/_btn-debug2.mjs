/* Debug: detect white artifact on the right edge of gradient buttons by
   rendering each button to a canvas (SVG foreignObject) and sampling pixels. */
import { chromium } from 'playwright';

const CSS = `
  :root{--grad:linear-gradient(135deg,#ff9dc0 0%,#ff6a8a 45%,#e8437e 100%)}
  body{background:#0b0e1a;padding:40px}
  .btn{
    display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:10px 18px;
    font-size:14px;font-weight:700;cursor:pointer;border:1px solid transparent;font-family:inherit;
    color:#1a0710;
  }
  .btn-grad{background:var(--grad);box-shadow:0 6px 24px rgba(255,106,138,.30)}
  .btn-noborder{background:var(--grad);box-shadow:0 6px 24px rgba(255,106,138,.30);border:none}
  .btn-solid{background:var(--grad);box-shadow:0 6px 24px rgba(255,106,138,.30);border:1px solid #ff6a8a}
`;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <button id="a" class="btn btn-grad">Get BoostPilot</button>
  <button id="b" class="btn btn-noborder">Get BoostPilot</button>
  <button id="c" class="btn btn-solid">Get BoostPilot</button>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 300 } });
await page.setContent(HTML);
await page.waitForTimeout(300);

const results = await page.evaluate(async () => {
  async function sample(sel) {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const scale = 3;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}"><foreignObject width="100%" height="100%">${el.outerHTML.replace(/class="/g, 'style="margin:0" class="')}</foreignObject></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = r.width * scale; c.height = r.height * scale;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const w = c.width, h = c.height;
    function px(x, y) {
      const i = (y * w + x) * 4;
      return [data[i], data[i+1], data[i+2], data[i+3]];
    }
    let whitePixels = 0, total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r2,g2,b2,a2] = px(x, y);
        if (a2 === 0) continue;
        total++;
        if (r2 > 240 && g2 > 240 && b2 > 240) whitePixels++;
      }
    }
    return { whitePixels, total, rightEdge: px(w-2, Math.floor(h/2)), bottomRight: px(w-4, h-4) };
  }
  return { a: await sample('#a'), b: await sample('#b'), c: await sample('#c') };
});

console.log('A (border transparent):', JSON.stringify(results.a));
console.log('B (no border):         ', JSON.stringify(results.b));
console.log('C (solid border):      ', JSON.stringify(results.c));
await browser.close();
