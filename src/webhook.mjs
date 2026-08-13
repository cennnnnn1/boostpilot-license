export function embed({ color, title, description, fields = [], timestamp, footer } = {}) {
  const e = {};
  if (color != null) e.color = color;
  if (title) e.title = title;
  if (description) e.description = description;
  if (fields && fields.length) {
    e.fields = fields.map((f) => ({
      name: String(f.name || ''),
      value: String(f.value || '\u200b'),
      inline: !!f.inline,
    }));
  }
  if (timestamp) e.timestamp = timestamp;
  if (footer) e.footer = { text: footer };
  return e;
}

export async function sendDiscord({ url, content, embeds, username } = {}) {
  if (!url || !/^https:\/\/discord(app)?\.com\/api\/webhooks\//i.test(url)) {
    return { ok: false, error: 'URL de webhook de Discord invalida' };
  }
  const payload = {};
  if (username) payload.username = username;
  if (content) payload.content = content;
  if (embeds && embeds.length) payload.embeds = embeds;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 140)}` };
  }
  return { ok: true };
}

export function webhookEnabled(config) {
  const d = (config && config.notify && config.notify.discord) || {};
  return !!(d.enabled && d.url);
}

export function eventEnabled(config, event) {
  if (!webhookEnabled(config)) return false;
  const d = config.notify.discord;
  const ev = d.events || {};
  return ev[event] !== false;
}
