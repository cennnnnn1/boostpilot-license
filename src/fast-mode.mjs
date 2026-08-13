import fs from 'fs/promises';
import path from 'node:path';
import { EldoradoApi } from './eldorado-api.mjs';
import { applyFilters, humanSummary, detectGame } from './rules.js';
import { computePrice, interpretDescription, matchCategory } from './pricing.mjs';
import { sendDiscord, embed, eventEnabled } from './webhook.mjs';
import { getSessionGameRestriction } from './session.mjs';

const DELIVERY_TIMES = new Set([
  'Automated', 'Instant', 'Minute20', 'Hour1', 'Hour2', 'Hour3', 'Hour5', 'Hour8', 'Hour12',
  'Day1', 'Day2', 'Day3', 'Day7', 'Day14', 'Day28', 'Day45', 'Day60', 'NotApplicable',
]);

const EVENT_COLORS = {
  newOrder: 0x3498db,
  offerPlaced: 0x2ecc71,
  offerFailed: 0xe74c3c,
  accepted: 0x2ecc71,
  followUp: 0xf1c40f,
  canceled: 0x95a5a6,
  paused: 0xf39c12,
  resumed: 0x27ae60,
  pricingError: 0xe74c3c,
};
const EVENT_COLOR_FALLBACK = 0xf0b015;

const CATEGORY_TOGGLE_KEYS = ['trophy boost', 'brawlers rank', 'prestige icon', 'rank boost', 'custom request'];

function categoryToggleKey(category) {
  const c = String(category || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!c) return null;
  if (/custom\s*request/.test(c)) return 'custom request';
  if (/prestige\s*icon/.test(c)) return 'prestige icon';
  if (/brawler/.test(c) && /rank/.test(c)) return 'brawlers rank';
  if (/\branked|\brank\b|rank\s*boost/.test(c)) return 'rank boost';
  if (/troph/.test(c)) return 'trophy boost';
  return null;
}

export class FastMode {
  constructor({ config, isSeen, markSeen, upsertRecord, beep, notify, onError, stateDir }) {
    this.config = config;
    this.isSeen = isSeen;
    this.markSeen = markSeen;
    this.upsertRecord = upsertRecord;
    this.beep = beep;
    this.notify = notify;
    this.onError = onError || (() => {});
    this.stateDir = stateDir;
    this.api = new EldoradoApi();
    this.running = false;
    this.paused = false;
    this.stats = { polls: 0, found: 0, placed: 0, skipped: 0, errors: 0, lastPoll: null, pending: 0, paused: false, ordersTracked: 0 };
    this.gameMap = null;
    this.pending = [];
    this.tracked = new Map();
    this.orders = new Map();
    this._consecutiveErrors = 0;
    this._lastPlaceAt = 0;
    this._placeLock = Promise.resolve();
    this._noPriceIds = new Set();
    this._autoOnlySkipped = new Set();
    this._catSkippedLogged = new Set();
  }

  _createdTs(item) {
    const src = item && (item.createdDate || item.createdAt);
    if (!src) return NaN;
    const ts = Date.parse(src);
    return Number.isFinite(ts) ? ts : NaN;
  }

  async _placeGap() {
    const min = this.cfg.minPlaceIntervalMs || 3000;
    const jitter = Math.floor(Math.random() * (this.cfg.placeJitterMs || 2000));
    const wait = min + jitter;
    const elapsed = Date.now() - this._lastPlaceAt;
    if (elapsed < wait) {
      await new Promise((r) => setTimeout(r, wait - elapsed));
    }
    this._lastPlaceAt = Date.now();
  }

  get cfg() {
    return this.config.bot.fastMode || {};
  }

