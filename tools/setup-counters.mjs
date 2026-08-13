import { loadConfig, loadAuth } from './discord-store.mjs';

const P = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 22n,
  ADD_REACTIONS: 1n << 6n,
};
const bit = (n) => n.toString();

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const cfg = loadConfig();
const gid = cfg.guildId;
const out = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let t = 0; t < 8; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      let d = {}; try { d = await res.json(); } catch {}
      await sleep((Number(d.retry_after) || 3) * 1000 + 500);
      continue;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 200 && res.status < 300) return data;
    throw new Error('HTTP ' + res.status + ' ' + method + ' ' + path + ' :: ' + String(data).slice(0, 250));
  }
}

(async () => {
  const chans = await api('GET', '/guilds/' + gid + '/channels');

  // 1) delete old voice counters
  const old = chans.filter((c) => c.type === 2 && ['👥', '⬆️', '🌐'].some((e) => c.name.startsWith(e)));
  for (const c of old) {
    await api('DELETE', '/channels/' + c.id);
    out.push('deleted voice counter: ' + c.name);
    await sleep(700);
  }

  // 2) create text counters with padlock (everyone denied, member roles allowed)
  const allowed = ['Member', 'Customer', 'VIP', 'Booster', 'Mod', 'Admin', 'Owner']
    .map((k) => cfg.roleIds[k]).filter(Boolean);

  const overwrites = [
    { id: gid, type: 0, allow: '0', deny: bit(P.VIEW_CHANNEL) },
    ...allowed.map((rid) => ({
      id: rid, type: 0,
      allow: bit(P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY),
      deny: bit(P.SEND_MESSAGES),
    })),
  ];

  const counters = [
    '👥 | 2 Members',
    '⬆️ | 0 Clients',
    '🌐 | BoostPilot.gg',
    '🌐 | Discord',
  ];

  const created = [];
  for (const name of counters) {
    const c = await api('POST', '/guilds/' + gid + '/channels', {
      name, type: 0, permission_overwrites: overwrites,
    });
    created.push(c);
    out.push('created text counter: ' + name);
    await sleep(700);
  }

  // 3) reorder so the 4 counters are on top, before all categories
  const fresh = await api('GET', '/guilds/' + gid + '/channels');
  const tops = fresh.filter((c) => !c.parent_id);
  const cats = tops.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const otherTops = tops.filter((c) => c.type !== 4 && !created.some((n) => n.id === c.id));

  const order = [
    ...created.map((c, i) => ({ id: c.id, position: i })),
    ...cats.map((c, i) => ({ id: c.id, position: created.length + i })),
    ...otherTops.map((c, i) => ({ id: c.id, position: created.length + cats.length + i })),
  ];
  await api('PATCH', '/guilds/' + gid + '/channels', order);
  out.push('reordered: 4 counters on top');

  // 4) verify
  const final = await api('GET', '/guilds/' + gid + '/channels');
  const topFinal = final.filter((c) => !c.parent_id).sort((a, b) => a.position - b.position);
  for (const c of topFinal) {
    out.push((c.type === 4 ? '[cat] ' : '') + c.name);
  }

  console.log(out.join('\n'));
})().catch((e) => console.error('ERR', e.message));
