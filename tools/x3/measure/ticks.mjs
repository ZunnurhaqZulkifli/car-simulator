// node ticks.mjs <outline.json> <speedo trace> <ppm> [inset] - brightness along the bracket, `inset` px inside the
// outline, for the speedo and the mirrored tach; prints the peaks (ticks) as arc length s from the bottom joint
import { ppm } from '../../f80/measure/lib.mjs';
import { bracket } from './curve.mjs';
const [, , oj, st, fp, INS = 3.5] = process.argv; const P = ppm(fp), B = bracket(oj, st);
for (const side of ['spd', 'tach']) { const prof = [];
  for (let s = 0; s <= B.len; s += 0.25) { const { p, n } = B.at(s); let x = p[0] + n[0] * INS, y = p[1] + n[1] * INS; if (side === 'tach') { x = 1584 - x; y += 0.9; } prof.push([s, P.lum(x, y)]); }
  const pk = []; for (let i = 8; i < prof.length - 8; i++) { const v = prof[i][1]; if (v > 60 && prof.slice(i - 8, i + 9).every(q => q[1] <= v)) pk.push([prof[i][0], Math.round(v)]); }
  console.log(side, pk.map(q => q.join('/')).join(' ')); }
console.log('len', B.len.toFixed(1));
