import { loadConfig, loadAuth } from './discord-store.mjs';

const cfg = loadConfig();
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const H = { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
const api = async (m, p) => {
  const r = await fetch('https://discord.com/api/v10' + p, { method: m, headers: H });
  return { s: r.status, j: await r.json().catch(() => null) };
};

const gid = cfg.guildId;
const { j: chans } = await api('GET', `/guilds/${gid}/channels`);
if (!Array.isArray(chans)) { console.log('ERROR canales:', JSON.stringify(chans)); process.exit(1); }

const cat = chans.find(c => c.id === cfg.ids['🎫 TICKETS']);
const ot = chans.find(c => c.id === cfg.ids['open-ticket']);
const logs = chans.find(c => c.id === cfg.ids['ticket-logs']);
const tickets = chans.filter(c => c.parent_id === cfg.ids['🎫 TICKETS']);

console.log('=== CATEGORIA TICKETS ===');
console.log(cat ? `OK ${cat.name} (${cat.id}) public=${cat.overwrites?.[0]?.deny !== '1024' ? 'yes' : 'no'}` : `FALTA categoria (id cfg: ${cfg.ids['🎫 TICKETS']})`);
console.log('canales en categoria:', tickets.map(t => `${t.name} [${t.type}]`).join(', ') || '(ninguno)');

console.log('\n=== OPEN-TICKET ===');
if (ot) {
  const { s, j } = await api('GET', `/channels/${ot.id}/messages?limit=10`);
  console.log(`HTTP ${s}, mensajes: ${Array.isArray(j) ? j.length : 'err'}`);
  if (Array.isArray(j)) {
    for (const m of j) {
      const btns = (m.components || []).flatMap(r => (r.components || []).filter(c => c.type === 2));
      const ids = btns.map(b => `${b.custom_id}(${b.label})`).join(' ') || '(sin botones)';
      console.log(`- ${m.author.username} (bot=${m.author.bot}): ${btns.length} botones -> ${ids}`);
    }
  }
} else {
  console.log('FALTA canal open-ticket');
}

console.log('\n=== ROLES ===');
const { j: roles } = await api('GET', `/guilds/${gid}/roles`);
if (Array.isArray(roles)) {
  for (const key of ['Admin', 'Mod', 'Customer', 'Member']) {
    const id = cfg.roleIds[key];
    const r = roles.find(x => x.id === id);
    console.log(`${key}: ${r ? r.name : 'FALTA'} (${id})`);
  }
}

console.log('\n=== LOGS ===');
console.log(logs ? `OK #${logs.name}` : `FALTA ticket-logs (id cfg: ${cfg.ids['ticket-logs']})`);
