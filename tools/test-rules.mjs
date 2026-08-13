import { detectGame, applyFilters, resolveEta } from '../src/rules.js';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('config/rules.json', 'utf8'));

const tests = [
  'Clash Royale - Trophy Boosting Current trophies: 11800 Desired trophies: 14000 Your player tag (optional) #Q82Q2J998',
  'Brawl Stars - Custom Request Request description 74 brawlers to prestige 1 Completion Method Solo',
  'Brawl Stars - Trophy Boost Current trophies: 6200 Desired trophies: 10000',
  'EA Sports FC - Division Rivals Current division: 6 Desired division: elite',
  'EA Sports FC - Champions Finals 10 wins needed',
  'Brawl Stars - Rank Boost from Diamond to Legendary',
  'Clash Royale - Path of Legends to Ultimate Champion',
  'Valorant - Rank Boost one division',
  'Rocket League - Rank Boost current rank gold 2 desired rank diamond 1',
  'Call of Duty - Rank Boost weapon camos',
  'texto random sin juego',
];

for (const t of tests) {
  const detected = detectGame(t, config.games);
  const game = detected ? detected.name.padEnd(13) : 'SIN JUEGO'.padEnd(13);
  const filtered = applyFilters({ text: t, category: 'Trophy Boosting' }, config);
  console.log(game, '|', (filtered.skip ? 'SKIP: ' + filtered.reason : 'ok').padEnd(24), '|', t.slice(0, 45));
}

console.log('resolveEta("3-5 days") =', resolveEta('3-5 days'));
