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
  const chans = await api('GET', '/guilds/' + gid + '/channels');
  const storeCat = chans.find((c) => c.type === 4 && c.name === '🛒 Store');
  const infoCat = chans.find((c) => c.type === 4 && c.name === '📌 INFORMATION');

  const targets = [];
  if (storeCat) targets.push(...chans.filter((c) => c.parent_id === storeCat.id));
  if (infoCat) targets.push(...chans.filter((c) => c.parent_id === infoCat.id));

  for (const c of targets) {
    const blocked = (c.permission_overwrites || []).some(
      (o) => o.type === 0 && o.id === gid && (Number(o.deny) & 1024) === 1024
    );
    if (blocked) {
      await api('PATCH', '/channels/' + c.id, { permission_overwrites: [] });
      console.log('desbloqueado:', c.name);
      await sleep(1200);
    }
  }
  console.log('listo');
})().catch((e) => console.error('ERR', e.message));
