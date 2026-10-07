// discord-faq.mjs — edita (en su lugar) las notas del canal #faq.
//
// Uso:
//   node tools/discord-faq.mjs
//
// NO crea mensajes nuevos: busca en #faq los mensajes con embeds por su título
// y actualiza los campos que hagan falta. Idempotente.
//   · "🛒 Plans & payment" → "Payment methods" deja SOLO USDT (TRC20).
//   · "❓ Frequently asked questions" → asegura los campos de descarga y
//     SmartScreen (paso 1: bajar solo de #downloads; paso 2: Run anyway).
// Env opcional: BP_DISCORD_TOKEN (override del token guardado).
import { loadConfig, loadAuth } from './discord-store.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, token, body, tries = 6) {
  const res = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    let d = {}; try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 1) * 1000 + 250;
    if (tries > 0) { console.log('  (rate limited, waiting ' + Math.round(wait) + 'ms)'); await sleep(wait); return api(method, path, token, body, tries - 1); }
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 400)}`);
  err.status = res.status; err.data = data;
  throw err;
}

async function findNote(channelId, title, token) {
  const msgs = await api('GET', `/channels/${channelId}/messages?limit=20`, token);
  return msgs.find((m) => (m.embeds || []).some((e) => e.title === title));
}

async function patchNote(channelId, msg, embedIndex, fields, token, label) {
  const embeds = (msg.embeds || []).map((e) => ({
    title: e.title, description: e.description || null,
    color: e.color || null, timestamp: e.timestamp || null,
    footer: e.footer || undefined,
    fields: e.fields || [],
  }));
  embeds[embedIndex].fields = fields;
  await api('PATCH', `/channels/${channelId}/messages/${msg.id}`, token, { embeds });
  console.log('  ✔ ' + label);
}

async function main() {
  const discord = loadConfig();
  const auth = loadAuth();
  const token = process.env.BP_DISCORD_TOKEN || auth.token;
  if (!token) { console.error('Falta el token de Discord.'); process.exit(1); }
  const channelId = process.env.BP_DISCORD_FAQ_ID || discord.ids?.faq;
  if (!channelId) { console.error('No se encontró el canal #faq.'); process.exit(1); }
  const downloadsId = discord.ids?.downloads;
  if (!downloadsId) { console.error('No se encontró el canal #downloads.'); process.exit(1); }

  console.log('· Actualizando notas de #faq (en su lugar)...');

  // 1) 🛒 Plans & payment → Payment methods solo USDT.
  const plans = await findNote(channelId, '🛒 Plans & payment', token);
  if (!plans) { console.log('  (nota "🛒 Plans & payment" no encontrada — se omite)'); }
  else {
    const ei = plans.embeds.findIndex((e) => e.title === '🛒 Plans & payment');
    const fields = (plans.embeds[ei].fields || []).map((f) => {
      if (f.name === 'Payment methods') {
        return { ...f, value: '**USDT (TRC20)**. Crypto recommended — instant and cannot be reversed.' };
      }
      return f;
    });
    await patchNote(channelId, plans, ei, fields, token, 'Pagos: solo USDT (TRC20) en "🛒 Plans & payment"');
  }

  // 2) ❓ FAQ → descarga + SmartScreen (pasos 1 y 2).
  const faq = await findNote(channelId, '❓ Frequently asked questions', token);
  if (!faq) { console.log('  (nota "❓ Frequently asked questions" no encontrada — se omite)'); }
  else {
    const ei = faq.embeds.findIndex((e) => e.title === '❓ Frequently asked questions');
    const fields = (faq.embeds[ei].fields || []).slice();
    const upsert = (name, value) => {
      const i = fields.findIndex((f) => f.name === name);
      if (i >= 0) fields[i] = { name, value, inline: false };
      else fields.push({ name, value, inline: false });
    };
    upsert('How do I download BoostPilot?',
      'Only from <#' + downloadsId + '> — the pinned message. Never download it from any other site.');
    upsert('Windows shows a warning?',
      'The app is not code-signed, so SmartScreen may say *"Windows protected your PC"*. That is normal. Click **More info** → **Run anyway**. You only do this once.');
    await patchNote(channelId, faq, ei, fields, token, 'FAQ: campos de descarga y SmartScreen');
  }

  console.log('✅ Listo.');
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1); });
