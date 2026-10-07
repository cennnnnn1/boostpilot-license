/* Persistent utility bot for the BoostPilot Discord server.
   Zero-dependency gateway client (Node >= 22). Run after tools/discord-setup.mjs:

     node tools/discord-ticket-bot.mjs     (o: npm run discord:bot)

   Handles:
     - 👥 members / ⬆️ clients channel counters
     - auto-assigns the Member role to new joiners
     - 🛒 Buy BoostPilot tickets (plan → payment USDT TRC20 → TXID → verify on
       TronGrid → staff confirms → key generated + delivered)
     - 🎧 Help & Support tickets (staff helps the client, manual)
   Payments are verified on-chain (TronGrid, free) but the key is only delivered
   after a staff member clicks Confirm (human validation).
*/
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, loadAuth, saveConfig } from './discord-store.mjs';
import { ticketOverwrites, STAFF_ALLOW, PINK } from './discord-structure.mjs';
import { generateKeys } from '../src/keys.mjs';
import { createLicenseChecker } from '../src/license.js';
import { verifyUsdtPayment, tronscanUrl } from './tron-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token) {
  for (let t = 0; t < 5; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) {
      let d = {};
      try { d = await res.json(); } catch { /* ignore */ }
      await sleep((Number(d.retry_after) || 1) * 1000 + 200);
      continue;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 200 && res.status < 300) return data;
    const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
}

/* ---------------- config ---------------- */

let cfg = null;
let token = null;
let botUserId = null;
let salesPlans = [];
let wallet = '';
let license = null;
let ticketCatId = null;

function loadSalesConfig() {
  try {
    const rules = JSON.parse(readFileSync(join(ROOT, 'config', 'rules.json'), 'utf8'));
    const store = rules.store || {};
    const plans = store.plans || {};
    const methods = (store.payment && store.payment.methods) || [];
    const cripto = methods.find((m) => m.type === 'cripto') || methods[0] || {};
    wallet = String(cripto.value || '').trim();
    salesPlans = Object.entries(plans).map(([id, p]) => ({
      id,
      label: p.label || id,
      days: Number(p.days) || 0,
      price: Number(p.price) || 0,
    })).filter((p) => p.days > 0 && p.price > 0);
  } catch (e) {
    console.error('[sales] no se pudo leer config/rules.json:', e.message);
  }
}

function isStaff(member) {
  const roles = (member && member.roles) || [];
  const staff = ['Owner', 'Admin', 'Mod'].map((k) => cfg.roleIds && cfg.roleIds[k]).filter(Boolean);
  return roles.some((r) => staff.includes(r));
}

/* ---------------- ticket / sales state ---------------- */

const sales = new Map(); // channelId -> { kind, clientId, username, plan, price, status, txid, verified, key, logged }

function findOpenTicket(userId) {
  for (const s of sales.values()) if (s.clientId === userId && s.status !== 'closed') return s;
  return null;
}

/* ---------------- helpers ---------------- */

function buildTicketOverwrites(userId) {
  const rows = ticketOverwrites(cfg.roleIds, userId, cfg.guildId);
  for (const key of ['Owner', 'BoostPilot']) {
    if (cfg.roleIds[key]) rows.push({ id: cfg.roleIds[key], type: 0, allow: STAFF_ALLOW, deny: '0' });
  }
  return rows;
}

const TXID_RE = /[0-9a-fA-F]{64}/g;

async function findTxidInChannel(channelId) {
  const msgs = await api('GET', `/channels/${channelId}/messages?limit=30`, undefined, token);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i].content || '';
    const m = c.match(TXID_RE);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

function embed(fields) {
  const e = { color: PINK, footer: { text: 'BoostPilot' } };
  if (fields.title) e.title = fields.title;
  if (fields.description) e.description = fields.description;
  if (fields.fields) e.fields = fields.fields;
  if (fields.color) e.color = fields.color;
  if (fields.footerText) e.footer.text = fields.footerText;
  return e;
}

