const DEFAULT_DELIVERY = {
  Minute20: 0.34, Hour1: 1, Hour2: 2, Hour3: 3, Hour5: 5, Hour8: 8, Hour12: 12,
  Day1: 24, Day2: 48, Day3: 72, Day7: 168, Day14: 336, Day28: 672, Day45: 1080,
};

const DEFAULTS = {
  segments: { price: 5, per: 1000, hours: 8 },
  tiers: { pricePerDivision: 3, hoursPerDivision: 2, divisions: 3 },
  units: { pricePerUnit: 2, hoursPerUnit: 1 },
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

function fmtEta(hours, { hoursOnly } = {}) {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24 || hoursOnly) {
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

const CATEGORY_ALIASES = {
  'prestige icon': 'Prestigios', 'brawlers rank': 'Rank Brawler',
  'placement': 'Placements', 'placement matches': 'Placements', 'placements match': 'Placements',
  'net win': 'Net Wins', 'netwin': 'Net Wins', 'net wins match': 'Net Wins',
  'game': 'Games', 'games boost': 'Games', 'game boost': 'Games',
};

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
  const sorted = Object.entries(multipliers).sort((a, b) => String(b[0]).length - String(a[0]).length);
  for (const [key, value] of sorted) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(t)) mult *= n;
  }
  return mult;
}

