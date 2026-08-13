/* Render promo images for each Discord game channel + bot avatar.
   Brand colors come from the BoostPilot web (landing.html):
   bg #07080f/#0a0d1a, panel #111527, line #20263c, text #eef1fb,
   pink gradient #ff9dc0 -> #ff6a8a -> #e8437e.
   Run: node tools/render-promos.mjs
   Outputs PNGs into tools/promo/*.png (1024x1024) and tools/promo/bot-avatar.png (512x512). */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'promo');
mkdirSync(OUT, { recursive: true });

const WEBTAG = 'WEB APP · SOON';

const LOGO = `<svg viewBox="0 0 48 48" width="46" height="46">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9dc0"/><stop offset=".5" stop-color="#ff6a8a"/><stop offset="1" stop-color="#e8437e"/>
    </linearGradient>
  </defs>
  <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill="#0d1018" stroke="#2a1a26" stroke-width="1"/>
  <path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="url(#lg)"/>
  <path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="#fff" opacity=".35"/>
  <path d="M24 9l13.5 15.5h-8V39h-11V24.5h-8L24 9z" fill="none" stroke="#ffd3e2" stroke-width="1.1" opacity=".45"/>
</svg>`;

const GAMES = [
  { key: 'valorant', name: 'VALORANT',         tag: 'Rank Boost · Placements', c1: '#ff4655', c2: '#1f232b' },
  { key: 'league',   name: 'LEAGUE OF LEGENDS', tag: 'Rank Boost · Elo · Duo', c1: '#c8aa6e', c2: '#0a1428' },
  { key: 'brawl',    name: 'BRAWL STARS',       tag: 'Trophy Boost · Prestige · Ranked', c1: '#f9e02e', c2: '#00b7f1' },
  { key: 'fc',       name: 'EA SPORTS FC',      tag: 'Division Rivals · Champions', c1: '#1b6fc9', c2: '#062b45' },
  { key: 'clash',    name: 'CLASH ROYALE',      tag: 'Path of Legends · Trophy Road', c1: '#3f7bd6', c2: '#1c2b55' },
  { key: 'rl',       name: 'ROCKET LEAGUE',     tag: 'Rank Boost (MMR)', c1: '#f04a1e', c2: '#0b2b66' },
  { key: 'fortnite', name: 'FORTNITE',          tag: 'Rank Boost', c1: '#9d4dff', c2: '#12315c' },
  { key: 'osrs',     name: 'OSRS',              tag: 'Power Leveling · Questing', c1: '#7dbd4a', c2: '#2f1e0e' },
  { key: 'r6',       name: 'R6 SIEGE',          tag: 'Rank Boost', c1: '#f6c13f', c2: '#14171f' },
  { key: 'marvel',   name: 'MARVEL RIVALS',     tag: 'Rank Boost', c1: '#e23636', c2: '#0f2a66' },
  { key: 'apex',     name: 'APEX LEGENDS',      tag: 'Rank Boost', c1: '#da3b2f', c2: '#1b1f2a' },
  { key: 'cod',      name: 'CALL OF DUTY',      tag: 'Prestige · Weapon', c1: '#37a04e', c2: '#101314' },
];

const PLANS = [
  { label: '3 DAYS', price: '$6', hot: false },
  { label: '7 DAYS', price: '$12', hot: true },
  { label: '1 MONTH', price: '$30', hot: false },
];

