import fs from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BASE = 'https://www.eldorado.gg/api/';
const TALKJS_APP_ID = '49mLECOW';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const STATE_ROOT = process.env.ELBOT_STATE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'state');
const AUTH_PATH = join(STATE_ROOT, 'auth.json');

export class EldoradoApiError extends Error {
  constructor(status, messages, correlationId) {
    super((messages || []).join('; ') || `HTTP ${status}`);
    this.status = status;
    this.messages = messages || [];
    this.correlationId = correlationId;
  }
}

export class EldoradoApi {
  constructor({ authPath = AUTH_PATH } = {}) {
    this.authPath = authPath;
    this.cookie = '';
    this.tokenExpiresAt = null;
  }

  async init() {
    const auth = JSON.parse(await fs.readFile(this.authPath, 'utf8'));
    const hasIdToken = (auth.cookies || []).some((c) => c.name === '__Host-EldoradoIdToken' && c.value);
    if (!hasIdToken) {
      this.cookie = '';
      this.tokenExpiresAt = null;
      const err = new Error('NO_AUTH: no hay __Host-EldoradoIdToken en ' + this.authPath);
      err.code = 'ENOENT';
      throw err;
    }
    this.cookie = auth.cookies
      .filter((c) => {
        const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
        return d === 'eldorado.gg' || d.endsWith('.eldorado.gg');
      })
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  _xsrf() {
    const m = this.cookie.match(/(?:^|;\s*)__Host-XSRF-TOKEN=([^;]+)/);
    return m ? m[1] : null;
  }

  _applySetCookie(setCookies) {
    for (const sc of setCookies || []) {
      const m = sc.match(/^([^=]+)=([^;]*)/);
      if (!m) continue;
      const [_, name, value] = m;
      if (this.cookie.includes(name + '=')) {
        const re = new RegExp(`(^|; )${name}=[^;]*`);
        this.cookie = this.cookie.replace(re, `$1${name}=${value}`);
      } else {
        this.cookie += `; ${name}=${value}`;
      }
    }
  }

  async _writeAuthJson(obj) {
    const tmp = this.authPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fs.rename(tmp, this.authPath);
  }

  async persistCookies() {
    const auth = JSON.parse(await fs.readFile(this.authPath, 'utf8'));
    const cookieNames = new Set();
    for (const pair of this.cookie.split('; ')) {
      const [name, value] = pair.split('=');
      const cookie = auth.cookies.find((c) => c.name === name && c.domain.endsWith('eldorado.gg'));
      if (cookie) {
        cookie.value = value;
        cookie.expires = (Date.now() / 1000) + 30 * 24 * 3600;
        cookieNames.add(name);
      }
    }
    await this._writeAuthJson(auth);
  }

  async refresh() {
    const res = await this._raw('POST', 'authentication/refreshTokens');
    this._applySetCookie(res.setCookies);
    await this.persistCookies();
    if (res.body && res.body.tokenExpiresIn) {
      this.tokenExpiresAt = Date.now() + (res.body.tokenExpirationInMinutes || 30) * 60 * 1000 - 60 * 1000;
    }
    return res.body;
  }

  async _raw(method, path, body, query) {
    const q = query
      ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString()
      : '';
    const headers = {
      'user-agent': UA,
      'accept': 'application/json, text/plain, */*',
      'cookie': this.cookie,
      'origin': 'https://www.eldorado.gg',
      'referer': 'https://www.eldorado.gg/',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const xsrf = this._xsrf();
    if (xsrf) headers['x-xsrf-token'] = xsrf;
    const res = await fetch(BASE + path + q, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json') && text) {
      try { parsed = JSON.parse(text); } catch {}
    }
    if (!res.ok && parsed && parsed.messages) {
      throw new EldoradoApiError(res.status, parsed.messages, parsed.correlationId);
    }
    if (!res.ok) {
      throw new EldoradoApiError(res.status, [text.slice(0, 200)]);
    }
    return { res, body: parsed, setCookies: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
  }

  async request(method, path, body, query) {
    if (!this.cookie) await this.init();
    if (!this.tokenExpiresAt || Date.now() > this.tokenExpiresAt) {
      await this.refresh();
    }
    let out;
    try {
      out = await this._raw(method, path, body, query);
    } catch (err) {
      if (err.status === 401) {
        await this.refresh();
        out = await this._raw(method, path, body, query);
      } else {
        throw err;
      }
    }
    return out.body;
  }

  getReceivedRequests({ cursorValue = null, pageSize = 50, filter = 'ActiveRequests', gameId = null } = {}) {
    return this.request('GET', 'boostingOffers/me/boostingRequests/received', undefined, {
      cursorValue,
      cursorColumn: null,
      pageSize,
      pageDirection: 'Next',
      filter,
      gameId,
    });
  }

  getSellerRequests({ cursorValue = null, pageSize = 50 } = {}) {
    return this.request('GET', 'boostingOffers/me/boostingRequests', undefined, {
      cursorValue,
      cursorColumn: null,
      pageSize,
      pageDirection: 'Next',
    });
  }

  getProfile() {
    return this.request('GET', 'users/me');
  }

  getRequestDetails(id) {
    return this.request('GET', `boostingOffers/boostingRequests/${id}/details`);
  }

  markRequestViewed(id) {
    return this.request('PUT', `boostingOffers/boostingRequests/${id}/viewer`);
  }

  placeOffer({ boostingRequestId, guaranteedDeliveryTime, amountUsd }) {
    const body = {
      details: {
        boostingRequestId,
        guaranteedDeliveryTime,
        pricing: {
          quantity: 1,
          minQuantity: 1,
          volumeDiscounts: null,
          pricePerUnit: { amount: amountUsd, currency: 'USD' },
        },
      },
    };
    return this.request('POST', 'boostingOffers', body);
  }

  createConversationSeller(boostingRequestId) {
    return this.request('POST', `boostingOffers/boostingRequests/${boostingRequestId}/createConversationForSeller`);
  }

  async sendMessageToBuyer(boostingRequestId, message) {
    const conv = await this.createConversationSeller(boostingRequestId);
    const talkJsConversationId = conv.talkJsConversationId;
    if (!talkJsConversationId) throw new Error('No se obtuvo talkJsConversationId.');
    const { token } = await this.request('GET', 'conversations/me/authorize');
    if (!token) throw new Error('No se obtuvo el token de TalkJS.');
    return this._talkJsPost(talkJsConversationId, token, { text: message, type: 'text' });
  }

  async sendImageToBuyer(boostingRequestId, imagePath) {
    const conv = await this.createConversationSeller(boostingRequestId);
    const talkJsConversationId = conv.talkJsConversationId;
    if (!talkJsConversationId) throw new Error('No se obtuvo talkJsConversationId.');
    const { token } = await this.request('GET', 'conversations/me/authorize');
    if (!token) throw new Error('No se obtuvo el token de TalkJS.');
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(imagePath);
    const upload = await fetch(
      `https://api.talkjs.com/v1/${TALKJS_APP_ID}/file-uploads`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/octet-stream',
          'user-agent': UA,
          'origin': 'https://www.eldorado.gg',
          'referer': 'https://www.eldorado.gg/',
        },
        body: new Blob([buffer]),
      }
    );
    const upText = await upload.text();
    if (!upload.ok) throw new Error(`TalkJS upload HTTP ${upload.status}: ${upText.slice(0, 140)}`);
    let parsed = null;
    try { parsed = JSON.parse(upText); } catch {}
    const url = parsed && (parsed.url || parsed.fileUrl || parsed.publicUrl);
    if (!url) throw new Error('TalkJS upload sin url en la respuesta');
    return this._talkJsPost(talkJsConversationId, token, {
      text: '',
      type: 'file',
      attachment: [{
        url,
        contentType: parsed.contentType || 'image/png',
        size: buffer.length,
        name: parsed.name || 'proof.png',
      }],
    });
  }

  _talkText(m) {
    const parts = [];
    for (const c of (m && m.content) || []) {
      const ch = c && c.children;
      if (Array.isArray(ch)) {
        for (const x of ch) {
          if (typeof x === 'string') parts.push(x);
          else if (x && x.text) parts.push(x.text);
        }
      } else if (typeof ch === 'string') {
        parts.push(ch);
      }
    }
    return parts.join(' ').trim().slice(0, 300);
  }

  async getBuyerMessages(boostingRequestId) {
    const conv = await this.createConversationSeller(boostingRequestId);
    const talkJsConversationId = conv.talkJsConversationId;
    const buyerId = conv.buyerUserId ? String(conv.buyerUserId) : '';
    const sellerId = conv.sellerUserId ? String(conv.sellerUserId) : '';
    if (!talkJsConversationId) return [];
    const { token } = await this.request('GET', 'conversations/me/authorize');
    if (!token) return [];
    const res = await fetch(
      `https://api.talkjs.com/v1/${TALKJS_APP_ID}/conversations/${talkJsConversationId}/messages?limit=100`,
      {
        method: 'GET',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': UA,
          'origin': 'https://www.eldorado.gg',
          'referer': 'https://www.eldorado.gg/',
        },
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`TalkJS HTTP ${res.status}: ${text.slice(0, 200)}`);
    let data = null;
    try { data = JSON.parse(text); } catch { throw new Error('TalkJS JSON invalido'); }
    const items = (data && data.data) || [];
    const out = [];
    for (const m of items) {
      if (!m || m.type === 'SystemMessage') continue;
      const sid = m.senderId != null ? String(m.senderId) : '';
      if (!sid) continue;
      if (sellerId && sid === sellerId) continue;
      if (buyerId && sid !== buyerId) continue;
      out.push({ sender: sid, text: this._talkText(m), createdAt: m.createdAt || m.timestamp || null });
    }
    return out;
  }

  async _talkJsPost(talkJsConversationId, token, body) {
    const res = await fetch(
      `https://api.talkjs.com/v1/${TALKJS_APP_ID}/conversations/${talkJsConversationId}/messages`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': UA,
          'origin': 'https://www.eldorado.gg',
          'referer': 'https://www.eldorado.gg/',
        },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`TalkJS HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { talkJsConversationId, ok: true };
  }
}
