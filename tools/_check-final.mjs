import { loadConfig, loadAuth } from './discord-store.mjs';
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const res = await fetch('https://discord.com/api/v10/guilds/' + gid + '/channels', { headers: { Authorization: 'Bot ' + token } });
const chans = await res.json();
const targets = chans.filter((c) => c.type === 0 && (c.name.startsWith('🎮') || c.name === 'faq'));
for (const ch of targets) {
  const msgs = await (await fetch('https://discord.com/api/v10/channels/' + ch.id + '/messages?limit=10', { headers: { Authorization: 'Bot ' + token } })).json();
  const mine = (Array.isArray(msgs) ? msgs : []).filter((m) => m.author && m.author.id === loadConfig().botUserId);
  let twelve = 0, allgames = 0, ticket = 0;
  for (const m of mine) {
    for (const emb of (m.embeds || [])) {
      const texts = [emb.title || '', emb.description || ''].concat((emb.fields || []).map((f) => f.name + ' ' + f.value));
      for (const t of texts) {
        if (/all ?12 ?games|12 games supported/i.test(t)) twelve++;
        if (/all games/i.test(t)) allgames++;
        if (t.includes('<#1536597874563883141>')) ticket++;
      }
    }
  }
  console.log(ch.name + ' | all-12:' + twelve + ' | all-games:' + allgames + ' | ticket-link:' + ticket);
}