  async loadGameMap() {
    const file = this.cfg.gameMapFile || 'state/game_map.json';
    const candidates = [path.join(this.stateDir, 'game_map.json')];
    if (file.includes('/')) candidates.unshift(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../', file));
    for (const c of candidates) {
      try {
        this.gameMap = JSON.parse(await fs.readFile(c, 'utf8'));
        return;
      } catch {}
    }
    this.gameMap = {};
  }

  gameNameFor(gameId) {
    if (this.gameMap && this.gameMap[gameId]) return this.gameMap[gameId].name || gameId;
    return gameId;
  }

  gameKeyFor(gameName) {
    const detected = detectGame(String(gameName || ''), this.config.games);
    return detected ? detected.name : null;
  }

  deliveryTime() {
    const configured = this.cfg.deliveryTime || 'Day3';
    return DELIVERY_TIMES.has(configured) ? configured : 'Day3';
  }

  _isPrestigeCategory(category) {
    if (!category) return false;
    if (/prestig/i.test(String(category))) return true;
    const pricing = this.config.bot && this.config.bot.pricing;
    const bs = pricing && pricing.games && pricing.games.brawl_stars;
    if (bs && /brawler/i.test(String(category))) {
      const cfg = matchCategory(category, bs);
      if (cfg && cfg.useSegmentHours) return true;
    }
    return false;
  }

  _categoryShouldSkip(p) {
    const key = this.gameKeyFor(String(p.game)) || p.game;
    const pricing = (this.config.bot && this.config.bot.pricing) || {};
    const gameCfg = pricing.games && pricing.games[key];
    if (gameCfg) {
      let catCfg = matchCategory(p.category, gameCfg);
      if (!catCfg && key === 'brawl_stars') catCfg = gameCfg.Prestigios || null;
      if (catCfg && catCfg.enabled === false) return true;
    }
    return this._categoryToggleOff(p.category);
  }

  _categoryToggleOff(category) {
    const ce = this.cfg.categoriesEnabled;
    if (!ce || typeof ce !== 'object') return false;
    const key = categoryToggleKey(category);
    if (!key) return false;
    return ce[key] === false;
  }

  _autoAllowsGame(gameKey) {
    const list = this.cfg.autoOnlyGames;
    if (!Array.isArray(list) || !list.length) return true;
    return list.some((g) => String(g).toLowerCase() === String(gameKey || '').toLowerCase());
  }

  _pricingSkipReason(reason) {
    const r = String(reason || '');
    return /se salta|venta\/intercambio|ya alcanzado|incluye pro/i.test(r);
  }

  buildText(item, details) {
    const parts = [];
    if (item.boostingCategoryTitle) parts.push(`category ${item.boostingCategoryTitle}`);
    const gameName = this.gameNameFor(item.gameId);
    if (gameName) parts.push(`game ${gameName}`);
    for (const v of details.descriptionValues || []) {
      parts.push(`${v.label || ''} ${v.value || ''}`.trim());
    }
    return parts.join('; ');
  }

  async processRequest(item) {
    console.log(`[fast][vista] Oferta vista: ${item.id.slice(0, 8)} (${this.gameNameFor(item.gameId) || item.gameId || '?'})`);
    let details;
    try {
      console.log(`[fast][abriendo] Abriendo detalles de ${item.id.slice(0, 8)}...`);
      details = await this.api.getRequestDetails(item.id);
    } catch (err) {
      console.error(`[fast] Error al leer detalles ${item.id.slice(0, 8)}: ${err.message}`);
      this.stats.errors++;
      return;
    }

    const gameName = this.gameNameFor(item.gameId);
    const gameKey = this.gameKeyFor(gameName);
    const label = gameKey || gameName || '?';
    const allowed = getSessionGameRestriction();
    if (allowed && !allowed.includes(String(gameKey || '').toLowerCase())) {
      console.log(`[fast][key] ${item.id.slice(0, 8)} fuera del juego de la key (${label}): se ignora.`);
      this.stats.skipped++;
      return;
    }
    const text = this.buildText(item, details);
    const summary = humanSummary(text);
    const category = item.boostingCategoryTitle || '';
    const dC = this.offerDetails({ fields: details.descriptionValues || [], description: summary });
    console.log(`[fast][creando] ${category || 'N/A'} | ${dC.mode} | ${dC.boost} | Comprador: ${item.buyerUsername || '-'}`);

    const filtered = applyFilters({ text, category, game: gameKey }, this.config);
    if (filtered.skip) {
      console.log(`[fast][skip] ${item.id.slice(0, 8)} (${filtered.reason}): ${summary.slice(0, 90)}`);
      this.stats.skipped++;
      this.upsertRecord({
        id: item.id,
        href: `https://www.eldorado.gg/boosting-request/${item.id}`,
        game: gameKey,
        category,
        description: summary,
        buyer: item.buyerUsername,
        price: null,
        eta: '',
        note: `filtro: ${filtered.reason}`,
        reason: filtered.reason,
        status: 'skipped',
        source: 'fast',
        createdAt: new Date().toISOString(),
        seenAt: new Date().toISOString(),
      });
      return;
    }

    const catDisabled = this._categoryShouldSkip({ game: gameKey, category });
    if (catDisabled) {
      console.log(`[fast][auto-off] ${item.id.slice(0, 8)} (categoria desactivada en auto): ${summary.slice(0, 90)}`);
    }

    const deliveryTime = this.deliveryTime();
    const href = `https://www.eldorado.gg/boosting-request/${item.id}`;
    const mode = this.cfg.autoPlace;

    const pricing = computePrice({ game: gameKey, category, description: summary, config: this.config }) ||
                    interpretDescription({ game: gameKey, category, description: summary, config: this.config });
    const suggested = pricing && pricing.ok ? pricing : null;
    const suggestedNote = pricing && pricing.ok === false ? `sin precio auto: ${pricing.reason}` : (suggested ? suggested.note : '');
    if (pricing && pricing.ok === false && this._pricingSkipReason(pricing.reason)) {
      console.log(`[fast][skip] ${item.id.slice(0, 8)} (${pricing.reason}): ${summary.slice(0, 90)}`);
      this.stats.skipped++;
      this.upsertRecord({
        id: item.id, href, game: gameKey, category,
        description: summary, buyer: item.buyerUsername,
        price: null, eta: '', etaLabel: '', note: `saltado: ${pricing.reason}`,
        reason: pricing.reason, status: 'skipped', source: 'fast',
        createdAt: new Date().toISOString(), seenAt: new Date().toISOString(),
      });
      return;
    }
    console.log(`[fast][sugerido] ${suggested ? `$${suggested.price} | ${suggested.deliveryTime}${suggested.etaLabel ? ' (' + suggested.etaLabel + ')' : ''}` : 'sin precio automatico (precio manual)'}`);

    const announce = (rec) => {
      this._discord('newOrder', {
        title: 'Nuevo pedido detectado',
        fields: [
          { name: 'Juego', value: label, inline: true },
          { name: 'Categoria', value: category || '-', inline: true },
          { name: 'Comprador', value: item.buyerUsername || '-', inline: true },
          { name: 'Precio sugerido', value: suggested ? `$${suggested.price} (${suggested.deliveryTime})` : 'manual', inline: true },
          { name: 'Pedido', value: item.id.slice(0, 8), inline: true },
        ],
      });
    };

    if (mode === false || mode === 'off') {
      console.log(`[fast] REQUEST DETECTADO (solo lectura): ${label.toUpperCase()} | ${summary.slice(0, 100)}`);
      this.beep();
      this.notify('Request detectado', `${label.toUpperCase()}: ${summary.slice(0, 80)}`);
      const rec = {
        id: item.id, href, game: gameKey, category,
        description: summary, buyer: item.buyerUsername,
        price: suggested ? suggested.price : null,
        deliveryTime: suggested ? suggested.deliveryTime : this.deliveryTime(),
        etaLabel: suggested ? suggested.etaLabel : '',
        note: suggestedNote || '', reason: 'detect', suggested: !!suggested,
        status: 'ready', source: 'fast',
        createdAt: new Date().toISOString(),
        seenAt: new Date().toISOString(),
      };
      this.upsertRecord(rec);
      this.tracked.set(item.id, { ts: this._createdTs(item), rec });
      announce(rec);
      return;
    }

    const isAuto = (mode === true || mode === 'auto') && this._autoAllowsGame(label);
    const isCustom = /custom request/i.test(String(category || ''));
    if (isAuto && isCustom) {
      const createdAt = new Date().toISOString();
      const p = {
        id: item.id, href, game: label, category,
        description: summary, buyer: item.buyerUsername,
        price: null, deliveryTime: '', etaLabel: '',
        note: 'custom request', suggested: false,
        fields: details.descriptionValues || [],
        vip: false, createdAt, createdDate: item.createdDate || null,
        gameId: item.gameId || null,
        custom: true,
        responded: false, respondedAt: null,
      };
      this.pending.push(p);
      this.stats.pending = this.pending.length;
      this.tracked.set(item.id, { ts: this._createdTs(item), rec: p });
      await this.savePending();
      return;
    }
    if (isAuto && suggested && !catDisabled) {
      const d0 = this.offerDetails({ fields: details.descriptionValues || [], description: summary });
      console.log(`[fast][auto] COLOCANDO OFERTA | ${label} | ${category || '-'} | ${d0.mode} | ${d0.boost} | $${suggested.price} | ${suggested.deliveryTime}`);
      const p = {
        id: item.id, href, game: label, category,
        description: summary, buyer: item.buyerUsername,
        price: suggested.price, deliveryTime: suggested.deliveryTime,
        etaLabel: suggested.etaLabel, note: suggested.note, suggested: true,
        fields: details.descriptionValues || [],
        vip: false, createdAt: new Date().toISOString(), createdDate: item.createdDate || null,
      };
      try {
        await this._executePlace(p, { auto: true });
        return;
      } catch (err) {
        console.error(`[fast][auto] No se pudo colocar la oferta de ${item.id.slice(0, 8)}: ${err.message}. Queda en Confirmar.`);
        this.pending.push(p);
        this.stats.pending = this.pending.length;
        await this.savePending();
        this._discord('offerFailed', { title: 'Fallo al crear oferta (auto)', fields: [{ name: 'Error', value: String(err.message).slice(0, 150) }] });
        return;
      }
    } else if (isAuto) {
      console.log(catDisabled
        ? '[fast] Categoria desactivada en auto: la oferta queda en Pedidos (no se envia automatica).'
        : '[fast] Sin precio sugerido: la oferta queda en Confirmar para precio manual.');
    }

    const d1 = this.offerDetails({ fields: details.descriptionValues || [], description: summary });
    console.log(`\n[fast] REQUEST DETECTADO: ${label.toUpperCase()}`);
    console.log(`[fast] ${category || 'N/A'} | ${d1.mode} | ${d1.boost} | Entrega: ${suggested ? suggested.deliveryTime : deliveryTime} | Comprador: ${item.buyerUsername}\n`);

    const createdAt = new Date().toISOString();
    this.pending.push({
      id: item.id, href, game: label, category,
      description: summary, buyer: item.buyerUsername,
      price: suggested ? suggested.price : null,
      deliveryTime: suggested ? suggested.deliveryTime : deliveryTime,
      etaLabel: suggested ? suggested.etaLabel : '',
      note: catDisabled ? 'categoria desactivada (auto)' : (suggestedNote || ''), suggested: !!suggested,
      fields: details.descriptionValues || [],
      vip: false,
      createdAt, createdDate: item.createdDate || null,
    });
    const p = this.pending[this.pending.length - 1];
    this.tracked.set(item.id, { ts: this._createdTs(item), rec: p });
    await this.savePending();
    this.stats.pending = this.pending.length;
    this.beep();
    this.notify(
      'Request esperando confirmacion',
      `${label.toUpperCase()} | Entrega ${p.deliveryTime}${suggested ? ` | $${suggested.price}` : ''}`
    );
    console.log(`[fast][pending] ${item.id.slice(0, 8)} esperando confirmacion en el panel (${p.deliveryTime})${suggested ? ` con precio sugerido $${suggested.price}` : ' (precio manual)'}.`);
    this.upsertRecord({
      id: item.id, href, game: gameKey, category,
      description: summary, buyer: item.buyerUsername,
      price: suggested ? suggested.price : null, eta: '', etaLabel: suggested ? suggested.etaLabel : '',
      note: suggestedNote || '', reason: 'default', suggested: !!suggested,
      status: 'pending', source: 'fast',
      createdAt, seenAt: new Date().toISOString(),
    });
    announce({});
  }

  async pollOnce() {
    this.stats.polls++;
    this.stats.lastPoll = new Date().toISOString();
    const list = await this.api.getReceivedRequests({
      filter: 'ActiveRequests',
      pageSize: Math.max(this.cfg.maxRequestsPerPoll || 20, 1),
    });
    const items = list.results || [];
    this.stats.found += items.length;
    const max = this.cfg.maxRequestsPerPoll || 20;
    let processed = 0;
    for (const item of items) {
      if (this.isSeen(item.id)) continue;
      this.markSeen(item.id);
      if (processed >= max) continue;
      processed++;
      await this.processRequest(item);
    }
    const modeTag = this.cfg.autoPlace === true || this.cfg.autoPlace === 'auto' ? 'AUTO' : 'SEMI';
    if (processed === 0) {
      console.log(`[fast][scan] Escaneo #${this.stats.polls} [${modeTag}]: no se detectaron órdenes nuevas (${this.stats.pending} pendientes, ${this.stats.placed} colocadas).`);
    } else {
      console.log(`[fast][scan] Escaneo #${this.stats.polls} [${modeTag}]: ${items.length} activas, ${processed} nueva(s), ${this.stats.pending} pendientes, ${this.stats.placed} colocadas.`);
    }
  }

  async _drainAuto() {
    const mode = this.cfg.autoPlace;
    if (!(mode === true || mode === 'auto')) return;
    if (!this.pending.length) return;
    const run = this._placeLock.then(async () => {
      const batchSize = Math.max(this.cfg.autoBatchSize || 2, 1);
      let handled = 0;
      for (let i = 0; i < this.pending.length && handled < batchSize; i++) {
        const p = this.pending[i];
        if (!p) continue;
        if (p.custom) {
          this.pending.push(this.pending.splice(i, 1)[0]);
          i--;
          continue;
        }
        if (!this._autoAllowsGame(p.game)) {
          if (!this._autoOnlySkipped.has(p.id)) {
            this._autoOnlySkipped.add(p.id);
            console.log(`[fast][auto] ${p.id.slice(0, 8)} (${p.game}) fuera de los juegos del modo auto: queda en Pedidos.`);
          }
          continue;
        }
        if (this._categoryShouldSkip(p)) {
          if (!this._catSkippedLogged.has(p.id)) {
            this._catSkippedLogged.add(p.id);
            console.log(`[fast][auto] ${p.id.slice(0, 8)} (${p.category || '-'}) categoria desactivada: se mantiene en Pedidos.`);
          }
          this.pending.push(this.pending.splice(i, 1)[0]);
          i--;
          continue;
        }
        if (p.price == null || !Number.isFinite(Number(p.price)) || Number(p.price) <= 0) {
          const chatCfg = this.config.chat || {};
          const repriceMs = chatCfg.clarifyRepriceMs ?? 180000;
          const lastTry = p._lastRepriceAt ? Date.parse(p._lastRepriceAt) : 0;
          if (!Number.isFinite(lastTry) || Date.now() - lastTry >= repriceMs) {
            p._lastRepriceAt = new Date().toISOString();
            const pricing = await this._reprice(p);
            if (pricing && pricing.ok) {
              p.price = pricing.price;
              p.deliveryTime = pricing.deliveryTime || p.deliveryTime;
              p.etaLabel = pricing.etaLabel || p.etaLabel;
              p.suggested = true;
              console.log(`[fast][auto] ${p.id.slice(0, 8)} re-cotizado: $${pricing.price} (${pricing.deliveryTime}).`);
            } else if (pricing && pricing.ok === false && this._pricingSkipReason(pricing.reason)) {
              console.log(`[fast][auto] ${p.id.slice(0, 8)} saltado: ${pricing.reason}.`);
              this.upsertRecord({
                id: p.id, href: p.href, game: p.game, category: p.category,
                description: p.description || '', buyer: p.buyer,
                price: null, eta: '', etaLabel: '', note: `saltado: ${pricing.reason}`,
                reason: pricing.reason, status: 'skipped', source: 'fast',
                createdAt: p.createdAt || new Date().toISOString(), seenAt: new Date().toISOString(),
              });
              this.pending.splice(i, 1);
              i--;
              await this.savePending();
              continue;
            }
          }
          if (p.price == null || !Number.isFinite(Number(p.price)) || Number(p.price) <= 0) {
            this.pending.push(this.pending.splice(i, 1)[0]);
            i--;
            continue;
          }
        }
        console.log(`[fast][auto] Procesando pendiente ${p.id.slice(0, 8)} con $${p.price} (${p.deliveryTime})...`);
        try {
          await this._executePlace(p, { auto: true });
          console.log(`[fast][auto] ${p.id.slice(0, 8)} salio de pedidos: quedan ${this.stats.pending}.`);
          handled++;
        } catch (err) {
          console.error(`[fast][auto] No se pudo colocar pendiente ${p.id.slice(0, 8)}: ${err.message}. Sigue en pedidos (precio manual).`);
          p.price = null;
          p.suggested = false;
          this._noPriceIds.add(p.id);
          await this.savePending();
          this._discord('offerFailed', {
            title: 'Fallo al crear oferta (auto)',
            fields: [
              { name: 'Pedido', value: p.id.slice(0, 8), inline: true },
              { name: 'Juego', value: p.game || '-', inline: true },
              { name: 'Error', value: String(err.message).slice(0, 150), inline: false },
            ],
          });
          this.pending.push(this.pending.splice(i, 1)[0]);
          i--;
        }
      }
    });
    this._placeLock = run.catch(() => {});
    await run;
  }

  get pendingFile() {
    return path.join(this.stateDir, 'pending.json');
  }

  async loadPending() {
    try {
      this.pending = JSON.parse(await fs.readFile(this.pendingFile, 'utf8')) || [];
    } catch {
      this.pending = [];
    }
    this.stats.pending = this.pending.length;
    for (const p of this.pending) {
      this.tracked.set(p.id, { ts: this._createdTs(p), rec: p });
    }
    await this._repricePending();
  }

  async _repricePending() {
    let priced = 0;
    let cleared = 0;
    let skipped = 0;
    for (const p of [...this.pending]) {
      if (p.custom) continue;
      const isAuto = p.suggested === true;
      if (p.price != null && Number(p.price) <= 0) p.price = null;
      const hasPrice = p.price != null && Number.isFinite(Number(p.price)) && Number(p.price) > 0;
      if ((hasPrice && !isAuto) || this._noPriceIds.has(p.id)) continue;
      const pricing = computePrice({ game: p.game, category: p.category, description: p.description, config: this.config }) ||
                      interpretDescription({ game: p.game, category: p.category, description: p.description, config: this.config });
      if (pricing && pricing.ok === false && this._pricingSkipReason(pricing.reason)) {
        const idx = this.pending.indexOf(p);
        if (idx >= 0) this.pending.splice(idx, 1);
        this.stats.skipped++;
        this.upsertRecord({
          id: p.id, href: p.href, game: p.game, category: p.category,
          description: p.description || '', buyer: p.buyer,
          price: null, eta: '', etaLabel: '', note: `saltado: ${pricing.reason}`,
          reason: pricing.reason, status: 'skipped', source: 'fast',
          createdAt: p.createdAt || new Date().toISOString(), seenAt: new Date().toISOString(),
        });
        skipped++;
        continue;
      }
      if (!pricing || !pricing.ok) {
        this._noPriceIds.add(p.id);
        if (isAuto && hasPrice) {
          p.price = null;
          p.suggested = false;
          p.note = pricing && pricing.ok === false ? `sin precio auto: ${pricing.reason}` : (p.note || '');
          cleared++;
        } else {
          skipped++;
        }
        continue;
      }
      p.price = pricing.price;
      p.deliveryTime = pricing.deliveryTime || p.deliveryTime;
      p.etaLabel = pricing.etaLabel || p.etaLabel;
      p.note = pricing.note || p.note;
      p.suggested = true;
      priced++;
    }
    if (priced > 0 || cleared > 0) {
      await this.savePending();
      console.log(`[fast][reprice] ${priced} precio(s) asignado(s), ${cleared} corregido(s), ${skipped} sin precio automatico.`);
    }
  }

  async savePending() {
    try {
      const tmp = `${this.pendingFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.pending, null, 2));
      await fs.rename(tmp, this.pendingFile);
    } catch {}
  }

  getPending() {
    return [...this.pending].sort((a, b) => {
      if (!!a.vip !== !!b.vip) return a.vip ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  placePending(id, overrides = {}) {
    const run = this._placeLock.then(async () => {
      const p = this.pending.find((x) => x.id === id);
      if (!p) throw new Error('Sin confirmacion pendiente para ese request.');
      p.vip = !!overrides.vip;
      p.price = overrides.price != null ? Number(overrides.price) : p.price;
      p.deliveryTime = overrides.deliveryTime || p.deliveryTime;
      p.message = overrides.message;
      return this._executePlace(p);
    });
    this._placeLock = run.catch(() => {});
    return run;
  }

  async sendMessageOnly(id, overrides = {}) {
    const p = this.pending.find((x) => x.id === id);
    if (!p) throw new Error('Sin confirmacion pendiente para ese request.');
    const chat = this.config.chat || {};
    if (chat.enabled === false) throw new Error('Los mensajes del chat estan deshabilitados.');
    const message = overrides.message != null ? String(overrides.message).trim() : this._messageFor(p);
    if (!message) throw new Error('No hay mensaje que enviar.');
    await this._chatWithImage(p, message, this._chatPlan(p) || {});
    const prevPending = this.pending.some((x) => x.id === p.id);
    this.pending = this.pending.filter((x) => x.id !== p.id);
    this.stats.pending = this.pending.length;
    this.tracked.delete(p.id);
    if (prevPending) await this.savePending();
    this.upsertRecord({
      id: p.id, href: p.href, game: p.game, category: p.category,
      description: p.description, buyer: p.buyer,
      price: null, deliveryTime: '', etaLabel: p.etaLabel || '',
      note: 'Mensaje enviado (sin oferta)', status: 'messaged', source: 'fast',
      createdAt: p.createdAt || new Date().toISOString(), seenAt: new Date().toISOString(),
    });
    this._trackOrder({
      id: p.id,
      href: p.href || `https://www.eldorado.gg/boosting-request/${p.id}`,
      game: p.game, category: p.category, description: p.description,
      buyer: p.buyer, price: null, deliveryTime: '', etaLabel: p.etaLabel || '',
      placedAt: new Date().toISOString(), acceptedAt: null,
      msgOnly: true, messageSentAt: new Date().toISOString(),
      responded: false, respondedAt: null, buyerReplyAt: null,
      acceptedNotified: false, followUps: 0, lastFollowUpAt: null,
      _wasPendingSeen: true,
    });
    this.beep();
    this.notify('Mensaje enviado', `${p.game.toUpperCase()} | ${p.buyer || '?'} | sin oferta`);
    return { ok: true };
  }

