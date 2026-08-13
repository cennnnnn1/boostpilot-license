/* Shared structure for the Discord server (BoostPilot).
   Used by tools/discord-setup.mjs and tools/discord-ticket-bot.mjs */

const P = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  READ_MESSAGE_HISTORY: 1n << 22n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
};

export const bit = (n) => n.toString();

function modPerms() {
  return bit(
    P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_CHANNELS | P.MANAGE_MESSAGES | P.MODERATE_MEMBERS |
    P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | P.MENTION_EVERYONE | P.VIEW_AUDIT_LOG
  );
}

export const CUSTOMER_BITS =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | P.EMBED_LINKS |
  P.ATTACH_FILES | P.ADD_REACTIONS | P.CREATE_PUBLIC_THREADS | P.SEND_MESSAGES_IN_THREADS;
export const CUSTOMER_ALLOW = bit(CUSTOMER_BITS);
export const STAFF_ALLOW = bit(CUSTOMER_BITS | P.MANAGE_CHANNELS | P.MANAGE_MESSAGES | P.MENTION_EVERYONE);
export const EVERYONE_DENY = bit(P.VIEW_CHANNEL);

export const GAMES = [
  ['valorant', 'Valorant', '🎮'],
  ['league', 'League of Legends', '🎮'],
  ['brawl', 'Brawl Stars', '🎮'],
  ['fc', 'EA Sports FC', '🎮'],
  ['clash', 'Clash Royale', '🎮'],
  ['rl', 'Rocket League', '🎮'],
  ['fortnite', 'Fortnite', '🎮'],
  ['osrs', 'OSRS', '🎮'],
  ['r6', 'R6 Siege', '🎮'],
  ['marvel', 'Marvel Rivals', '🎮'],
  ['apex', 'Apex Legends', '🎮'],
  ['cod', 'Call of Duty', '🎮'],
];

export const gameChannelName = ([slug, display, emoji]) => emoji + display.toLowerCase().replace(/[^a-z0-9]+/g, '');

export const ROLE_ORDER = ['Owner', 'Admin', 'Mod', 'VIP', 'Booster', 'Customer', 'Member', 'Bot'];

export const ROLE_DEFS = [
  { name: '👑 Owner', color: 0xe0315c, hoist: true,  permissions: '8' },
  { name: '🛡️ Admin', color: 0xe0315c, hoist: true,  permissions: '8' },
  { name: '🎖️ Mod',   color: 0xf59f00, hoist: true,  permissions: modPerms() },
  { name: '💎 VIP',    color: 0xb197fc, hoist: true,  permissions: '0' },
  { name: '🌟 Booster', color: 0x40c057, hoist: true, permissions: '0' },
  { name: '🎁 Customer', color: 0xff6a8a, hoist: false, permissions: '0' },
  { name: '🧑 Member',  color: 0x51cf66, hoist: false, permissions: '0' },
  { name: '🤖 BoostPilot', color: 0xff6a8a, hoist: false, permissions: '8', bot: true },
];

export function customerOverwrites(roleIds, guildId) {
  const rows = [{ id: guildId || '@everyone', type: 0, allow: '0', deny: EVERYONE_DENY }];
  for (const key of ['Customer', 'VIP', 'Booster']) {
    if (roleIds[key]) rows.push({ id: roleIds[key], type: 0, allow: CUSTOMER_ALLOW, deny: '0' });
  }
  return rows;
}

export function staffOverwrites(roleIds, guildId) {
  const rows = [{ id: guildId || '@everyone', type: 0, allow: '0', deny: EVERYONE_DENY }];
  for (const key of ['Mod', 'Admin']) {
    if (roleIds[key]) rows.push({ id: roleIds[key], type: 0, allow: STAFF_ALLOW, deny: '0' });
  }
  return rows;
}

export function ticketOverwrites(roleIds, userId, guildId) {
  return [
    { id: guildId || '@everyone', type: 0, allow: '0', deny: bit(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY) },
    { id: userId, type: 1, allow: CUSTOMER_ALLOW, deny: '0' },
    ...staffOverwrites(roleIds, guildId).slice(1),
  ];
}

export const CATEGORIES = (roleIds) => [
  {
    name: '📌 INFORMATION', type: 4, public: true,
    channels: [
      { name: 'announcements', type: 0 },
      { name: 'faq', type: 0 },
    ],
  },
  {
    name: '🛒 Store', type: 4, public: true,
    channels: [
      { name: '⭐reviews', type: 0 },
      { name: '📖how-it-works', type: 0 },
      ...GAMES.map((g) => ({ name: gameChannelName(g), type: 0 })),
    ],
  },
  {
    name: '🎫 TICKETS', type: 4, public: false, overwrites: customerOverwrites(roleIds),
    channels: [
      { name: 'open-ticket', type: 0 },
    ],
  },
];

export const TICKET_BUTTONS = [
  { type: 2, custom_id: 'bp_ticket', label: 'Create Ticket', style: 3, emoji: { name: '🎟️' } },
  { type: 2, custom_id: 'bp_ticket_purchase', label: 'Purchase', style: 4, emoji: { name: '🛒' } },
];

export const TICKET_MOTIVES = {
  bp_ticket: '🎟️ Create Ticket / Buy',
  bp_ticket_purchase: '🛒 Purchase / Buy',
};

export const PINK = 0xff6a8a;
