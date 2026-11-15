// node outline.mjs <spd-trace.json> <tach-trace.json> <ppm> - one symmetric bracket from both traces: the tach mirrored
// about x = 792 (dy -0.9, from the straight bottom edges), both in polar form round C, median per 1.5 deg bin, robust
// smoothing. Then the thin red inner line: per ray the redness peak 4-40 px inside the outline. Prints JSON
// { outline: [[x,y]...], red: [[x,y]...], inset: [[deg, px]...] } for the left bracket (photo px).
import { readFileSync } from 'node:fs';
import { ppm } from '../../f80/measure/lib.mjs';
const [, , fs_, ft, fp] = process.argv; const P = ppm(fp);
const C = [597, 545], AX = 792, DY = -0.9;
const S = JSON.parse(readFileSync(fs_)).map(p => [p[1], p[2]]), T = JSON.parse(readFileSync(ft)).map(p => [2 * AX - p[1], p[2] + DY]);
const pol = ([x, y]) => [((Math.atan2(y - C[1], x - C[0]) * 180 / Math.PI) + 360) % 360, Math.hypot(x - C[0], y - C[1])];
const all = [...S, ...T].map(pol).filter(([a]) => a > 100 && a < 300);
const BIN = 1.5, bins = new Map();
for (const [a, r] of all) { const k = Math.round(a / BIN); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(r); }
const med = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
let pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k * BIN, med(v), v.length]);
// robust: drop bins off their neighbourhood median by > 1.2 px (tick crossings), then a 5-bin moving average
for (let it = 0; it < 2; it++) { const m = pts.map((_, i) => med(pts.slice(Math.max(0, i - 4), i + 5).map(p => p[1]))); pts = pts.filter((p, i) => Math.abs(p[1] - m[i]) < 1.2); }
const sm = pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 2), i + 3); return [p[0], w.reduce((s, q) => s + q[1], 0) / w.length]; });
const xy = ([a, r]) => [C[0] + r * Math.cos(a * Math.PI / 180), C[1] + r * Math.sin(a * Math.PI / 180)];
const outline = sm.map(xy);
// red inner line (Comfort): redness peak along the ray, inside the outline - left bracket and mirrored right, median
const red = (x, y) => P.bil(x, y, 0) - 0.5 * (P.bil(x, y, 1) + P.bil(x, y, 2));
const inset = [];
for (const [a, r] of sm) { const vals = [];
  for (const side of [1, -1]) { const ca = Math.cos(a * Math.PI / 180) * side, sa = Math.sin(a * Math.PI / 180), cx = side === 1 ? C[0] : 2 * AX - C[0], cy = C[1] - (side === 1 ? 0 : DY);
    let pk = 0, rp = 0; for (let q = r - 4; q > r - 40; q -= 0.1) { const v = red(cx + q * ca, cy + q * sa); if (v > pk) { pk = v; rp = q; } }
    if (pk > 25) { let s = 0, w = 0; for (let q = rp - 3; q <= rp + 3; q += 0.1) { const v = Math.max(0, red(cx + q * ca, cy + q * sa) - pk / 2); s += q * v; w += v; } vals.push([r - s / w, pk]); } }
  if (vals.length) inset.push([+a.toFixed(1), +(vals.reduce((s, v) => s + v[0], 0) / vals.length).toFixed(2), vals.map(v => Math.round(v[1])).join('/')]); }
console.log(JSON.stringify({ outline: outline.map(p => p.map(v => +v.toFixed(2))), inset }));
