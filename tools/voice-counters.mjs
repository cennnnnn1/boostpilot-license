import { loadConfig, loadAuth } from './discord-store.mjs';

const P = {
  VIEW_CHANNEL: 1n << 10n,
  READ_MESSAGE_HISTORY: 1n << 22n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
};
const bit = (n) => n.toString();

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let t = 0; t < 20; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      let d = {}; try { d = await res.json(); } catch {}
      const wait = (Number(d.retry_after) || 5) * 1000 + 1000;
      console.log('429, esperando ' + Math.round(wait / 1000) + 's...');
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 200 && res.status < 300) return data;
    throw new Error('HTTP ' + res.status + ' ' + method + ' ' + path + ' :: ' + String(data).slice(0, 300));
  }
}

const OLD_TEXT_IDS = [
  '1536772443211960360', // 👥
  '1536772447817179218', // ⬆️
  '1536772452091297966', // 🌐 boostpilot
  '1536772456981991537', // 🌐 discord
];

// @everyone (id = guild id): ve el canal pero no puede entrar (CONNECT denegado = candado)
const overwrites = [
  { id: gid, type: 0, allow: bit(P.VIEW_CHANNEL), deny: bit(P.CONNECT | P.SPEAK) },
];

const NEW_COUNTERS = [
  { name: '👥 ｜ 2 Members' },
  { name: '⬆️ ｜ 0 Clients' },
  { name: '🌐 ｜ BoostPilot.gg' },
  { name: '🌐 ｜ Discord' },
];

(async () => {
  // 1) crear los 4 canales de voz
  const created = [];
  for (const c of NEW_COUNTERS) {
    const r = await api('POST', '/guilds/' + gid + '/channels', {
      type: 2,
      name: c.name,
      permission_overwrites: overwrites,
    });
    console.log('creado:', r.id, JSON.stringify(r.name), 'type=' + r.type);
    created.push(r);
    await sleep(1500);
  }

  // 2) borrar los 4 de texto viejos
  for (const id of OLD_TEXT_IDS) {
    try {
      await api('DELETE', '/channels/' + id);
      console.log('borrado texto:', id);
    } catch (e) { console.error('no se pudo borrar', id, e.message); }
    await sleep(1500);
  }

  // 3) reordenar: los 4 contadores arriba (0-3), luego todo lo demás
  let chans = await api('GET', '/guilds/' + gid + '/channels');
  const counters = chans.filter((c) => created.some((n) => n.id === c.id));
  const topLevel = chans.filter((c) => !c.parent_id);
  const cats = topLevel.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
  const others = topLevel.filter((c) => c.type !== 4 && !counters.some((n) => n.id === c.id));
  const order = [
    ...counters.map((c) => ({ id: c.id, position: counters.indexOf(c) })),
    ...cats.map((c) => ({ id: c.id, position: counters.length + cats.indexOf(c) })),
    ...others.map((c) => ({ id: c.id, position: counters.length + cats.length + others.indexOf(c) })),
  ];
  await api('PATCH', '/guilds/' + gid + '/channels', order);
  console.log('reordenado: contadores primero');

  chans = await api('GET', '/guilds/' + gid + '/channels');
  const names = chans
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((c) => c.name);
  console.log('layout:', names.join(' | '));
})().catch((e) => console.error('ERR', e.message));
