// node normal.mjs <outline.json> <speedo trace> <ppm> s... - brightness along the inward normal at arc length s
// (inset -4..16 px): tick length and outline stroke profile
import { ppm } from '../../f80/measure/lib.mjs';
import { bracket } from './curve.mjs';
const [, , oj, st, fp, ...ss] = process.argv; const P = ppm(fp), B = bracket(oj, st);
for (const s of ss.map(Number)) { const { p, n } = B.at(s); let o = '';
  for (let d = -4; d <= 16; d += 1) o += Math.round(P.lum(p[0] + n[0] * d, p[1] + n[1] * d)) + ' ';
  console.log(`s ${s} (${p.map(v => v.toFixed(1))})  d=-4..16: ${o}`); }
