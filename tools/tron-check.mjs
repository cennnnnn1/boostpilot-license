/* tron-check.mjs ΓÇö verificaci├│n on-chain de pagos USDT (TRC20) v├¡a TronGrid.
 *
 * Sin dependencias. Verifica que un TXID dado corresponda a una transferencia
 * USDT (TRC20) CONFIRMADA hacia la wallet del negocio por un monto >= esperado.
 *
 * Uso CLI (diagn├│stico):
 *   node tools/tron-check.mjs <txid> <wallet> <montoUSDT>
 *   ΓåÆ devuelve ok/reason + detalles (monto recibido, de, a, token, confirmado).
 *
 * API (m├│dulo):
 *   import { verifyUsdtPayment } from './tron-check.mjs';
 *   const r = await verifyUsdtPayment({ txid, wallet, expectedUsdt });
 *   r.ok, r.reason, r.receivedUsdt, r.from, r.to, r.token, r.confirmed, r.explorer
 */

import { pathToFileURL } from 'url';

export const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRONGRID = 'https://api.trongrid.io';

const sha256 = async (buf) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', buf));

/* base58encode de un Buffer (para convertir direcciones Tron hexΓåÆbase58). */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58encode(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of buf) { if (b === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/* "0xaa47a27d..." (20 bytes) ΓåÆ direcci├│n base58. */
export async function hexToBase58(hex) {
  let bytes = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  if (bytes.length === 20) bytes = Buffer.concat([Buffer.from([0x41]), bytes]);
  const cs = (await sha256(await sha256(bytes))).slice(0, 4);
  return base58encode(Buffer.concat([bytes, cs]));
}

async function get(path, { method = 'GET', body } = {}) {
  const res = await fetch(TRONGRID + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (res.status >= 400) {
    const err = new Error(`TronGrid ${res.status} ${path} :: ${String(j).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return j;
}

/* Intenta conseguir el "to" (base58) y value (unidades raw) por txid usando
   los eventos del contrato (fallback si no aparece en la lista de la wallet). */
async function fetchByEvents(txid) {
  try {
    const ev = await get(`/v1/contracts/${USDT_TRC20}/events?limit=100&order_by=block_timestamp,desc`);
    const list = (ev.data || []).filter(
      (e) => e.transaction_id === txid && e.result && e.result.value !== undefined
    );
    if (!list.length) return null;
    const best = list[0];
    return {
      to: await hexToBase58(best.result.to || ''),
      from: await hexToBase58(best.result.from || ''),
      value: Number(best.result.value),
    };
  } catch {
    return null;
  }
}

export async function verifyUsdtPayment({ txid, wallet, expectedUsdt, usdtContract = USDT_TRC20, confirmations = 1 }) {
  txid = String(txid || '').trim().toLowerCase();
  wallet = String(wallet || '').trim();
  if (!/^[0-9a-f]{64}$/.test(txid)) return { ok: false, reason: 'bad_txid', explorer: tronscanUrl(txid) };
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)) return { ok: false, reason: 'bad_wallet' };
  const expectedRaw = Math.floor(Number(expectedUsdt || 0) * 1e6);

  /* 1) Lista de transferencias TRC20 de la wallet (solo confirmadas). */
  let hit = null;
  let receivedRaw = 0;
  let from = null;
  let to = null;
  let token = null;
  let confirmed = false;
  try {
    const list = await get(`/v1/accounts/${wallet}/transactions/trc20?limit=200&only_to=true&only_confirmed=true`);
    for (const t of list.data || []) {
      if (String(t.transaction_id).toLowerCase() === txid) {
        hit = t; break;
      }
    }
    if (hit) {
      receivedRaw = Number(hit.value) || 0;
      from = hit.from || null;
      to = hit.to || null;
      token = hit.token_info ? hit.token_info.address : null;
      confirmed = true;
    }
  } catch { /* fallback abajo */ }

  /* 2) Fallback por eventos si no aparece en la lista de la wallet. */
  if (!hit) {
    const ev = await fetchByEvents(txid);
    if (ev && ev.to === wallet) {
      receivedRaw = ev.value;
      from = ev.from;
      to = ev.to;
      token = usdtContract;
      try {
        const info = await get('/wallet/gettransactioninfobyid', { method: 'POST', body: { value: txid } });
        const conf = Number(info.confirmations) || 0;
        confirmed = conf >= confirmations || Number(info.blockNumber) > 0;
      } catch {
        confirmed = false;
      }
    }
  }

  const receivedUsdt = receivedRaw / 1e6;
  const okTo = to === wallet;
  const okToken = !token || token === usdtContract;
  const okAmount = receivedUsdt >= Number(expectedUsdt || 0);
  const okConfirmed = confirmed || !hit; // si apareci├│ en la lista confirmada ya est├í confirmado

  return {
    ok: !!hit && okTo && okToken && okAmount,
    reason: !hit
      ? 'not_found'
      : !okTo ? 'wrong_wallet'
      : !okToken ? 'wrong_token'
      : !okAmount ? 'insufficient'
      : 'ok',
    txid,
    receivedUsdt,
    expectedUsdt: Number(expectedUsdt || 0),
    from,
    to,
    token: token || usdtContract,
    confirmed,
    source: hit ? 'wallet-list' : 'events',
    explorer: tronscanUrl(txid),
  };
}

export function tronscanUrl(txid) {
  return 'https://tronscan.org/#/transaction/' + String(txid || '').trim();
}

/* ---- CLI ---- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , txid, wallet, amount] = process.argv;
  if (!txid || !wallet || !amount) {
    console.log('Uso: node tools/tron-check.mjs <txid> <wallet> <montoUSDT>');
    process.exit(1);
  }
  const r = await verifyUsdtPayment({ txid, wallet, expectedUsdt: Number(amount) });
  console.log('\n┬╖ Verificaci├│n USDT (TRC20)');
  console.log('  txid      : ' + r.txid);
  console.log('  resultado : ' + (r.ok ? 'Γ£à OK' : 'Γ¥î ' + r.reason));
  console.log('  recibido  : ' + r.receivedUsdt.toFixed(6) + ' USDT (esperado >= ' + r.expectedUsdt + ')');
  console.log('  de        : ' + (r.from || 'n/a'));
  console.log('  a         : ' + (r.to || 'n/a'));
  console.log('  token     : ' + (r.token || 'n/a'));
  console.log('  confirmado: ' + (r.confirmed ? 's├¡' : 'no/indeterminado'));
  console.log('  tronscan  : ' + r.explorer);
  console.log();
}
