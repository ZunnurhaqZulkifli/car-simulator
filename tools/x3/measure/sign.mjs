// node sign.mjs <ppm> <cx> <cy> <r> - fits an ellipse to the outer edge of the round red speed-limit sign (photo px):
// per ray the outermost red pixel's half-max edge. A round sign that fits ~1:1 means no vertical squash to undo.
import { ppm, ellipse } from '../../f80/measure/lib.mjs';
const [, , f, cx, cy, R] = process.argv.map((v, i) => i > 2 ? +v : v);
const P = ppm(f); const red = (x, y) => P.bil(x, y, 0) - 0.5 * (P.bil(x, y, 1) + P.bil(x, y, 2));
const pts = [];
for (let a = 0; a < 360; a += 3) { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); let pk = 0, rp = 0;
  for (let r = 2; r < R; r += 0.1) { const v = red(cx + r * c, cy + r * s); if (v > pk) { pk = v; rp = r; } }
  if (pk < 60) continue; let r = rp; while (r < R && red(cx + r * c, cy + r * s) > pk / 2) r += 0.05; pts.push([cx + r * c, cy + r * s]); }
let keep = pts; for (let k = 0; k < 4; k++) { const e = ellipse(keep); keep = keep.filter((p, i) => Math.abs(e.res[i]) < 2.5 * Math.max(0.3, e.rms)); }
const e = ellipse(keep); console.log(`n ${keep.length}/${pts.length} centre (${e.cx.toFixed(2)}, ${e.cy.toFixed(2)}) r1 ${e.r1.toFixed(2)} r2 ${e.r2.toFixed(2)} th ${e.th.toFixed(1)} rms ${e.rms.toFixed(2)}`);
