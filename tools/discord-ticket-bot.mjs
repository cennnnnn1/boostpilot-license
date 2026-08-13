/* Persistent utility bot for the BoostPilot Discord server.
   Zero-dependency gateway client (Node >= 22). Run after tools/discord-setup.mjs:

     node tools/discord-ticket-bot.mjs

   Handles:
     - 👥 members / ⬆️ clients channel counters
     - auto-assigns the Member role to new joiners
   Tickets and payments are handled manually by staff (Ticket Tool).
*/
import { loadConfig, loadAuth } from './discord-store.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token) {
  for (let t = 0; t < 5; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

/* ---------------- gateway ---------------- */

let ws = null;
let heartbeatTimer = null;
let lastSeq = null;
let token = null;
let cfg = null;
let intentMask = (1 << 0) | (1 << 1); // GUILDS + GUILD_MEMBERS (privileged)
let memberCache = [];
let memberCount = null;

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
      console.log(`[gw] listo como ${m.d.user.username}#${m.d.user.discriminator || ''}`);
      console.log(`[gw] servidor: ${cfg.guildId}`);
    } else if (m.t === 'GUILD_CREATE') {
      memberCount = m.d.member_count ?? memberCount;
      if (Array.isArray(m.d.members)) {
        memberCache = m.d.members;
        console.log(`[gw] ${memberCache.length} miembros en caché`);
      }
      syncMembers().catch(() => {});
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

connect();
setInterval(() => syncMembers().catch(() => {}), 5 * 60 * 1000);
