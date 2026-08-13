import { loadConfig, loadAuth } from './discord-store.mjs';

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let t = 0; t < 15; t++) {
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
    throw new Error('HTTP ' + res.status + ' ' + method + ' ' + path + ' :: ' + String(data).slice(0, 300));
  }
}

(async () => {
  const roles = await api('GET', '/guilds/' + gid + '/roles');
  const byName = (n) => roles.find((r) => r.name === n);

  // orden de mayor a menor posición (jerarquía en la lista de miembros)
  const order = ['👑 Owner', '🛡️ Admin', '🎖️ Mod', '🎁 Customer', '🧑 Member', '💎 VIP', '🌟 Booster', '🤖 BoostPilot'];
  const items = order.map((n, i) => ({ id: byName(n).id, position: order.length - i }));

  // color: Customer rosado, Member verde
  const colors = {
    '🎁 Customer': 0xff6a8a,
    '🧑 Member': 0x51cf66,
  };

  const patch = items.map((it) => {
    const role = byName(order[order.length - it.position]);
    const color = colors[role.name];
    return color === undefined ? { id: it.id, position: it.position } : { id: it.id, position: it.position, color };
  });

  const r = await api('PATCH', '/guilds/' + gid + '/roles', patch);
  console.log('roles actualizados:', r.length);

  const final = await api('GET', '/guilds/' + gid + '/roles');
  final.sort((a, b) => b.position - a.position)
    .forEach((x) => console.log(String(x.position).padStart(2), JSON.stringify(x.name), '#' + x.color.toString(16).padStart(6, '0')));
})().catch((e) => console.error('ERR', e.message));