function card(g) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:1024px;height:1024px}
    body{
      font-family:'Segoe UI',system-ui,sans-serif;color:#eef1fb;overflow:hidden;
      background:
        radial-gradient(900px 520px at 85% -10%, ${g.c1}38, transparent 60%),
        radial-gradient(820px 520px at -10% 8%, ${g.c2}66, transparent 55%),
        radial-gradient(900px 600px at 50% 120%, ${g.c1}26, transparent 60%),
        linear-gradient(180deg,#0a0d1a 0%,#07080f 100%);
      position:relative;
    }
    .dots{position:absolute;inset:0;pointer-events:none;opacity:.5;
      background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px);background-size:28px 28px;
      -webkit-mask-image:radial-gradient(85% 70% at 50% 0%,#000,transparent 78%);mask-image:radial-gradient(85% 70% at 50% 0%,#000,transparent 78%)}
    .glow{position:absolute;left:50%;top:-90px;transform:translateX(-50%);width:680px;height:300px;pointer-events:none;
      background:radial-gradient(50% 60% at 50% 50%, ${g.c1}59, transparent 70%);filter:blur(10px)}
    .wrap{position:relative;height:100%;padding:56px 70px;display:flex;flex-direction:column}
    .brand{display:flex;align-items:center;gap:14px;justify-content:space-between}
    .brand .word{font-size:34px;font-weight:800;letter-spacing:.5px}
    .brand .word em{font-style:normal;background:linear-gradient(135deg,#ff9dc0,#ff6a8a,#e8437e);-webkit-background-clip:text;background-clip:text;color:transparent}
    .brand .url{font-size:17px;font-weight:700;color:#8b93ad;letter-spacing:.4px}
    .brand .url span{color:#5d6580;font-weight:600}
    .mid{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;margin-top:20px}
    .game{font-size:74px;font-weight:900;letter-spacing:-.02em;line-height:1.02;max-width:100%;
      background:linear-gradient(180deg,#ffffff 20%, ${g.c1} 160%);-webkit-background-clip:text;background-clip:text;color:transparent;
      text-shadow:0 0 60px ${g.c1}44}
    .tag{font-size:22px;color:#8b93ad;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-top:18px}
    .line{width:96px;height:4px;border-radius:4px;background:linear-gradient(90deg,${g.c1},transparent);margin:22px 0 0}
    .plans{display:flex;gap:22px;justify-content:center;margin-top:46px}
    .plan{width:226px;padding:26px 14px;border-radius:20px;text-align:center;position:relative;
      background:linear-gradient(180deg,rgba(17,21,39,.85),rgba(17,21,39,.5));border:1px solid #2b3350}
    .plan.hot{border-color:${g.c1};box-shadow:0 0 0 1px ${g.c1} inset,0 20px 48px -18px ${g.c1}59}
    .plan .pl{font-size:14px;font-weight:800;letter-spacing:.14em;color:#8b93ad;text-transform:uppercase}
    .plan .pr{font-size:44px;font-weight:900;margin:10px 0 2px;color:#ffffff}
    .plan .pd{font-size:13px;color:#5d6580}
    .plan .bd{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;letter-spacing:.1em;
      background:linear-gradient(135deg,#ff9dc0,#e8437e);color:#1a0710;border-radius:999px;padding:4px 12px}
    .foot{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
    .url{font-size:26px;font-weight:800;letter-spacing:.5px;color:#ffffff}
    .url span{color:#8b93ad;font-weight:600}
    .cta{font-size:16px;font-weight:800;color:#1a0710;background:linear-gradient(135deg,#ff9dc0,#ff6a8a,#e8437e);
      padding:14px 26px;border-radius:14px;box-shadow:0 10px 30px ${g.c1}59}
    .mini{margin-top:18px;text-align:center;color:#5d6580;font-size:14px;letter-spacing:.3em;text-transform:uppercase}
  </style></head><body>
    <div class="dots"></div><div class="glow"></div>
    <div class="wrap">
      <div class="brand"><div style="display:flex;align-items:center;gap:14px">${LOGO}<div class="word">Boost<em>Pilot</em></div></div><div class="url">DESKTOP APP</div></div>
      <div class="mid">
        <div class="game">${g.name}</div>
        <div class="tag">${g.tag}</div>
        <div class="line"></div>
        <div class="plans">
          ${PLANS.map((p) => `<div class="plan${p.hot ? ' hot' : ''}">${p.hot ? '<div class="bd">POPULAR</div>' : ''}<div class="pl">${p.label}</div><div class="pr">${p.price}</div><div class="pd">all games</div></div>`).join('')}
        </div>
      </div>
      <div class="foot">
        <div class="url">${WEBTAG}</div>
        <div class="cta">GET BOOSTPILOT</div>
      </div>
      <div class="mini">One key · All games · Free trial</div>
    </div>
  </body></html>`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const g of GAMES) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    await page.setContent(card(g), { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(OUT, `${g.key}.png`), type: 'png' });
    await page.close();
    console.log(`rendered ${g.key}.png`);
  }
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const avatar = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}html,body{width:512px;height:512px;background:#0d1018;display:flex;align-items:center;justify-content:center}
    .box{background:radial-gradient(120% 120% at 50% 0%,#191f2b,#090c12);border-radius:30px;padding:24px;
      box-shadow:0 0 80px #ff6a8a33}
    .rocket{width:200px;height:200px}
  </style></head><body><div class="box">
    <svg class="rocket" viewBox="0 0 48 48">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff9dc0"/><stop offset=".5" stop-color="#ff6a8a"/><stop offset="1" stop-color="#e8437e"/>
      </linearGradient></defs>
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#0d1018" stroke="#2a1a26" stroke-width="1"/>
      <path d="M24 8l14 16h-8v16H18V24h-8l14-16z" fill="url(#lg)"/>
      <path d="M24 8l14 16h-8v16H18V24h-8l14-16z" fill="#fff" opacity=".4"/>
      <path d="M24 8l14 16h-8v16H18V24h-8l14-16z" fill="none" stroke="#ffd3e2" stroke-width="1.1" opacity=".45"/>
    </svg>
  </div></body></html>`;
  await page.setContent(avatar, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(OUT, 'bot-avatar.png'), type: 'png' });
  await page.close();
  await browser.close();
  console.log('avatar done');
}

main().catch((e) => { console.error(e); process.exit(1); });
