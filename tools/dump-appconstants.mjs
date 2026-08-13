import { EldoradoApi } from '../src/eldorado-api.mjs';
import fs from 'fs/promises';

const api = new EldoradoApi();
await api.init();
await api.refresh();
const res = await api.request('GET', 'appConstants');
await fs.writeFile('state/appConstants.json', JSON.stringify(res, null, 2));
console.log('appConstants guardado', JSON.stringify(res).length, 'bytes');
const s = JSON.stringify(res);
for (const kw of ['Brawl', 'EA Sports', 'FC', 'boosting', 'gameId', 'FIFA']) {
  const i = s.indexOf(kw);
  if (i >= 0) console.log('\n###', kw, '->', s.slice(Math.max(0, i - 150), i + 250));
}
