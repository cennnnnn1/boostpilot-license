import fs from 'fs/promises';

const lib = JSON.parse(await fs.readFile('state/library.json', 'utf8'));
const boosting = lib.filter((g) => g.category === 'RequestedBoosting');
console.log('juegos boosting:', boosting.length);
const map = {};
for (const g of boosting) {
  map[g.gameId] = { name: g.gameName, seoAlias: g.seoAlias };
  console.log(`${g.gameId}\t${g.gameName}`);
}
await fs.writeFile('state/game_map.json', JSON.stringify(map, null, 2));
console.log('\nmapa guardado en state/game_map.json');