  _chatPlan(p) {
    const chat = this.config.chat || {};
    const cat = String(p.category || '');
    const isCustom = /custom request/i.test(cat);
    if (isCustom && chat.customRequestEnabled !== false && chat.customRequestMessage) {
      return { text: String(chat.customRequestMessage), image: chat.customRequestImage || '', delayMs: chat.customRequestDelayMs };
    }
    if (this._isPrestigeCategory(cat) && chat.prestigeMessageEnabled !== false && chat.prestigeMessage) {
      return { text: String(chat.prestigeMessage), image: chat.prestigeImage || '', delayMs: chat.prestigeDelayMs };
    }
    if (chat.welcomeEnabled !== false && chat.welcomeMessage) {
      return { text: String(chat.welcomeMessage), image: chat.welcomeImage || '', delayMs: chat.welcomeDelayMs };
    }
    return null;
  }

  _messageFor(p) {
    const plan = this._chatPlan(p);
    return plan ? plan.text : '';
  }

  async _reprice(p) {
    try {
      const details = await this.api.getRequestDetails(p.id);
      const text = this.buildText({ gameId: p.gameId, boostingCategoryTitle: p.category || '' }, details);
      const summary = humanSummary(text);
      return computePrice({ game: p.game, category: p.category, description: summary, config: this.config }) ||
             interpretDescription({ game: p.game, category: p.category, description: summary, config: this.config }) ||
             { ok: false, reason: 'sin precio' };
    } catch (err) {
      return { ok: false, reason: `re-fetch: ${err.message}` };
    }
  }

