import { loadConfig, loadAuth } from './discord-store.mjs';
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const gid = loadConfig().guildId;
const res = await fetch('https://discord.com/api/v10/guilds/' + gid + '/channels', {
  headers: { Authorization: 'Bot ' + token },
});
const chans = await res.json();
if (!Array.isArray(chans)) { console.log('ERROR:', JSON.stringify(chans).slice(0, 300)); process.exit(1); }
for (const c of chans) {
  if (c.type === 4) console.log('\nCAT ' + c.name);
  else if (c.name.includes('ticket') || c.name.includes('open') || c.name.includes('💗')) console.log('  ' + c.name + '  (id ' + c.id + ')');
}
const t = chans.find((c) => c.name === 'open-ticket');
console.log('\nopen-ticket found:', t ? 'YES -> <#' + t.id + '>' : 'NO');
