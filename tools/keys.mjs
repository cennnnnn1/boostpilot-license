import { generateKeys, listKeys, revokeKey, extendKey, getSubscription } from '../src/keys.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name, dflt) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fmt(iso) {
  if (!iso) return 'al activar';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

if (cmd === 'generate') {
  const days = parseInt(flag('days', '30'), 10);
  const count = parseInt(flag('count', '1'), 10);
  const owner = flag('owner', 'Cliente');
  const plan = flag('plan', '');
  const note = flag('note', '');
  const keys = generateKeys({ owner, days, count, plan, note });
  console.log('Llaves generadas (' + keys.length + '):');
  keys.forEach((k) => console.log('  ' + k.key + '  [' + (k.plan || k.days + ' días') + ']  dueño: ' + k.owner));
} else if (cmd === 'list') {
  const rows = listKeys();
  if (!rows.length) {
    console.log('No hay llaves todavía.');
    process.exit(0);
  }
  console.log(pad('LLAVE', 22) + pad('DUEÑO', 14) + pad('PLAN', 12) + pad('ESTADO', 10) + 'RESTANTE');
  rows.forEach((r) => {
    const sub = getSubscription(r);
    const estado = !r.active ? 'revocada' : (sub.expired ? 'vencida' : 'activa');
    const restante = !r.active ? '-' : (sub.activatedAt ? sub.daysLeft + ' días (vence ' + fmt(r.expiresAt) + ')' : r.days + ' días (sin activar)');
    console.log(pad(r.key, 22) + pad(r.owner || '', 14) + pad(r.plan || '', 12) + pad(estado, 10) + restante);
  });
} else if (cmd === 'revoke') {
  const raw = args[1];
  if (!raw) {
    console.log('Uso: node tools/keys.mjs revoke <LLAVE>');
    process.exit(1);
  }
  const out = revokeKey(raw);
  if (out.ok) console.log('Llave revocada: ' + out.key);
  else console.log('Error: ' + out.error);
} else if (cmd === 'extend') {
  const raw = args[1];
  const extra = parseInt(flag('days', '30'), 10);
  if (!raw) {
    console.log('Uso: node tools/keys.mjs extend <LLAVE> --days 30');
    process.exit(1);
  }
  const out = extendKey(raw, extra);
  if (out.ok) console.log('Extendida ' + out.key + ': ahora ' + out.days + ' días. Vence: ' + (out.expiresAt ? fmt(out.expiresAt) : 'al activar'));
  else console.log('Error: ' + out.error);
} else {
  console.log('Uso: node tools/keys.mjs <comando> [opciones]');
  console.log('  generate  --owner "Nombre" --days 30 [--count 5] [--plan "Mensual"] [--note "x"]');
  console.log('  list');
  console.log('  revoke    <LLAVE>');
  console.log('  extend    <LLAVE> --days 30');
}
