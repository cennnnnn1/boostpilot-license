import { loadConfig, loadAuth } from './discord-store.mjs';

const P = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  READ_MESSAGE_HISTORY: 1n << 22n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
};
const bit = (n) => n.toString();
const sum = (...b) => b.reduce((a, x) => a | x, 0n).toString();

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
  const owner = roles.find((r) => r.name === '👑 Owner');
  const botRole = roles.find((r) => r.managed && r.name === 'BoostPilot');

  // @everyone: ve pero no escribe. Owner: puede todo. Bot: puede todo.
  const everyone = { id: gid, type: 0, allow: bit(P.VIEW_CHANNEL), deny: sum(P.SEND_MESSAGES, P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS) };
  const ownerOw = { id: owner.id, type: 0, allow: sum(P.VIEW_CHANNEL, P.SEND_MESSAGES, P.EMBED_LINKS, P.ATTACH_FILES, P.ADD_REACTIONS, P.CONNECT, P.SPEAK, P.READ_MESSAGE_HISTORY, P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS), deny: '0' };
  const botOw = botRole ? { id: botRole.id, type: 0, allow: sum(P.VIEW_CHANNEL, P.SEND_MESSAGES, P.EMBED_LINKS, P.ATTACH_FILES, P.ADD_REACTIONS, P.CONNECT, P.SPEAK, P.READ_MESSAGE_HISTORY, P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS), deny: '0' } : null;

  const overwrites = [everyone, ownerOw, ...(botOw ? [botOw] : [])];

  const chans = await api('GET', '/guilds/' + gid + '/channels');
  // categorías y canales (incluye tickets y open-ticket) -> público + solo lectura.
  // Los 4 contadores de voz: se saltan (ya están bloqueados para entrar).
  const counters = chans.filter((c) => c.type === 2 && !c.parent_id);

  for (const c of chans) {
    if (c.type === 4) continue; // las categorías se tratan igual, aplicar también
  }

  let done = 0;
  for (const c of chans) {
    if (counters.some((x) => x.id === c.id)) continue;
    await api('PATCH', '/channels/' + c.id, { permission_overwrites: overwrites });
    done++;
    await sleep(1200);
  }
  console.log('aplicado a', done, 'canales (+categorías)');
})().catch((e) => console.error('ERR', e.message));
