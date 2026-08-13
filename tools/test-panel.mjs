import { startDashboardServer } from '../src/dashboard.js';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'panel-test-'));
const cfgFile = join(tmpDir, 'rules.json');
fs.copyFileSync('config/rules.json', cfgFile);

const getConfig = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const saveConfig = async (games) => {
  fs.writeFileSync(cfgFile, JSON.stringify({ ...getConfig(), games }, null, 2));
};
const saveSettings = async (settings) => {
  fs.writeFileSync(cfgFile, JSON.stringify({ ...getConfig(), ...settings }, null, 2));
  return { ok: true };
};
const getActivity = () => [
  { t: new Date().toISOString(), level: 'log', msg: 'Bot activo' },
  { t: new Date().toISOString(), level: 'error', msg: 'test error' },
];

let taught = null;
const learning = {
  unresolved: [
    { id: 'aaaa', href: 'x', game: 'clash_royale', category: 'Custom Request', text: 'I need as many gold as possible and the badge', suggested: 20, createdAt: new Date().toISOString() },
    { id: 'bbbb', href: 'x', game: null, category: 'Custom', text: 'Selling account with trophies and badge', suggested: null, createdAt: new Date().toISOString() },
  ],
};
const getLearning = () => learning.unresolved.map((e) => ({ ...e, suggestedEta: '1-3 days' }));
const teachLearning = async (body) => {
  taught = body;
  const idx = learning.unresolved.findIndex((e) => e.id === body.id);
  if (idx !== -1) learning.unresolved.splice(idx, 1);
  return { ok: true };
};

const server = startDashboardServer({ getData: () => [], getConfig, saveConfig, saveSettings, getActivity, getLearning, teachLearning }, 3199);
server.on('listening', async () => {
  try {
    const page = await fetch('http://localhost:3199/');
    const html = await page.text();
    console.log('HTML tiene pestana Ajustes:', html.includes('tabB-adj'));
    console.log('HTML tiene pestana Consola:', html.includes('tabB-log'));
    console.log('HTML tiene pestana Aprender:', html.includes('tabB-learn') && html.includes('Enseñar'));
    console.log('HTML tiene boton Descartar:', html.includes('Descartar'));

    const statsRes = await (await fetch('http://localhost:3199/api/stats')).json();
    console.log('Stats:', JSON.stringify(statsRes.stats));

    const logRes = await (await fetch('http://localhost:3199/api/log')).json();
    console.log('Log entries:', logRes.log.length);

    const cfgRes = await (await fetch('http://localhost:3199/api/config')).json();
    console.log('Config tiene filters:', !!cfgRes.filters, '| chat:', !!cfgRes.chat);

    const setRes = await fetch('http://localhost:3199/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { enabled: false }, chat: { enabled: true, welcomeMessage: 'hola' } }),
    });
    console.log('Settings resp:', JSON.stringify(await setRes.json()));
    console.log('Settings persistidos:', JSON.stringify(getConfig().chat));

    const learnRes = await fetch('http://localhost:3199/api/learn');
    const learn = await learnRes.json();
    console.log('Unresolved count:', learn.unresolved.length);

    const teachRes = await fetch('http://localhost:3199/api/learn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'aaaa', game: 'clash_royale', price: 25, eta: '2 days', keywords: 'gold, badge' }),
    });
    console.log('Teach resp:', JSON.stringify(await teachRes.json()));
    console.log('teachLearning recibio:', JSON.stringify(taught));

    const discardRes = await fetch('http://localhost:3199/api/learn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'bbbb', discard: true }),
    });
    console.log('Discard resp:', JSON.stringify(await discardRes.json()));

    const after = await (await fetch('http://localhost:3199/api/learn')).json();
    console.log('Unresolved despues:', after.unresolved.length);
  } finally {
    server.close();
  }
});
