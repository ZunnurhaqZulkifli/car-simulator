// node trace.mjs <ppm> <cx> <cy> <a0> <a1> [step] - the OS7 bracket outline round an interior point (photo px):
// mask = bright + unsaturated, keep the largest 8-connected component near the point (the outline; numerals are
// separate blobs), then per ray the lum-weighted centre of that component's run. Rays whose run is long (a tick
// crossing the outline) are dropped. Prints [angle, x, y] JSON (angles: 0 = +x, clockwise on screen).
import { ppm } from '../../f80/measure/lib.mjs';
const [, , f, cx, cy, a0, a1, step = 0.5] = process.argv.map((v, i) => i > 2 ? +v : v);
const P = ppm(f), TH = +(process.env.TH || 110), R = +(process.env.R || 260);
const X0 = Math.max(0, Math.floor(cx - R)), Y0 = Math.max(0, Math.floor(cy - R)), N = 2 * R;
const lumAt = (x, y) => { const [r, g, b] = P.px(x, y); return 0.3 * r + 0.59 * g + 0.11 * b; };
const white = (x, y) => { const [r, g, b] = P.px(x, y); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return lumAt(x, y) > TH && (mx - mn) < 0.35 * mx; };
const lab = new Int32Array(N * N).fill(-1); const sizes = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  if (lab[j * N + i] !== -1) continue; if (!white(X0 + i, Y0 + j)) { lab[j * N + i] = 0; continue; }
  const id = sizes.length + 1; let n = 0; const st = [[i, j]]; lab[j * N + i] = id;
  while (st.length) { const [a, b] = st.pop(); n++; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const u = a + dx, v = b + dy;
    if (u < 0 || v < 0 || u >= N || v >= N || lab[v * N + u] !== -1) continue; if (white(X0 + u, Y0 + v)) { lab[v * N + u] = id; st.push([u, v]); } else lab[v * N + u] = 0; } }
  sizes.push(n); }
// the outline = the component most rays meet first (numerals are hit by a few rays only; the wheel rim is further out)
const votes = {};
for (let a = a0; a <= a1; a += step) for (let r = 20; r < R; r += 0.5) { const i = Math.round(cx + r * Math.cos(a * Math.PI / 180)) - X0, j = Math.round(cy + r * Math.sin(a * Math.PI / 180)) - Y0;
  if (i < 0 || j < 0 || i >= N || j >= N) break; const l = lab[j * N + i]; if (l > 0) { votes[l] = (votes[l] || 0) + 1; break; } }
const big = +Object.entries(votes).sort((p, q) => q[1] - p[1])[0][0];
const isO = (x, y) => { const i = Math.round(x) - X0, j = Math.round(y) - Y0; return i >= 0 && j >= 0 && i < N && j < N && lab[j * N + i] === big; };
const out = [];
for (let a = a0; a <= a1; a += step) { const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180);
  let s = 0, w = 0, first = null, last = null;
  for (let r = 20; r < R; r += 0.1) { const x = cx + r * ca, y = cy + r * sa; if (isO(x, y)) { const l = P.lum(x, y); s += r * l; w += l; if (first == null) first = r; last = r; } else if (first != null && r - last > 2) break; }
  if (first == null || last - first > +(process.env.MAXRUN || 4.5)) continue;
  const r = s / w; out.push([+a.toFixed(2), +(cx + r * ca).toFixed(2), +(cy + r * sa).toFixed(2)]); }
console.error(`component ${big} size ${sizes[big - 1]} of ${sizes.length}; ${out.length} rays`);
console.log(JSON.stringify(out));
