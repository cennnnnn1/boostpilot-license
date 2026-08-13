/* Debug: reproduce white artifact on gradient buttons. */
import { chromium } from 'playwright';

const CSS = `
  :root{--grad:linear-gradient(135deg,#ff9dc0 0%,#ff6a8a 45%,#e8437e 100%)}
  body{background:#0b0e1a;padding:40px;display:flex;gap:30px;align-items:flex-start}
  .btn{
    display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:10px 18px;
    font-size:14px;font-weight:700;cursor:pointer;border:1px solid transparent;font-family:inherit;
  }
  .btn-grad{background:var(--grad);color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30)}
  .btn-grad2{background:var(--grad);color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30);background-clip:border-box}
  .btn-noborder{background:var(--grad);color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30);border:none}
  .btn-fix{background:var(--grad);color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30);border:1px solid rgba(255,106,138,.0)}
  .btn-solidborder{background:var(--grad);color:#1a0710;box-shadow:0 6px 24px rgba(255,106,138,.30);border:1px solid #ff6a8a}
  .lbl{color:#8b93ad;font:600 13px sans-serif;margin-bottom:8px}
  .col{display:flex;flex-direction:column;gap:6px}
`;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="col"><div class="lbl">A: border transparent (current)</div><button class="btn btn-grad">Get BoostPilot</button></div>
  <div class="col"><div class="lbl">B: + background-clip border-box</div><button class="btn btn-grad2">Get BoostPilot</button></div>
  <div class="col"><div class="lbl">C: no border</div><button class="btn btn-noborder">Get BoostPilot</button></div>
  <div class="col"><div class="lbl">D: border rgba .0</div><button class="btn btn-fix">Get BoostPilot</button></div>
  <div class="col"><div class="lbl">E: solid border pink</div><button class="btn btn-solidborder">Get BoostPilot</button></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 300 }, deviceScaleFactor: 2 });
await page.setContent(HTML);
await page.waitForTimeout(400);
await page.screenshot({ path: 'C:/Users/cenn/AppData/Local/Temp/opencode/btn-debug.png' });
await browser.close();
console.log('screenshot ok');
