import { loadConfig, loadAuth, ROOT } from './discord-store.mjs';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

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

(async () => {
  // real clients count from keys.json (absolute path)
  let clients = '?';
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'state', 'keys.json'), 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.keys || []);
    clients = String(new Set(arr.map((k) => k.owner).filter(Boolean)).size);
  } catch (e) { out.push('clients read failed: ' + e.message); }

  let chans = await api('GET', '/guilds/' + gid + '/channels');
  const byName = (n) => chans.find((c) => c.name === n);

  // 1) fix clients counter value
  const clientsCounter = chans.find((c) => c.name.startsWith('⬆️'));
  if (clientsCounter) {
    const newName = '⬆️ ' + clients + ' Clients';
    if (clientsCounter.name !== newName) {
      await api('PATCH', '/channels/' + clientsCounter.id, { name: newName });
      out.push('clients counter: ' + newName);
    }
  }

  // 2) fix discord counter with a real invite code
  const discCounter = chans.find((c) => c.name.startsWith('🌐 discord.gg/'));
  if (discCounter) {
    let code = discCounter.name.replace('🌐 discord.gg/', '').replace(/[^a-zA-Z0-9]/g, '');
    if (!code || code === 'discord.gg') {
      const inv = await api('POST', '/channels/' + byName('announcements').id + '/invites', { max_age: 0, max_uses: 0 });
      code = inv.code;
    }
    const newName = '🌐 discord.gg/' + code;
    if (discCounter.name !== newName) {
      await api('PATCH', '/channels/' + discCounter.id, { name: newName });
      out.push('discord counter: ' + newName);
    }
  }

  // 3) move the 4 counters to the top (positions 0-3), categories after
  chans = await api('GET', '/guilds/' + gid + '/channels');
  const counters = chans.filter((c) => /^[👥⬆️🌐]/.test(c.name) && c.type === 2);
  const topLevel = chans.filter((c) => !c.parent_id);
  const cats = topLevel.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const others = topLevel.filter((c) => c.type !== 4 && !counters.includes(c));

  const order = [
    ...counters.map((c) => ({ id: c.id, position: counters.indexOf(c) })),
    ...cats.map((c) => ({ id: c.id, position: counters.length + cats.indexOf(c) })),
    ...others.map((c) => ({ id: c.id, position: counters.length + cats.length + others.indexOf(c) })),
  ];
  await api('PATCH', '/guilds/' + gid + '/channels', order);
  out.push('reordered: counters first (' + counters.length + '), then ' + cats.length + ' cats');

  // 4) verify clients + members + final layout
  const g = await api('GET', '/guilds/' + gid + '?with_counts=true');
  out.push('guild members: ' + (g.approximate_member_count ?? '?'));
  chans = await api('GET', '/guilds/' + gid + '/channels');
  const names = chans
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((c) => c.name);
  out.push('channels: ' + names.join(', '));

  writeFileSync('state/_restruct.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch((e) => writeFileSync('state/_restruct.txt', 'ERR: ' + e.message));
