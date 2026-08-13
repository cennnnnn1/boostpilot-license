/* Post content for the BoostPilot Discord server (English).
   Content reflects the real BoostPilot app: two modes (Semi-automatic / Automatic),
   auto-pricing, smart filters, auto-chat + proof image, live dashboard, Discord
   webhook alerts, per-game license keys, free trial and crypto payment via tickets.
   Idempotent: skips channels that already have BoostPilot content.
   Force re-post (clears previous bot messages first) with:  BP_CONTENT_FORCE=1

     node tools/discord-content.mjs
     BP_CONTENT_FORCE=1 node tools/discord-content.mjs
 */
import { readFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, loadAuth } from './discord-store.mjs';
import { GAMES, gameChannelName, PINK } from './discord-structure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMO_DIR = join(ROOT, 'tools', 'promo');

const force = process.env.BP_CONTENT_FORCE === '1';
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const cfg = loadConfig();
const gid = cfg.guildId;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, tries = 6) {
  const res = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    let d = {};
    try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 1) * 1000 + 250;
    if (tries > 0) { console.log(`  (rate limited, waiting ${Math.round(wait)}ms)`); await sleep(wait); return api(method, path, body, tries - 1); }
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${String(data).slice(0, 300)}`);
  err.status = res.status;
  throw err;
}

async function postMultipart(channelId, payload, filePath, tries = 3) {
  const buf = await readFile(filePath);
  const name = basename(filePath);
  const embed = { ...payload.embeds[0], image: { url: `attachment://${name}` } };
  const form = new FormData();
  form.append('files[0]', new Blob([buf]), name);
  form.append('payload_json', JSON.stringify({ embeds: [embed] }));
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bot ' + token },
    body: form,
  });
  if (res.status === 429 && tries > 0) {
    let d = {}; try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 1) * 1000 + 250;
    console.log(`  (rate limited, waiting ${Math.round(wait)}ms)`);
    await sleep(wait);
    return postMultipart(channelId, payload, filePath, tries - 1);
  }
  if (res.status >= 300) throw new Error(`HTTP ${res.status} multipart :: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function embed(title, desc, fields = [], footer = 'BoostPilot') {
  const e = { title, description: desc, color: PINK, timestamp: new Date().toISOString() };
  if (fields.length) e.fields = fields;
  if (footer) e.footer = { text: footer };
  return e;
}

const byName = (chans, name) => chans.find((c) => c.name === name);

async function clearChannel(channelId) {
  if (!force) return;
  const msgs = await api('GET', `/channels/${channelId}/messages?limit=100`);
  const mine = msgs.filter((m) => m.author && m.author.id === cfg.botUserId);
  for (const m of mine) {
    try { await api('DELETE', `/channels/${channelId}/messages/${m.id}`); } catch { /* ignore */ }
    await sleep(150);
  }
  if (mine.length) console.log(`  cleared ${mine.length} BoostPilot message(s)`);
}

async function hasBotContent(channelId) {
  try {
    const msgs = await api('GET', `/channels/${channelId}/messages?limit=20`);
    return Array.isArray(msgs) && msgs.some((m) => m.author && m.author.id === cfg.botUserId);
  } catch { return true; }
}

async function post(channelId, body) {
  await api('POST', `/channels/${channelId}/messages`, body);
  await sleep(250);
}

/* ---------------- content (English) ---------------- */

const WEB_SOON = '🌐 **Web app coming soon** — stay tuned!';
const DISCORD_INVITE = 'https://discord.gg/ys25Jqsj69';
const PLANS = '**3 Days** $6 · **7 Days** $12 · **1 Month** $30';
const GIFT = '🎁 **Promo — 1 Month $30**: all games + **3 extra days free**.';
const TRIAL = '🎁 **Free trial** — try BoostPilot free for a limited time. Ask in a ticket.';

const MODES =
  '✅ **Semi-automatic** *(default)* — BoostPilot prepares every offer (price, delivery time, message) and you approve it in one click in the panel.\n' +
  '🤖 **Automatic** — the offer is sent by itself as soon as a request matches your rules. For safety it returns to Semi-automatic every time the app restarts.';

const FEATURES =
  '· ⚙️ **Auto-pricing** — your price per game and per tier, with multipliers for Duo (+30%), Solo queue (+15%) and Stream (+20%)\n' +
  '· 🧹 **Smart filters** — skip Duo, Squad, console, categories and keywords\n' +
  '· 💬 **Auto-chat** — welcome message + proof image sent to every buyer automatically\n' +
  '· 📊 **Live dashboard** — real-time stats, order history, pending approvals and activity log\n' +
  '· 🔔 **Discord webhook alerts** — new orders, placed/failed offers, replies, follow-ups\n' +
  '· 🖥️ **24/7** on your PC or any Windows VPS';

const GAME_SERVICES = {
  valorant: 'Rank Boost · Placements',
  league: 'Rank Boost · Elo · Duo',
  brawl: 'Trophy Boost · Prestige · Brawlers Rank · Rank Boost',
  fc: 'Division Rivals · FUT Champions',
  clash: 'Path of Legends · Trophy Road',
  rl: 'Rank Boost (MMR)',
  fortnite: 'Rank Boost',
  osrs: 'Power Leveling · Questing',
  r6: 'Rank Boost',
  marvel: 'Rank Boost',
  apex: 'Rank Boost',
  cod: 'Prestige · Weapon (Camo)',
};

const CONTENT = {};

/* announcements */
CONTENT['📢announcements'] = [
  {
    embeds: [
      embed(
        '🚀 Welcome to BoostPilot',
        'BoostPilot is a **Windows desktop app** for **Eldorado.gg sellers** that helps you react to boosting requests in seconds.\n\n' +
        'Connect your own seller account, set your price rules in the local dashboard, and BoostPilot detects new requests as they appear — it prepares each offer with **your pricing** and sends a welcome message with your proof image. You just review and confirm (or let it run full auto). Runs **24/7** on your PC or VPS.\n\n' +
        '**Modes:**\n' + MODES + '\n\n' +
        `🛒 **Get your license**: ${PLANS} — **one key for all games**. ${GIFT}\n` +
        WEB_SOON + '\n' +
        `💬 **Support**: ${DISCORD_INVITE}`,
        [], 'BoostPilot · Welcome'
      ),
      embed(
        '✨ What BoostPilot includes',
        'Everything you need to stop losing offers to faster sellers.\n\n' + FEATURES + '\n\n' +
        '**All games supported**: Valorant · League of Legends · Brawl Stars · EA Sports FC · Clash Royale · Rocket League · Fortnite · OSRS · R6 Siege · Marvel Rivals · Apex Legends · Call of Duty.\n\n' +
        '**One key unlocks all games** — no per-game fees, ever. **Free trial** available.',
        [], 'BoostPilot · Features'
      ),
    ],
  },
];

/* faq */
CONTENT.faq = [
  {
    embeds: [embed(
      '❓ Frequently asked questions',
      'Quick answers before you buy.',
      [
        { name: 'What is BoostPilot?', value: 'A Windows tool for Eldorado.gg sellers. It monitors the seller hub, detects new boosting requests in real time and prepares your offer automatically (price, delivery time, welcome message) so you just review and confirm. Runs 24/7 on PC or VPS.', inline: false },
        { name: 'What are the modes?', value: '**Semi-automatic** *(default)* — BoostPilot prepares each offer (price, delivery time, message) and you approve it in one click in the panel. **Automatic** — the offer is sent by itself as soon as a request matches your rules (it returns to Semi-automatic on restart).', inline: false },
        { name: 'Is it safe?', value: 'It uses **your own logged-in Eldorado seller session** — same account you use manually, no shared sessions and no external servers.', inline: false },
        { name: 'Which games are supported?', value: 'Valorant, League of Legends, Brawl Stars, EA Sports FC, Clash Royale, Rocket League, Fortnite, OSRS, R6 Siege, Marvel Rivals, Apex Legends and Call of Duty.', inline: false },
      ],
      'BoostPilot · FAQ'
    )],
  },
  {
    embeds: [embed(
      '🛒 Plans & payment',
      'One key unlocks **all games**. Free trial available. All purchases handled through tickets.',
      [
        { name: 'Plans', value: PLANS + '\n' + GIFT, inline: false },
        { name: 'How do I buy?', value: `Click **Create Ticket** in <#open>, tell us your plan and payment method, and a staff member will deliver your key in the ticket.`, inline: false },
        { name: 'Payment methods', value: '**USDT (TRC20)** · **Bitcoin (BTC)** · **Litecoin (LTC)** · **Binance Pay** · **PayPal**. Crypto recommended — instant and cannot be reversed.', inline: false },
        { name: 'Key delivery', value: 'One key — `XXXX-XXXX-XXXX-XXXX` — unlocks all games and is delivered in your ticket after payment.', inline: false },
        { name: 'Free trial', value: 'Ask for a **free trial** in a ticket before you commit. One trial per account.', inline: false },
      ],
      'BoostPilot · FAQ'
    )],
  },
  {
    embeds: [embed(
      '🔑 License & activation',
      'How your key works.',
      [
        { name: 'How do I activate?', value: 'Download the BoostPilot launcher, paste your key and connect your Eldorado seller account. No command line, no config files.', inline: false },
        { name: 'How many PCs?', value: 'Your key is **hardware-locked** to one machine. If you upgrade or move to a new VPS, open a ticket and we reset it **for free**.', inline: false },
        { name: 'How many games?', value: '**All games** are included with your key — no extra licenses needed.', inline: false },
        { name: 'How do I renew?', value: 'When it expires, buy another key for the same plan and activate it. No strings attached.', inline: false },
        { name: 'Refunds?', value: 'No refunds once a key has been issued. Start with the 3-day plan to test before committing.', inline: false },
      ],
      'BoostPilot · FAQ'
    )],
  },
  {
    embeds: [embed(
      '🛠️ Configuration & support',
      'Everything is controlled from a clean dashboard.',
      [
        { name: 'Can I customize the pricing?', value: 'Yes, fully. Price per game and per tier, plus multipliers for **Duo (+30%)**, **Solo queue (+15%)** and **Stream (+20%)**.', inline: false },
        { name: 'Can I filter requests?', value: 'Yes. Skip Duo, Squad, console requests, specific categories and keywords. Take only the orders you want.', inline: false },
        { name: 'Does it send messages automatically?', value: 'Yes. A welcome message with your proof image goes to every buyer. Custom messages and delays per event.', inline: false },
        { name: 'Need help?', value: `Join our Discord: ${DISCORD_INVITE}. We help with setup, activation and moving machines.`, inline: false },
      ],
      'BoostPilot · FAQ'
    )],
  },
];

