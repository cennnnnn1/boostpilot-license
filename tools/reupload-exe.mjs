import { readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const gh = JSON.parse(readFileSync(join(ROOT, 'state', 'github.json'), 'utf-8'));
const token = gh.token;
const repo = gh.repo;
const tag = 'v' + pkg.version;
const hdr = `-H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json"`;
const exe = join(ROOT, 'release', `BoostPilot Setup ${pkg.version}.exe`);

function ghFetch(url, method = 'GET', body) {
  const parts = [`curl -s -H "Authorization: token ${token}"`];
  let tmp;
  if (body !== undefined) {
    tmp = join(ROOT, 'state', `.release-body-${Date.now()}.json`);
    writeFileSync(tmp, JSON.stringify(body), 'utf-8');
    parts.push(`-X ${method} -H "Content-Type: application/json" --data-binary "@${tmp}"`);
  } else if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }
  parts.push(`"${url}"`);
  let out;
  try {
    out = execSync(parts.join(' '), { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch (e) {
    throw new Error('Fallo de curl: ' + (e.status || ''));
  }
  if (tmp) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
  let json;
  if (!out.trim()) return undefined;
  try {
    json = JSON.parse(out);
  } catch {
    throw new Error('Respuesta no-JSON de GitHub: ' + out.slice(0, 200));
  }
  if (json.message && json.documentation_url) {
    throw new Error(`GitHub API error: ${json.message}`);
  }
  return json;
}

// Find release by tag, create if missing
let release;
try {
  release = ghFetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`);
  if (!release.id) throw new Error('not found');
} catch (e) {
  console.log(`Release ${tag} not found, creating...`);
  release = ghFetch(`https://api.github.com/repos/${repo}/releases`, 'POST', {
    tag_name: tag,
    name: `BoostPilot ${tag}`,
    draft: false,
    prerelease: false,
  });
  console.log('Created release:', release.id);
}
console.log('Release ID:', release.id);

for (const a of release.assets || []) {
  console.log(`Deleting ${a.name} (id=${a.id})...`);
  ghFetch(`https://api.github.com/repos/${repo}/releases/assets/${a.id}`, 'DELETE');
}

console.log('Uploading new exe...');
const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=BoostPilot.Setup.${pkg.version}.exe`;
const cmd = `curl -s -X POST ${hdr} -H "Content-Type: application/octet-stream" --data-binary "@${exe}" "${uploadUrl}"`;
const uploaded = JSON.parse(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
console.log('Uploaded:', uploaded.name, uploaded.size, 'bytes');
console.log('URL:', uploaded.browser_download_url);