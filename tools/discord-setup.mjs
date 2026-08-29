/* One-time Discord server setup for BoostPilot.
   Creates the guild (bot must be in <10 servers), builds roles / categories /
   channels, posts the ticket panel, assigns you staff roles and transfers
   ownership to your account.

   Usage:
     node tools/discord-setup.mjs
   Or with env:
     BP_DISCORD_TOKEN=... BP_DISCORD_USER_ID=... node tools/discord-setup.mjs
     BP_DISCORD_GUILD_ID=...  (skip guild creation, only build structure)
*/

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline/promises';
import { ROOT, configPath, loadConfig, saveConfig } from './discord-store.mjs';
import {
  ROLE_ORDER, ROLE_DEFS, CATEGORIES, TICKET_BUTTONS, TICKET_MOTIVES, PINK,
  downloadsOverwrites,
} from './discord-structure.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token, tries = 6) {
  const res = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    let d = {};
    try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 1) * 1000 + 250;
    if (tries > 0) { console.log(`  (rate limited, waiting ${Math.round(wait)}ms)`); await sleep(wait); return api(method, path, body, token, tries - 1); }
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 400)}`);
  err.status = res.status; err.data = data;
  throw err;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);

async function ensureAuth() {
  let token = process.env.BP_DISCORD_TOKEN;
  let userId = process.env.BP_DISCORD_USER_ID;

  const authFile = join(ROOT, 'state', 'discord.auth.json');
  if (!token || !userId) {
    try {
      const a = JSON.parse(readFileSync(authFile, 'utf8'));
      token = token || a.token;
      userId = userId || a.userId;
    } catch { /* ignore */ }
  }
  if (!token) token = (await ask('Pega el BOT TOKEN (Developer Portal): ')).trim();
  if (!userId) userId = (await ask('Tu ID de usuario de Discord (modo desarrollador): ')).trim();

  mkdirSync(dirname(authFile), { recursive: true });
  writeFileSync(authFile, JSON.stringify({ token, userId }, null, 2), 'utf8');
  return { token, userId };
}

async function findGuild(token, name = 'BoostPilot') {
  const guilds = await api('GET', '/users/@me/guilds', undefined, token);
  return guilds.find((g) => g.name === name) || null;
}

async function wipeDefaultChannels(guildId, token) {
  const chans = await api('GET', `/guilds/${guildId}/channels`, undefined, token);
  for (const c of chans) {
    try { await api('DELETE', `/channels/${c.id}`, undefined, token); } catch { /* keep */ }
  }
}

async function setRolePositions(guildId, roleIds, token) {
  /* bot role must sit ABOVE all assignable roles so it can give them to users */
  const order = ROLE_ORDER; // Owner..Member, then Bot on top
  const pos = {};
  order.forEach((key, i) => { pos[key] = i + 1; });
  pos['Bot'] = order.length + 1;
  const roles = ROLE_ORDER.map((key) => ({ id: roleIds[key], position: pos[key] }));
  try {
    await api('PATCH', `/guilds/${guildId}/roles`, roles, token);
    console.log('  ✔ Posición de roles (bot arriba)');
  } catch (e) { console.warn('  ! No se pudieron reordenar roles: ' + e.message); }
}

async function createRoles(guildId, token) {
  const existing = await api('GET', `/guilds/${guildId}/roles`, undefined, token);
  const ids = { everyone: guildId };
  for (const def of ROLE_DEFS) {
    const found = existing.find((r) => r.name === def.name);
    let id;
    if (found) {
      id = found.id;
      console.log(`  ✔ Rol ${def.name} (ya existía)`);
    } else {
      const r = await api('POST', `/guilds/${guildId}/roles`, {
        name: def.name, permissions: def.permissions, color: def.color,
        hoist: !!def.hoist, mentionable: def.name.startsWith('🤖') ? false : def.name.startsWith('🎖️'),
      }, token);
      id = r.id;
      console.log(`  ✔ Rol ${def.name}`);
    }
    ids[def.name.split(' ')[1] || def.name] = id;
  }
  const orphan = existing.find((r) => r.name === 'BoostPilot' && r.id !== ids['BoostPilot']);
  if (orphan) {
    try { await api('DELETE', `/guilds/${guildId}/roles/${orphan.id}`, undefined, token); console.log('  ✔ Rol huérfano BoostPilot eliminado'); } catch { /* ignore */ }
  }
  return ids;
}

async function createStructure(guildId, roleIds, token) {
  const ids = {};
  const cats = CATEGORIES(roleIds);
  for (const cat of cats) {
    const overwrites = (cat.overwrites || []).map((o) =>
      o.id === '@everyone' ? { ...o, id: guildId } : o
    );
    const c = await api('POST', `/guilds/${guildId}/channels`, {
      name: cat.name, type: 4, permission_overwrites: overwrites,
    }, token);
    ids[cat.name] = c.id;
    for (const ch of cat.channels) {
      const body = { name: ch.name, type: ch.type, parent_id: c.id };
      if (ch.topic) body.topic = ch.topic;
      if (ch.overwrites) body.permission_overwrites = ch.overwrites.map((o) =>
        o.id === '@everyone' ? { ...o, id: guildId } : o
      );
      const nc = await api('POST', `/guilds/${guildId}/channels`, body, token);
      ids[ch.name] = nc.id;
    }
    console.log(`  ✔ Categoría ${cat.name}`);
  }
  if (ids['⬇️downloads']) ids['downloads'] = ids['⬇️downloads'];
  return ids;
}

async function ensureDownloadsChannel(guildId, roleIds, ids, token) {
  const chans = await api('GET', `/guilds/${guildId}/channels`, undefined, token);
  const existing = chans.find((c) => c.name === '⬇️downloads');
  if (existing) {
    ids['downloads'] = existing.id;
    console.log('  ✔ Canal ⬇️downloads (ya existía)');
    return ids;
  }
  const cat = chans.find((c) => c.type === 4 && /INFORMATION/i.test(c.name));
  if (!cat) {
    console.warn('  ! No se encontró la categoría INFORMATION; no se creó ⬇️downloads');
    return ids;
  }
  const nc = await api('POST', `/guilds/${guildId}/channels`, {
    name: '⬇️downloads', type: 0, parent_id: cat.id,
    topic: 'Latest BoostPilot version',
    permission_overwrites: downloadsOverwrites(roleIds, guildId),
  }, token);
  ids['downloads'] = nc.id;
  console.log('  ✔ Canal ⬇️downloads creado (visible: Customer+ · escritura: staff)');
  return ids;
}

async function assignBotRole(guildId, roleIds, token) {
  const app = await api('GET', '/oauth2/applications/@me', undefined, token);
  try {
    await api('PUT', `/guilds/${guildId}/members/${app.id}/roles/${roleIds['BoostPilot']}`, undefined, token);
    console.log('  ✔ Rol del bot asignado');
  } catch (e) { console.warn('  ! No se pudo asignar el rol del bot: ' + e.message); }
  return app.id;
}

async function createInvite(channelId, token) {
  const inv = await api('POST', `/channels/${channelId}/invites`, { max_age: 0, max_uses: 0, unique: false }, token);
  return 'https://discord.gg/' + inv.code;
}

function embed(title, desc, fields = [], footer) {
  const e = { title, description: desc, color: PINK, fields, timestamp: new Date().toISOString() };
  if (footer) e.footer = { text: footer };
  return e;
}

async function postWelcome(guildId, ids, invite, userId, token) {
  const ch = ids['welcome'];
  const body = {
    content: null,
    embeds: [embed(
      'Welcome to BoostPilot',
      `Official **BoostPilot** server — the tool that catches Eldorado.gg boosting orders in seconds.\n\n` +
      `· **Buy**: open a ticket at <#${ids['open-ticket']}>\n` +
      `· **Pricing & plans**: <#${ids['pricing']}>\n` +
      `· **Support**: <#${ids['open-ticket']}>\n\n` +
      `Invite: ${invite}`,
      [], 'BoostPilot · Discord'
    )],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: 'Join the server', url: invite },
        ],
      },
    ],
  };
  await api('POST', `/channels/${ch}/messages`, body, token);
  console.log('  ✔ Mensaje de bienvenida');
}

