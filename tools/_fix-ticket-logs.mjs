import { loadConfig, saveConfig, loadAuth } from './discord-store.mjs';
import { staffOverwrites, ticketOverwrites } from './discord-structure.mjs';

const cfg = loadConfig();
const token = process.env.BP_DISCORD_TOKEN || loadAuth().token;
const H = { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' };
const api = async (m, p, b) => {
  const r = await fetch('https://discord.com/api/v10' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => null);
  return { status: r.status, data: j };
};

// 1) ticket-logs staff-only
let logsId = cfg.ids['ticket-logs'];
const probe = await api('GET', `/channels/${logsId}`);
if (probe.status === 200) {
  console.log(`ticket-logs ya existe: #${probe.data.name}`);
} else {
  const created = await api('POST', `/guilds/${cfg.guildId}/channels`, {
    name: 'ticket-logs',
    type: 0,
    parent_id: cfg.ids['🎫 TICKETS'],
    permission_overwrites: staffOverwrites(cfg.roleIds, cfg.guildId),
    topic: 'Closed ticket history (staff only)',
  });
  if (created.status === 201) {
    cfg.ids['ticket-logs'] = created.data.id;
    saveConfig(cfg);
    logsId = created.data.id;
    console.log(`ticket-logs CREADO: #${created.data.name} (${logsId})`);
  } else {
    console.log(`ERROR ticket-logs: HTTP ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

// 2) prueba real de creacion de ticket con overwrites corregidos
const overwrites = ticketOverwrites({ Mod: cfg.roleIds.Mod, Admin: cfg.roleIds.Admin }, 'probe-user', cfg.guildId);
const ch = await api('POST', `/guilds/${cfg.guildId}/channels`, {
  name: 'probe-ticket',
  type: 0,
  parent_id: cfg.ids['🎫 TICKETS'],
  permission_overwrites: overwrites,
  topic: 'probe',
});
if (ch.status === 201) {
  const ows = ch.data.permission_overwrites || [];
  const everyone = ows.find(o => o.id === cfg.guildId);
  const userOw = ows.find(o => o.type === 1);
  const modOw = ows.find(o => o.id === cfg.roleIds.Mod);
  const adminOw = ows.find(o => o.id === cfg.roleIds.Admin);
  console.log(`\nTICKET DE PRUEBA CREADO: #${ch.data.name} (${ch.data.id})`);
  console.log(`@everyone(gid) deny = ${everyone?.deny ?? '(none)'}`);
  console.log(`usuario allow          = ${userOw?.allow ?? '(none)'}`);
  console.log(`Mod allow              = ${modOw?.allow ?? '(none)'}`);
  console.log(`Admin allow            = ${adminOw?.allow ?? '(none)'}`);
  const ok = everyone && everyone.deny !== '0' && everyone.deny !== undefined && userOw && modOw && adminOw;
  console.log(ok ? 'PERMISOS OK: oculto para todos, visible para usuario + staff' : 'PERMISOS INSUFICIENTES');
  await api('DELETE', `/channels/${ch.data.id}`);
  console.log('ticket de prueba BORRADO OK');
} else {
  console.log(`\nERROR creando ticket de prueba: HTTP ${ch.status} ${JSON.stringify(ch.data).slice(0, 300)}`);
}
