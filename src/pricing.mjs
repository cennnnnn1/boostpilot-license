import fs from 'fs/promises';

const DEFAULT_DELIVERY = {
  Minute20: 0.34, Hour1: 1, Hour2: 2, Hour3: 3, Hour5: 5, Hour8: 8, Hour12: 12,
  Day1: 24, Day2: 48, Day3: 72, Day7: 168, Day14: 336, Day28: 672, Day45: 1080,
};

const ROMANS = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

export function roundPrice(price) {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (price < 5) return Math.round(price * 2) / 2;
  if (price < 50) return Math.round(price);
  if (price < 200) return Math.round(price / 5) * 5;
  return Math.round(price / 10) * 10;
}

function romanNum(s) {
  const u = String(s || '').toUpperCase();
  if (ROMANS[u] != null) return ROMANS[u];
  return null;
}

function toNumber(t) {
  const n = Number(String(t || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return String(n ?? '');
  const neg = n < 0;
  const s = String(Math.round(Math.abs(n)));
  return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtEta(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) {
    const h = Math.round(hours * 10) / 10;
    return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  }
  const d = hours / 24;
  return d % 1 === 0 ? `${d} day${d > 1 ? 's' : ''}` : `${d.toFixed(1)} day${d > 1 ? 's' : ''}`;
}

function deliveryCodeForHours(hours, cfg) {
  const map = Object.entries((cfg && cfg.delivery) || DEFAULT_DELIVERY).sort((a, b) => a[1] - b[1]);
  if (!map.length) return 'Day3';
  let best = map[0][0];
  let bestDiff = Infinity;
  for (const [code, maxH] of map) {
    const diff = Math.abs(hours - maxH);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = code;
    }
  }
  return best;
}

const CATEGORY_ALIASES = { 'prestige icon': 'Prestigios', 'brawlers rank': 'Rank Brawler' };

function matchCategory(category, gameCfg) {
  const cat = String(category || '').trim();
  if (!cat) return null;
  if (gameCfg[cat]) return gameCfg[cat];
  const low = cat.toLowerCase();
  const alias = CATEGORY_ALIASES[low];
  if (alias && gameCfg[alias]) return gameCfg[alias];
  const keys = Object.keys(gameCfg);
  for (const k of keys) {
    if (k.toLowerCase() === low) return gameCfg[k];
  }
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (low.includes(kl) || kl.includes(low)) return gameCfg[k];
  }
  return null;
}

function multipliersFromText(text, multipliers) {
  if (!multipliers) return 1;
  const t = String(text || '');
  let mult = 1;
  for (const [key, value] of Object.entries(multipliers)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const re = new RegExp(String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(t)) mult *= n;
  }
  return mult;
}

function rankList(tiers) {
  const list = [];
  for (const t of tiers || []) {
    if (!t || !t.name) continue;
    if (t.skip) {
      list.push({ tier: t.name, div: null, label: t.name, tierCfg: t, price: 0, hours: 0, skip: true });
      continue;
    }
    const divs = Math.max(t.divisions || t.divisionsPerTier || 1, 1);
    for (let d = 1; d <= divs; d++) {
      const label = divs > 1 ? `${t.name} ${['I', 'II', 'III', 'IV', 'V'][d - 1] || d}` : t.name;
      list.push({
        tier: t.name,
        div: d,
        label,
        tierCfg: t,
        price: Number(t.pricePerDivision || 0),
        hours: Number(t.hoursPerDivision || 0),
        skip: false,
      });
    }
  }
  return list;
}

function rankIndex(text, list) {
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  let i = list.findIndex((x) => x.label.toLowerCase() === raw.toLowerCase());
  if (i >= 0) return i;
  for (let j = 0; j < list.length; j++) {
    if (!list[j].skip && list[j].tier.toLowerCase() === raw.toLowerCase()) {
      let k = j;
      while (k > 0 && !list[k - 1].skip && list[k - 1].tier === list[j].tier) k--;
      return k;
    }
  }
  const m = raw.match(/^([a-z]+)\s*([ivx]+)$/i);
  if (m) {
    const div = romanNum(m[2]);
    if (div != null) {
      const k = list.findIndex((x) => !x.skip && x.tier.toLowerCase() === m[1].toLowerCase() && x.div === div);
      if (k >= 0) return k;
    }
  }
  return null;
}

