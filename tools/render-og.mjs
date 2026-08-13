/* Render OG image (1200x630) for the landing. Run: node tools/render-og.mjs */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px}
  body{
    font-family:'Segoe UI',system-ui,sans-serif;color:#eef1fb;overflow:hidden;
    background:
      radial-gradient(900px 520px at 88% -10%, rgba(232,67,126,.22), transparent 60%),
      radial-gradient(820px 520px at -10% 8%, rgba(168,85,247,.16), transparent 55%),
      radial-gradient(900px 600px at 50% 120%, rgba(255,106,138,.12), transparent 60%),
      linear-gradient(180deg,#0a0d1a 0%,#07080f 100%);
    display:flex;align-items:center;padding:0 70px;
  }
  .logo{width:92px;height:92px;filter:drop-shadow(0 8px 26px rgba(255,106,138,.5))}
  .brand{display:flex;align-items:center;gap:22px}
  h1{font-size:74px;font-weight:900;letter-spacing:-.03em;margin:26px 0 14px}
  h1 em{font-style:normal;
    background:linear-gradient(135deg,#ff9dc0 0%,#ff6a8a 45%,#e8437e 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .tag{font-size:26px;color:#8b93ad;font-weight:600}
  .pills{position:absolute;right:70px;bottom:52px;display:flex;gap:14px}
  .pill{border:1px solid #2b3350;border-radius:999px;padding:12px 22px;font-size:17px;font-weight:800;background:rgba(17,21,39,.7)}
  .pill span{color:#8b93ad;font-weight:600;font-size:13px}
  .dot{position:absolute;top:48px;left:70px;display:flex;align-items:center;gap:10px;font-size:16px;font-weight:700;color:#ff9dc0;
    border:1px solid rgba(255,106,138,.35);background:rgba(255,106,138,.08);border-radius:999px;padding:10px 18px}
  .dot i{width:9px;height:9px;border-radius:50%;background:#ff6a8a;box-shadow:0 0 14px #ff6a8a}
</style></head><body>
  <span class="dot"><i></i>WEB APP &middot; SOON</span>
  <div>
    <div class="brand">
      <svg class="logo" viewBox="0 0 48 48"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9dc0"/><stop offset=".5" stop-color="#ff6a8a"/><stop offset="1" stop-color="#e8437e"/></linearGradient></defs><rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="#0d1018" stroke="#2a1a26" stroke-width="1"/><path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="url(#lg)"/><path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="#fff" opacity=".35"/><path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="none" stroke="#ffd3e2" stroke-width="1.1" opacity=".45"/></svg>
      <div style="font-size:40px;font-weight:900;letter-spacing:-.01em">Boost<em style="font-style:normal;background:linear-gradient(135deg,#ff9dc0,#ff6a8a 45%,#e8437e);-webkit-background-clip:text;background-clip:text;color:transparent">Pilot</em></div>
    </div>
    <h1>Never miss a <em>boosting order</em> again.</h1>
    <p class="tag">Auto-pricing &bull; Smart filters &bull; Auto-messages &bull; 24/7</p>
  </div>
  <div class="pills">
    <div class="pill">$6 <span>3 DAYS</span></div>
    <div class="pill">$12 <span>7 DAYS</span></div>
    <div class="pill">$30 <span>1 MONTH</span></div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(HTML);
await page.waitForTimeout(300);
const buf = await page.screenshot({ type: 'png', omitBackground: true });
await browser.close();
writeFileSync(join(ROOT, 'src', 'og.png'), buf);
console.log('og.png escrito:', buf.length, 'bytes');
