// self-check for the analysis scripts: a synthetic six sweeping 2,000 -> 5,000 rpm - every 1.5 multiple to order 24, the
// six's own (3, 6, 9 ...) falling 2 dB a step, the half-engine ones 12 dB under, order 1.5 at -10 and 6 at -6 - must
// come back out of track.mjs (rpm within 2%) and orders.mjs --lock (levels within 1.5 dB). usage: node selftest.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { writeWav, readRpm, rpmAt, aWeight, dB } from './lib.mjs';

assert.ok(Math.abs(dB(aWeight(1000))) < 0.1, 'A-weighting is 0 dB at 1 kHz');
const here = dirname(fileURLToPath(import.meta.url)), dir = mkdtempSync(join(tmpdir(), 'f80snd-'));
try {
  const sr = 44100, T = 3, n = sr*T, x = new Float32Array(n), rpm = t => 2000 + 1000*t;
  let rev = 0;
  for (let i = 0; i < n; i++) { rev += rpm(i/sr)/60/sr; const p = 2*Math.PI*rev;
    let v = 0.01*(Math.random()*2 - 1);
    for (let k = 1; k <= 16; k++) { const o = 1.5*k, db = o === 1.5 ? -10 : o === 6 ? -6 : k % 2 ? -12 - (k - 1) : -2*(k/2 - 1); v += 0.1*10 ** (db/20)*Math.sin(o*p + k); }
    x[i] = v; }
  writeWav(join(dir, 's.wav'), sr, [x, x]);
  execFileSync(process.execPath, [join(here, 'track.mjs'), join(dir, 's.wav'), join(dir, 'r.txt')]);
  const log = readRpm(join(dir, 'r.txt'));
  for (const t of [0.5, 1.5, 2.5]) assert.ok(Math.abs(rpmAt(log, t)/rpm(t) - 1) < 0.02, `track at ${t} s: ${rpmAt(log, t)} vs ${rpm(t)}`);
  const out = execFileSync(process.execPath, [join(here, 'orders.mjs'), join(dir, 's.wav'), join(dir, 'r.txt'), 0.3, 2.7, '--lock', 3, '--brief', 1, '--max', 6], { encoding: 'utf8' });
  const lv = o => +out.match(new RegExp(`^\\s*${o.toFixed(2)}\\s+mono\\s+(-?[\\d.]+)`, 'm'))[1];
  assert.ok(Math.abs(lv(1.5) + 10) < 1.5 && Math.abs(lv(6) + 6) < 1.5, `orders 1.5 / 6: ${lv(1.5)} / ${lv(6)} dB`);
  console.log('ok: A-weighting, track.mjs, orders.mjs --lock');
} finally { rmSync(dir, { recursive: true, force: true }); }
