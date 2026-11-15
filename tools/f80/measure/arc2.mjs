// node arc2.mjs ppm cx cy a0 a1 rOut rIn [step]: per angle walk inward from rOut: chrome (first lum > TH), the dark gap after it
// (its min), then the scale arc = first sample brighter than gapMin + DELTA; sub-pixel: half-max crossing. Prints fits; DUMP=1 the points
import { ppm, circle, ellipse } from './lib.mjs';
const [,, f, cx, cy, a0, a1, rOut, rIn, step=1] = process.argv.map((v,i)=> i>2 ? +v : v);
const P = ppm(f), TH = +(process.env.TH || 100), DELTA = +(process.env.DELTA || 35);
const pts = [];
for (let a = a0; a <= a1; a += step) { const rad = (a-90)*Math.PI/180, at = r => P.lum(cx + r*Math.cos(rad), cy + r*Math.sin(rad));
  let state = 0, gmin = 1e9, hit = null;
  for (let r = rOut; r >= rIn; r -= 0.25) { const v = at(r);
    if (state === 0 && v > TH) state = 1;
    else if (state === 1 && v < TH*0.55) { state = 2; gmin = v; }
    else if (state === 2) { if (v < gmin) gmin = v; if (v > gmin + DELTA) { // half-max crossing between gmin and the local peak
        let pk = v, rp = r; for (let q = r; q > r - 3; q -= 0.25) { const w = at(q); if (w > pk) { pk = w; rp = q; } }
        const half = (gmin + pk)/2; let rr = r + 0.25; while (rr > rp && at(rr) < half) rr -= 0.05; hit = rr; break; } } }
  if (hit != null) pts.push([cx + hit*Math.cos(rad), cy + hit*Math.sin(rad), a, hit]); }
let keep = pts; for (let k=0;k<5;k++){ const e = ellipse(keep); keep = keep.filter((p,i)=> Math.abs(e.res[i]) < 2.5*Math.max(0.4, e.rms)); }
const c = circle(keep), e = ellipse(keep);
console.log(`n ${pts.length} kept ${keep.length}  angles ${keep[0]?.[2]}..${keep.at(-1)?.[2]}`);
console.log(`circle  (${c.cx.toFixed(2)}, ${c.cy.toFixed(2)}) R ${c.R.toFixed(2)} rms ${c.rms.toFixed(2)}`);
console.log(`ellipse (${e.cx.toFixed(2)}, ${e.cy.toFixed(2)}) r1 ${e.r1.toFixed(2)} r2 ${e.r2.toFixed(2)} ratio ${(Math.min(e.r1,e.r2)/Math.max(e.r1,e.r2)).toFixed(4)} th ${e.th.toFixed(1)} rms ${e.rms.toFixed(2)}`);
if (process.env.DUMP) console.log(JSON.stringify(keep.map(p=>[+p[2], +p[3].toFixed(2)])));