/* how it works */
CONTENT['📖how-it-works'] = [
  {
    embeds: [embed(
      '📖 How BoostPilot works',
      'From purchase to automatic offers in 5 steps.',
      [
        { name: '1️⃣ Get your key', value: `Click **Create Ticket** in <#open>, choose your plan. Free trial available.`, inline: false },
        { name: '2️⃣ Install & log in', value: 'Download the BoostPilot launcher, paste your key and connect your own Eldorado seller account.', inline: false },
        { name: '3️⃣ Set your rules', value: 'In the web dashboard pick games and order types, set price per tier and multipliers, filters, messages and your proof image.', inline: false },
        { name: '4️⃣ Choose your mode', value: '**Semi-automatic** (approve each offer in the panel) or **Automatic** (places it by itself).', inline: false },
        { name: '5️⃣ Let it run 24/7', value: 'BoostPilot detects requests in seconds, prices them with your rules and sends the offer — on your PC or a cheap Windows VPS.', inline: false },
      ],
      'BoostPilot · How it works'
    )],
  },
];

/* reviews */
CONTENT['⭐reviews'] = [
  {
    embeds: [embed(
      '⭐ Reviews / Vouches',
      'Already using BoostPilot? Tell us how it went.',
      [
        { name: 'How to leave a review', value: 'Drop your vouch below, ideally with a screenshot of your orders/sales.', inline: false },
        { name: 'Rules', value: '· 1 review per order · no spam · no external links.', inline: false },
      ],
      'BoostPilot · Reviews'
    )],
  },
];

