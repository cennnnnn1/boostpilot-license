import { loadAuth, loadConfig } from './discord-store.mjs';

const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function patch(id, name) {
  const res = await fetch('https://discord.com/api/v10/channels/' + id, {
    method: 'PATCH',
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const text = await res.text();
  console.log(res.status, id, JSON.stringify(name), text.slice(0, 80));
  await sleep(1200);
}

await patch('1536604738903347273', '⬆️ 0 Clients');
await patch('1536604740589191238', '🌐 BoostPilot.gg');
await patch('1536604744351485972', '🌐 Discord');