function parseRankRange(text) {
  const cur = (String(text || '').match(/current rank\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  const des = (String(text || '').match(/desired rank\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  return { current: cur ? cur.trim() : null, desired: des ? des.trim() : null };
}

function computeSegments(cfg, from, to) {
  const segs = cfg.segments || [];
  if (!segs.length) return null;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (lo === hi) return null;
  let price = 0;
  let hours = 0;
  let covered = 0;
  for (const s of segs) {
    const sFrom = Number(s.from ?? 0);
    const sTo = Number(s.to ?? Infinity);
    const per = Number(s.per || 1);
    const start = Math.max(lo, sFrom);
    const end = Math.min(hi, sTo);
    if (end <= start) continue;
    const count = end - start;
    const units = count / per;
    price += units * Number(s.price || 0);
    hours += units * Number(s.hours || 0);
    covered += count;
  }
  if (covered <= 0) return null;
  return { price, hours, from: lo, to: hi, detail: `${hi - lo} (${lo}->${hi})` };
}

function computeTiers(cfg, text) {
  const list = rankList(cfg.tiers);
  if (!list.length) return null;
  const { current, desired } = parseRankRange(text);
  const ci = rankIndex(current, list);
  const di = rankIndex(desired, list);
  if (ci == null || di == null || ci === di) return null;
  const lo = Math.min(ci, di);
  const hi = Math.max(ci, di);
  for (let k = lo; k <= hi; k++) {
    if (list[k].skip) return { skipTier: list[k].tier };
  }
  const range = list.slice(lo + 1, hi + 1);
  const price = range.reduce((s, x) => s + x.price, 0);
  const hours = range.reduce((s, x) => s + x.hours, 0);
  if (price <= 0) return null;
  return {
    price,
    hours,
    detail: `${current} -> ${desired}`,
  };
}

const PHASE_TARGET = { 1: 1000, 2: 2000, 3: 3000 };
const PHASE_TROPHY = { 1000: 1, 2000: 2, 3000: 3 };

function brawlPrestigeBand(text, tr) {
  const desired = tr.desired;
  const current = tr.current;
  if (desired == null) return null;
  if (desired > 2000 && desired <= 3000) {
    return { from: current != null ? current : 2000, to: desired, bandFrom: 2000, bandTo: 3000, label: 'p2 a p3' };
  }
  if (desired >= 1000 && desired <= 2000 && current != null && current >= 1000 && current < desired) {
    return { from: current, to: desired, bandFrom: 1000, bandTo: 2000, label: 'p1 a p2' };
  }
  return null;
}

function bandCovered(segs, bandFrom, bandTo) {
  return (segs || []).some((s) => Number(s.price || 0) > 0 && Number(s.from ?? 0) <= bandFrom && Number(s.to ?? Infinity) >= bandTo);
}
const SKIP_RE = /\b(vendo|vender|vende|venta|venderla|cambio|intercambi|trad(?:e|ing)|selling|sell\b|sale\b|for sale|wanna sell|quiero vender)\b/i;

const BRAWLER_NAMES = [
  '8-bit', '8bit', 'alli', 'amber', 'angelo', 'ash', 'barley', 'bea', 'belle', 'bell', 'berry',
  'bibi', 'bo', 'bolt', 'bonnie', 'brock', 'bull', 'buster', 'buzz', 'byron', 'carl', 'charlie',
  'chester', 'chuck', 'clancy', 'colette', 'colt', 'cordelius', 'crow', 'damian', 'darryl', 'doug',
  'draco', 'dynamike', 'dyna', 'edgar', 'el primo', 'emz', 'eve', 'fang', 'finx', 'frank', 'gale',
  'gene', 'gigi', 'glowy', 'gray', 'griff', 'grom', 'gus', 'hank', 'jacky', 'jae-yong', 'janet',
  'jessie', 'juju', 'kaze', 'kenji', 'kit', 'larry', 'lawrie', 'larry & lawrie', 'larry&lawrie',
  'l&l', 'leon', 'lily', 'lola', 'lou', 'lumi', 'maisie', 'mandy', 'max', 'meeple', 'meg',
  'melodie', 'mico', 'mina', 'moe', 'mortis', 'mr. p', 'mr p', 'najia', 'nani', 'nita', 'nori',
  'ollie', 'otis', 'pam', 'pearl', 'penny', 'pierce', 'piper', 'poco', 'r-t', 'rt', 'rico', 'rosa',
  'ruffs', 'sam', 'sandy', 'shade', 'shelly', 'sirius', 'spike', 'sprout', 'squeak', 'star nova',
  'starr nova', 'stu', 'surge', 'tara', 'tick', 'trunk', 'wendy', 'willow', 'ziggy',
];

const BRAWLER_RE = new RegExp(`\\b(${BRAWLER_NAMES.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

export function hasBrawlerName(text) {
  const t = String(text || '');
  if (/\bspecific\s+brawlers?\b/i.test(t)) return true;
  return BRAWLER_RE.test(t);
}


function isRankRangeRequest(text) {
  const t = String(text || '');
  if (/\b\d{2,4}k?\s*elo\b/i.test(t)) return true;
  const range = t.match(/\b(\d{3,4}k?)\s*(?:-|a|to|hasta|al)\s*(\d{3,4}k?)\b/i);
  if (range) {
    const a = parseNumber(range[1]);
    const b = parseNumber(range[2]);
    if ((a != null && a > 3000) || (b != null && b > 3000)) return true;
  }
  const from = t.match(/\b(?:at|from|current(?:ly)?|now|estoy|tengo|va\s+por|en)\b[^\d]{0,20}(\d{3,4}k?)\b[\s\S]{0,20}?(?:to|hasta|al|goal|target)\s+(\d{3,4}k?)\b/i);
  if (from) {
    const a = parseNumber(from[1]);
    const b = parseNumber(from[2]);
    if ((a != null && a > 3000) || (b != null && b > 3000)) return true;
  }
  return false;
}

function parseNumber(s) {
  const m = String(s || '').trim().match(/^([\d.,]+)\s*(k)?$/i);
  if (!m) return null;
  let v = Number(m[1].replace(/,/g, ''));
  if (m[2]) v *= 1000;
  return Number.isFinite(v) ? v : null;
}

function prestigePhases(text) {
  const t = String(text || '');
  const set = new Set();
  for (let n = 1; n <= 3; n++) {
    if (new RegExp(`\\b(?:p|prestig(?:e|io))\\s*${n}\\b`, 'i').test(t)) set.add(n);
    if (new RegExp(`\\b${n}\\s*[-aá]\\s*${n + 1}\\b`, 'i').test(t)) set.add(n + 1);
  }
  if (!set.size) {
    const m = t.match(/(\d{3,4})\s*(?:-|a|hasta|al)\s*(\d{3,4})/);
    if (m) {
      if (PHASE_TROPHY[Number(m[1])]) set.add(PHASE_TROPHY[Number(m[1])]);
      if (PHASE_TROPHY[Number(m[2])]) set.add(PHASE_TROPHY[Number(m[2])]);
    }
  }
  if (!set.size) {
    const m = t.match(/\b([123])k\s*(?:-|a|to|hasta|al)\s*([123])k\b/i);
    if (m) {
      set.add(Number(m[1]));
      set.add(Number(m[2]));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function hasPrestigePhrase(text) {
  return /\b(?:p|prestig(?:e|io|ing))\s*[1-9]\b/i.test(String(text || ''));
}

function explicitTarget(text) {
  const t = String(text || '');
  const out = { current: null, desired: null };
  const cur = t.match(/\bcurrent\s+(?:brawler\s+)?(?:troph(?:y|ies)(?:\s+count)?|rank)\s*:?\s*([\d.,]+k?)/i);
  if (cur) out.current = parseNumber(cur[1]);
  const des = t.match(/\bdesired\s+(?:brawler\s+)?(?:troph(?:y|ies)(?:\s+count)?|rank)\s*:?\s*([\d.,]+k?)/i);
  if (des) out.desired = parseNumber(des[1]);
  if (out.desired == null) {
    const to = t.match(/\b(?:to|hasta|al|goal|target)\s+([\d.,]+k?)\b/i);
    if (to) out.desired = parseNumber(to[1]);
  }
  const range = t.match(/\b(\d[\d.,]*k?)\s*(?:-|a|to|hasta|al)\s*(\d[\d.,]*k?)\b/i);
  if (range) {
    if (out.current == null) out.current = parseNumber(range[1]);
    if (out.desired == null) out.desired = parseNumber(range[2]);
  }
  return out;
}

function currentTrophies(text, exclude) {
  const t = String(text || '');
  const anchor = t.match(/\b(?:current|from|now\s*(?:at)?|currently\s*(?:at|in)?|ahora\s*(?:est[aá]?)?\s*(?:en)?|est[aá]\s+en|va\s+por|tiene|tengo|en\s+el|en\s+la|at|de|hasta|in)\b\s*[^\d]*?(\d[\d.,]*k?)/i);
  if (anchor) {
    const n = parseNumber(anchor[1]);
    if (n != null && n >= 100 && n <= 3000) return n;
  }
  const post = t.match(/(\d[\d.,]*k?)\s*(?:currently|ahora|rn|right\s+now)/i);
  if (post) {
    const n = parseNumber(post[1]);
    if (n != null && n >= 100 && n <= 3000) return n;
  }
  let best = null;
  const re = /\b(\d[\d.,]*k?)\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const n = parseNumber(m[1]);
    if (n != null && n >= 500 && n <= 3000 && n !== exclude && (best == null || n < best)) best = n;
  }
  return best;
}

function brawlerCount(text) {
  const t = String(text || '');
  const m = t.match(/(\d+)\s*(?:brawlers?|personajes?|personas?|cuentas?)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 100) return n;
  }
  return 1;
}

function brawlerRankNumbers(text) {
  const nums = [];
  const re = /\b(\d{3,4})\b/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const n = Number(m[1]);
    if (n >= 1000 && n <= 4000) nums.push(n);
  }
  return nums;
}

function budgetFromText(text) {
  const t = String(text || '');
  const m = t.match(/\$([\d.,]+)|\b(?:usd|dollars|bucks|dolares|dólares|presupuesto|budget)\b\s*:?\s*\$?\s*([\d.,]+)|([\d.,]+)\s*(?:usd|dollars|bucks|dólares|dolares)\b|([\d.,]+)\s*\$|\b(?:for|por)\s*\$?\s*([\d.,]+)\s*(?:usd|dollars|bucks|dólares|dolares)\b/i);
  if (!m) return null;
  const raw = m.slice(1).find((x) => x != null) || '';
  const n = parseNumber(raw);
  return n != null && n > 0 && n < 100000 ? n : null;
}

function configFloor(segs) {
  let floor = 0;
  for (const s of segs) {
    const v = Number(s.minPrice || 0);
    if (v > 0 && (floor === 0 || v < floor)) floor = v;
  }
  return floor;
}

function proportionalForRange(segs, from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  let price = 0;
  let hours = 0;
  for (const s of segs) {
    const sFrom = Number(s.from ?? 0);
    const sTo = Number(s.to ?? Infinity);
    const per = Number(s.per || 1);
    const start = Math.max(lo, sFrom);
    const end = Math.min(hi, sTo);
    if (end <= start) continue;
    const count = end - start;
    price += (count / per) * Number(s.price || 0);
    hours += (count / per) * Number(s.hours || 0);
  }
  return { price, hours };
}

export function computePrice({ game, category, description, config } = {}) {
  const pricing = (config && config.bot && config.bot.pricing) || {};
  if (!pricing.enabled) return null;
  const gameCfg = pricing.games && pricing.games[game];
  if (!gameCfg) return null;
  const text = String(description || '');
  let catCfg = matchCategory(category, gameCfg);
  if (!catCfg) return null;
  if (catCfg.mode === 'segments' && gameCfg.Prestigios && hasPrestigePhrase(text) &&
      catCfg !== gameCfg.Prestigios && catCfg !== gameCfg['Rank Brawler']) {
    catCfg = gameCfg.Prestigios;
  }
  if (game === 'brawl_stars' && catCfg === gameCfg['Trophy Boost'] && hasBrawlerName(text)) {
    return { ok: false, reason: 'menciona brawler en categoria trofeos (se salta)' };
  }
  if (catCfg.enabled === false) return { ok: false, reason: 'categoría desactivada (se salta)' };

  if (SKIP_RE.test(text)) return { ok: false, reason: 'posible venta/intercambio de cuenta' };
  if (isRankRangeRequest(text)) return { ok: false, reason: 'rango/ELO detectado (no se cotiza como trofeos)' };
  let out = null;
  let segFrom = null;
  let segTo = null;

  if (game === 'brawl_stars' && catCfg.mode === 'segments' && catCfg === gameCfg['Trophy Boost']) {
    const prestige = gameCfg.Prestigios || gameCfg['Rank Brawler'] || null;
    const band = brawlPrestigeBand(text, explicitTarget(text));
    if (prestige && prestige.mode === 'segments' && band) {
      if (prestige.enabled === false) return { ok: false, reason: 'categoría desactivada (se salta)' };
      if (!bandCovered(prestige.segments, band.bandFrom, band.bandTo)) {
        return { ok: false, reason: `sin segmento ${band.label} en prestigio (se salta)` };
      }
      catCfg = prestige;
      segFrom = band.from;
      segTo = band.to;
    }
  }

  if (catCfg.mode === 'segments') {
    const from = segFrom != null ? segFrom : toNumber((text.match(/current (?:brawler )?troph(?:y|ies)(?: count)?\s*[:]?\s*([\d.,]+)/i) || [])[1]);
    const to = segTo != null ? segTo : toNumber((text.match(/desired (?:brawler )?troph(?:y|ies)(?: count)?\s*[:]?\s*([\d.,]+)/i) || [])[1]);
    if (from == null || to == null) return null;
    if (to < from) return null;
    const segMax = Math.max(0, ...(catCfg.segments || []).map((s) => (s.to != null ? Number(s.to) : 0)));
    if (to > segMax) return { ok: false, reason: 'rango por encima del máximo configurado (se salta)', to };
    segFrom = from;
    segTo = to;
    out = computeSegments(catCfg, from, to);
    if (!out) return null;
  } else if (catCfg.mode === 'tiers') {
    const t = computeTiers(catCfg, text);
    if (!t) return null;
    if (t.skipTier) return { ok: false, reason: `rango incluye ${t.skipTier} (sin precio automatico)` };
    out = t;
  } else {
    return null;
  }

  const mult = multipliersFromText(text, catCfg.multipliers);
  let price = out.price * mult;
  let hours = out.hours * mult;

  const hasSegHours = (catCfg.segments || []).some((s) => s.hours != null && Number(s.hours) > 0);
  let segPace = null;
  if (catCfg.mode === 'segments' && segFrom != null && segTo != null && !catCfg.useSegmentHours && !hasSegHours) {
    segPace = Number(catCfg.pacePerDay != null ? catCfg.pacePerDay : (pricing.pacePerDay != null ? pricing.pacePerDay : 1500));
    const total = Math.abs(segTo - segFrom);
    hours = (total / Math.max(1, segPace)) * 24 * mult;
  }

  const roundTo = pricing.roundTo != null ? Number(pricing.roundTo) : 0.01;
  if (roundTo > 0 && roundTo !== 0.01) {
    const factor = Math.max(1, Math.round(1 / roundTo));
    price = Math.round((price + Number.EPSILON) * factor) / factor;
  } else {
    price = roundPrice(price);
  }
  if (catCfg.mode === 'segments') {
    const floor = configFloor(catCfg.segments || []);
    if (floor > 0) price = Math.max(price, floor);
  }
  if (!Number.isFinite(price) || price <= 0) return null;

  const deliveryTime = deliveryCodeForHours(hours, pricing);
  const etaLabel = fmtEta(hours);

  let note;
  if (catCfg.mode === 'segments' && segFrom != null && segTo != null) {
    const total = Math.abs(segTo - segFrom);
    if (!catCfg.useSegmentHours && !hasSegHours) {
      note = `precio sugerido: ${fmtNum(total)} trofeos (${fmtNum(segFrom)} -> ${fmtNum(segTo)})${mult !== 1 ? ' x' + mult : ''} | ~${etaLabel} | ritmo ${fmtNum(segPace || 1500)}/dia`;
    } else {
      note = `precio sugerido: ${fmtNum(total)} trofeos (${fmtNum(segFrom)} -> ${fmtNum(segTo)})${mult !== 1 ? ' x' + mult : ''} | ~${etaLabel}`;
    }
  } else {
    note = `precio sugerido (${out.detail}${mult !== 1 ? ' x' + mult : ''})`;
  }

  return {
    ok: true,
    price,
    hours,
    deliveryTime,
    etaLabel,
    multiplier: mult,
    detail: out.detail,
    from: out.from != null ? out.from : null,
    to: out.to != null ? out.to : null,
    note,
  };
}

export function interpretDescription({ game, category, description, config } = {}) {
  const pricing = (config && config.bot && config.bot.pricing) || {};
  if (!pricing.enabled) return null;
  const gameCfg = pricing.games && pricing.games[game];
  if (!gameCfg) return null;
  let catCfg = matchCategory(category, gameCfg);
  if (catCfg && catCfg.mode === 'segments' && gameCfg.Prestigios && hasPrestigePhrase(description) &&
      catCfg !== gameCfg.Prestigios && catCfg !== gameCfg['Rank Brawler']) {
    catCfg = gameCfg.Prestigios;
  }
  if (game === 'brawl_stars' && catCfg && catCfg.mode === 'segments' && catCfg === gameCfg['Trophy Boost']) {
    const prestige = gameCfg.Prestigios || gameCfg['Rank Brawler'] || null;
    const band = brawlPrestigeBand(String(description || ''), explicitTarget(String(description || '')));
    if (prestige && band) {
      if (prestige.enabled === false) return { ok: false, reason: 'categoría desactivada (se salta)' };
      if (!bandCovered(prestige.segments, band.bandFrom, band.bandTo)) {
        return { ok: false, reason: `sin segmento ${band.label} en prestigio (se salta)` };
      }
      catCfg = prestige;
    }
  }
  if (!catCfg && game === 'brawl_stars') catCfg = gameCfg.Prestigios || null;
  if (!catCfg || catCfg.mode !== 'segments') return null;
  if (catCfg.enabled === false) return { ok: false, reason: 'categoría desactivada (se salta)' };
  const segs = (catCfg.segments || []).filter((s) => Number(s.price || 0) > 0);
  if (!segs.length) return null;

  const text = String(description || '');
  if (SKIP_RE.test(text)) {
    return { ok: false, reason: 'posible venta/intercambio de cuenta' };
  }
  if (isRankRangeRequest(text)) {
    return { ok: false, reason: 'rango/ELO detectado (no se cotiza como trofeos)' };
  }
  if (game === 'brawl_stars' && catCfg === gameCfg['Trophy Boost'] && hasBrawlerName(text)) {
    return { ok: false, reason: 'menciona brawler en categoria trofeos (se salta)' };
  }
  const segMax = Math.max(0, ...(catCfg.segments || []).map((s) => (s.to != null ? Number(s.to) : 0)));
  if (hasBrawlerName(text) && brawlerRankNumbers(text).some((n) => n > segMax)) {
    return { ok: false, reason: 'rango por encima del máximo configurado (se salta)' };
  }

  const phases = prestigePhases(text);
  let explicit = explicitTarget(text);
  const targetPhase = phases.length ? Math.max(...phases) : null;
  const phaseTarget = targetPhase != null ? PHASE_TARGET[targetPhase] : null;

  if (targetPhase != null && explicit.current == null && explicit.desired == null) {
    let sourcePhase = phases.length >= 2 ? Math.min(...phases) : null;
    if (sourcePhase == null) {
      const from = text.match(/\b(?:from|desde|de|start(?:ing|ed)?|empez(?:ando)?|current|actual|va\s+por|estoy\s+en)\b[^,;()]*\b(p|prestig(?:e|io))\s*([1-3])\b/i);
      if (from) sourcePhase = Number(from[2]);
    }
    if (sourcePhase != null && sourcePhase < targetPhase) explicit.current = PHASE_TARGET[sourcePhase];
  }

  const currentValid = explicit.current != null && explicit.current >= 1000;
  const desiredSmall = explicit.desired != null && explicit.desired < 1000;
  if (targetPhase != null && !currentValid && desiredSmall) {
    explicit = { current: null, desired: null };
  }

  let target = null;
  if (explicit.desired != null && (explicit.current == null || explicit.desired > explicit.current)) target = explicit.desired;
  if (target == null) target = phaseTarget;
  if (!target || target <= 0) return null;

  let current = explicit.current != null ? explicit.current : currentTrophies(text, target);
  if (current != null && explicit.desired != null && explicit.desired <= current && phaseTarget != null && phaseTarget > current) {
    target = phaseTarget;
  }
  if (current != null && current >= target) return { ok: false, reason: 'ya alcanzado el objetivo' };
  if (target > segMax) return { ok: false, reason: 'rango por encima del máximo configurado (se salta)' };
  const count = brawlerCount(text);
  const mult = multipliersFromText(text, catCfg.multipliers);
  const roundTo = pricing.roundTo != null ? Number(pricing.roundTo) : 0.01;
  const factor = Math.max(1, Math.round(1 / roundTo));

  let price;
  let hours;
  let budgetMatch = false;
  if (current != null) {
    const p = proportionalForRange(segs, current, target);
    price = p.price * count;
    hours = p.hours * count;
  } else {
    const budget = budgetFromText(text);
    if (budget == null) return null;
    price = budget;
    hours = proportionalForRange(segs, 1000, target).hours * count;
    budgetMatch = true;
  }

  price *= mult;
  hours *= mult;

  const floor = current != null ? configFloor(segs) : 0;
  if (floor > 0 && current != null) price = Math.max(price, floor);

  const budget = budgetFromText(text);
  if (budget != null && budget > 0) price = Math.min(price, budget);

  if (roundTo > 0 && roundTo !== 0.01) {
    price = Math.round((price + Number.EPSILON) * factor) / factor;
  } else {
    price = roundPrice(price);
  }
  if (!Number.isFinite(price) || price <= 0) return null;

  const deliveryTime = deliveryCodeForHours(hours, pricing);
  const etaLabel = fmtEta(hours);
  const missing = current != null ? target - current : null;

  const parts = [`interpretado: ${targetPhase != null ? `fase ${targetPhase} ` : ''}${current != null ? `(${fmtNum(current)} -> ${fmtNum(target)})` : `a ${fmtNum(target)}`}`];
  if (missing != null) parts.push(`${fmtNum(missing)} trofeos faltan`);
  if (count > 1) parts.push(`${count} brawlers`);
  if (mult !== 1) parts.push(`x${mult}`);
  parts.push(`~${etaLabel}`);
  if (budgetMatch) parts.push('presupuesto del cliente');
  else if (budget != null) parts.push(`max $${budget}`);

  return {
    ok: true,
    price,
    hours,
    deliveryTime,
    etaLabel,
    multiplier: mult,
    detail: current != null ? `${targetPhase != null ? `fase ${targetPhase}: ` : ''}${fmtNum(current)} -> ${fmtNum(target)}` : `${targetPhase != null ? `fase ${targetPhase}: ` : ''}a ${fmtNum(target)}`,
    from: current,
    to: target,
    note: parts.join(' | '),
    budgetMatch: !!budgetMatch,
  };
}

export async function loadPricingFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export { matchCategory };
