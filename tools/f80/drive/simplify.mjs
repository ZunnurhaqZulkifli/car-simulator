// simplify(pos, nor, idx, { eps, scale, cos, lock }) - fewer triangles, same look: quadric-error edge collapse
// (Garland-Heckbert) onto existing vertices, so every vertex that stays keeps its own position and normal (no new ones,
// no UVs to blend). A vertex may go
// - inside a smooth patch (one vertex at its place, every edge round it shared by two triangles), onto any neighbour;
// - on a border or a hard-edge seam that runs straight through it (two border / seam edges, one vertex per side), along
//   that line only, when it lies within `eps` of the line between its two neighbours on it;
// and only if, in every triangle round it, the other corners' normals are within `cos` of its own - and of every normal
// already merged into it (each vertex keeps the widest angle it stands for, so it can't creep) - so the shading can't change,
// the planes of everything already merged into its target stay within `eps` metres of the target (the quadric's sum of
// squared distances - a bound on each), the surface keeps its topology and no triangle round it turns more than 60°.
// pos / nor: flat xyz per vertex (pos in model units, x scale = metres); idx: triangle corners; lock(v): keep vertex v.
// Returns the new triangle list (Uint32Array) over the same vertices. `node simplify.mjs` runs its self-check.
export function simplify(pos, nor, idx, { eps, scale = 1, cos = 0.97, lock }) {
  const nv = pos.length / 3, P = Float64Array.from(pos, x => x * scale);
  // positions: every vertex at one place is one point (seams and chunk joins have several)
  const at = new Map(), pid = new Int32Array(nv); let np = 0;
  for (let v = 0; v < nv; v++) { const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`; let p = at.get(k); if (p === undefined) at.set(k, p = np++); pid[v] = p; }
  const tri = [], ofP = new Int32Array(np), fixed = new Uint8Array(np);
  for (let t = 0; t < idx.length; t += 3) { const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]; if (pid[a] !== pid[b] && pid[b] !== pid[c] && pid[a] !== pid[c]) tri.push(a, b, c); } // (no zero-area slivers)
  const nt = tri.length / 3, alive = new Uint8Array(nt).fill(1), fans = Array.from({ length: np }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; fans[pid[v]].push(t); ofP[pid[v]] = v; }
  if (lock) for (let v = 0; v < nv; v++) if (lock(v)) fixed[pid[v]] = 1;
  const vp = p => { const v = ofP[p] * 3; return [P[v], P[v + 1], P[v + 2]]; };
  const normal = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n); return l > 1e-14 ? n.map(x => x / l) : null; };
  // quadrics: each triangle's plane, unweighted, so the error is a sum of squared distances
  const Q = new Float64Array(np * 10);
  for (let t = 0; t < nt; t++) {
    const c = [0, 1, 2].map(k => vp(pid[tri[t * 3 + k]])), n = normal(...c); if (!n) continue;
    const q = [n[0], n[1], n[2], -(n[0] * c[0][0] + n[1] * c[0][1] + n[2] * c[0][2])], m = [q[0] * q[0], q[0] * q[1], q[0] * q[2], q[0] * q[3], q[1] * q[1], q[1] * q[2], q[1] * q[3], q[2] * q[2], q[2] * q[3], q[3] * q[3]];
    for (let k = 0; k < 3; k++) { const o = pid[tri[t * 3 + k]] * 10; for (let i = 0; i < 10; i++) Q[o + i] += m[i]; }
  }
  const err = (a, b) => { const [x, y, z] = vp(b), q = i => Q[a * 10 + i] + Q[b * 10 + i];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9); };
  const corner = (t, p) => tri[t * 3 + (pid[tri[t * 3]] === p ? 0 : pid[tri[t * 3 + 1]] === p ? 1 : 2)]; // t's vertex at position p
  const around = a => { const m = new Map(); for (const t of fans[a]) if (alive[t]) for (let k = 0; k < 3; k++) { const r = pid[tri[t * 3 + k]]; if (r !== a) { if (!m.has(r)) m.set(r, []); m.get(r).push(t); } } return m; };
  const angle = (a, b) => Math.acos(Math.min(1, nor[a * 3] * nor[b * 3] + nor[a * 3 + 1] * nor[b * 3 + 1] + nor[a * 3 + 2] * nor[b * 3 + 2]));
  const wide = new Float64Array(np), MAX = Math.acos(cos); // (the widest angle between a vertex's normal and those merged into it)
  // what a is: { line: null } free inside a patch, { line: [b, c] } on a straight-through border / seam, or null: stays
  const kind = (a, m) => {
    if (fixed[a]) return null;
    const line = [], wedges = new Set(); let type = '';
    for (const [r, ts] of m) {
      if (ts.length > 2) return null;
      for (const t of ts) wedges.add(corner(t, a));
      const t2 = ts.length === 1 ? 'border' : corner(ts[0], a) !== corner(ts[1], a) || corner(ts[0], r) !== corner(ts[1], r) ? 'seam' : '';
      if (t2) { if (type && type !== t2) return null; type = t2; line.push(r); }
    }
    for (const t of fans[a]) if (alive[t]) { const w = corner(t, a); for (let k = 0; k < 3; k++) if (angle(w, tri[t * 3 + k]) + wide[a] > MAX) return null; }
    if (!line.length) return wedges.size === 1 ? { line: null } : null;
    return line.length === 2 && wedges.size === (type === 'border' ? 1 : 2) ? { line } : null;
  };
  // a min-heap of collapses (cost, a -> b, both versions); stale ones are skipped when popped
  let cap = 1 << 16, size = 0, hc = new Float64Array(cap), hi = new Int32Array(cap * 4);
  const swap = (i, j) => { const c = hc[i]; hc[i] = hc[j]; hc[j] = c; for (let k = 0; k < 4; k++) { const x = hi[i * 4 + k]; hi[i * 4 + k] = hi[j * 4 + k]; hi[j * 4 + k] = x; } };
  const ver = new Int32Array(np), limit = eps * eps;
  const offer = (a, b) => {
    if (fixed[a]) return; const e = err(a, b); if (!(e <= limit)) return;
    if (size === cap) { cap *= 2; const c = new Float64Array(cap); c.set(hc); hc = c; const d = new Int32Array(cap * 4); d.set(hi); hi = d; }
    hc[size] = e; hi.set([a, b, ver[a], ver[b]], size * 4);
    for (let i = size++; i > 0;) { const j = (i - 1) >> 1; if (hc[j] <= hc[i]) break; swap(i, j); i = j; }
  };
  const pop = () => { const r = [hi[0], hi[1], hi[2], hi[3]]; size--; if (size) { hc[0] = hc[size]; hi.copyWithin(0, size * 4, size * 4 + 4);
    for (let i = 0; ;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < size && hc[l] < hc[m]) m = l; if (rr < size && hc[rr] < hc[m]) m = rr; if (m === i) break; swap(i, m); i = m; } } return r; };
  for (let a = 0; a < np; a++) for (const b of around(a).keys()) offer(a, b);
  const gone = new Uint8Array(np);
  while (size) {
    const [a, b, va, vb] = pop();
    if (gone[a] || gone[b] || ver[a] !== va || ver[b] !== vb) continue;
    const m = around(a), k = kind(a, m), shared = m.get(b);
    if (!k || !shared || k.line && !k.line.includes(b)) continue;
    if (k.line) { // along its line: a must lie on the line between its two neighbours there, between them
      const B = vp(b), C = vp(k.line[0] === b ? k.line[1] : k.line[0]), A = vp(a), u = C.map((x, i) => x - B[i]), uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
      const s = ((A[0] - B[0]) * u[0] + (A[1] - B[1]) * u[1] + (A[2] - B[2]) * u[2]) / uu;
      if (!(s > 0 && s < 1) || Math.hypot(...A.map((x, i) => x - B[i] - s * u[i])) > eps) continue;
    }
    const rb = new Set(around(b).keys()); let common = 0; for (const r of m.keys()) if (rb.has(r)) common++;
    if (common !== shared.length) continue; // (the link condition: anything else would pinch the surface)
    const to = new Map(); let ok = true; // a's vertex on each side -> b's on that side
    for (const t of shared) { const wa = corner(t, a), wb = corner(t, b); if (to.has(wa) && to.get(wa) !== wb) ok = false; to.set(wa, wb); }
    const B = vp(b);
    for (const t of fans[a]) { if (!ok) break; if (!alive[t] || shared.includes(t)) continue;
      if (!to.has(corner(t, a))) { ok = false; break; }
      const c = [0, 1, 2].map(k => vp(pid[tri[t * 3 + k]])), n0 = normal(...c), n1 = normal(...c.map((x, k) => pid[tri[t * 3 + k]] === a ? B : x));
      if (!n0 || !n1 || n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0.5) ok = false; }
    if (!ok) continue;
    for (const t of shared) alive[t] = 0;
    for (const t of fans[a]) if (alive[t]) { for (let k = 0; k < 3; k++) if (pid[tri[t * 3 + k]] === a) tri[t * 3 + k] = to.get(tri[t * 3 + k]); fans[b].push(t); }
    for (let i = 0; i < 10; i++) Q[b * 10 + i] += Q[a * 10 + i];
    for (const [wa, wb] of to) wide[b] = Math.max(wide[b], wide[a] + angle(wa, wb));
    gone[a] = 1; ver[b]++;
    for (const r of around(b).keys()) { offer(r, b); offer(b, r); }
  }
  const out = []; for (let t = 0; t < nt; t++) if (alive[t]) out.push(tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]);
  return Uint32Array.from(out);
}

// self-check: a flat grid goes down to a couple of triangles; a hard-edged cube (each face its own vertices) to a few per
// face, its corners where they were; a sphere loses triangles but no vertex of the original lies further than eps from
// what's left, and nothing turns inside out
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (c, m) => { if (!c) throw new Error('self-check: ' + m); };
  const area = (pos, o) => { let s = 0; for (let t = 0; t < o.length; t += 3) { const [a, b, c] = [o[t], o[t + 1], o[t + 2]].map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    const u = b.map((x, i) => x - a[i]), w = c.map((x, i) => x - a[i]); s += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; } return s; };
  const grid = (N, f) => { const pos = [], nor = [], idx = []; // an N x N grid on the unit square, mapped by f(u, v) -> [pos, normal]
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const [p, n] = f(i / N, j / N); pos.push(...p); nor.push(...n); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = j * (N + 1) + i; idx.push(v, v + 1, v + N + 2, v, v + N + 2, v + N + 1); }
    return { pos, nor, idx }; };
  { const g = grid(40, (u, v) => [[u, v, 0], [0, 0, 1]]), o = simplify(g.pos, g.nor, g.idx, { eps: 1e-6 });
    assert(o.length / 3 <= 4 && Math.abs(area(g.pos, o) - 1) < 1e-9, `grid ${g.idx.length / 3} -> ${o.length / 3}, area ${area(g.pos, o)}`);
    console.log(`grid: ${g.idx.length / 3} -> ${o.length / 3} triangles`); }
  { // a cube from six 20 x 20 grids, each face its own vertices (hard edges)
    const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    const pos = [], nor = [], idx = [];
    for (const [n, a, b] of F) { const g = grid(20, (u, v) => [n.map((x, i) => x + (u * 2 - 1) * a[i] + (v * 2 - 1) * b[i]), n]), o = pos.length / 3; pos.push(...g.pos); nor.push(...g.nor); idx.push(...g.idx.map(x => x + o)); }
    const o = simplify(pos, nor, idx, { eps: 1e-6 }), used = new Set(o);
    for (const v of used) assert(Math.max(...[0, 1, 2].map(k => Math.abs(pos[v * 3 + k]))) > 1 - 1e-9, 'a cube vertex off its surface');
    for (const c of [[1, 1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]]) assert([...used].some(v => [0, 1, 2].every(k => pos[v * 3 + k] === c[k])), 'a corner went');
    assert(o.length / 3 <= 6 * 4 && Math.abs(area(pos, o) - 24) < 1e-9, `cube ${idx.length / 3} -> ${o.length / 3}, area ${area(pos, o)}`);
    console.log(`cube: ${idx.length / 3} -> ${o.length / 3} triangles, area ${area(pos, o).toFixed(9)}`); }
  { // an icosphere of radius 1, 4 subdivisions
    const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => v.map(x => x / Math.hypot(...v)));
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < 4; s++) { const mid = new Map(), m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { const p = V[a].map((x, i) => x + V[b][i]), l = Math.hypot(...p); V.push(p.map(x => x / l)); mid.set(k, V.length - 1); } return mid.get(k); };
      F = F.flatMap(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; }); }
    const pos = V.flat(), idx = F.flat(), eps = 0.01, o = simplify(pos, pos, idx, { eps, cos: 0.9 });
    assert(o.length < idx.length * 0.75 && o.length > 0, `sphere ${F.length} -> ${o.length / 3}`);
    const T = []; for (let i = 0; i < o.length; i += 3) T.push([o[i], o[i + 1], o[i + 2]].map(v => V[v]));
    for (const [a, b, c] of T) { const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      assert(n[0] * (a[0] + b[0] + c[0]) + n[1] * (a[1] + b[1] + c[1]) + n[2] * (a[2] + b[2] + c[2]) > 0, 'a triangle turned over'); }
    // each original vertex's distance to the nearest remaining triangle (its plane, if it projects inside, else an edge)
    const seg = (p, a, b) => { const u = b.map((x, i) => x - a[i]), k = Math.max(0, Math.min(1, u.reduce((s, x, i) => s + x * (p[i] - a[i]), 0) / u.reduce((s, x) => s + x * x, 0))); return Math.hypot(...p.map((x, i) => x - a[i] - k * u[i])); };
    let worst = 0;
    for (const p of V) { let best = Infinity;
      for (const [a, b, c] of T) { const u = b.map((x, i) => x - a[i]), w = c.map((x, i) => x - a[i]), d = p.map((x, i) => x - a[i]);
        const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], ww = w[0] * w[0] + w[1] * w[1] + w[2] * w[2], du = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2], den = uu * ww - uw * uw;
        const s = (ww * du - uw * dw) / den, r = (uu * dw - uw * du) / den;
        best = Math.min(best, s >= 0 && r >= 0 && s + r <= 1 ? Math.hypot(...d.map((x, i) => x - s * u[i] - r * w[i])) : Math.min(seg(p, a, b), seg(p, b, c), seg(p, c, a))); }
      worst = Math.max(worst, best); }
    assert(worst <= eps, `sphere worst distance ${worst}`);
    console.log(`sphere: ${F.length} -> ${o.length / 3} triangles, worst distance ${worst.toFixed(5)} (eps ${eps})`); }
}
