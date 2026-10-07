import { detectPlatform } from '../src/rules.js';

const CASES = [
  ['pc', 'PC - Rank Boost one division'],
  ['pc', 'windows account steam boost'],
  ['playstation', 'playstation 5 rank boost ps5'],
  ['playstation', 'psn account desired rank'],
  ['xbox', 'xbox series x boosting'],
  ['xbox', 'xb1 rank boost'],
  ['switch', 'nintendo switch rank boost'],
  ['switch', 'wii u boosting'],
  ['mobile', 'ios account boosting'],
  ['mobile', 'android phone rank boost'],
  [null, 'no platform mentioned'],
  [null, 'rank boost only'],
];

let pass = 0;
let fail = 0;
for (const [expect, text] of CASES) {
  const got = detectPlatform(text);
  const ok = got === expect;
  if (ok) pass += 1; else fail += 1;
  console.log((ok ? 'ok ' : 'FAIL') + ' expect=' + String(expect) + ' got=' + String(got) + ' | ' + text);
}
console.log('PLATFORM_TESTS=' + pass + '/' + CASES.length);
if (fail > 0) process.exit(1);