  _detailValue(fields, re) {
    const f = (fields || []).find((x) => x && x.label && re.test(String(x.label)));
    return f ? String(f.value).trim() : '';
  }

  offerDetails(p) {
    const fields = p.fields || [];
    const mode = this._detailValue(fields, /mode/i);
    let boost = this._detailValue(fields, /boost/i);
    if (!boost) {
      const from = this._detailValue(fields, /(from|start|current)/i);
      const to = this._detailValue(fields, /(to|target)/i);
      if (from && to) boost = `${from} -> ${to}`;
    }
    if (!boost) boost = this._detailValue(fields, /->| to /);
    if (!boost && p.description) boost = String(p.description);
    return { mode: mode || '-', boost: boost || '-' };
  }

  async _executePlace(p, { auto = false } = {}) {
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Precio invalido.');
    const deliveryTime = p.deliveryTime;
    if (!DELIVERY_TIMES.has(deliveryTime)) throw new Error(`Entrega invalida: ${deliveryTime}.`);
    const chat = this.config.chat || {};
    const message = p.message != null ? String(p.message) : this._messageFor(p);
    await this._placeGap();
    console.log(`[fast][enviando] Enviando oferta $${price} | ${deliveryTime} al pedido ${p.id.slice(0, 8)}...`);
    const result = await this.api.placeOffer({
      boostingRequestId: p.id,
      guaranteedDeliveryTime: deliveryTime,
      amountUsd: price,
    });
    console.log(`[fast][enviando] Oferta creada y enviada (${p.id.slice(0, 8)}).`);
    const dDone = this.offerDetails(p);
    console.log(`[fast][auto] OFERTA COLOCADA | ${p.game || '-'} | ${p.category || '-'} | ${dDone.mode} | ${dDone.boost} | $${price} | ${deliveryTime} | ${p.buyer || '?'}`);
    if (message && chat.enabled !== false) {
      try {
        console.log(`[fast][mensaje] Enviando mensaje al comprador de ${p.id.slice(0, 8)}...`);
        await this._chatWithImage(p, message, this._chatPlan(p) || {});
        console.log(`[fast][mensaje] Mensaje enviado al comprador de ${p.id.slice(0, 8)}.`);
      } catch (err) {
        console.error(`[chat] No se pudo enviar el mensaje: ${err.message}`);
      }
    }
    const prevPending = this.pending.some((x) => x.id === p.id);
    this.pending = this.pending.filter((x) => x.id !== p.id);
    this.stats.pending = this.pending.length;
    this.stats.placed++;
    this.tracked.delete(p.id);
    if (prevPending) await this.savePending();
    this._trackOrder({
      id: p.id,
      href: p.href || `https://www.eldorado.gg/boosting-request/${p.id}`,
      game: p.game, category: p.category, description: p.description,
      buyer: p.buyer, price, deliveryTime, etaLabel: p.etaLabel || '',
      placedAt: new Date().toISOString(), acceptedAt: null,
      msgOnly: false, messageSentAt: new Date().toISOString(),
      responded: false, respondedAt: null, buyerReplyAt: null,
      acceptedNotified: false, followUps: 0, lastFollowUpAt: null,
      _wasPendingSeen: true,
    });
    this.upsertRecord({
      id: p.id, href: p.href, game: p.game, category: p.category,
      description: p.description, buyer: p.buyer,
      price, deliveryTime, etaLabel: p.etaLabel, note: p.note,
      status: 'placed', source: 'fast',
      createdAt: p.createdAt || new Date().toISOString(), seenAt: new Date().toISOString(),
    });
    this._discord('offerPlaced', {
      title: '\u{1F680} Open offer on Eldorado',
      fields: [
        { name: '\u{1F3AE} Type', value: p.category || '-', inline: true },
        { name: '\u2699\uFE0F Mode', value: this.offerDetails(p).mode, inline: true },
        { name: '\u{1F4C8} Boost', value: this.offerDetails(p).boost, inline: true },
        { name: '\u{1F4B0} Price', value: `$${price}`, inline: true },
        { name: '\u23F1\uFE0F Delivery', value: p.etaLabel || deliveryTime, inline: true },
        { name: '\u{1F464} Buyer', value: p.buyer || '-', inline: true },
        { name: '\u{1F517} Link', value: p.href || `https://www.eldorado.gg/boosting-request/${p.id}`, inline: false },
      ],
    });
    this.beep();
    this.notify('Boost activado', `${p.game.toUpperCase()} | ${p.buyer || '?'} | $${price}`);
    return result;
  }

