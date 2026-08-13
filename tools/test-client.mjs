import { EldoradoApi } from '../src/eldorado-api.mjs';

const api = new EldoradoApi();
await api.init();
await api.refresh();
const list = await api.getReceivedRequests();
for (const r of list.results.slice(0, 3)) {
  console.log(JSON.stringify(r, null, 2));
  console.log('---');
}
