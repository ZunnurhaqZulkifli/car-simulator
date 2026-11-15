// spectrogram PNG, optionally with the rpm track's crank orders drawn over it (to check a track, or to see which
// orders carry the sound). Labels via ImageMagick.
// usage: node spec.mjs <in.wav> <out.png> [--rpm rpm.txt] [--orders 1.5,3,6] [--t0 0] [--t1 end] [--fmax 1500]
//          [--fmin 20 --log 1] [--w 1400] [--h 500] [--range 70] [--title text] [--cyl 6]
import { execFileSync } from 'node:child_process';
import { readWav, powerSpec, readRpm, rpmAt, writePng, heat } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [inp, outp] = args;
const { sr, mono } = readWav(inp);
const T0 = +opt('t0', 0), T1 = +opt('t1', mono.length/sr), FMAX = +opt('fmax', 1500), FMIN = +opt('fmin', 20), LOG = opt('log', '0') === '1';
const W = +opt('w', 1400), H = +opt('h', 500), RANGE = +opt('range', 70), TITLE = opt('title', '');
const rpmLog = opt('rpm') ? readRpm(opt('rpm')) : null, ORDERS = opt('orders', '3').split(',').map(Number);
const WIN = FMAX > 3000 ? 2048 : 4096, NFFT = WIN*2, df = sr/NFFT;
const yToF = y => LOG ? FMIN*(FMAX/FMIN) ** (1 - y/(H - 1)) : FMAX*(1 - y/(H - 1));
const fToY = f => LOG ? (H - 1)*(1 - Math.log(f/FMIN)/Math.log(FMAX/FMIN)) : (H - 1)*(1 - f/FMAX);
const cols = [];
let peak = -200;
for (let x = 0; x < W; x++) {
  const t = T0 + (T1 - T0)*x/(W - 1), P = powerSpec(mono, Math.round(t*sr - WIN/2), WIN, NFFT), col = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const fa = yToF(y + 0.5), fb = yToF(y - 0.5); // the pixel's band: the strongest bin in it
    let m = 0; for (let i = Math.max(1, Math.floor(fa/df)); i <= Math.ceil(fb/df) && i < P.length; i++) m = Math.max(m, P[i]);
    col[y] = 10*Math.log10(m + 1e-20); peak = Math.max(peak, col[y]);
  }
  cols.push(col);
}
const rgb = new Uint8Array(W*H*3);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const c = heat((cols[x][y] - peak + RANGE)/RANGE); rgb.set(c, (y*W + x)*3); }
// orders over it: cyan dots on order 3 (the firing order of a six), green on the others
if (rpmLog) for (let x = 0; x < W; x += 2) {
  const t = T0 + (T1 - T0)*x/(W - 1), r = rpmAt(rpmLog, t);
  for (const o of ORDERS) { const y = Math.round(fToY(o*r/60)); if (y >= 0 && y < H) rgb.set(o === 3 ? [0, 255, 255] : [80, 255, 80], (y*W + x)*3); }
}
const raw = outp.replace(/\.png$/, '') + '.raw.png';
writePng(raw, W, H, rgb);
// axes: time ticks along the bottom, frequency ticks on the left
const draws = [];
const tStep = [0.5, 1, 2, 5, 10].find(s => (T1 - T0)/s <= 16) || 20;
for (let t = Math.ceil(T0/tStep)*tStep; t <= T1; t += tStep) { const x = 60 + Math.round((t - T0)/(T1 - T0)*(W - 1)); draws.push('-draw', `stroke #888 line ${x},${H + 30} ${x},${H + 36}`, '-annotate', `+${x - 10}+${H + 50}`, `${+t.toFixed(1)}s`); }
const fTicks = LOG ? [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] : Array.from({ length: 11 }, (_, i) => Math.round(FMAX*i/10));
for (const f of fTicks) { if (f < FMIN || f > FMAX) continue; const y = 30 + Math.round(fToY(f)); draws.push('-draw', `stroke #888 line 54,${y} 60,${y}`, '-annotate', `+2+${y + 4}`, f >= 1000 ? `${f/1000}k` : `${f}`); }
execFileSync('magick', [raw, '-background', '#111', '-gravity', 'northwest', '-splice', '60x30', '-gravity', 'southeast', '-splice', '0x30', '-gravity', 'northwest',
  '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-fill', '#ddd', '-stroke', 'none', '-pointsize', '13', '-annotate', '+66+8', TITLE + (rpmLog ? `   (lines: orders ${ORDERS.join(', ')} of the rpm track; cyan = 3)` : ''),
  '-fill', '#ccc', ...draws, outp]);
execFileSync('rm', [raw]);
console.log(outp);