  async _chatWithImage(p, text, plan = {}) {
    const delay = plan.delayMs != null ? Number(plan.delayMs) : 0;
    const img = plan.image ? String(plan.image).trim() : '';
    if (delay > 0) {
      console.log(`[chat] Mensaje al comprador en ${Math.round(delay / 1000)}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
    if (img) {
      try {
        await this.api.sendImageToBuyer(p.id, img);
        console.log(`[chat] Imagen enviada (${p.category || '-'}).`);
        return;
      } catch (err) {
        console.warn(`[chat] No se pudo enviar imagen (${err.message}). Enviando solo texto.`);
      }
    }
    await this.api.sendMessageToBuyer(p.id, text);
    console.log(`[chat] Mensaje enviado al comprador (${(p.game || '').toUpperCase()}).`);
  }

  async _discord(event, { title, description, fields = [], content } = {}) {
    try {
      if (!eventEnabled(this.config, event)) return;
      const d = this.config.notify.discord;
      const result = await sendDiscord({
        url: d.url,
        username: d.username || 'BoostPilot',
        content,
        embeds: [embed({
          color: EVENT_COLORS[event] != null ? EVENT_COLORS[event] : EVENT_COLOR_FALLBACK,
          title,
          description,
          fields,
          timestamp: new Date().toISOString(),
          footer: 'BoostPilot',
        })],
      });
      if (!result.ok) console.warn(`[webhook] ${result.error}`);
    } catch (err) {
      console.warn(`[webhook] ${err.message}`);
    }
  }

  get ordersFile() {
    return path.join(this.stateDir, 'orders.json');
  }

  async loadOrders() {
    try {
      const arr = JSON.parse(await fs.readFile(this.ordersFile, 'utf8')) || [];
      for (const o of arr) {
        if (o && o.id) {
          delete o._wasPendingSeen;
          this.orders.set(o.id, o);
        }
      }
    } catch {
      this.orders = new Map();
    }
    this.stats.ordersTracked = this.orders.size;
  }

  async saveOrders() {
    try {
      const tmp = `${this.ordersFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify([...this.orders.values()], null, 2));
      await fs.rename(tmp, this.ordersFile);
    } catch {}
  }

  _trackOrder(o) {
    this.orders.set(o.id, o);
    this.stats.ordersTracked = this.orders.size;
    this.saveOrders();
  }

  getOrders() {
    return [...this.orders.values()];
  }

  async updateOrderPrice(id, price) {
    const o = this.orders.get(id);
    if (!o) return { ok: false, error: 'Pedido no rastreado.' };
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, error: 'Precio inválido.' };
    o.price = p;
    await this.saveOrders();
    console.log(`[fast][order] Precio editado en panel: ${id.slice(0, 8)} ahora $${p}.`);
    return { ok: true, order: o };
  }