/* per-game plan channels: embed + promo image with prices */
for (const g of GAMES) {
  const slug = g[0], display = g[1], emoji = g[2];
  CONTENT[gameChannelName(g)] = [
    {
      embeds: [embed(
        `${emoji} ${display} Boosting`,
        `Automated boosting offers for **${display}** with BoostPilot on Eldorado.gg.\n\n` +
        `**Services:** ${GAME_SERVICES[slug] || 'Rank Boost · Placements'}\n\n` +
        '· Automatic pricing with your rules (Duo / Solo / Stream multipliers)\n' +
        '· Smart filters by rank, region, extras and keywords\n' +
        '· Auto-chat + proof image to every buyer\n' +
        '· 24/7 on your PC or VPS\n\n' +
        `One BoostPilot key unlocks **all games** — no per-game fees.\n\n` +
        `${PLANS}\n${GIFT}\n${TRIAL}\n\n` +
        `**Want to buy?** Click **Create Ticket** in <#open>.`,
        [], 'BoostPilot · ' + display
      )],
      image: join(PROMO_DIR, `${slug}.png`),
    },
  ];
}

/* ---------------- run ---------------- */

const chans = await api('GET', `/guilds/${gid}/channels`);

/* rename game channels to the shared emoji + game name (no "plan", no hyphens) */
const OLD_GAME_EMOJIS = { valorant: '🎯', league: '🧙', brawl: '🤜', fc: '⚽', clash: '👑', rl: '🚀', fortnite: '🧱', osrs: '⚔️', r6: '🪖', marvel: '🦸', apex: '🪂', cod: '💀' };
const oldGameNames = ([slug, display]) => [
  OLD_GAME_EMOJIS[slug] + 'plan-' + display.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  '💗plan-' + display.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  'plan-' + display.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
];
for (const g of GAMES) {
  const want = gameChannelName(g);
  const ch = chans.find((c) => oldGameNames(g).includes(c.name));
  if (ch && ch.name !== want) {
    try {
      await api('PATCH', `/channels/${ch.id}`, { name: want });
      ch.name = want;
      console.log(`✔ ${ch.id} → ${want}`);
    } catch (e) { console.log('! could not rename: ' + e.message); }
  }
}