async function postTicketPanel(ids, token) {
  const body = {
    embeds: [embed(
      '🎟️ Open a ticket',
      'Click **Create Ticket** to get help or buy a BoostPilot plan. A private channel will be created automatically.',
      [
        { name: '🛒 Buy / Boost', value: 'Order a boost or a BoostPilot plan. Purchases are handled in tickets.', inline: false },
        { name: '🎫 Help', value: 'Installation, key activation, webhooks, configuration.', inline: false },
        { name: '🐞 Report', value: 'Software errors, bugs, suggestions.', inline: false },
      ],
      'One order per ticket · Staff will assist you shortly'
    )],
    components: [{ type: 1, components: TICKET_BUTTONS }],
  };
  await api('POST', `/channels/${ids['open-ticket']}/messages`, body, token);
  console.log('  ✔ Panel de tickets');
}

async function assignUserRoles(guildId, roleIds, userId, token) {
  const toGive = ['Owner', 'Admin', 'VIP', 'Customer', 'Member'];
  for (const key of toGive) {
    const rid = roleIds[key];
    if (!rid) continue;
    try {
      await api('PUT', `/guilds/${guildId}/members/${userId}/roles/${rid}`, undefined, token);
    } catch (e) { console.warn(`  ! No se pudo dar ${key}: ${e.message}`); }
  }
  console.log('  ✔ Roles asignados (Admin, VIP, Customer, Member)');
}