  async checkOrders() {
    console.log(`[fast][scan] Verificando ${this.orders.size} oferta(s) en seguimiento...`);
    for (const [requestId, o] of [...this.orders]) {
      let d;
      try {
        d = await this.api.request('GET', `boostingOffers/boostingRequests/${requestId}`);
      } catch (err) {
        this.stats.errors++;
        console.warn(`[fast][order] No se pudo consultar ${requestId.slice(0, 8)}: ${err.message}`);
        continue;
      }
      const state = (d && d.state) || '';
      const sellerState = (d && d.sellerDetails && d.sellerDetails.boostingRequestSellerState) || '';
      if (state !== 'Bought' && state !== 'Canceled' && sellerState !== 'OfferLost' && sellerState !== 'Canceled') {
        o._wasPendingSeen = true;
      }
      if (sellerState === 'OfferLost') {
        console.log(`[fast][order] ${requestId.slice(0, 8)} perdida (otro vendedor gano).`);
        this._discord('canceled', {
          title: 'Oferta perdida',
          fields: [
            { name: 'Pedido', value: requestId.slice(0, 8), inline: true },
            { name: 'Juego', value: o.game || '-', inline: true },
            { name: 'Comprador', value: o.buyer || '-', inline: true },
          ],
        });
        this.orders.delete(requestId);
        this.upsertRecord({
          id: requestId, href: o.href, game: o.game, category: o.category,
          description: o.description || '', buyer: o.buyer,
          price: o.price, deliveryTime: o.deliveryTime, etaLabel: o.etaLabel,
          note: 'perdida (otro vendedor gano)', reason: 'lost',
          status: 'canceled', source: 'fast',
          createdAt: o.placedAt, seenAt: new Date().toISOString(),
        });
      } else if (sellerState === 'Canceled' || state === 'Canceled') {
        console.log(`[fast][order] ${requestId.slice(0, 8)} cancelada tras enviar oferta.`);
        this._discord('canceled', {
          title: 'Pedido cancelado despues de enviar oferta',
          fields: [
            { name: 'Pedido', value: requestId.slice(0, 8), inline: true },
            { name: 'Juego', value: o.game || '-', inline: true },
            { name: 'Comprador', value: o.buyer || '-', inline: true },
          ],
        });
        this.orders.delete(requestId);
        this.upsertRecord({
          id: requestId, href: o.href, game: o.game, category: o.category,
          description: o.description || '', buyer: o.buyer,
          price: o.price, deliveryTime: o.deliveryTime, etaLabel: o.etaLabel,
          note: 'cancelada tras enviar oferta', reason: 'canceled_after_offer',
          status: 'canceled', source: 'fast',
          createdAt: o.placedAt, seenAt: new Date().toISOString(),
        });
      } else if (state === 'Bought' || sellerState === 'OfferWon') {
        if (!o.acceptedNotified) {
          if (!this._sellerUserId) {
            try {
              const me = await this.api.getProfile();
              this._sellerUserId = (me && me.id) || '';
            } catch (err) {
              console.warn(`[fast][order] No se pudo obtener mi userId: ${err.message}`);
            }
          }
          const offers = (d && d.offers) || [];
          const win = offers.find((x) => x && x.orderId && (!this._sellerUserId || x.userId === this._sellerUserId));
          if (!win) {
            const wonByOther = offers.some((x) => x && x.orderId);
            if (wonByOther) {
              console.log(`[fast][order] ${requestId.slice(0, 8)} comprada por otro vendedor, quitada del seguimiento.`);
              this._discord('canceled', {
                title: 'Comprada por otro vendedor',
                fields: [
                  { name: 'Pedido', value: requestId.slice(0, 8), inline: true },
                  { name: 'Juego', value: o.game || '-', inline: true },
                  { name: 'Comprador', value: o.buyer || '-', inline: true },
                ],
              });
              this.orders.delete(requestId);
              this.upsertRecord({
                id: requestId, href: o.href, game: o.game, category: o.category,
                description: o.description || '', buyer: o.buyer,
                price: o.price, deliveryTime: o.deliveryTime, etaLabel: o.etaLabel,
                note: 'comprada por otro vendedor', reason: 'lost',
                status: 'canceled', source: 'fast',
                createdAt: o.placedAt, seenAt: new Date().toISOString(),
              });
              continue;
            }
            console.log(`[fast][order] ${requestId.slice(0, 8)} comprado sin confirmar orden propia, reintentare.`);
            continue;
          }
          o.orderId = win.orderId;
          if (win.pricePerUnitInUSD && win.pricePerUnitInUSD.amount != null) {
            o.price = win.pricePerUnitInUSD.amount;
          }
          o.acceptedAt = new Date().toISOString();
          o.acceptedNotified = true;
          if (o._wasPendingSeen) {
            console.log(`[fast][order] Pedido ACEPTADO (en vivo): ${requestId.slice(0, 8)} (${o.buyer || '-'}) order ${(o.orderId || '-').slice(0, 8)}.`);
            this.beep();
            this.upsertRecord({
              id: requestId, href: o.href, game: o.game, category: o.category,
              description: o.description || '', buyer: o.buyer,
              price: o.price, deliveryTime: o.deliveryTime, etaLabel: o.etaLabel,
              orderId: o.orderId || null,
              note: 'oferta aceptada', reason: 'accepted', status: 'placed', source: 'fast',
              createdAt: o.placedAt, seenAt: new Date().toISOString(),
            });
            await this._sendAcceptedMessage(o);
          } else {
            console.log(`[fast][order] ${requestId.slice(0, 8)} ya estaba comprada (detectada tarde), sin mensaje al comprador.`);
            this.beep();
            this.upsertRecord({
              id: requestId, href: o.href, game: o.game, category: o.category,
              description: o.description || '', buyer: o.buyer,
              price: o.price, deliveryTime: o.deliveryTime, etaLabel: o.etaLabel,
              orderId: o.orderId || null,
              note: 'compra detectada tarde (ya aceptada)', reason: 'accepted_late', status: 'placed', source: 'fast',
              createdAt: o.placedAt, seenAt: new Date().toISOString(),
            });
            this._discord('accepted', {
              title: 'Compra detectada tarde (sin mensaje al comprador)',
              fields: [
                { name: 'Pedido', value: requestId.slice(0, 8), inline: true },
                { name: 'Juego', value: o.game || '-', inline: true },
                { name: 'Comprador', value: o.buyer || '-', inline: true },
                { name: 'Precio', value: o.price != null ? `$${o.price}` : '-', inline: true },
              ],
            });
          }
        }
      }
    }
    await this.saveOrders();
    await this._checkResponses();
    this.stats.ordersTracked = this.orders.size;
    console.log(`[fast][scan] Seguimiento de ofertas al dia (${this.orders.size} en seguimiento).`);
  }
  async _checkResponses() {
    const chat = this.config.chat || {};
    const every = chat.responseCheckMs ?? 5 * 60 * 1000;
    const now = Date.now();
    const notified = new Set();
    for (const [id, o] of this.orders) {
      if (o.responded) continue;
      const last = o._lastChatCheckAt ? Date.parse(o._lastChatCheckAt) : 0;
      if (Number.isFinite(last) && now - last < every) continue;
      o._lastChatCheckAt = new Date().toISOString();
      try {
        const msgs = await this.api.getBuyerMessages(id);
        if (msgs.length) {
          const lastMsg = msgs[msgs.length - 1];
          o.responded = true;
          o.respondedAt = lastMsg.createdAt != null ? new Date(lastMsg.createdAt).toISOString() : new Date().toISOString();
          o.buyerReplyAt = o.respondedAt;
          console.log(`[fast][order] Respuesta de ${o.buyer || '-'} (${id.slice(0, 8)}): "${lastMsg.text || '...'}".`);
          notified.add(id);
          this._discord('buyerReply', {
            title: 'El comprador respondió',
            fields: [
              { name: 'Pedido', value: id.slice(0, 8), inline: true },
              { name: 'Comprador', value: o.buyer || '-', inline: true },
              { name: 'Mensaje', value: String(lastMsg.text || '...').slice(0, 180) },
            ],
          });
        }
      } catch (err) {
        // sin conversacion aun o error de red: se reintenta en el proximo ciclo
      }
    }
    if (notified.size) await this.saveOrders();
  }

