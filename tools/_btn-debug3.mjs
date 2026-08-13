/* Render 3 gradient button variants, screenshot, decode PNG, scan each button
   box for near-white pixels (the reported white artifact). */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import zlib from 'zlib';

const CSS = `
  :root{--grad:linear-gradient(135deg,#ff9dc0 0%,#ff6a8a 45%,#e8437e 100%)}
  body{background:#0b0e1a;padding:30px;display:flex;flex-direction:column;gap:20px;align-items:flex-start}
  .btn{
    display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:10px 18px;
    font-size:14px;font-weight:700;cursor:pointer;border:1px solid transparent;font-family:inherit;
    color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30);
  }
  .btn-grad{background:var(--grad)}
  .btn-noborder{background:var(--grad);border:none}
  .btn-solid{background:var(--grad);border:1px solid #ff6a8a}
  .lbl{color:#8b93ad;font:600 12px sans-serif}
`;
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="lbl">A: border:1px solid transparent (ACTUAL)</div>
  <button id="a" class="btn btn-grad">Get BoostPilot</button>
  <div class="lbl">B: border:none</div>
  <button id="b" class="btn btn-noborder">Get BoostPilot</button>
  <div class="lbl">C: border:1px solid #ff6a8a</div>
  <button id="c" class="btn btn-solid">Get BoostPilot</button>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 500, height: 420 } });
await page.setContent(HTML);
await page.waitForTimeout(300);
const boxes = {};
for (const id of ['a', 'b', 'c']) {
  const r = await page.locator('#' + id).boundingBox();
  boxes[id] = r;
}
await page.screenshot({ path: 'C:/Users/cenn/AppData/Local/Temp/opencode/btn-debug2.png' });
await browser.close();

/* ---- minimal PNG decode ---- */
const buf = readFileSync('C:/Users/cenn/AppData/Local/Temp/opencode/btn-debug2.png');
let off = 8, w = 0, h = 0, ctype = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ctype = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = ctype === 6 ? 4 : 3;
const stride = w * bpp;
const out = Buffer.alloc(h * stride);
let p = 0;
for (let y = 0; y < h; y++) {
  const f = raw[p++];
  const line = out.subarray(y * stride, (y + 1) * stride);
  const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? line[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = (x >= bpp && prev) ? prev[x - bpp] : 0;
    let v = raw[p++];
    if (f === 1) v = (v + a) & 255;
    else if (f === 2) v = (v + b) & 255;
    else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (f === 4) {
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      v = (v + pr) & 255;
    }
    line[x] = v;
  }
}
function px(x, y) {
  const i = (y * stride) + x * bpp;
  return [out[i], out[i + 1], out[i + 2]];
}
function scan(box) {
  const x0 = Math.round(box.x), y0 = Math.round(box.y);
  const x1 = Math.round(box.x + box.width), y1 = Math.round(box.y + box.height);
  let white = 0, total = 0, maxWhiteRun = 0, run = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = px(x, y);
      if (r > 240 && g > 240 && b > 240) { white++; run++; maxWhiteRun = Math.max(maxWhiteRun, run); }
      else run = 0;
      total++;
    }
  }
  const mid = Math.floor((y0 + y1) / 2);
  const rightEdge = px(x1 - 1, mid);
  const bottomRight = px(x1 - 2, y1 - 2);
  return { white, total, pct: ((white / total) * 100).toFixed(2) + '%', maxWhiteRun, rightEdge, bottomRight };
}
for (const id of ['a', 'b', 'c']) {
  console.log(id, 'box=', JSON.stringify(boxes[id]), '=>', JSON.stringify(scan(boxes[id])));
}