function btn(customId, label, style = 2) {
  return { type: 2, custom_id: customId, label, style };
}

function closeBtn() {
  return { type: 1, components: [btn('ticket_close', '🔒 Close ticket', 4)] };
}

async function sendMessage(channelId, payload) {
  if (typeof payload === 'string') payload = { content: payload };
  return api('POST', `/channels/${channelId}/messages`, payload, token);
}

async function editMessage(channelId, messageId, payload) {
  return api('PATCH', `/channels/${channelId}/messages/${messageId}`, payload, token);
}

async function replyInteraction(it, content, { ephemeral = false } = {}) {
  try {
    await api('POST', `/interactions/${it.id}/${it.token}/callback`, {
      type: 4,
      data: { content, flags: ephemeral ? (1 << 6) : 0 },
    }, token);
  } catch (e) {
    console.error('[interaction] no se pudo responder (timeout en Discord):', e.message);
  }
}

async function logTicket(st, extra = {}) {
  try {
    const ch = cfg.ids['ticket-logs'];
    if (!ch) return;
    const fields = [
      { name: 'Client', value: `<@${st.clientId}> (${st.username})`, inline: true },
      { name: 'Plan', value: st.plan ? `${st.plan.label} — $${st.plan.price}` : '—', inline: true },
    ];
    if (st.txid) fields.push({ name: 'TXID', value: `\`${st.txid}\``, inline: false });
    if (st.verified) fields.push(
      { name: 'Received', value: st.verified.receivedUsdt.toFixed(6) + ' USDT', inline: true },
      { name: 'From', value: st.verified.from || 'n/a', inline: true },
    );
    if (st.key) fields.push({ name: 'Key', value: `\`${st.key}\``, inline: false });
    for (const [k, v] of Object.entries(extra)) fields.push({ name: k, value: v, inline: true });
    await sendMessage(ch, { embeds: [embed({ title: '🧾 Ticket closed', color: 0xe0315c, fields, footerText: 'BoostPilot · ticket-logs' })] });
    st.logged = true;
  } catch (e) {
    console.log('[sales] aviso de ticket-logs:', e.message);
  }
}

/* ---------------- ticket flows ---------------- */

async function createTicketChannel(it, kind) {
  const user = it.member.user;
  const username = String(user.username || 'user').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20) || 'user';
  const prefix = kind === 'buy' ? '🛒' : '🎧';
  return api('POST', `/guilds/${cfg.guildId}/channels`, {
    name: `${prefix}-${username}`,
    type: 0,
    parent_id: ticketCatId,
    permission_overwrites: buildTicketOverwrites(user.id),
    topic: kind === 'buy' ? 'Purchase' : 'Support',
  }, token);
}

function staffPing() {
  const ids = ['Owner', 'Admin', 'Mod'].map((k) => cfg.roleIds && cfg.roleIds[k]).filter(Boolean);
  return ids.map((id) => `<@&${id}>`).join(' ');
}

async function openSalesTicket(it, chan) {
  const uid = it.member.user.id;
  const planRow = { type: 1, components: salesPlans.map((p) => btn('plan:' + p.id, `${p.label} — $${p.price}`)) };
  await sendMessage(chan.id, {
    embeds: [embed({
      title: '🛒 Buy BoostPilot',
      description: `Welcome <@${uid}>! Pick a plan.\nPayment: **USDT (TRC20)** only. Staff: ${staffPing()}`,
    })],
    components: [planRow, closeBtn()],
  });
  console.log(`[sales] ticket de compra abierto: #${chan.name} (${it.member.user.username})`);
}

async function openSupportTicket(it, chan) {
  const uid = it.member.user.id;
  await sendMessage(chan.id, {
    embeds: [embed({
      title: '🎧 Support ticket',
      description: `Hi <@${uid}>! Describe your issue and a staff member will help you as soon as possible. Staff: ${staffPing()}`,
    })],
    components: [closeBtn()],
  });
  console.log(`[sales] ticket de soporte abierto: #${chan.name} (${it.member.user.username})`);
}

