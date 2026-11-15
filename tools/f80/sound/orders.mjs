// crank-order spectrum over a stretch, by angle-domain resampling along the rpm track (so a sweep doesn't smear the
// high orders): the signal is resampled at PPR points per crank revolution and FFT'd in blocks of REVS revolutions.
// Prints every order on a 0.25 grid up to --max with its level re order 3 (dB), per channel and for the mono mix.
// A real four-stroke only has lines on multiples of 0.5: lines on the quarters mean the track is off by an octave.
// usage: node orders.mjs <in.wav> <rpm.txt> <t0> <t1> [--scale 1] [--max 24] [--revs 16] [--ppr 128] [--brief 1]
import { readWav, readRpm, rpmAt, powerSpec, dB } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const [inp, rpmFile, T0, T1] = args;
const SCALE = opt('scale', 1), MAX = opt('max', 24), REVS = opt('revs', 16), PPR = opt('ppr', 128), BRIEF = opt('brief', 0), LOCK = opt('lock', 0);
const { sr, ch, mono } = readWav(inp), log = readRpm(rpmFile);
// crank angle (revolutions) at every sample from t0 to t1
const a = Math.round(T0*sr), b = Math.round(T1*sr), ang = new Float64Array(b - a);
for (let i = 1; i < ang.length; i++) ang[i] = ang[i - 1] + rpmAt(log, (a + i)/sr)*SCALE/60/sr;
// --lock o: phase-lock the track to the line of order o (heterodyne it to DC, smooth over 30 ms, add the residual
// phase back) - a 10 ms / 0.5% track is too rough to resample 16+ revolutions without smearing the high orders
if (LOCK) {
  const n = ang.length, zr = new Float64Array(n), zi = new Float64Array(n), M = Math.round(0.03*sr);
  for (let i = 0; i < n; i++) { const p = 2*Math.PI*LOCK*ang[i]; zr[i] = mono[a + i]*Math.cos(p); zi[i] = -mono[a + i]*Math.sin(p); }
  const box = v => { for (let pass = 0; pass < 3; pass++) { const c = new Float64Array(n + 1); for (let i = 0; i < n; i++) c[i + 1] = c[i] + v[i]; for (let i = 0; i < n; i++) { const lo = Math.max(0, i - (M >> 1)), hi = Math.min(n, i + (M >> 1) + 1); v[i] = (c[hi] - c[lo])/(hi - lo); } } };
  box(zr); box(zi);
  let prev = Math.atan2(zi[0], zr[0]), un = 0;
  for (let i = 0; i < n; i++) { const p = Math.atan2(zi[i], zr[i]); let d = p - prev; d -= 2*Math.PI*Math.round(d/(2*Math.PI)); un += d; prev = p; ang[i] += un/(2*Math.PI*LOCK); }
  for (let i = n - 1; i >= 0; i--) ang[i] -= ang[0];
}
const sigs = { mono, L: ch[0], R: ch[1] ?? ch[0] };
const res = {};
for (const [name, x] of Object.entries(sigs)) {
  const total = Math.floor(ang[ang.length - 1]*PPR), y = new Float32Array(total);
  let j = 0;
  for (let k = 0; k < total; k++) { const th = k/PPR; while (j < ang.length - 2 && ang[j + 1] < th) j++; const f = (th - ang[j])/((ang[j + 1] - ang[j]) || 1); y[k] = x[a + j]*(1 - f) + x[a + j + 1]*f; }
  const N = REVS*PPR, P = new Float64Array(N/2); let nb = 0;
  for (let at = 0; at + N <= total; at += N/2, nb++) { const p = powerSpec(y, at, N); for (let i = 0; i < P.length; i++) P[i] += p[i]; }
  if (!nb) { console.log(`too short: ${(ang.at(-1)).toFixed(1)} revs, need ${REVS}`); process.exit(1); }
  // order o sits at bin o*REVS; sum +-1 bin (the Hann main lobe)
  const lvl = o => { const c = Math.round(o*REVS); let s = 0; for (let i = c - 1; i <= c + 1; i++) s += P[i] || 0; return dB(s/nb); };
  res[name] = lvl;
}
const ref = res.mono(3);
console.log(`${T0}-${T1} s: ${ang.at(-1).toFixed(1)} revs, mean ${Math.round(ang.at(-1)*60/(T1 - T0))} rpm; order 3 mono ${ref.toFixed(1)} dB; levels re mono order 3`);
const rows = [];
for (let o = 0.25; o <= MAX + 1e-9; o += 0.25) {
  if (BRIEF && o % 0.5) continue;
  rows.push(`${o.toFixed(2).padStart(6)}  mono ${(res.mono(o) - ref).toFixed(1).padStart(6)}  L ${(res.L(o) - ref).toFixed(1).padStart(6)}  R ${(res.R(o) - ref).toFixed(1).padStart(6)}${o % 1.5 === 0 ? '  *' : ''}`);
}
console.log(rows.join('\n'));
