// node blobs.mjs <ppm> x0 y0 x1 y1 [minSize] - bright unsaturated 8-connected blobs in a photo box: bbox, size,
// lum-weighted centre (photo px). Numerals/labels/ticks come out as separate blobs; merge digits by hand.
import { ppm } from '../../f80/measure/lib.mjs';
const [, , f, x0, y0, x1, y1, MIN = 6] = process.argv.map((v, i) => i > 2 ? +v : v);
const P = ppm(f), TH = +(process.env.TH || 100), SAT = +(process.env.SAT || 0.4);
const W = x1 - x0, H = y1 - y0, lab = new Int32Array(W * H);
const ok = (x, y) => { const [r, g, b] = P.px(x, y), mx = Math.max(r, g, b), mn = Math.min(r, g, b); return 0.3 * r + 0.59 * g + 0.11 * b > TH && (mx - mn) <= SAT * mx; };
const out = []; let id = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (lab[j * W + i] || !ok(x0 + i, y0 + j)) continue;
  id++; const st = [[i, j]]; lab[j * W + i] = id; let n = 0, sx = 0, sy = 0, sw = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  while (st.length) { const [a, b] = st.pop(); n++; const w = P.lum(x0 + a, y0 + b); sx += (x0 + a) * w; sy += (y0 + b) * w; sw += w;
    bx0 = Math.min(bx0, a); by0 = Math.min(by0, b); bx1 = Math.max(bx1, a); by1 = Math.max(by1, b);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const u = a + dx, v = b + dy; if (u < 0 || v < 0 || u >= W || v >= H || lab[v * W + u]) continue; if (ok(x0 + u, y0 + v)) { lab[v * W + u] = id; st.push([u, v]); } } }
  if (n >= MIN) out.push({ x: x0 + bx0, y: y0 + by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1, n, c: [+(sx / sw).toFixed(1), +(sy / sw).toFixed(1)] }); }
out.sort((a, b) => a.y - b.y || a.x - b.x);
for (const o of out) console.log(`bbox ${o.x},${o.y} ${o.w}x${o.h}  n ${o.n}  c ${o.c}`);
