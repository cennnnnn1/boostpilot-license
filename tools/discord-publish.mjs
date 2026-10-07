/* Publish the current build to GitHub Releases and pin the download message
   in the #downloads Discord channel (version + Download button).

   Usage:
     node tools/discord-publish.mjs
   Env:
     BP_DISCORD_TOKEN / BP_GITHUB_TOKEN  (override saved auth, optional)

   It reads:
     - version  from launcher/package.json
     - github   from state/github.json     ({ repo, token })
     - discord  from state/discord.auth.json + state/discord.json
     - installer exe from release/BoostPilot Setup <version>.exe
*/

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { ROOT, loadConfig, loadAuth } from './discord-store.mjs';
import { PINK } from './discord-structure.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(method, path, token, body, tries = 6) {
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 429) {
    let d = {}; try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 30) * 1000 + 250;
    if (tries > 0) { console.log(`  (github rate limited, waiting ${Math.round(wait / 1000)}s)`); await sleep(wait); return gh(method, path, token, body, tries - 1); }
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 400)}`);
  err.status = res.status; err.data = data;
  throw err;
}

async function api(method, path, token, body, tries = 6) {
  const res = await fetch('https://discord.com/api/v10' + path, {
    method,
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    let d = {}; try { d = await res.json(); } catch { /* ignore */ }
    const wait = (Number(d.retry_after) || 1) * 1000 + 250;
    if (tries > 0) { console.log(`  (rate limited, waiting ${Math.round(wait)}ms)`); await sleep(wait); return api(method, path, token, body, tries - 1); }
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 200 && res.status < 300) return data;
  const err = new Error(`HTTP ${res.status} ${method} ${path} :: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 400)}`);
  err.status = res.status; err.data = data;
  throw err;
}

function loadGithub() {
  const env = process.env.BP_GITHUB_TOKEN;
  const file = join(ROOT, 'state', 'github.json');
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')); } catch { /* ignore */ }
  return { repo: saved.repo, token: env || saved.token };
}

async function ensureRelease(repo, tag, token, notes) {
  let rel;
  const exePath = join(ROOT, 'release', `BoostPilot Setup ${tag.slice(1)}.exe`);
  let hash = '';
  try { hash = createHash('sha256').update(readFileSync(exePath)).digest('hex').toUpperCase(); } catch { /* ignore */ }
  const body =
    'BoostPilot ' + tag + '\n\n' +
    (notes ? notes + '\n\n' : '') +
    'Available in the #downloads channel of the Discord server.\n\n' +
    (hash ? '**SHA256** (for verification): `' + hash + '`' : '');
  try {
    rel = await gh('GET', `/repos/${repo}/releases/tags/${tag}`, token);
    console.log(`  ✔ Release ${tag} (ya existía)`);
    if (notes || hash) {
      await gh('PATCH', `/repos/${repo}/releases/${rel.id}`, token, { body });
      console.log('  ✔ Body del release actualizado (notas + hash)');
    }
  } catch (e) {
    if (e.status !== 404) throw e;
    rel = await gh('POST', `/repos/${repo}/releases`, token, {
      tag_name: tag, name: 'BoostPilot ' + tag,
      body,
      draft: false, prerelease: false,
    });
    console.log(`  ✔ Release ${tag} creado`);
  }
  return rel;
}

async function ensureAsset(repo, rel, exePath, tag, token) {
  const name = basename(exePath);
  const norm = (s) => String(s || '').toLowerCase().replace(/[.\s]/g, '');
  const findAsset = async (r) => {
    let assets = r.assets || [];
    if (!assets.length) {
      try {
        const fresh = await gh('GET', `/repos/${repo}/releases/${r.id}`, token);
        assets = fresh.assets || [];
      } catch { /* ignore */ }
    }
    return assets.find((a) => norm(a.name) === norm(name));
  };
  const existing = await findAsset(rel);
  if (existing) { console.log(`  ✔ Asset ${name} (ya subido)`); return existing.browser_download_url; }
  const buf = readFileSync(exePath);
  const uploadUrl = rel.upload_url.replace('{?name,label}', '?name=' + encodeURIComponent(name));
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
    },
    body: buf,
  });
  if (res.status === 422) {
    const again = await findAsset(await gh('GET', `/repos/${repo}/releases/${rel.id}`, token));
    if (again) { console.log(`  ✔ Asset ${name} (ya subido)`); return again.browser_download_url; }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Subida del asset ${name}: HTTP ${res.status} :: ${text.slice(0, 400)}`);
  }
  const a = await res.json();
  console.log(`  ✔ Asset ${name} subido (${(buf.length / 1048576).toFixed(1)} MB)`);
  return a.browser_download_url;
}

