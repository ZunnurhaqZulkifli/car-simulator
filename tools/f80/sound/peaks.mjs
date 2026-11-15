// the strongest spectral lines in a steady stretch (idle, a held rpm) - long window, fine resolution. Their spacing
// gives the base frequency, which settles which line is which order.
// usage: node peaks.mjs <in.wav> <t0> <t1> [fmax 1200] [n 25]
import { readWav, powerSpec, dB } from './lib.mjs';
const [inp, t0, t1, fmax = 1200, n = 25] = process.argv.slice(2);
const { sr, mono } = readWav(inp);
const a = Math.round(t0*sr), b = Math.round(t1*sr), WIN = 1 << Math.floor(Math.log2(b - a)), NFFT = WIN*4, df = sr/NFFT;
// average overlapping windows if the stretch is long enough
const P = new Float64Array(NFFT/2); let k = 0;
for (let at = a; at + WIN <= b; at += WIN/2, k++) { const p = powerSpec(mono, at, WIN, NFFT); for (let i = 0; i < P.length; i++) P[i] += p[i]; }
const top = Math.round(fmax/df), pk = [];
for (let i = 2; i < top; i++) if (P[i] > P[i - 1] && P[i] >= P[i + 1]) {
  const y0 = dB(P[i - 1]), y1 = dB(P[i]), y2 = dB(P[i + 1]), d = 0.5*(y0 - y2)/(y0 - 2*y1 + y2);
  pk.push([(i + d)*df, y1 - 10*Math.log10(k)]);
}
pk.sort((x, y) => y[1] - x[1]);
const best = pk.slice(0, n).sort((x, y) => x[0] - y[0]), ref = Math.max(...best.map(p => p[1]));
console.log(`${t0}-${t1} s, window ${WIN} (${(WIN/sr).toFixed(2)} s), resolution ${df.toFixed(2)} Hz`);
console.log(best.map(([f, l]) => `${f.toFixed(1)} Hz ${(l - ref).toFixed(1)} dB`).join('\n'));