  async _sendAcceptedMessage(o) {
    const chat = this.config.chat || {};
    if (chat.enabled === false || chat.orderAcceptedEnabled === false) return;
    const text = chat.orderAcceptedMessage || 'Hey! Your order has been accepted. Please share your login details here so I can start. 🚀';
    try {
      await this._chatWithImage(o, text, { image: chat.orderAcceptedImage || '', delayMs: chat.orderAcceptedDelayMs });
    } catch (err) {
      console.error(`[chat] No se pudo enviar mensaje de aceptacion: ${err.message}`);
    }
    this._discord('accepted', {
      title: 'Pedido ACEPTADO',
      fields: [
        { name: 'Pedido', value: o.id.slice(0, 8), inline: true },
        { name: 'Juego', value: o.game || '-', inline: true },
        { name: 'Comprador', value: o.buyer || '-', inline: true },
        { name: 'Precio', value: o.price != null ? `$${o.price}` : '-', inline: true },
      ],
    });
  }

  async _sendFollowUp(o) {
    const chat = this.config.chat || {};
    if (chat.enabled === false || chat.followUpEnabled === false) return { ok: false, error: 'Recordatorios deshabilitados.' };
    const text = chat.followUpMessage || 'Quick reminder: I need your login details to start your order. You can share them here whenever you are ready. 👍';
    try {
      await this._chatWithImage(o, text, { image: chat.followUpImage || '', delayMs: chat.followUpDelayMs });
      console.log(`[chat] Recordatorio enviado a ${o.buyer || '-'}.`);
    } catch (err) {
      console.error(`[chat] No se pudo enviar recordatorio: ${err.message}`);
      return { ok: false, error: err.message };
    }
    o.messageSentAt = new Date().toISOString();
    this._discord('followUp', {
      title: 'Recordatorio enviado',
      fields: [
        { name: 'Pedido', value: o.id.slice(0, 8), inline: true },
        { name: 'Comprador', value: o.buyer || '-', inline: true },
      ],
    });
    return { ok: true };
  }

  async sendReminder(id) {
    const o = this.orders.get(id);
    if (!o) return { ok: false, error: 'Pedido no rastreado.' };
    if (o.responded) return { ok: false, error: 'El pedido ya tiene respuesta.' };
    const res = await this._sendFollowUp(o);
    if (!res.ok) return res;
    o.followUps = (o.followUps || 0) + 1;
    o.lastFollowUpAt = new Date().toISOString();
    await this.saveOrders();
    return { ok: true, sentAt: o.lastFollowUpAt };
  }

