export const ETA_OPTIONS = [
  '20 min', '1 h', '2 h', '3 h', '5 h', '8 h', '12 h',
  '1 day', '2 days', '3 days', '7 days', '14 days', '28 days', '45 days', '60 days',
];

export const ETA_MAP = {
  '12h': '12 h',
  '1 day': '1 day',
  '1-2 days': '2 days',
  '1-3 days': '3 days',
  '2-3 days': '3 days',
  '2-4 days': '3 days',
  '3-5 days': '7 days',
  '1 week': '7 days',
  'same day': '1 day',
  'per session': '2 h',
};

export function resolveEta(eta) {
  if (ETA_OPTIONS.includes(eta)) return eta;
  return ETA_MAP[eta] || '2 days';
}

export function detectGame(text, games) {
  const t = text.toLowerCase();
  const entries = Object.entries(games).filter(([, cfg]) => cfg.enabled !== false);

  let best = null;
  let bestScore = 0;
  for (const [name, cfg] of entries) {
    for (const alias of cfg.names || []) {
      if (t.includes(alias.toLowerCase())) {
        const score = alias.length;
        if (score > bestScore) {
          bestScore = score;
          best = { name, cfg };
        }
      }
    }
  }
  if (best) return best;

  best = null;
  bestScore = 0;
  for (const [name, cfg] of entries) {
    for (const alias of cfg.aliases || []) {
      if (t.includes(alias.toLowerCase())) {
        const score = alias.length;
        if (score > bestScore) {
          bestScore = score;
          best = { name, cfg };
        }
      }
    }
  }
  return best;
}

const CUSTOM_RANK_WORDS = 'pro|masters?|mythic|legendary|diamond|platinum|gold|silver|bronze|champion|grandmaster|radiant|immortal|ascendant|predator|ultimate|challenger|royal|elite';

export function hasCustomRange(text) {
  const t = String(text || '');
  if (/\b(?:p|prestig(?:e|io|ing))\s*[1-9]\b/i.test(t)) return true;
  const rw = `\\b(?:${CUSTOM_RANK_WORDS})\\b`;
  if (new RegExp(`${rw}[\\s\\S]*?(?:to|->|→|hasta|al)\\s+${rw}`, 'i').test(t)) return true;
  if (new RegExp(`${rw}\\s*[1-9]\\b`, 'i').test(t)) return true;
  if (/\b(?:elo|mmr)\b/i.test(t)) return true;
  if (/\brank(?:ed|ing)?\b/i.test(t)) return true;
  return false;
}

export function detectPlatform(text) {
  const t = String(text || '').toLowerCase();
  const hits = [
    ['pc', /\bpc\b|\bdesktop\b|\bwindows\b|\bcomputer\b|\bmac\b|\bsteam\b/i],
    ['playstation', /\bplaystation\b|\bplay ?station\b|\bps[45]\b|\bpsn\b/i],
    ['xbox', /\bxbox\b|\bxb1\b|\bxbx\b/i],
    ['switch', /\bswitch\b|\bnintendo\b|\bwii\b|\bgame ?boy\b|\b3ds\b/i],
    ['mobile', /\bios\b|\bandroid\b|\bmobile\b|\bsmartphone\b|\bcelular\b|\biphone\b/i],
  ];
  let plat = null;
  for (const [key, re] of hits) {
    if (re.test(t)) {
      if (!plat) plat = key;
      else if (key === 'pc') { /* pc + otra plataforma -> cuenta la otra */ }
      else return key;
    }
  }
  return plat; // 'pc' | 'playstation' | 'xbox' | 'switch' | 'mobile' | null
}

export function applyFilters({ text, category, game } = {}, config) {
  const f = config.filters || {};
  if (!f.enabled) return { skip: false };
  const t = String(text || '').toLowerCase();
  const gameCfg = (game && config.bot && config.bot.pricing && config.bot.pricing.games && config.bot.pricing.games[game]) || {};
  if (/custom request/i.test(String(category || '')) && hasCustomRange(t)) {
    return { skip: true, reason: 'custom request con rango/prestigio' };
  }

  if (gameCfg.skipDuo !== false && /\bduo\b|duo queue|duos\b/i.test(t)) {
    return { skip: true, reason: 'duo' };
  }
  if (gameCfg.skipSquad !== false && /\bsquad\b|\bstack\b|5[- ]?stack\b|\btrio\b|\bparty\b|\bteams?\b|\bteammates?\b|\bequipos?\b|\bclub\b/i.test(t)) {
    return { skip: true, reason: 'squad' };
  }
  if (gameCfg.platforms && Object.keys(gameCfg.platforms).length > 0) {
    const plat = detectPlatform(t);
    if (plat && gameCfg.platforms[plat] === false) {
      return { skip: true, reason: `plataforma ${plat}` };
    }
  } else if (gameCfg.skipConsole !== false && /playstation|\bxbox\b|\bswitch\b|\bwii\b|\bnintendo\b|\bconsole\b/i.test(t)) {
    return { skip: true, reason: 'console' };
  }
  if (Array.isArray(f.skipKeywords)) {
    for (const kw of f.skipKeywords) {
      if (kw && t.includes(String(kw).toLowerCase())) {
        return { skip: true, reason: String(kw) };
      }
    }
  }
  if (Array.isArray(f.skipCategories)) {
    for (const cat of f.skipCategories) {
      if (cat && String(category || '').toLowerCase() === String(cat).toLowerCase()) {
        return { skip: true, reason: `categoria ${cat}` };
      }
    }
  }
  if (Array.isArray(f.onlyGames) && f.onlyGames.length) {
    const detected = detectGame(String(text || ''), config.games);
    if (detected && !f.onlyGames.includes(detected.name)) {
      return { skip: true, reason: `juego no habilitado (${detected.name})` };
    }
  }
  return { skip: false };
}

export function humanSummary(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
}
