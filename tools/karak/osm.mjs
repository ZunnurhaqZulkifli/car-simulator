// OSM helpers for the Gombak - Genting - Kuantan route: the cached Overpass answers (fetch.mjs), metres from lat/lon,
// and the way along the road network between two places
import fs from 'node:fs';
const DIR = new URL('./.cache/', import.meta.url);
export const load = name => JSON.parse(fs.readFileSync(new URL(name, DIR))).elements;
const R = 6371008.8, LAT0 = 3.3 * Math.PI / 180;
// metres east and north of (lat0, lon0), on a local flat projection (fine over these ~200 km at 3.3°N)
export const metres = (lat, lon, lat0, lon0) => [(lon - lon0) * Math.PI / 180 * R * Math.cos(LAT0), (lat - lat0) * Math.PI / 180 * R];
export const latlon = (e, n, lat0, lon0) => [lat0 + n / R * 180 / Math.PI, lon0 + e / (R * Math.cos(LAT0)) * 180 / Math.PI];
export const dist = (a, b) => Math.hypot((a.lon - b.lon) * Math.PI / 180 * R * Math.cos(LAT0), (a.lat - b.lat) * Math.PI / 180 * R);
export const length = pts => pts.slice(1).reduce((s, p, k) => s + dist(pts[k], p), 0);
// the cheapest way from the node nearest `from` to the node nearest `to` over the ways `ok` accepts (one-way ways only
// forwards, motorways counted one-way), each metre costing cost(way), starting and ending within `reach` m of them:
// [{lat, lon, way}]
export function route(ways, ok, from, to, cost = () => 1, reach = 150) {
  const out = new Map(), at = new Map(); // node -> [[next node, metres x cost, way, point]], node -> its point
  for (const w of ways) {
    if (w.type !== 'way' || !w.tags?.highway || !ok(w)) continue;
    const both = w.tags.oneway !== 'yes' && w.tags.oneway !== '-1' && !/motorway/.test(w.tags.highway), c = cost(w);
    for (let k = 1; k < w.nodes.length; k++) {
      const a = w.nodes[k - 1], b = w.nodes[k], pa = w.geometry[k - 1], pb = w.geometry[k], d = dist(pa, pb) * c;
      at.set(a, pa); at.set(b, pb);
      if (!out.has(a)) out.set(a, []);
      if (!out.has(b)) out.set(b, []);
      out.get(a).push([b, d, w]);
      if (both) out.get(b).push([a, d, w]);
    }
  }
  // from any node near `from` (its distance there as a head start) to the first node near `to` it reaches
  const near = (q, m) => [...at].filter(([n, p]) => dist(p, q) < m && out.get(n).length).map(([n, p]) => [n, dist(p, q)]);
  let srcs = near(from, reach), ends = near(to, reach);
  if (!srcs.length) srcs = near(from, 400); if (!ends.length) ends = near(to, 400);
  const goal = new Set(ends.map(([n]) => n)), best = new Map(), prev = new Map(), done = new Set(), heap = [];
  let s, t;
  const push = e => { heap.push(e); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const [n, d] of srcs) { best.set(n, d); push([d, n]); }
  while (heap.length) {
    const [d, n] = pop();
    if (done.has(n)) continue;
    done.add(n);
    if (goal.has(n)) { t = n; break; }
    for (const [m, e, w] of out.get(n)) if (d + e < (best.get(m) ?? Infinity)) { best.set(m, d + e); prev.set(m, [n, w]); push([d + e, m]); }
  }
  if (t === undefined) throw new Error('no way between ' + JSON.stringify(from) + ' and ' + JSON.stringify(to));
  const pts = [];
  let n = t;
  for (; prev.has(n); n = prev.get(n)[0]) pts.push({ ...at.get(n), way: prev.get(n)[1] });
  pts.push({ ...at.get(n) });
  return pts.reverse().map((p, i, a) => ({ ...p, way: p.way ?? a[i + 1]?.way }));
}