async function handlePlan(it, plan) {
  const st = sales.get(it.channel_id);
  if (!st || st.kind !== 'buy') { await replyInteraction(it, 'This ticket is not a purchase ticket.', { ephemeral: true }); return; }
  if (st.status !== 'selecting') { await replyInteraction(it, 'You already picked a plan.', { ephemeral: true }); return; }
  st.plan = plan;
  st.price = plan.price;
  st.status = 'awaiting_payment';
  await replyInteraction(it, `✓ Plan selected: **${plan.label} — $${plan.price}**`);
  if (it.message && it.message.id) {
    await editMessage(it.channel_id, it.message.id, {
      embeds: [embed({ title: '🛒 Buy BoostPilot', description: `Welcome <@${st.clientId}>!\n**Selected plan:** ${plan.label} — **$${plan.price}**` })],
      components: [closeBtn()],
    }).catch(() => {});
  }
  await sendMessage(it.channel_id, {
    embeds: [embed({
      title: '💳 Payment',
      description:
        `Send **$${plan.price}** in **USDT (TRC20)** to:\n\`\`\`${wallet}\`\`\`\n` +
        `**TRC20 network ONLY** — other networks mean lost funds.\n\n` +
        `1) Send the exact amount.\n` +
        `2) Click **✅ I paid** and paste your **TXID** (transaction hash) in the popup.\n` +
        `3) A staff member will verify on-chain and deliver your key.`,
    })],
    components: [
      { type: 1, components: [btn('sales_paid', '✅ I paid', 3)] },
      closeBtn(),
    ],
  });
}

async function handlePaid(it, txid) {
  const st = sales.get(it.channel_id);
  if (!st || st.kind !== 'buy') { await replyInteraction(it, 'This ticket is not a purchase ticket.', { ephemeral: true }); return; }
  if (st.status !== 'awaiting_payment' && st.status !== 'verifying') {
    await replyInteraction(it, 'This ticket is already being processed.', { ephemeral: true });
    return;
  }
  await replyInteraction(it, '⏳ Checking your TXID...');
  if (!txid) {
    try { txid = await findTxidInChannel(it.channel_id); } catch (e) { console.error('[sales] leer mensajes:', e.message); }
  }
  if (!txid) {
    await sendMessage(it.channel_id, '⚠️ I couldn\'t get your **TXID**. Click **✅ I paid** and paste the transaction hash in the popup.');
    return;
  }
  st.status = 'verifying';
  st.txid = txid;
  let r = null;
  try {
    r = await verifyUsdtPayment({ txid, wallet, expectedUsdt: st.price });
  } catch (e) {
    console.error('[sales] tron-check:', e.message);
    await sendMessage(it.channel_id, '⚠️ Could not verify the transaction right now (TronGrid). Try again in a minute.');
    st.status = 'awaiting_payment';
    return;
  }
  st.verified = r;
  const ok = r.ok;
  await sendMessage(it.channel_id, {
    embeds: [embed({
      title: '🔎 Payment check',
      color: ok ? 0x40c057 : 0xf59f00,
      description: ok
        ? '✅ **Payment found and verified.** Staff can now confirm and deliver your key.'
        : '⚠️ **Payment not verified.** Check the details below, then confirm your TXID.',
      fields: [
        { name: 'TXID', value: '`' + r.txid + '`', inline: false },
        { name: 'Received', value: r.receivedUsdt.toFixed(6) + ' USDT', inline: true },
        { name: 'Expected', value: '~' + st.price + ' USDT', inline: true },
        { name: 'From', value: r.from || 'n/a', inline: false },
        { name: 'Status', value: ok ? '✅ Confirmed' : '❌ ' + r.reason, inline: false },
        { name: 'TronScan', value: r.explorer, inline: false },
      ],
    })],
    components: [
      { type: 1, components: [btn('sales_confirm', '✅ Confirm & deliver key', 3), btn('sales_reject', '❌ Wrong TXID', 4)] },
      closeBtn(),
    ],
  });
}

