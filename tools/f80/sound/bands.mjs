// the numbers to fit a synth by: over the frames of some stretches (optionally only those in an rpm range, rising or
// falling), the A-weighted octave bands re the A-weighted total, the A-weighted centroid, the crank-order levels re
// order 3, and the rasp - the noise floor between the harmonics (median of each 1/3 octave), its A-weighted centre
// and the span within 6 dB of its top.
// usage: node bands.mjs <in.wav> <rpm.txt> <t0-t1>[,<t0-t1>...] [--rmin 0] [--rmax 1e9] [--dir up|down|any] [--label x]
import { readWav, readRpm, rpmAt, powerSpec, aWeight, dB } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [inp, rpmFile, segArg] = args;
const RMIN = +opt('rmin', 0), RMAX = +opt('rmax', 1e9), DIR = opt('dir', 'any'), LABEL = opt('label', '');
const { sr, mono } = readWav(inp), log = readRpm(rpmFile);
const WIN = 4096, NFFT = 16384, df = sr/NFFT, HOP = Math.round(0.02*sr);
const segs = segArg.split(',').map(s => s.split('-').map(Number));
const OCT = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000], ORD = [0.5, 1, 1.5, 2, 3, 4.5, 6, 7.5, 9, 12];
const third = []; for (let f = 250; f <= 10000; f *= 2 ** (1/3)) third.push(f);
const acc = { n: 0, A: 0, oct: OCT.map(() => 0), cen: 0, ord: ORD.map(() => 0), floor: third.map(() => 0), rpm: 0 };
for (const [t0, t1] of segs) for (let at = Math.round(t0*sr); at + WIN <= Math.min(mono.length, t1*sr); at += HOP) {
  const t = (at + WIN/2)/sr, r = rpmAt(log, t), slope = rpmAt(log, t + 0.03) - rpmAt(log, t - 0.03);
  if (r < RMIN || r > RMAX || (DIR === 'up' && slope <= 0) || (DIR === 'down' && slope >= 0)) continue;
  const P = powerSpec(mono, at, WIN, NFFT);
  let A = 0, c = 0;
  for (let i = 1; i < P.length; i++) { const f = i*df; if (f < 20) continue; const pa = P[i]*aWeight(f); A += pa; c += pa*f;
    const o = OCT.findIndex(fc => f < fc*Math.SQRT2); if (o >= 0 && f >= OCT[0]/Math.SQRT2) acc.oct[o] += pa; }
  acc.A += A; acc.cen += c;
  ORD.forEach((o, k) => { const f = o*r/60, lo = Math.floor(f*0.985/df), hi = Math.ceil(f*1.015/df); let m = 0; for (let i = lo; i <= hi; i++) m = Math.max(m, P[i] || 0); acc.ord[k] += m; });
  third.forEach((fc, k) => { const lo = Math.round(fc/2 ** (1/6)/df), hi = Math.round(fc*2 ** (1/6)/df), v = []; for (let i = lo; i <= hi; i++) v.push(P[i]); v.sort((x, y) => x - y); acc.floor[k] += v[v.length >> 1]*aWeight(fc); });
  acc.rpm += r; acc.n++;
}
if (!acc.n) { console.log(`${LABEL}: no frames`); process.exit(0); }
const tot = acc.A, octS = OCT.map((f, i) => `${f >= 1000 ? f/1000 + 'k' : f}:${(dB(acc.oct[i]) - dB(tot)).toFixed(0)}`).join(' ');
const o3 = acc.ord[ORD.indexOf(3)], ordS = ORD.map((o, k) => `${o}:${(dB(acc.ord[k]) - dB(o3)).toFixed(0)}`).join(' ');
const fl = acc.floor.map(v => dB(v/acc.n)), top = Math.max(...fl), span = third.filter((f, k) => fl[k] > top - 6);
let fc = 0, fw = 0; third.forEach((f, k) => { const p = acc.floor[k]; fc += p*Math.log2(f); fw += p; });
console.log(`${LABEL.padEnd(14)} ${String(acc.n).padStart(4)} fr, ${Math.round(acc.rpm/acc.n)} rpm | A ${(dB(tot/acc.n)).toFixed(1)} dB, centroid ${Math.round(acc.cen/acc.A)} Hz`);
console.log(`   A-oct re total: ${octS}`);
console.log(`   orders re 3:    ${ordS}`);
console.log(`   rasp floor: centre ${Math.round(2 ** (fc/fw))} Hz, within 6 dB ${Math.round(span[0])}-${Math.round(span.at(-1))} Hz, floor re A-total ${(dB(acc.floor.reduce((s, v) => s + v, 0)/df) - dB(tot)).toFixed(1)} dB (per Hz, sr-independent)`);
