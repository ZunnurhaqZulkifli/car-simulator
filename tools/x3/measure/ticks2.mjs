// node ticks2.mjs <outline.json> <speedo trace> <ppm> - every tick along the bracket: brightness averaged over
// insets 3.5-6.5 px (tick body, clear of the outline stroke), local maxima over a +-2 px window with prominence;
// prints s, peak, prominence for the speedo and the mirrored tach, plus each numeral's nearest s
import { ppm } from '../../f80/measure/lib.mjs';
import { bracket } from './curve.mjs';
const [, , oj, st, fp] = process.argv; const P = ppm(fp), B = bracket(oj, st);
const NUM = { spd: { 0: [551.7, 620.8], 20: [510.5, 608], 40: [477, 565], 60: [458.5, 515.3], 100: [496.5, 467.5], 140: [547, 432], 200: [612.5, 417.6], 260: [684, 412.7] },
  tach: { 1: [1083, 609.8], 2: [1111, 565], 3: [1132.7, 518.3], 4: [1103.4, 474.4], 5: [1052, 438], 6: [996.4, 422.5], 7: [934.5, 415.3] } };
for (const side of ['spd', 'tach']) { const prof = [];
  for (let s = 0; s <= B.len; s += 0.25) { const { p, n } = B.at(s); let v = 0; for (let ins = 3.5; ins <= 6.5; ins += 1) { let x = p[0] + n[0] * ins, y = p[1] + n[1] * ins; if (side === 'tach') { x = 1584 - x; y += 0.9; } v += P.lum(x, y); } prof.push([s, v / 4]); }
  const pk = []; for (let i = 8; i < prof.length - 8; i++) { const v = prof[i][1]; const win = prof.slice(i - 8, i + 9); if (win.every(q => q[1] <= v)) { const mn = Math.min(...prof.slice(i - 10, i + 11).map(q => q[1])); if (v - mn > 6) pk.push(`${prof[i][0]}/${Math.round(v)}/${Math.round(v - mn)}`); } }
  console.log(side, pk.join(' '));
  console.log(' numerals', Object.entries(NUM[side]).map(([k, c]) => { if (side === 'tach') c = [1584 - c[0], c[1] + 0.9]; const r = B.near(c); return `${k}@${r.s}(${r.d.toFixed(1)})`; }).join(' ')); }