async function handleConfirm(it) {
  const st = sales.get(it.channel_id);
  if (!st || st.kind !== 'buy') { await replyInteraction(it, 'This ticket is not a purchase ticket.', { ephemeral: true }); return; }
  if (!isStaff(it.member)) { await replyInteraction(it, 'Only staff can confirm payments.', { ephemeral: true }); return; }
  if (st.status !== 'verifying' || !st.verified) { await replyInteraction(it, 'Nothing to confirm yet.', { ephemeral: true }); return; }
  st.status = 'done';
  await replyInteraction(it, '⏳ Generating key...');
  const staffName = (it.member.user && it.member.user.username) || 'staff';
  let rec = null;
  try {
    rec = generateKeys({
      owner: st.username,
      days: st.plan.days,
      plan: st.plan.label,
      price: st.price,
      paid: true,
      seller: 'Discord',
    })[0];
  } catch (e) {
    console.error('[sales] generar key:', e.message);
    await sendMessage(it.channel_id, '⚠️ Could not generate the key. Tell staff to generate it manually in the panel.');
    st.status = 'verifying';
    return;
  }
  st.key = rec.key;
  await logTicket(st, { 'Confirmed by': staffName });
  await api('PUT', `/guilds/${cfg.guildId}/members/${st.clientId}/roles/${cfg.roleIds.Customer}`, undefined, token)
    .then(() => console.log('[sales] rol Customer asignado a', st.username))
    .catch((e) => console.error('[sales] rol Customer:', e.message));
  if (license) {
    try {
      const out = await license.publishAll();
      console.log(`[sales] índice publicado: blacklist=${out.blacklist && out.blacklist.published} index=${out.index && out.index.published}`);
    } catch (e) {
      console.error('[sales] publishAll:', e.message);
      await sendMessage(it.channel_id, '⚠️ Key generated, but I could not publish the license index right now. Run `node tools/publish-keys.mjs` on the server to activate it for the client.');
    }
  }
  await api('PATCH', `/channels/${it.channel_id}`, { name: `🟢-${(st.username || 'user').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20)}` }, token).catch(() => {});
  if (it.message && it.message.id) {
    await editMessage(it.channel_id, it.message.id, {
      embeds: [embed({
        title: '🔎 Payment check',
        color: 0x40c057,
        description: '✅ **Payment confirmed** by ' + staffName + '.',
        fields: [
          { name: 'TXID', value: '`' + st.txid + '`', inline: false },
          { name: 'Received', value: st.verified.receivedUsdt.toFixed(6) + ' USDT', inline: true },
          { name: 'Status', value: '✅ Confirmed by staff', inline: true },
        ],
      })],
      components: [closeBtn()],
    }).catch(() => {});
  }
  await sendMessage(it.channel_id, {
    embeds: [embed({
      title: '🎉 Payment confirmed — here\'s your key!',
      color: 0x40c057,
      description:
        `**Your BoostPilot key:**\n\`\`\`${rec.key}\`\`\`\n` +
        `1) Download BoostPilot from <#${cfg.ids['downloads']}>\n` +
        `2) Open it and paste your key\n` +
        `3) Connect your Eldorado seller account\n\n` +
        `Your plan (**${st.plan.label}**) starts when you first log in. If it says the key is already in use on another device, open a ticket and we\'ll unlock it.`,
    })],
    components: [closeBtn()],
  });
  console.log(`[sales] key ${rec.key} entregada a ${st.username} (${st.plan.label})`);
}