async function main() {
  const { token, userId } = await ensureAuth();

  const existing = loadConfig();
  const guildId = process.env.BP_DISCORD_GUILD_ID || existing.guildId;
  let ids = existing.ids || {};
  let roleIds = existing.roleIds || {};
  const fresh = !existing.guildId;

  let gid = guildId;
  if (!gid) {
    console.log('\n· Buscando el servidor "BoostPilot" (debe estar añadido el bot)...');
    const found = await findGuild(token);
    if (!found) {
      console.error('\nNo encontramos el servidor. 1) Créalo con tu cuenta en Discord, 2) añade el bot con el enlace de invitación.');
      rl.close();
      process.exit(1);
    }
    gid = found.id;
    console.log(`  ✔ Servidor encontrado (id ${gid})`);
    await sleep(1000);
  }

  let botIdAssigned;
  if (fresh) {
    await wipeDefaultChannels(gid, token);
    console.log('\n· Creando roles...');
    roleIds = await createRoles(gid, token);
    botIdAssigned = await assignBotRole(gid, roleIds, token);
    await setRolePositions(gid, roleIds, token);
    console.log('\n· Creando categorías y canales...');
    ids = await createStructure(gid, roleIds, token);
  } else {
    console.log('\n· Reutilizando estructura guardada...');
    if (!Object.keys(roleIds).length) { roleIds = await createRoles(gid, token); await setRolePositions(gid, roleIds, token); }
    if (!Object.keys(ids).length) { ids = await createStructure(gid, roleIds, token); }
    if (!existing.botUserId) botIdAssigned = await assignBotRole(gid, roleIds, token);
  }

  if (!fresh) {
    ids = await ensureDownloadsChannel(gid, roleIds, ids, token);
  }

  const botUserId = existing.botUserId || botIdAssigned;
  saveConfig({ guildId: gid, roleIds, ids, botUserId, ownerUserId: userId });

  if (fresh) {
    // Tickets los gestiona Ticket Tool; BoostPilot ya no publica panel de tickets.
  }

  await assignUserRoles(gid, roleIds, userId, token);

  console.log('\n✅ Servidor configurado.');
  console.log('\nPasos manuales restantes (en la app de Discord, como dueño):');
  console.log(' 1. Server Settings → Enable Community (elige #rules y #announcements).');
  console.log(' 2. Onboarding: pantalla de bienvenida, rol de entrada 🧑 Member, role menus de juego.');
  console.log(' 3. Activa el bot de tickets: node tools/discord-ticket-bot.mjs');
  rl.close();
}

main().catch((e) => { console.error('\nERROR:', e.message); rl.close(); process.exit(1); });
