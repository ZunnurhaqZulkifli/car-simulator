// source-filter split of a sweep: each crank-order line's level in each frame is modelled as
//   L(frame, order) = g(frame) + S(order) + H(frequency of that line)
// S = the engine's own order balance (what the pulses make), H = the response of the pipes / room / mic (resonances,
// rolloffs) on a 1/6-octave grid - separable because the same order crosses many frequencies as the rpm moves.
// Fitted by alternating least squares, S(3) = 0, H smoothed and zero-mean. Lines within 3 dB of their local floor are
// clipped to it. Needs a sweep over at least ~2:1 in rpm. Caveat: S and H are only defined up to a shared dB-per-octave
// tilt (log f = log order + log rpm, and g soaks up the rpm part), and filters that track rpm land in S - compare
// neighbouring orders here, and the absolute balance at matched rpm with table.mjs.
// usage: node fitsf.mjs <in.wav> <rpm.txt> <t0-t1>[,...] [--rmin 0] [--rmax 1e9] [--dir up|down|any] [--label x] [--maxo 12]
import { readWav, readRpm, rpmAt, powerSpec, dB } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [inp, rpmFile, segArg] = args;
const RMIN = +opt('rmin', 0), RMAX = +opt('rmax', 1e9), DIR = opt('dir', 'any'), LABEL = opt('label', ''), MAXO = +opt('maxo', 12);
const { sr, mono } = readWav(inp), log = readRpm(rpmFile);
const WIN = 4096, NFFT = 16384, df = sr/NFFT, HOP = Math.round(0.02*sr);
const ORD = []; for (let o = 0.5; o <= MAXO; o += 0.5) ORD.push(o);
const F0 = 25, BPO = 6, NB = Math.ceil(Math.log2(4000/F0)*BPO) + 1, bin = f => Math.log2(f/F0)*BPO;
const rows = []; // [frame, orderIdx, freqBin (fractional), level]
let nf = 0;
for (const [t0, t1] of segArg.split(',').map(s => s.split('-').map(Number))) for (let at = Math.round(t0*sr); at + WIN <= Math.min(mono.length, t1*sr); at += HOP) {
  const t = (at + WIN/2)/sr, r = rpmAt(log, t), slope = rpmAt(log, t + 0.03) - rpmAt(log, t - 0.03);
  if (r < RMIN || r > RMAX || (DIR === 'up' && slope <= 0) || (DIR === 'down' && slope >= 0)) continue;
  const P = powerSpec(mono, at, WIN, NFFT);
  ORD.forEach((o, k) => {
    const f = o*r/60; if (f < F0*1.2 || f > 3800) return;
    const w = Math.max(1, Math.round(f*0.012/df)), c = Math.round(f/df); let m = 0; for (let i = c - w; i <= c + w; i++) m = Math.max(m, P[i] || 0);
    const v = []; for (let i = Math.round(f*0.9/df); i <= Math.round(f*1.1/df); i++) v.push(P[i]); v.sort((x, y) => x - y);
    rows.push([nf, k, bin(f), Math.max(dB(m), dB(v[v.length >> 1]) + 3)]);
  });
  nf++;
}
if (!nf) { console.log(`${LABEL}: no frames`); process.exit(0); }
const g = new Float64Array(nf), S = new Float64Array(ORD.length), H = new Float64Array(NB);
const Hat = b => { const i = Math.min(NB - 2, Math.max(0, Math.floor(b))), f = Math.min(1, Math.max(0, b - i)); return H[i]*(1 - f) + H[i + 1]*f; };
for (let it = 0; it < 80; it++) {
  // frame gains
  const gs = new Float64Array(nf), gn = new Float64Array(nf);
  for (const [fr, k, b, L] of rows) { gs[fr] += L - S[k] - Hat(b); gn[fr]++; }
  for (let i = 0; i < nf; i++) g[i] = gn[i] ? gs[i]/gn[i] : 0;
  // order balance
  const ss = new Float64Array(ORD.length), sn = new Float64Array(ORD.length);
  for (const [fr, k, b, L] of rows) { ss[k] += L - g[fr] - Hat(b); sn[k]++; }
  for (let k = 0; k < ORD.length; k++) S[k] = sn[k] ? ss[k]/sn[k] : NaN;
  const s3 = S[ORD.indexOf(3)]; for (let k = 0; k < ORD.length; k++) S[k] -= s3;
  // response: residuals shared to the two grid points by the interpolation weights, then smoothed
  const hs = new Float64Array(NB), hn = new Float64Array(NB);
  for (const [fr, k, b, L] of rows) { const i = Math.min(NB - 2, Math.floor(b)), f = b - i, e = L - g[fr] - (S[k] || 0); hs[i] += e*(1 - f); hn[i] += 1 - f; hs[i + 1] += e*f; hn[i + 1] += f; }
  for (let i = 0; i < NB; i++) H[i] = hn[i] > 0.5 ? hs[i]/hn[i] : H[i];
  const Hs = H.map((v, i) => (H[Math.max(0, i - 1)] + 2*v + H[Math.min(NB - 1, i + 1)])/4); H.set(Hs);
  let m = 0, n = 0; for (let i = 0; i < NB; i++) if (hn[i] > 0.5) { m += H[i]; n++; } for (let i = 0; i < NB; i++) H[i] -= m/n;
}
let res = 0; for (const [fr, k, b, L] of rows) res += (L - g[fr] - S[k] - Hat(b)) ** 2;
console.log(`${LABEL}: ${nf} frames, ${rows.length} lines, rms residual ${Math.sqrt(res/rows.length).toFixed(1)} dB`);
console.log('  S(order) re 3: ' + ORD.map((o, k) => `${o}:${isNaN(S[k]) ? '-' : S[k].toFixed(0)}`).join(' '));
const used = new Set(rows.map(r => Math.round(r[2])));
console.log('  H(f) dB: ' + [...Array(NB).keys()].filter(i => used.has(i)).map(i => `${Math.round(F0*2 ** (i/BPO))}:${H[i].toFixed(0)}`).join(' '));
