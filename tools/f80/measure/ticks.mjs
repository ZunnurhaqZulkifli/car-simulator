// node ticks.mjs ppm cx cy K r a0 a1 - bright runs along a circle of radius r (design space), with centre angle + width (deg) and peak lum
import { ppm } from './lib.mjs';
const [,, f, cx, cy, K, r, a0, a1] = process.argv.map((v,i)=> i>2 ? +v : v);
const P = ppm(f), TH = +(process.env.TH || 110), da = 0.05, runs = []; let cur = null;
for (let a = a0; a <= a1; a += da) { const rad = a*Math.PI/180, v = P.lum(cx + r*Math.sin(rad), cy - r*Math.cos(rad)*K);
  if (v > TH) { if (!cur) cur = { a0: a, a1: a, w: 0, s: 0, pk: 0 }; cur.a1 = a; cur.w += v - TH; cur.s += (v - TH)*a; cur.pk = Math.max(cur.pk, v); }
  else if (cur) { runs.push(cur); cur = null; } }
if (cur) runs.push(cur);
console.log(runs.map(q => `${(q.s/q.w).toFixed(2)}(${(q.a1-q.a0).toFixed(2)})`).join(' '));
