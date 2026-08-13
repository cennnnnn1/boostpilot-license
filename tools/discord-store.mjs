/* Persist config for the Discord server setup / ticket bot. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const configPath = () => process.env.BP_DISCORD_CONFIG || join(ROOT, 'state', 'discord.json');

export function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(cfg) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

export function loadAuth() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'state', 'discord.auth.json'), 'utf8'));
  } catch {
    return {};
  }
}