async function postDownloadMessage(channelId, version, url, announcementsId, faqId, token) {
  const embed = {
    title: 'BoostPilot v' + version,
    description:
      '**BoostPilot v' + version + '** is out.\n\n' +
      '· Click the button below to download the new version\n' +
      '· Requires the key you received when buying\n' +
      '· **Release notes:** <#' + announcementsId + '>\n' +
      '· Windows shows a warning? Click **More info → Run anyway** · Help: <#' + faqId + '>',
    color: PINK,
    timestamp: new Date().toISOString(),
    footer: { text: 'BoostPilot' },
  };
  const msg = {
    embeds: [embed],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'v' + version, url }],
    }],
  };

  const pins = await api('GET', `/channels/${channelId}/pins`, token);
  const existing = pins.find((m) =>
    m.embeds && m.embeds.some((e) => e.footer && e.footer.text === 'BoostPilot')
  );
  if (existing) {
    await api('PATCH', `/channels/${channelId}/messages/${existing.id}`, token, msg);
    console.log('  ✔ Nota de descarga actualizada (v' + version + ')');
  } else {
    const sent = await api('POST', `/channels/${channelId}/messages`, token, msg);
    await api('PUT', `/channels/${channelId}/pins/${sent.id}`, token);
    console.log('  ✔ Nota de descarga fijada (v' + version + ')');
  }
}

async function postAnnouncement(channelId, version, notes, downloadsId, token) {
  const recents = await api('GET', `/channels/${channelId}/messages?limit=20`, token).catch(() => []);
  const already = (recents || []).some((m) =>
    m.content && /BoostPilot v?/.test(m.content) && m.content.includes('v' + version) && m.content.includes('is here')
  );
  if (already) {
    console.log('  ✔ #announcements ya tiene el anuncio de v' + version + ' (no se duplica)');
    return;
  }
  const content =
    '🚀 **BoostPilot v' + version + ' is here!**\n\n' +
    notes.trim() + '\n\n' +
    'Available now in <#' + downloadsId + '> — download the new version to update.';
  await api('POST', `/channels/${channelId}/messages`, token, { content });
  console.log('  ✔ Anuncio en #announcements (v' + version + ')');
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'launcher', 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = 'v' + version;
  const exePath = join(ROOT, 'release', `BoostPilot Setup ${version}.exe`);
  if (!existsSync(exePath)) {
    console.error('No existe el instalador: ' + exePath);
    console.error('  (Corré primero: npm run dist dentro de launcher/)');
    process.exit(1);
  }

  const ghConf = loadGithub();
  if (!ghConf.repo || !ghConf.token) {
    console.error('Falta state/github.json (repo + token).');
    process.exit(1);
  }

  const discord = loadConfig();
  const auth = loadAuth();
  const token = process.env.BP_DISCORD_TOKEN || auth.token;
  if (!token) { console.error('Falta el token de Discord.'); process.exit(1); }
  const channelId = process.env.BP_DISCORD_DOWNLOADS_ID || discord.ids?.downloads || discord.ids?.['⬇️downloads'];
  if (!channelId) { console.error('No se encontró el canal #downloads (corré tools/discord-setup.mjs).'); process.exit(1); }
  const announceId = process.env.BP_DISCORD_ANNOUNCEMENTS_ID || discord.ids?.announcements;
  if (!announceId) { console.error('No se encontró el canal #announcements.'); process.exit(1); }
  const faqId = process.env.BP_DISCORD_FAQ_ID || discord.ids?.faq;
  if (!faqId) { console.error('No se encontró el canal #faq.'); process.exit(1); }

  // Notas de cambios para clientes (opcional). Si existe release/notes-v<version>.md
  // se anuncia en #announcements (solo cuando hay cambios del panel que usan los
  // clientes). Sin el archivo, la publicación es silenciosa (solo #downloads).
  const notesPath = join(ROOT, 'release', 'notes-v' + version + '.md');
  let notes = null;
  try {
    const t = readFileSync(notesPath, 'utf8').trim();
    if (t) notes = t;
  } catch { /* no notes file */ }

  console.log(`\n· Publicando BoostPilot ${version}...`);
  const rel = await ensureRelease(ghConf.repo, tag, ghConf.token, notes);
  const url = await ensureAsset(ghConf.repo, rel, exePath, tag, ghConf.token);
  console.log('  URL de descarga: ' + url);

  await postDownloadMessage(channelId, version, url, announceId, faqId, token);
  if (notes) {
    await postAnnouncement(announceId, version, notes, channelId, token);
  } else {
    console.log('  (sin release/notes-v' + version + '.md → no se anuncia en #announcements)');
  }
  console.log('\n✅ Listo.');
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1); });