async function handleReject(it) {
  const st = sales.get(it.channel_id);
  if (!st || st.kind !== 'buy') { await replyInteraction(it, 'This ticket is not a purchase ticket.', { ephemeral: true }); return; }
  st.status = 'awaiting_payment';
  await replyInteraction(it, '⚠️ OK, that TXID was rejected. Paste the correct **TXID** and click **✅ I paid** again.');
}

async function handleClose(it) {
  const st = sales.get(it.channel_id);
  if (st) st.status = 'closed';
  await replyInteraction(it, '🔒 Closing ticket...');
  if (st && st.key && !st.logged) await logTicket(st);
  await api('DELETE', `/channels/${it.channel_id}`, undefined, token).catch((e) => console.error('[sales] cerrar ticket:', e.message));
  sales.delete(it.channel_id);
}

async function handleInteraction(it) {
  const id = it.data && it.data.custom_id;

  /* Submit del modal de TXID (interacción tipo 5 = MODAL_SUBMIT). */
  if (it.type === 5 && id === 'sales_txid') {
    let txid = '';
    for (const row of it.data.components || []) {
      for (const comp of row.components || []) {
        if (comp.type === 4 && comp.custom_id === 'txid') txid = String(comp.value || '').trim();
      }
    }
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      await replyInteraction(it, '❌ That doesn\'t look like a valid TXID (64 hex characters). Click **✅ I paid** and paste it again.');
      return;
    }
    return handlePaid(it, txid.toLowerCase());
  }

  if (!id) return;

  if (id === 'bp_buy' || id === 'bp_support') {
    const uid = it.member && it.member.user && it.member.user.id;
    if (!uid) return;
    if (findOpenTicket(uid)) {
      await replyInteraction(it, 'You already have an open ticket.', { ephemeral: true });
      return;
    }
    await replyInteraction(it, '⏳ Opening ticket...', { ephemeral: true });
    const kind = id === 'bp_buy' ? 'buy' : 'support';
    const chan = await createTicketChannel(it, kind);
    const username = String(it.member.user.global_name || it.member.user.username || 'user').slice(0, 32) || 'user';
    sales.set(chan.id, { kind, clientId: uid, username, plan: null, price: 0, status: kind === 'buy' ? 'selecting' : 'support', txid: null, verified: null, key: null, logged: false });
    if (kind === 'buy') await openSalesTicket(it, chan);
    else await openSupportTicket(it, chan);
    return;
  }

  if (id && id.startsWith('plan:')) {
    const plan = salesPlans.find((p) => p.id === id.slice(5));
    if (plan) await handlePlan(it, plan);
    return;
  }
  if (id === 'sales_paid') {
    const st = sales.get(it.channel_id);
    if (!st || st.kind !== 'buy') { await replyInteraction(it, 'This ticket is not a purchase ticket.', { ephemeral: true }); return; }
    if (st.status !== 'awaiting_payment' && st.status !== 'verifying') {
      await replyInteraction(it, 'This ticket is already being processed.', { ephemeral: true });
      return;
    }
    /* Modal para que el cliente pegue el TXID (sin depender del contenido del mensaje). */
    await api('POST', `/interactions/${it.id}/${it.token}/callback`, {
      type: 9,
      data: {
        custom_id: 'sales_txid',
        title: 'Confirm your payment',
        components: [
          { type: 1, components: [
            { type: 4, custom_id: 'txid', label: 'Transaction hash (TXID)', style: 1, required: true, min_length: 64, max_length: 64, placeholder: 'Paste your 64-character TXID' },
          ]},
        ],
      },
    }, token).catch((e) => console.error('[sales] abrir modal:', e.message));
    return;
  }
  if (id === 'sales_confirm') return handleConfirm(it);
  if (id === 'sales_reject') return handleReject(it);
  if (id === 'ticket_close') return handleClose(it);
}

/* ---------------- gateway ---------------- */

let ws = null;
let heartbeatTimer = null;
let lastSeq = null;
let intentMask = (1 << 0) | (1 << 1); // GUILDS + GUILD_MEMBERS (privileged)
let memberCache = [];
let memberCount = null;
let bootDone = false;