const ticket = byName(chans, 'open-ticket');
const ticketMention = ticket ? `<#${ticket.id}>` : '`#open-ticket`';

const sub = (body) => JSON.parse(JSON.stringify(body).split('<#open>').join(ticketMention));

for (const [name, bodies] of Object.entries(CONTENT)) {
  const ch = byName(chans, name);
  if (!ch) { console.log(`!! channel not found: ${name}`); continue; }
  if (force) { console.log(`~ ${name}: clearing...`); await clearChannel(ch.id); }
  if (!force && await hasBotContent(ch.id)) { console.log(`- ${name}: already has content (skip)`); continue; }
  for (const b of bodies) {
    if (b.image) {
      await postMultipart(ch.id, sub({ embeds: b.embeds }), b.image);
      await sleep(250);
    } else {
      await post(ch.id, sub(b));
    }
  }
  console.log(`✔ ${name}`);
  await sleep(300);
}

/* rename web counter to announce the web app */
const webCounter = chans.find((c) => c.name.startsWith('🌐') && (c.name.includes('BoostPilot') || c.name.includes('boostpilot')));
if (webCounter && webCounter.name !== '🌐｜Web app soon') {
  try {
    await api('PATCH', `/channels/${webCounter.id}`, { name: '🌐｜Web app soon' });
    console.log('✔ web counter → 🌐｜Web app soon');
  } catch (e) { console.log('! could not rename web counter: ' + e.message); }
}

console.log('\n✅ Content posted.');
