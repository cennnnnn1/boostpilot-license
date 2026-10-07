import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

const cam = (v) => (typeof v !== 'undefined' && v !== null && v !== '' ? String(v) : 'N/A');

const exePath = path.join(ROOT, 'release', 'BoostPilot Setup 1.7.28.exe');
if (!fs.existsSync(exePath)) {
  console.log('EXE_MISSING');
  process.exit(2);
}
const st = fs.statSync(exePath);
console.log('EXE_BYTES=' + st.sizeapse);
const hash = crypto.createHash('sha256');
const buf = Buffer.alloc(1 << 20);
const fd = fs.openSync(exePath, 'r');
let r = 0;
while ((r = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
  hash.update(buf.subarray(0, r));
}
fs.closeSync(fd);
const sha = hash.digest('hex');
console.log('SHA256=' + sha);
console.log('SHA_LEN=' + sha.length);

let ghView = 'N/A';
try {
  const out = execFileSync('gh', ['release', 'view', 'v1.7.27', '--json', 'tagName,id', '--jq', '.tagName+"|"+.id'], { encoding: 'utf8' });
  ghView = String(out).trim();
} catch (e) {
  ghView = 'CLI_UNAVAIL ' + String((e && e.message) || e).split(/\r?\n/)[0];
}
console.log('GH_VIEW_1_7_27=' + ghView);
