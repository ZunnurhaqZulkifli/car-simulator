// rpm from the sound of a six: tracks the firing frequency (order 3, f = rpm/20) frame by frame and joins the frames
// with a Viterbi path (rpm can't jump), so blips and pulls come out as one continuous curve.
// usage: node track.mjs <in.wav> <out.txt> [--cyl 6] [--min 500] [--max 8200] [--hop 0.01]
// out: "t rpm conf level" per frame. conf = how far the harmonic comb stands above the frame's own floor (dB);
//      under ~4 there is no engine to speak of (gaps, silence, wind)
import { writeFileSync } from 'node:fs';
import { readWav, powerSpec } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const [inp, outp] = args;
const CYL = opt('cyl', 6), RMIN = opt('min', 500), RMAX = opt('max', 8200), HOP = opt('hop', 0.01);
const ORD = CYL/2; // firing order
const { sr, mono } = readWav(inp);
const WIN = 4096*Math.round(sr/44100) || 4096, NFFT = WIN*4, df = sr/NFFT;
const hop = Math.round(HOP*sr), nFr = Math.floor((mono.length - WIN)/hop);
const fmin = RMIN/60*ORD, fmax = RMAX/60*ORD, STEP = 1.005;
const cands = []; for (let f = fmin; f <= fmax; f *= STEP) cands.push(f);
const NC = cands.length, NH = 8, TOP = Math.ceil(fmax*NH*1.03/df) + 40;

const score = new Float32Array(nFr*NC), level = new Float32Array(nFr);
const R = new Float64Array(TOP);
for (let fr = 0; fr < nFr; fr++) {
  const P = powerSpec(mono, fr*hop, WIN, NFFT);
  let e = 0; for (let i = 1; i < TOP; i++) e += P[i];
  level[fr] = 10*Math.log10(e + 1e-20);
  // whiten: log spectrum minus its local mean (+-40 Hz), clipped at 0 - peaks above their neighbourhood
  const L = new Float64Array(TOP + 1); for (let i = 0; i < TOP; i++) L[i] = 10*Math.log10(P[i] + 1e-14);
  const cs = new Float64Array(TOP + 1); for (let i = 0; i < TOP; i++) cs[i + 1] = cs[i] + L[i];
  const half = Math.round(40/df);
  for (let i = 0; i < TOP; i++) { const a = Math.max(0, i - half), b = Math.min(TOP, i + half + 1); R[i] = Math.max(0, L[i] - (cs[b] - cs[a])/(b - a)); }
  const at = f => { const c = f/df, w = Math.max(1, Math.round(c*0.006)); let m = 0; for (let i = Math.round(c) - w; i <= Math.round(c) + w; i++) if (i > 0 && i < TOP) m = Math.max(m, R[i]); return m; };
  // the comb: firing-order harmonics full weight, the half orders between them (one per two revolutions of a
  // half-engine) half weight - so order 1.5 (its subharmonic) can't win the track
  for (let c = 0; c < NC; c++) {
    const f = cands[c]; let s = 0;
    for (let k = 1; k <= NH; k++) s += at(k*f) + 0.5*at((k - 0.5)*f);
    score[fr*NC + c] = s/NH;
  }
}
// Viterbi: maximise summed score less a cost per candidate step between frames (rpm can't jump)
const JUMP = 14, LAMBDA = 0.35;
let prev = new Float64Array(NC), cur = new Float64Array(NC);
const back = new Int16Array(nFr*NC);
for (let c = 0; c < NC; c++) prev[c] = score[c];
for (let fr = 1; fr < nFr; fr++) {
  for (let c = 0; c < NC; c++) {
    let best = -1e9, bi = c;
    for (let d = -JUMP; d <= JUMP; d++) { const j = c + d; if (j < 0 || j >= NC) continue; const v = prev[j] - LAMBDA*Math.abs(d); if (v > best) { best = v; bi = j; } }
    cur[c] = best + score[fr*NC + c]; back[fr*NC + c] = bi;
  }
  [prev, cur] = [cur, prev];
}
let c = 0; for (let j = 1; j < NC; j++) if (prev[j] > prev[c]) c = j;
const path = new Int32Array(nFr);
for (let fr = nFr - 1; fr >= 0; fr--) { path[fr] = c; c = back[fr*NC + c]; }
const lines = [];
for (let fr = 0; fr < nFr; fr++) {
  const t = (fr*hop + WIN/2)/sr, f = cands[path[fr]];
  lines.push(`${t.toFixed(3)} ${Math.round(f*60/ORD)} ${score[fr*NC + path[fr]].toFixed(1)} ${level[fr].toFixed(1)}`);
}
writeFileSync(outp, lines.join('\n') + '\n');
console.log(`${nFr} frames, ${NC} candidates (${RMIN}-${RMAX} rpm) -> ${outp}`);