  async _runOrdersLoop(everyMs) {
    while (this.running) {
      if (!this.paused) {
        try {
          await this.checkOrders();
        } catch (err) {
          this.stats.errors++;
          this.onError(err);
        }
      }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  async discardPending(id) {
    const p = this.pending.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'No está pendiente.' };
    this.pending = this.pending.filter((x) => x.id !== id);
    this.stats.pending = this.pending.length;
    this.tracked.delete(id);
    await this.savePending();
    this.upsertRecord({
      id, href: p.href, game: p.game, category: p.category,
      description: p.description, buyer: p.buyer,
      price: p.price, etaLabel: p.etaLabel, note: 'descartada en panel',
      status: 'skipped', source: 'fast',
      createdAt: p.createdAt, seenAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  async checkCancellations() {
    if (!this.tracked.size) return;
    const maxPages = Math.max(this.cfg.cancelCheckPages || 10, 1);
    const active = new Set();
    let minDate = Infinity;
    let cursor = null;
    for (let i = 0; i < maxPages; i++) {
      let page;
      try {
        page = await this.api.getReceivedRequests({ filter: 'ActiveRequests', pageSize: 20, cursorValue: cursor });
      } catch (err) {
        this.stats.errors++;
        this.onError(err);
        return;
      }
      const items = page.results || [];
      if (!items.length) break;
      for (const it of items) {
        active.add(it.id);
        const ts = this._createdTs(it);
        if (Number.isFinite(ts) && ts < minDate) minDate = ts;
      }
      cursor = page.nextPageCursor;
      if (!cursor) break;
    }
    const dead = [];
    for (const [id, t] of this.tracked) {
      if (!Number.isFinite(t.ts) || t.ts < minDate) continue;
      if (!active.has(id)) dead.push(id);
    }
    for (const id of dead) {
      try {
        await this.markCanceled(id);
      } catch (err) {
        this.stats.errors++;
        console.error(`[fast][cancel] error al marcar ${id.slice(0, 8)}: ${err.message}`);
      }
    }
  }

  async markCanceled(id) {
    const t = this.tracked.get(id);
    if (!t) return;
    const p = this.pending.find((x) => x.id === id);
    if (p) {
      this.pending = this.pending.filter((x) => x.id !== id);
      this.stats.pending = this.pending.length;
      await this.savePending();
    }
    if (this.tracked.delete(id) === false) return;
    const rec = p || t.rec || {};
    console.log(`[fast][cancel] ${id.slice(0, 8)} el cliente canceló la solicitud (ya no está activa).`);
    this.beep();
    this.notify('Request cancelado', `El cliente canceló la solicitud ${id.slice(0, 8)}.`);
    this._discord('canceled', {
      title: 'Pedido cancelado por el cliente',
      fields: [
        { name: 'Pedido', value: id.slice(0, 8), inline: true },
        { name: 'Juego', value: rec.game || '-', inline: true },
        { name: 'Comprador', value: rec.buyer || '-', inline: true },
      ],
    });
    this.upsertRecord({
      id,
      href: rec.href || `https://www.eldorado.gg/boosting-request/${id}`,
      game: rec.game || null,
      category: rec.category || '',
      description: rec.description || '',
      buyer: rec.buyer || '',
      price: rec.price != null ? rec.price : null,
      deliveryTime: rec.deliveryTime || null,
      eta: '',
      etaLabel: rec.etaLabel || '',
      note: 'cancelada por el cliente',
      reason: 'canceled',
      status: 'canceled',
      source: 'fast',
      createdAt: rec.createdAt || new Date().toISOString(),
      seenAt: new Date().toISOString(),
    });
  }

  async _runCancelLoop(everyMs) {
    while (this.running) {
      if (!this.paused) {
        try {
          await this.checkCancellations();
        } catch (err) {
          this.stats.errors++;
          this.onError(err);
        }
      }
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  pause() {
    this.paused = true;
    this.stats.paused = true;
    console.log('[fast] PAUSADO desde el panel: no se monitorean ni se colocan ofertas.');
    this.notify('Bot pausado', 'No se monitorean nuevas solicitudes.');
    this._discord('paused', { content: 'Bot pausado desde el panel.' });
  }

  resume() {
    this.paused = false;
    this.stats.paused = false;
    console.log('[fast] REANUDADO: sigue monitoreando solicitudes.');
    this.notify('Bot reanudado', 'Se sigue monitoreando solicitudes.');
    this._discord('resumed', { content: 'Bot reanudado desde el panel.' });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.loadGameMap();
    await this.loadPending();
    await this.loadOrders();
    try {
      await this.api.init();
    } catch (err) {
      console.log('[fast] SIN SESION de Eldorado (auth.json): se reintenta cada 30s. Paneles y tienda siguen activos.');
      this._noSession = true;
      this._waitAuth();
    }
    if (!this._noSession) {
      console.log(`[fast] Fast Mode por API activo. Polling cada ${this.cfg.pollIntervalMs || 1500}ms.`);
      console.log(`[fast] Modo: ${this.cfg.autoPlace === 'confirm' ? 'SEMI-AUTOMATICO (precio sugerido + confirmar en el panel)' : this.cfg.autoPlace ? 'AUTOMATICO (precios automaticos)' : 'solo detecta'}.`);
      const cancelEvery = this.cfg.cancelCheckIntervalMs ?? 60000;
      if (cancelEvery > 0) {
        this._cancelLoop = this._runCancelLoop(cancelEvery);
        console.log(`[fast] Deteccion de cancelaciones cada ${Math.round(cancelEvery / 1000)}s.`);
      }
      const ordersEvery = this.cfg.ordersCheckIntervalMs ?? 120000;
      if (ordersEvery > 0) {
        this._ordersLoop = this._runOrdersLoop(ordersEvery);
        console.log(`[fast] Seguimiento de pedidos (aceptados + respuesta) cada ${Math.round(ordersEvery / 1000)}s.`);
      }
    }
    while (this.running) {
      if (this.paused) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (this._noSession) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      try {
      await this.pollOnce();
      this._consecutiveErrors = 0;
      await this._drainAuto();
      const nowBeat = Date.now();
      if (!this._lastBeat || nowBeat - this._lastBeat > 60000) {
        this._lastBeat = nowBeat;
        const m = this.cfg.autoPlace === true || this.cfg.autoPlace === 'auto' ? 'AUTO' : 'SEMI';
        console.log(`[fast][${m}] vivo | polls=${this.stats.polls} encontrados=${this.stats.found} colocados=${this.stats.placed} pendientes=${this.stats.pending} errores=${this.stats.errors} ultimoPoll=${this.stats.lastPoll ? this.stats.lastPoll.slice(11, 19) : '-'}`);
      }
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          this._noSession = true;
          this._waitAuth();
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        this._consecutiveErrors++;
        this.stats.errors++;
        this.onError(err);
      }
      const base = this.cfg.pollIntervalMs || 1500;
      const jitter = Math.floor(Math.random() * (this.cfg.pollJitterMs || 1500));
      let wait = base + jitter;
      if (this._consecutiveErrors > 0) {
        const backoff = Math.min(this.cfg.maxBackoffMs || 60000, 5000 * 2 ** (this._consecutiveErrors - 1));
        wait = Math.max(wait, backoff);
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  async _waitAuth() {
    const tryInit = async () => {
      try {
        await this.api.init();
        this._noSession = false;
        this._waitTimer = null;
        console.log('[fast] Sesion cargada. Fast Mode activo.');
        console.log(`[fast] Fast Mode por API activo. Polling cada ${this.cfg.pollIntervalMs || 1500}ms.`);
        if (!this._ordersLoop) {
          const ordersEvery = this.cfg.ordersCheckIntervalMs ?? 120000;
          if (ordersEvery > 0) {
            this._ordersLoop = this._runOrdersLoop(ordersEvery);
            console.log(`[fast] Seguimiento de pedidos (aceptados + respuesta) cada ${Math.round(ordersEvery / 1000)}s.`);
          }
        }
      } catch (err) {
        this._waitTimer = setTimeout(tryInit, 30000);
      }
    };
    if (!this._waitTimer) this._waitTimer = setTimeout(tryInit, 30000);
  }

  async stop() {
    this.running = false;
  }
}
