import { loadConfig, loadAuth } from './discord-store.mjs';

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const cfg = loadConfig();
const gid = cfg.guildId;
const out = [];

async function api(method, path, body) {
  for (let t = 0; t < 6; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      let d = {}; try { d = await res.json(); } catch {}
      await new Promise((r) => setTimeout(r, (Number(d.retry_after) || 2) * 1000 + 500));
      continue;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 200 && res.status < 300) return data;
    throw new Error('HTTP ' + res.status + ' :: ' + String(data).slice(0, 300));
  }
}

(async () => {
  const chans = await api('GET', '/guilds/' + gid + '/channels');
  const vc = chans.filter((c) => c.type === 2);
  const name = (c) => JSON.stringify(c.name);

  const members = vc.find((c) => c.name.includes('Members'));
  const clients = vc.find((c) => c.name.includes('Clients'));
  const web = vc.find((c) => c.name.includes('BoostPilot'));
  const disc = vc.find((c) => c.name.includes('discord') || c.name === '🌐 Discord');

  const target = new Map();
  if (members) target.set(members.id, '👥 2 Members');
  if (clients) target.set(clients.id, '⬆️ 0 Clients');
  if (web) target.set(web.id, '🌐 BoostPilot.gg');
  if (disc) target.set(disc.id, '🌐 Discord');

  out.push('found: ' + vc.map((c) => c.name).join(' | '));
  for (const [id, want] of target) {
    const cur = vc.find((c) => c.id === id);
    if (cur && cur.name !== want) {
      await api('PATCH', '/channels/' + id, { name: want });
      out.push('renamed: ' + cur.name + ' -> ' + want);
    } else {
      out.push('ok (unchanged): ' + (cur ? cur.name : '?'));
    }
  }

  // delete any leftover extra counter channels (duplicates not in target)
  const keepIds = new Set(target.keys());
  for (const c of vc) {
    if (!keepIds.has(c.id)) {
      await api('DELETE', '/channels/' + c.id);
      out.push('deleted duplicate: ' + c.name);
    }
  }

  console.log(out.join('\n'));
})().catch((e) => console.error('ERR', e.message));
