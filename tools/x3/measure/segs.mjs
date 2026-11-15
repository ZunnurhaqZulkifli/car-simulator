// node segs.mjs <outline.json> [smooth px] - curvature profile of a traced outline: resample by arc length, smooth,
// print heading (deg) and curvature (1/px) every few px so the straight runs and fillets can be read off
import { readFileSync } from 'node:fs';
const pts = JSON.parse(readFileSync(process.argv[2])).map(p => [p[1], p[2]]);
const SM = +(process.argv[3] || 4), STEP = 1;
// arc-length resample
const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
const rs = []; for (let s = 0, i = 0; s <= L.at(-1); s += STEP) { while (L[i + 1] < s) i++; const t = (s - L[i]) / ((L[i + 1] - L[i]) || 1); rs.push([pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])]); }
const sm = rs.map((_, i) => { let x = 0, y = 0, n = 0; for (let k = -SM; k <= SM; k++) { const q = rs[Math.min(rs.length - 1, Math.max(0, i + k))]; x += q[0]; y += q[1]; n++; } return [x / n, y / n]; });
const hd = sm.map((_, i) => { const a = sm[Math.max(0, i - 2)], b = sm[Math.min(sm.length - 1, i + 2)]; return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; });
let prev = null;
for (let i = 0; i < sm.length; i += 3) { let d = hd[Math.min(hd.length - 1, i + 3)] - hd[i]; d = ((d + 540) % 360) - 180;
  console.log(`s ${String(i).padStart(4)}  (${sm[i][0].toFixed(1)}, ${sm[i][1].toFixed(1)})  hd ${hd[i].toFixed(1).padStart(7)}  k ${(d * Math.PI / 180 / 3).toFixed(4)}`); }
