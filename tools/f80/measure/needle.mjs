// node needle.mjs ppm cx cy K a0 a1 - red-needle cross sections: for each radius, the angular span of red pixels (design space)
import { ppm } from './lib.mjs';
const [,, f, cx, cy, K, a0, a1] = process.argv.map((v,i)=> i>2 ? +v : v), P = ppm(f);
const red = (x, y) => { const r = P.bil(x,y,0), g = P.bil(x,y,1), b = P.bil(x,y,2); return r > 140 && r - g > 70 && r - b > 60; };
const rows = [];
for (let r = 0; r <= 215; r += 5) { let lo = null, hi = null, sa = 0, n = 0;
  for (let a = a0; a <= a1; a += 0.05) { const t = a*Math.PI/180; if (red(cx + r*Math.sin(t), cy - r*Math.cos(t)*K)) { if (lo === null) lo = a; hi = a; sa += a; n++; } }
  if (n) rows.push(`r${r}: ${(sa/n).toFixed(2)}° w ${((hi-lo)*Math.PI/180*r).toFixed(1)}px`); }
console.log(rows.join('\n'));