function send(d) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(d)); }

function identify() {
  send({
    op: 2,
    d: {
      token,
      intents: intentMask,
      properties: { os: 'windows', browser: 'boostpilot', device: 'boostpilot' },
    },
  });
}

function countRole(roleId) {
  return memberCache.filter((m) => m.roles && m.roles.includes(roleId)).length;
}

async function patchChannelName(channelId, name) {
  await api('PATCH', `/channels/${channelId}`, { name }, token);
}

async function fetchMembers() {
  const list = [];
  let after = null;
  for (let i = 0; i < 200; i++) {
    const q = after ? `?limit=1000&after=${after}` : '?limit=1000';
    const page = await api('GET', `/guilds/${cfg.guildId}/members${q}`, undefined, token);
    if (!Array.isArray(page) || !page.length) break;
    list.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return list;
}

async function updateCounters() {
  try {
    const list = await fetchMembers();
    if (list.length) {
      memberCache = list;
      memberCount = list.length;
      console.log(`[counters] ${memberCache.length} miembros leídos de REST`);
    }
    const members = countRole(cfg.roleIds.Member);
    const clients = countRole(cfg.roleIds.Customer);
    const chans = await api('GET', `/guilds/${cfg.guildId}/channels`, undefined, token);
    for (const ch of chans) {
      if (ch.type !== 2) continue;
      if (ch.name.startsWith('👥')) {
        const want = `👥｜${members} members`;
        if (ch.name !== want) { await patchChannelName(ch.id, want); console.log(`[counters] members -> ${want}`); }
      } else if (ch.name.startsWith('⬆️')) {
        const want = `⬆️｜${clients} clients`;
        if (ch.name !== want) { await patchChannelName(ch.id, want); console.log(`[counters] clients -> ${want}`); }
      }
    }
  } catch (e) { console.error('[counters] error:', e.message); }
}

async function syncMembers() {
  await updateCounters();
}

async function bootSetup() {
  if (bootDone) return;
  bootDone = true;
  try {
    const chans = await api('GET', `/guilds/${cfg.guildId}/channels`, undefined, token);
    ticketCatId = cfg.ids['🎫 TICKETS'] || (chans.find((c) => c.type === 4 && /TICKETS/i.test(c.name)) || {}).id || null;
    const logs = chans.find((c) => c.name === 'ticket-logs');
    if (logs) cfg.ids['ticket-logs'] = logs.id;
    saveConfig(cfg);
    if (!ticketCatId) console.warn('[sales] no se encontró la categoría 🎫 TICKETS');
    if (!salesPlans.length || !wallet) {
      console.warn('[sales] plans/wallet vacíos — revisá config/rules.json (store.plans / store.payment)');
    }
    const openCh = cfg.ids['open-ticket'];
    if (openCh) {
      const msgs = await api('GET', `/channels/${openCh}/messages?limit=20`, undefined, token).catch(() => []);
      const hasPanel = (msgs || []).some((m) => m.embeds && m.embeds.some((e) => e.footer && e.footer.text === 'BoostPilot-BuyPanel'));
      if (!hasPanel) {
        await api('POST', `/channels/${openCh}/messages`, {
          embeds: [embed({
            title: '🎫 How can we help you?',
            description: '**🛒 Buy BoostPilot** — pick a plan, pay in USDT (TRC20) and get your key after staff confirms.\n**❓ Help & Support** — activation, moving machines or any question.',
            footerText: 'BoostPilot-BuyPanel',
          })],
          components: [
            { type: 1, components: [btn('bp_buy', '🛒 Buy BoostPilot', 3), btn('bp_support', '❓ Help & Support', 4)] },
          ],
        }, token);
        console.log('[sales] panel de compra publicado en #open-ticket');
      }
    }
    console.log('[sales] listo. Planes:', salesPlans.map((p) => p.label + ' $' + p.price).join(', '));
  } catch (e) {
    console.error('[sales] bootSetup:', e.message);
  }
}

function connect() {
  ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

  ws.onopen = () => console.log('[gw] conectado');

  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.s) lastSeq = m.s;

    if (m.op === 10) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => send({ op: 1, d: lastSeq }), m.d.heartbeat_interval);
      identify();
    } else if (m.op === 11) {
      /* heartbeat ack */
    } else if (m.t === 'READY') {
      botUserId = m.d.user.id;
      console.log(`[gw] listo como ${m.d.user.username}#${m.d.user.discriminator || ''}`);
      console.log(`[gw] servidor: ${cfg.guildId}`);
    } else if (m.t === 'GUILD_CREATE') {
      memberCount = m.d.member_count ?? memberCount;
      if (Array.isArray(m.d.members)) {
        memberCache = m.d.members;
        console.log(`[gw] ${memberCache.length} miembros en caché`);
      }
      syncMembers().catch(() => {});
      bootSetup().catch((err) => console.error('[sales] bootSetup:', err.message));
    } else if (m.t === 'GUILD_MEMBER_ADD') {
      memberCache.push(m.d);
      memberCount = (memberCount ?? 0) + 1;
      updateCounters().catch(() => {});
      // auto-asignar rol Member al nuevo miembro (si aún no lo tiene)
      const memberRole = cfg.roleIds.Member;
      const has = Array.isArray(m.d.roles) && m.d.roles.includes(memberRole);
      if (memberRole && !has) {
        api('PUT', `/guilds/${cfg.guildId}/members/${m.d.user.id}/roles/${memberRole}`, undefined, token)
          .then(() => console.log(`[member] rol Member asignado a ${m.d.user.username}`))
          .catch((e) => console.error(`[member] no se pudo asignar rol a ${m.d.user.username}:`, e.message));
      }
    } else if (m.t === 'GUILD_MEMBER_UPDATE') {
      const i = memberCache.findIndex((x) => x.user && x.user.id === m.d.user.id);
      if (i >= 0) memberCache[i] = m.d; else memberCache.push(m.d);
      updateCounters().catch(() => {});
    } else if (m.t === 'GUILD_MEMBER_REMOVE') {
      const id = m.d.user && m.d.user.id;
      memberCache = memberCache.filter((x) => !(x.user && x.user.id === id));
      memberCount = Math.max(0, (memberCount ?? 0) - 1);
      updateCounters().catch(() => {});
    } else if (m.t === 'INTERACTION_CREATE') {
      handleInteraction(m.d).catch((err) => console.error('[sales] interacción:', err.message));
    } else if (m.t === 'CHANNEL_DELETE') {
      sales.delete(m.d.id);
    }
  };

  ws.onclose = (e) => {
    clearInterval(heartbeatTimer);
    if (e.code === 4014 && intentMask !== (1 << 0)) {
      intentMask = 1 << 0; // GUILD_MEMBERS no habilitado -> reintentar solo con GUILDS
      console.log('[gw] GUILD_MEMBERS intent no habilitado: contadores desactivados.');
    }
    console.log('[gw] reconectando en 3s...');
    setTimeout(connect, 3000);
  };

  ws.onerror = (e) => console.error('[gw] error de socket');
}

/* ---------------- main ---------------- */

cfg = loadConfig();
if (!cfg.guildId || !cfg.roleIds) {
  console.error('Config no encontrada. Ejecuta primero: node tools/discord-setup.mjs');
  process.exit(1);
}
token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
if (!token) {
  console.error('Falta el token. Define BP_DISCORD_TOKEN o state/discord.auth.json');
  process.exit(1);
}
loadSalesConfig();
license = createLicenseChecker(() => null, { debug: false });

connect();
setInterval(() => syncMembers().catch(() => {}), 5 * 60 * 1000);
