// node radial.mjs ppm cx cy K a r0 r1 [dr] - lum along a ray (design space)
import { ppm } from './lib.mjs';
const [,, f, cx, cy, K, a, r0, r1, dr = 0.5] = process.argv.map((v,i)=> i>2 ? +v : v);
const P = ppm(f), rad = a*Math.PI/180, o = [];
for (let r = r1; r >= r0; r -= dr) o.push(`${r}:${Math.round(P.lum(cx + r*Math.sin(rad), cy - r*Math.cos(rad)*K))}`);
console.log(o.join(' '));
