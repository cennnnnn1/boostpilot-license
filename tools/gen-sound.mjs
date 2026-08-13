import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SR = 44100;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const total = SR;
const buf = new Float64Array(total);

function bell(freq, start, dur, tau, gain) {
  const t0 = start * SR;
  const n = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(t0) + i;
    if (j >= total) break;
    const t = i / SR;
    const env = Math.exp(-t / tau);
    const v = Math.sin(2 * Math.PI * freq * t)
      + 0.55 * Math.sin(2 * Math.PI * freq * 2.01 * t)
      + 0.28 * Math.sin(2 * Math.PI * freq * 3.42 * t)
      + 0.12 * Math.sin(2 * Math.PI * freq * 4.8 * t)
      + 0.25 * Math.sin(2 * Math.PI * freq * 1.0015 * t);
    buf[j] += v * env * gain;
  }
}

for (let i = 0; i < Math.floor(0.03 * SR); i++) {
  const t = i / SR;
  buf[i] += (Math.random() * 2 - 1) * Math.exp(-t / 0.006) * 0.22;
}
for (let i = 0; i < Math.floor(0.06 * SR); i++) {
  const t = i / SR;
  buf[i] += Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.02) * 0.35;
}

bell(2093, 0.025, 0.6, 0.11, 0.34);
bell(2637, 0.13, 0.7, 0.13, 0.30);
bell(1760, 0.02, 0.5, 0.09, 0.18);

let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(buf[i]));
const norm = peak > 0 ? 0.85 / peak : 1;
for (let i = 0; i < total; i++) buf[i] *= norm;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'cash.wav');
writeFileSync(out, wav(buf));
console.log('cash.wav generado:', out);
