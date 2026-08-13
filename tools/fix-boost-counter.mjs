import { loadConfig, loadAuth } from './discord-store.mjs';

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let t = 0; t < 8; t++) {
    const res = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) { let d = {}; try { d = await res.json(); } catch {} await sleep((Number(d.retry_after) || 3) * 1000 + 500); continue; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (res.status >= 200 && res.status < 300) return data;
    throw new Error('HTTP ' + res.status + ' :: ' + String(data).slice(0, 250));
  }
}

(async () => {
  const chans = await api('GET', '/guilds/' + gid + '/channels');
  const boost = chans.find((c) => c.id === '1536772452091297966');
  const r = await api('PATCH', '/channels/' + boost.id, { name: '🌐｜Web app soon' });
  console.log('result:', JSON.stringify(r.name));

  const final = await api('GET', '/guilds/' + gid + '/channels');
  for (const c of final.filter((c) => c.type === 0 && !c.parent_id)) {
    console.log(c.id, JSON.stringify(c.name));
  }
})().catch((e) => console.error('ERR', e.message));
