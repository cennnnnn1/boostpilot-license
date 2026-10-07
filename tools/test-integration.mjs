import fs from 'node:fs';
import path from 'node:path';
import { detectGame, applyFilters, resolveEta, humanSummary } from '../src/rules.js';

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, 'config', 'rules.json');
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const GAMES = CFG.games;

let pass = 0;
let fail = 0;
const fails = [];

function same(a, b) {
  return String(a) === String(b);
}

function assert(name, cond, want, got) {
  if (cond) {
    pass += 1;
    console.log('ok   ' + name + ' -> ' + String(got));
  } else {
    fail += 1;
    fails.push(name + ' want=' + String(want) + ' got=' + String(got));
    console.log('FAIL ' + name + ' want=' + String(want) + ' got=' + String(got));
  }
}

function findGameKey(name) {
  return Object.keys(GAMES).find((k) => k === name) || null;
}

function testDetectIdent(name, text, wantKey) {
  const gk = detectGame(text, GAMES);
  const got = gk ? gk.key : gk && gk.name ? gk.name : (gk || {}).key || (gk || {}).name || null;
  const key = detectGame(text, GAMES);
  const ck = key && key.key ? key.key : key && key.name ? key.name : null;
  assert(name, same(ck, wantKey), wantKey, ck);
}

function testWhitelist(name, text, wantSkip) {
  const gk = detectGame(text, GAMES);
  const ck = gk && gk.key ? gk.key : gk && gk.name ? gk.name : null;
  if (!ck) {
    fail += 1;
    fails.push(name + ': no game detected');
    console.log('FAIL ' + name + ': no game detected');
    return;
  }
  const r = applyFilters({ text, category: null, game: ck }, CFG);
  const skip = !!(r && r.skip);
  assert(name, same(skip, wantSkip), wantSkip, skip);
}

testDetectIdent('detect-fc26', 'EA FC 26 rank boost pc account', 'fc26');
testDetectIdent('detect-valorant', 'valorant rank boost pc', 'valorant');
testDetectIdent('detect-clash', 'clash royale trophy boost', 'clash_royale');
testDetectIdent('detect-nogame', 'tomates y cebollas al horno', null);

testWhitelist('veto-fc26-switch', 'EA FC 26 rank boost switch account', true);
testWhitelist('veto-valorant-ps5', 'valorant rank boost playstation 5', true);
testWhitelist('veto-valorant-xbox', 'valorant rank boost xbox', true);
testWhitelist('ok-fortnite-switch', 'fortnite rank boost switch', false);
testWhitelist('ok-fc26-pc', 'EA FC 26 rank boost pc', false);
testWhitelist('ok-clash-mobile', 'clash royale trophy boost android phone', false);

const eta = resolveEta(3);
assert('resolveEta-int', typeof eta === 'string' && eta.length > 0, typeof eta, typeof eta盡);
const sum = humanSummary('   ' + 'valorant rank boost pc  '.repeat(3) + '  ');
const sumOk = typeof sum === 'string' && sum.includes('valorant');
assert('humanSummary-md', sumOk, true, sumOk);

console.log('INT_PASS=' + pass);
console.log('INT_FAIL=' + fail);
if (fail > 0) {
  console.log('INT_FAILURES=' + fails.join(' | '));
  process.exit(1);
} else {
  console.log('INT_OK whitelist real activa en ' + Object.keys(GAMES).length + ' juegos');
  process.exit(0);
}
