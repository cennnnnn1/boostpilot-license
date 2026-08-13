import { loadConfig, loadAuth } from './discord-store.mjs';
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const res = await fetch('https://discord.com/api/v10/guilds/' + gid + '/channels', { headers: { Authorization: 'Bot ' + token } });
const chans = await res.json();
const names = ['announcements', 'faq', '💗plan-valorant', '📖how-it-works'];
for (const n of names) {
  const ch = chans.find((c) => c.name === n);
  if (!ch) { console.log(n + ': channel NOT FOUND'); continue; }
  const msgs = await (await fetch('https://discord.com/api/v10/channels/' + ch.id + '/messages?limit=10', { headers: { Authorization: 'Bot ' + token } })).json();
  const mine = (Array.isArray(msgs) ? msgs : []).filter((m) => m.author && m.author.id === loadConfig().botUserId);
  const first = mine[0];
  if (!first) { console.log(n + ': no bot messages'); continue; }
  const emb = first.embeds && first.embeds[0] ? first.embeds[0] : {};
  const text = (emb.description || '') + ' ' + (emb.title || '');
  const hasTicket = text.includes('<#1536597874563883141>');
  const hasOpen = text.includes('<#open>');
  const g = (emb.title || '').match(/^(.{2,8}) /);
  console.log(n + ' | ticket-link:' + hasTicket + ' | open-placeholder:' + hasOpen + ' | title:' + (g ? g[1] : '-'));
}
