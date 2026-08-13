import { loadConfig, loadAuth } from './discord-store.mjs';
import { GAMES, gameChannelName } from './discord-structure.mjs';
import { readFileSync, writeFileSync } from 'fs';

const P = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  READ_MESSAGE_HISTORY: 1n << 22n,
  EMBED_LINKS: 1n << 14n,
};
const bit = (n) => n.toString();

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const cfg = loadConfig();
const gid = cfg.guildId;
const out = [];

async function api(method, path, body) {
  const res = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  throw new Error('HTTP ' + res.status + ' ' + method + ' ' + path + ' :: ' + String(data).slice(0, 300));
}

const oldGameName = ([slug, display, emoji]) => emoji + display.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const newGameName = gameChannelName;

const membersCount = async () => {
  try {
    const g = await api('GET', '/guilds/' + gid + '?with_counts=true');
    return g.approximate_member_count ?? '?';
  } catch { return '?'; }
};

const clientsCount = () => {
  try {
    const raw = JSON.parse(readFileSync('state/keys.json', 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.keys || []);
    const owners = new Set(arr.map((k) => k.owner).filter(Boolean));
    return owners.size;
  } catch { return '?'; }
};

(async () => {
  const members = await membersCount();
  const clients = clientsCount();
  const chans = await api('GET', '/guilds/' + gid + '/channels');

  const byName = (n) => chans.find((c) => c.name === n);

  // 1) delete BOT category + its channels
  for (const n of ['orders', 'commands', 'bugs-suggestions']) {
    const c = byName(n);
    if (c) { await api('DELETE', '/channels/' + c.id); out.push('deleted: ' + n); }
  }
  const botCat = byName('🤖 BOT');
  if (botCat) { await api('DELETE', '/channels/' + botCat.id); out.push('deleted: 🤖 BOT'); }

  // 2) unlock INFORMATION + Store (only TICKETS stays locked)
  const infoCat = byName('📌 INFORMATION');
  if (infoCat) { await api('PATCH', '/channels/' + infoCat.id, { permission_overwrites: [] }); out.push('INFORMATION: unlocked'); }
  const storeCat = byName('🛒 Store');
  if (storeCat) { await api('PATCH', '/channels/' + storeCat.id, { permission_overwrites: [] }); out.push('Store: unlocked'); }

  // 3) rename game channels -> "emojiplan-slug"
  for (const g of GAMES) {
    const old = oldGameName(g);
    const c = byName(old);
    if (c && c.name !== newGameName(g)) {
      await api('PATCH', '/channels/' + c.id, { name: newGameName(g) });
      out.push('renamed: ' + old + ' -> ' + newGameName(g));
    }
  }

  // 4) create how-it-works in Store
  if (!byName('📖how-it-works') && storeCat) {
    const c = await api('POST', '/guilds/' + gid + '/channels', {
      name: '📖how-it-works', type: 0, parent_id: storeCat.id,
      topic: 'How BoostPilot works: catch boosting orders automatically.',
    });
    out.push('created: 📖how-it-works');
  }

  // 5) create 4 locked voice counters (type 2) at top
  const lockOverwrites = [
    { id: gid, type: 0, allow: bit(P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY), deny: bit(P.CONNECT | P.SPEAK) },
  ];
  const counters = [
    { emoji: '👥', label: 'Members', value: String(members) },
    { emoji: '⬆️', label: 'Clients', value: String(clients) },
    { emoji: '🌐', label: 'BoostPilot.gg', value: '' },
    { emoji: '🌐', label: 'discord.gg/', value: '' },
  ];
  for (const c of counters) {
    const name = c.value ? `${c.emoji} ${c.value} ${c.label}` : `${c.emoji} ${c.label}${c.value}`;
    if (!byName(name)) {
      const ch = await api('POST', '/guilds/' + gid + '/channels', {
        name, type: 2, permission_overwrites: lockOverwrites,
      });
      out.push('created counter: ' + name);
    }
  }

  // create a real invite for the discord link counter
  let code = '';
  try {
    const inv = await api('POST', '/channels/' + byName('announcements').id + '/invites', { max_age: 0, max_uses: 0 });
    code = inv.code;
    out.push('invite: discord.gg/' + code);
  } catch (e) { out.push('invite failed: ' + e.message); }

  // if invite ok, set the discord counter name with the real code
  if (code) {
    const discordCounter = chans.find((c) => c.name.startsWith('🌐 discord.gg/'));
    if (discordCounter) {
      await api('PATCH', '/channels/' + discordCounter.id, { name: '🌐 discord.gg/' + code });
      out.push('discord counter updated: discord.gg/' + code);
    }
  }

  writeFileSync('state/_restruct.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch((e) => writeFileSync('state/_restruct.txt', 'ERR: ' + e.message));
