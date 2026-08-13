import { EldoradoApi } from '../src/eldorado-api.mjs';
import fs from 'fs/promises';

const api = new EldoradoApi();
await api.init();
await api.refresh();
const res = await api.request('GET', 'library', undefined, { locale: 'en-US' });
await fs.writeFile('state/library.json', JSON.stringify(res, null, 2));
console.log('library guardado', JSON.stringify(res).length, 'bytes');
console.log(JSON.stringify(res).slice(0, 300));