function rankList(tiers, cfg) {
  const list = [];
  const reversed = cfg && cfg.divisionOrder === 'reversed';
  for (const t of tiers || []) {
    if (!t || !t.name) continue;
    if (t.skip) {
      list.push({ tier: t.name, div: null, label: t.name, tierCfg: t, price: 0, hours: 0, skip: true });
      continue;
    }
    const divs = Math.max(t.divisions || t.divisionsPerTier || 1, 1);
    for (let d = 1; d <= divs; d++) {
      const rv = reversed ? divs - d + 1 : d;
      const label = divs > 1 ? `${t.name} ${['I', 'II', 'III', 'IV', 'V'][rv - 1] || rv}` : t.name;
      list.push({
        tier: t.name,
        div: rv,
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
  const originalRaw = String(text || '').trim().replace(/\s+/g, ' ').replace(/\s+\d+\s*rr\b/i, '').trim();
  if (!originalRaw) return null;

  function findInList(raw) {
    if (!raw) return null;
    const low = raw.toLowerCase();
    const i = list.findIndex((x) => x.label.toLowerCase() === low);
    if (i >= 0) return i;
    for (let j = 0; j < list.length; j++) {
      if (!list[j].skip && list[j].tier.toLowerCase() === low) {
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
    const stripRank = (s) => String(s || '').trim().replace(/^(?:rank|division|div|tier|rango)\s+/i, '').toLowerCase();
    const sRaw = stripRank(raw);
    const k = list.findIndex((x) => {
      if (x.skip) return false;
      return stripRank(x.label) === sRaw || stripRank(x.tier) === sRaw;
    });
    if (k >= 0) {
      let g = k;
      while (g > 0 && !list[g - 1].skip && list[g - 1].tier === list[k].tier) g--;
      return g;
    }
    return null;
  }

  const direct = findInList(originalRaw);
  if (direct != null) return direct;

  const romanized = originalRaw.replace(/(\b[a-z]+)\s+(\d{1,2})\b/gi, (_, name, num) => {
    const n = Number(num);
    if (n >= 1 && n <= 10) return `${name} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1]}`;
    return `${name} ${num}`;
  });
  if (romanized !== originalRaw) {
    const rMatch = findInList(romanized);
    if (rMatch != null) return rMatch;
  }

  return null;
}

function parseRankRange(text) {
  const cur = (String(text || '').match(/current (?:rank|division)\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  const des = (String(text || '').match(/desired\s+(?:rank|division)\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1] ||
             (String(text || '').match(/game\s+level\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  return { current: cur ? cur.trim() : null, desired: des ? des.trim() : null };
}

function parseRR(text) {
  const t = String(text || '');
  const m = t.match(/(?:current\s+)?(?:rr|rating)\s*[:\s]*(\d{1,3})\b/i);
  if (m) {
    const before = t.slice(0, m.index);
    if (/(?:over|above|at\s+least|min(?:imum)?|under|below|desired|up\s+to)\s+$/i.test(before)) return null;
    if (/(?:over|above|at\s+least|min(?:imum)?|under|below|up\s+to)\s+(?:\d{1,3}\s*rr\s*)?$/i.test(before)) return null;
    const v = Number(m[1]);
    if (v > 100) return null;
    return Math.min(v, 99);
  }
  const m2 = t.match(/\b(\d{1,3})\s*rr\b/i);
  if (m2) {
    const before = t.slice(0, m2.index);
    if (/(?:over|above|at\s+least|min(?:imum)?|under|below|desired|up\s+to)\s+$/i.test(before)) return null;
    const v = Number(m2[1]);
    if (v > 100) return null;
    return Math.min(v, 99);
  }
  return null;
}

function parseDesiredRR(text) {
  const t = String(text || '');
  const m = t.match(/desired\s+(?:rr|rating)\s*[:\s]*(\d{1,3})\b/i);
  if (m) return (Number(m[1]) <= 100) ? Math.min(Number(m[1]), 99) : null;
  const m2 = t.match(/(?:up\s+to|to|al)\s+(\d{1,3})\s*rr\b/i);
  if (m2) return (Number(m2[1]) <= 100) ? Math.min(Number(m2[1]), 99) : null;
  const m3 = t.match(/(?:over|above|at\s+least|min(?:imum)?|under|below)\s+(\d{1,3})\s*rr\b/i);
  if (m3) return (Number(m3[1]) <= 100) ? Math.min(Number(m3[1]), 99) : null;
  const m4 = t.match(/(\d{1,3})\s*\+\s*rr\b/i);
  if (m4) return (Number(m4[1]) <= 100) ? Math.min(Number(m4[1]), 99) : null;
  return null;
}

const RR_PER_WIN = { iron: 25, bronze: 25, silver: 25, gold: 25, platinum: 20, diamond: 15, ascendant: 15, immortal: 12 };

function computeRRBoost(cfg, text, currentRank) {
  const curRR = parseRR(text);
  const desRR = parseDesiredRR(text);
  if (curRR == null || desRR == null || desRR <= curRR) return null;
  const rrNeeded = desRR - curRR;
  const rankName = String(currentRank || '').toLowerCase().replace(/\s*[ivx]+.*$/i, '');
  const rrPerWin = RR_PER_WIN[rankName] || 15;
  const winsNeeded = Math.ceil(rrNeeded / rrPerWin);
  const netWinsCfg = cfg['Net Wins'];
  if (!netWinsCfg || netWinsCfg.enabled === false) return null;
  const pricePerWin = Number(netWinsCfg.pricePerUnit || 0);
  const hoursPerWin = Number(netWinsCfg.hoursPerUnit || 0);
  if (pricePerWin <= 0) return null;
  const price = winsNeeded * pricePerWin;
  const hours = winsNeeded * hoursPerWin;
  return {
    price,
    hours,
    detail: `RR boost ${curRR}→${desRR} (${rrNeeded} rr, ~${winsNeeded} wins)`,
    rrBoost: true,
  };
}

function computeSegments(cfg, from, to) {
  let segs = cfg.segments || [];
  if (!segs.length) {
    const d = DEFAULTS.segments;
    segs = [{ from: 0, to: 100000, per: d.per, price: d.price, hours: d.hours }];
  }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (lo === hi) return null;
  let price = 0;
  let hours = 0;
  let covered = 0;
  for (const s of segs) {
    const sFrom = Number(s.from ?? 0);
    const sTo = Number(s.to ?? Infinity);
    const per = (Number(s.per) > 0) ? Number(s.per) : ((Number(cfg.per) > 0) ? Number(cfg.per) : 1);
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
  const pace = Number(cfg.pacePerDay);
  if (pace > 0) hours = (hi - lo) / pace;
  return { price, hours, from: lo, to: hi, detail: `${hi - lo} (${lo}->${hi})` };
}

function computeTiers(cfg, text, gameCfg) {
  let list = rankList(cfg.tiers, cfg);
  if (!list.length) {
    const d = DEFAULTS.tiers;
    const defTiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master'].map((n) => ({
      name: n, pricePerDivision: d.pricePerDivision, hoursPerDivision: d.hoursPerDivision, divisions: d.divisions,
    }));
    list = rankList(defTiers, cfg);
  }
  if (!list.length) return null;
  const { current, desired } = parseRankRange(text);
  const ci = rankIndex(current, list);
  const di = rankIndex(desired, list);
  if (ci == null) return null;
  if (di == null) return { emptyDesired: true, detail: `${current || '?'} -> ?` };
  if (ci === di) {
    return computeRRBoost(gameCfg || cfg, text, current) || null;
  }
  const lo = Math.min(ci, di);
  const hi = Math.max(ci, di);
  for (let k = lo; k <= hi; k++) {
    if (list[k].skip) return { skipTier: list[k].tier };
  }
  const range = list.slice(lo + 1, hi + 1);
  let price = range.reduce((s, x) => s + x.price, 0);
  let hours = range.reduce((s, x) => s + x.hours, 0);
  const pace = Number(cfg.pacePerDay);
  if (pace > 0) {
    const steps = hi - lo;
    hours = (steps / pace) * 24;
  }
  if (ci < di && range.length > 0) {
    const rr = parseRR(text);
    if (rr != null && rr > 0) {
      const currentPrice = list[lo].price;
      const discount = currentPrice * (rr / 100);
      price -= discount;
      if (pace > 0) {
        hours -= (1 / pace) * 24 * (rr / 100);
      } else {
        hours -= list[lo].hours * (rr / 100);
      }
    }
  }
  const desRR = parseDesiredRR(text);
  if (desRR != null && desRR > 0 && range.length > 0) {
    const lastStepPrice = range[range.length - 1].price;
    const rrExtra = lastStepPrice * (desRR / 100);
    price += rrExtra;
    if (pace > 0) {
      hours += (1 / pace) * 24 * (desRR / 100);
    } else {
      hours += range[range.length - 1].hours * (desRR / 100);
    }
  }
  price = Math.max(price, 0);
  hours = Math.max(hours, 0.5);
  if (price <= 0) return null;
  return {
    price,
    hours,
    detail: `${current} -> ${desired}`,
  };
}

const PHASE_TARGET = { 1: 1000, 2: 2000, 3: 3000 };
const PHASE_TROPHY = { 1000: 1, 2000: 2, 3000: 3 };

function unitsCount(text, cfg) {
  const t = String(text || '');
  const label = (cfg && cfg.unitLabel) ? String(cfg.unitLabel).toLowerCase() : '';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lab = label ? esc(label) + 's?' : '(?:wins?|placements?|placement\\s+games?)';
  const gameLabel = label === 'win' ? '|games?|matches?' : '';
  const anyLabel = `(?:${lab}${gameLabel})`;
  let m = t.match(new RegExp(`(\\d{1,4})\\s*(?:net\\s+)?${anyLabel}\\b`, 'i'));
  if (m) return Number(m[1]);
  m = t.match(new RegExp(`(?:number\\s+of\\s+(?:games?|matches?)\\s*[:\\s]*|count\\s+of\\s+)?${anyLabel}\\s*(?:count)?\\s*:?\\s*(\\d{1,4})\\b`, 'i'));
  if (m) return Number(m[1]);
  m = t.match(new RegExp(`(?:number\\s+of\\s+(?:games?|matches?)\\s*[:\\s]*|count\\s+of\\s+)\\s*(?:count)?\\s*:?\\s*(\\d{1,4})\\b`, 'i'));
  if (m) return Number(m[1]);
  m = t.match(new RegExp(`\\b${anyLabel}\\b[^\\n]*?[-\\u2013\\u2014]\\s*(\\d{1,4})\\s*(?:${anyLabel}|matches?|games?)\\b`, 'i'));
  if (m) return Number(m[1]);
  return null;
}

function computeUnits(cfg, text) {
  const count = unitsCount(text, cfg);
  if (!count || count <= 0) return null;
  const d = DEFAULTS.units;
  const perHours = Number(cfg.hoursPerUnit || d.hoursPerUnit);
  const rp = cfg.rankPrices;
  if (rp && typeof rp === 'object') {
    const rank = rankFromText(text);
    const rankPrice = rank ? Number(rp[rank]) : NaN;
    if (!isNaN(rankPrice) && rankPrice > 0) {
      return { price: rankPrice * count, hours: perHours * count, count, detail: `${count} ${cfg.unitLabel || 'unidades'}` };
    }
  }
  const per = Number(cfg.pricePerUnit || d.pricePerUnit);
  if (per <= 0) return null;
  let price = per * count;
  let hours = perHours * count;
  const rm = cfg.rankMultipliers;
  if (rm && typeof rm === 'object') {
    const rank = rankFromText(text);
    if (rank) {
      const mult = Number(rm[rank] || 1);
      price *= mult;
      hours *= mult;
    }
  }
  return {
    price,
    hours,
    count,
    detail: `${count} ${cfg.unitLabel || 'unidades'}`,
  };
}

const RANK_NAMES = ['one above all', 'grand champion iii', 'grand champion ii', 'grand champion i', 'grand champion', 'supersonic legend', 'grand master', 'grandmaster', 'supersonic', 'celestial', 'eternity', 'master', 'mythic', 'legendary', 'predator', 'ascendant', 'immortal', 'radiant', 'platinum', 'diamond', 'champion', 'emerald', 'bronze', 'silver', 'gold', 'copper', 'iron'];

function rankFromText(text) {
  const t = String(text || '').toLowerCase();
  for (const r of RANK_NAMES) {
    if (new RegExp(`\\b${r}\\b`, 'i').test(t)) return r;
  }
  return null;
}

const REGION_CANON = {
  'north america': 'NA', 'na': 'NA', 'us': 'NA', 'usa': 'NA', 'canada': 'NA',
  'europe': 'EU', 'eu': 'EU', 'europea': 'EU',
  'asia': 'AP', 'apac': 'AP', 'southeast asia': 'AP', 'sea': 'AP', 'asia pacific': 'AP', 'oceania': 'AP', 'oce': 'AP', 'australia': 'AP',
  'south america': 'LATAM', 'latam': 'LATAM', 'sudamerica': 'LATAM',
  'brasil': 'BRASIL', 'brazil': 'BRASIL', 'br': 'BRASIL',
  'korea': 'KR', 'korea del sur': 'KR', 'kr': 'KR', 'south korea': 'KR',
};

function canonRegion(val) {
  const v = String(val || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '');
  if (REGION_CANON[v]) return REGION_CANON[v];
  for (const [k, c] of Object.entries(REGION_CANON)) {
    if (k.length <= 2) {
      if (new RegExp(`\\b${k}\\b`).test(v)) return c;
    } else if (v.includes(k)) {
      return c;
    }
  }
  return null;
}

function regionFromText(text) {
  const t = String(text || '');
  let val = (t.match(/server\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  if (!val) val = (t.match(/region\s*[:]?\s*(.+?)(?=;|$)/i) || [])[1];
  if (!val) return null;
  return canonRegion(val);
}

function brawlPrestigeBand(text, tr) {
  const desired = tr.desired;
  const current = tr.current;
  if (desired == null) return null;
  if (desired > 2000 && desired <= 3000) {
    return { from: current != null ? current : 2000, to: desired, bandFrom: 2000, bandTo: 3000, label: 'p2 a p3' };
  }
  if (desired >= 1000 && desired <= 2000 && current != null && current < desired) {
    return { from: current, to: desired, bandFrom: 1000, bandTo: 2000, label: 'p1 a p2' };
  }
  if (desired >= 1000 && desired <= 2000 && current == null) {
    return { from: 0, to: desired, bandFrom: 0, bandTo: 2000, label: 'p0 a p2' };
  }
  return null;
}

function trophyRanges(text) {
  const t = String(text || '');
  const out = [];
  const re = /\b(\d{3,4})\s*(?:-|a|to|hasta|al)\s*(\d{3,4})\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from >= 1000 && to >= 1000 && to > from) out.push({ from, to });
  }
  return out;
}

function normalizeBrawlerName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (n.includes('larry') || n.includes('lawrie')) return 'larry & lawrie';
  if (n === 'r-t' || n === 'rt') return 'r-t';
  return n;
}

function parseMultiBrawlerDescriptions(text) {
  const t = String(text || '');
  const BW_RE = BRAWLER_NAMES.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const targets = [];
  const targetRe = new RegExp(`\\b(${BW_RE})\\s+(?:from\\s+)?(?:\\d{3,4}\\s+)?(?:to|hasta|al|goal|target)\\s+(?:p(?:restige)?\\s*)?(\\d{1,4})\\b`, 'gi');
  let m;
  while ((m = targetRe.exec(t))) {
    let to = Number(m[2]);
    if (to >= 1 && to <= 3) to = PHASE_TARGET[to] || to;
    targets.push({ brawler: normalizeBrawlerName(m[1]), to, idx: m.index });
  }
  if (targets.length < 2) return [];
  const currents = [];
  const currentRe = new RegExp(`\\b(${BW_RE})\\s+(?:from\\s+)?(\\d{3,4})\\b`, 'gi');
  while ((m = currentRe.exec(t))) {
    const from = Number(m[2]);
    if (from >= 100 && from <= 4000) currents.push({ brawler: normalizeBrawlerName(m[1]), from, idx: m.index });
  }
  const ranges = [];
  for (const tgt of targets) {
    const match = currents.find((c) => c.brawler === tgt.brawler && c.from < tgt.to);
    if (match) ranges.push({ from: match.from, to: tgt.to });
  }
  return ranges;
}

function bandCovered(segs, bandFrom, bandTo) {
  let covered = bandFrom;
  const sorted = [...(segs || [])].sort((a, b) => Number(a.from ?? 0) - Number(b.from ?? 0));
  for (const s of sorted) {
    if (Number(s.price || 0) <= 0) continue;
    const sFrom = Number(s.from ?? 0);
    const sTo = Number(s.to ?? Infinity);
    if (sFrom <= covered && sTo > covered) covered = sTo;
  }
  return covered >= bandTo;
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

// Detecta pedidos que claramente involucran VARIOS brawlers (para no cotizar como uno solo).
function multiBrawlerHint(text) {
  const t = String(text || '');
  if (/\b\d+\s+brawlers?\b/i.test(t)) return true;
  if (trophyRanges(t).length >= 2) return true;
  const found = new Set();
  const re = new RegExp(`\\b(${BRAWLER_NAMES.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  let m;
  while ((m = re.exec(t))) found.add(m[1].toLowerCase());
  return found.size >= 2;
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
  if (out.desired == null) {
    const prest = t.match(/\b(?:p|prestig(?:e|io))\s*([1-3])\b/i);
    if (prest) {
      const PHASE = { 1: 1000, 2: 2000, 3: 3000 };
      out.desired = PHASE[Number(prest[1])] || null;
    }
  }
  if (out.current == null) {
    const trophy = t.match(/\b(\d{1,4})\s*(?:troph(?:y|ies)|t)\b/i);
    if (trophy) {
      const n = parseNumber(trophy[1]);
      if (n != null && n >= 0 && n <= 3000) out.current = n;
    }
  }
  if (out.current == null) {
    const trophyAbbr = t.match(/\b(\d{3,4})\s*tr\b/i);
    if (trophyAbbr) {
      const n = parseNumber(trophyAbbr[1]);
      if (n != null && n >= 0 && n <= 3000) out.current = n;
    }
  }
  if (out.current == null) {
    const from = t.match(/\bfrom\s+(\d[\d.,]*k?)\b/i);
    if (from) {
      const n = parseNumber(from[1]);
      if (n != null && n >= 0 && n <= 3000) out.current = n;
    }
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
  const abbr = t.match(/\b(\d{3,4})\s*tr\b/i);
  if (abbr) {
    const n = parseNumber(abbr[1]);
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

function proportionalForRange(segs, from, to, catCfg) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const catPer = catCfg ? Number(catCfg.per) : 0;
  let price = 0;
  let hours = 0;
  for (const s of segs) {
    const sFrom = Number(s.from ?? 0);
    const sTo = Number(s.to ?? Infinity);
    const per = (Number(s.per) > 0) ? Number(s.per) : ((catPer > 0) ? catPer : 1);
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
    const hasMultiBrawler = multiBrawlerHint(text) || (trophyRanges(text).length >= 2) || /\b\d+\s+brawlers?\b/i.test(text);
    if (segFrom == null) {
      const mFrom = text.match(/current (?:brawler )?troph(?:y|ies)(?: count)?\s*[:]?\s*([\d.,]+)/i);
      if (mFrom) segFrom = toNumber(mFrom[1]);
    }
    if (segTo == null) {
      const mTo = text.match(/desired (?:brawler )?troph(?:y|ies)(?: count)?\s*[:]?\s*([\d.,]+)/i);
      if (mTo) segTo = toNumber(mTo[1]);
    }
    if (segFrom == null || segTo == null) {
      if (!hasMultiBrawler) {
        const et = explicitTarget(text);
        if (segFrom == null && et.current != null) segFrom = et.current;
        if (segTo == null && et.desired != null) segTo = et.desired;
      }
    }
    // Prestige Icon de Brawl sin datos de trofeos (ej. "el icono de X", "Random Brawler"):
    // se sugiere el boost completo del prestigio (desde el piso del segmento hasta el tope p3).
    // NO aplica si el mensaje trae rangos/multi-brawler: esos se suman por brawler.
    if (game === 'brawl_stars' && catCfg === gameCfg.Prestigios && (segFrom == null || segTo == null) && !hasMultiBrawler) {
      const segs = catCfg.segments || [];
      if (segs.length) {
        const floors = segs.map((s) => Number(s.from ?? 0)).filter((v) => Number.isFinite(v));
        const tops = segs.map((s) => (s.to != null ? Number(s.to) : 0)).filter((v) => Number.isFinite(v));
        segFrom = segFrom == null ? Math.min(0, ...floors) : segFrom;
        segTo = segTo == null ? Math.max(0, ...tops) : segTo;
      }
    }
    if (segFrom == null || segTo == null) return null;
    // Derank: desired < current (bajar trofeos/rango). Se cotiza por la magnitud del trabajo.
    if (segTo < segFrom) { const _t = segTo; segTo = segFrom; segFrom = _t; }
    const segMax = Math.max(0, ...(catCfg.segments || []).map((s) => (s.to != null ? Number(s.to) : 0)));
    if (segTo > segMax) return { ok: false, reason: 'rango por encima del máximo configurado (se salta)', to: segTo };
    out = computeSegments(catCfg, segFrom, segTo);
    if (!out) return null;
  } else if (catCfg.mode === 'tiers') {
    const t = computeTiers(catCfg, text, gameCfg);
    if (!t) return null;
    if (t.emptyDesired) return { ok: false, reason: 'rango deseado vacío (precio manual)' };
    if (t.skipTier) return { ok: false, reason: `rango incluye ${t.skipTier} (sin precio automatico)` };
    out = t;
  } else if (catCfg.mode === 'units') {
    const u = computeUnits(catCfg, text);
    if (!u) return null;
    out = u;
  } else {
    return null;
  }

  const mult = multipliersFromText(text, catCfg.multipliers);
  let price = out.price * mult;
  let hours = out.hours * mult;

  let region = null;
  const regionCfg = (gameCfg.regionLocked && gameCfg.regions) ? gameCfg.regions : (catCfg.regions || null);
  if (regionCfg) {
    region = regionFromText(text);
    if (region) {
      const rc = regionCfg[region];
      if (!rc || rc.enabled === false) {
        return { ok: false, reason: `regi\u00f3n ${region} no soportada (se salta)` };
      }
      const rmult = Number(rc.multiplier);
      if (Number.isFinite(rmult) && rmult > 0 && rmult !== 1) {
        price *= rmult;
        hours *= rmult;
      }
    }
  }

  const hasSegHours = (catCfg.segments || []).some((s) => s.hours != null && Number(s.hours) > 0);
  let segPace = null;
  if (catCfg.mode === 'segments' && segFrom != null && segTo != null && !catCfg.useSegmentHours && !hasSegHours) {
    segPace = Number(catCfg.pacePerDay != null ? catCfg.pacePerDay : 1500);
    const total = Math.abs(segTo - segFrom);
    // hoursOnly => pacePerDay se interpreta como trofeos POR HORA (ej. CR 300/h).
    // en otro caso, pacePerDay es trofeos por día (se convierte a horas x24).
    const paceFactor = !!(gameCfg && gameCfg.hoursOnly) ? 1 : 24;
    hours = (total / Math.max(1, segPace)) * paceFactor * mult;
  }

  price = roundPrice(price);
  if (catCfg.mode === 'segments') {
    const floor = configFloor(catCfg.segments || []);
    if (floor > 0) price = Math.max(price, floor);
  }
  const minPrice = Number(catCfg.minPrice);
  if (Number.isFinite(minPrice) && minPrice > 0 && price < minPrice) return { ok: false, reason: `precio $${price} por debajo del mínimo $${minPrice}`, minPrice, price };
  const maxPrice = Number(catCfg.maxPrice);
  if (Number.isFinite(maxPrice) && maxPrice > 0 && price > maxPrice) return { ok: false, reason: `precio $${price} por encima del máximo $${maxPrice}`, maxPrice, price };
  const budget = budgetFromText(text);
  if (!Number.isFinite(price) || price <= 0) return null;

  const deliveryTime = deliveryCodeForHours(hours, pricing);
  const etaLabel = fmtEta(hours, { hoursOnly: gameCfg.hoursOnly });

  let note;
  if (catCfg.mode === 'segments' && segFrom != null && segTo != null) {
    const total = Math.abs(segTo - segFrom);
    if (!catCfg.useSegmentHours && !hasSegHours) {
      const paceUnit = gameCfg.hoursOnly ? 'hora' : 'dia';
      note = `precio sugerido: ${fmtNum(total)} trofeos (${fmtNum(segFrom)} -> ${fmtNum(segTo)})${mult !== 1 ? ' x' + mult : ''} | ~${etaLabel} | ritmo ${fmtNum(segPace || 1500)}/${paceUnit}`;
    } else {
      note = `precio sugerido: ${fmtNum(total)} trofeos (${fmtNum(segFrom)} -> ${fmtNum(segTo)})${mult !== 1 ? ' x' + mult : ''} | ~${etaLabel}`;
    }
  } else {
    note = `precio sugerido (${out.detail}${mult !== 1 ? ' x' + mult : ''})`;
  }
  if (region) note += ` | server ${region}`;

  return {
    ok: true,
    price,
    hours,
    deliveryTime,
    etaLabel,
    region,
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
  if (phases.length >= 2 && /\b\d+\s+(?:prestige|p)\s+\d/i.test(text)) return null;
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
  // Derank: desired < current (bajar trofeos/rango). Se cotiza por la magnitud del trabajo.
  const derank = explicit.desired != null && explicit.current != null && explicit.desired < explicit.current;
  if (explicit.desired != null && (explicit.current == null || explicit.desired > explicit.current || derank)) target = explicit.desired;
  if (target == null) target = phaseTarget;
  if (!target || target <= 0) return null;

  let current = explicit.current != null ? explicit.current : currentTrophies(text, target);
  if (current != null && explicit.desired != null && explicit.desired <= current && phaseTarget != null && phaseTarget > current) {
    target = phaseTarget;
  }
  if (current != null && !derank && current >= target) return { ok: false, reason: 'ya alcanzado el objetivo' };
  if (target > segMax) return { ok: false, reason: 'rango por encima del máximo configurado (se salta)' };

  const mult = multipliersFromText(text, catCfg.multipliers);
  let ranges = trophyRanges(text);
  const isMulti = ranges.length >= 2 || parseMultiBrawlerDescriptions(text).length >= 2 || /\b\d+\s+brawlers?\b/i.test(text);
  if (ranges.length < 2) ranges = parseMultiBrawlerDescriptions(text);
  const minSpan = Number(catCfg.minSpan || 0);
  if (minSpan > 0 && !isMulti) {
    const span = current != null ? Math.abs(target - current) : target;
    if (span < minSpan) return { ok: false, reason: `span de trofeos demasiado pequeño (se salta)` };
  }
  if (ranges.length >= 2) {
    let price = 0;
    let hours = 0;
    const parts = [];
    for (const r of ranges) {
      if (r.to > segMax) return { ok: false, reason: 'rango por encima del máximo configurado (se salta)' };
      const p = proportionalForRange(segs, r.from, r.to, catCfg);
      price += p.price;
      hours += p.hours;
      parts.push(`${fmtNum(r.from)} -> ${fmtNum(r.to)}`);
    }
    price *= mult;
    hours *= mult;
    const pace = Number(catCfg.pacePerDay);
    if (pace > 0) {
      const totalTrophies = ranges.reduce((s, r) => s + (r.to - r.from), 0);
      const paceFactor = !!(gameCfg && gameCfg.hoursOnly) ? 1 : 24;
      hours = ((totalTrophies * mult) * paceFactor) / pace;
    }
    const floor = configFloor(segs);
    if (floor > 0) price = Math.max(price, floor);
    const budget = budgetFromText(text);
    price = roundPrice(price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const deliveryTime = deliveryCodeForHours(hours, pricing);
    const etaLabel = fmtEta(hours, { hoursOnly: gameCfg.hoursOnly });
    return {
      ok: true,
      price,
      hours,
      deliveryTime,
      etaLabel,
      multiplier: mult,
      detail: `${ranges.length} brawlers (${parts.join(', ')})`,
      from: ranges[0].from,
      to: ranges[0].to,
      note: `interpretado: ${ranges.length} brawlers (${parts.join(', ')}) | ~${etaLabel}${budget != null ? ` | max $${budget}` : ''}`,
    };
  }

  const count = brawlerCount(text);

  let price;
  let hours;
  let budgetMatch = false;
  if (current != null) {
    const p = proportionalForRange(segs, current, target, catCfg);
    price = p.price * count;
    hours = p.hours * count;
    const pace = Number(catCfg.pacePerDay);
    if (pace > 0) {
      const paceFactor = !!(gameCfg && gameCfg.hoursOnly) ? 1 : 24;
      hours = (Math.abs(target - current) * count * paceFactor) / pace;
    }
  } else {
    const budget = budgetFromText(text);
    if (budget == null) return null;
    price = budget;
    hours = proportionalForRange(segs, 0, target, catCfg).hours * count;
    budgetMatch = true;
  }

  price *= mult;
  hours *= mult;

  const floor = current != null ? configFloor(segs) : 0;
  if (floor > 0 && current != null) price = Math.max(price, floor);

  const budget = budgetFromText(text);

  price = roundPrice(price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const deliveryTime = deliveryCodeForHours(hours, pricing);
  const etaLabel = fmtEta(hours, { hoursOnly: gameCfg.hoursOnly });
  const missing = current != null ? Math.abs(target - current) : null;

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

export { matchCategory, regionFromText };
