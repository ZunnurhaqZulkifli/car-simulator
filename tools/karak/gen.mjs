// node gen.mjs - the Gombak - Genting Highlands - Kuantan route for drive.html: each road's centre line and its places
// (public/js/karak.js) and the land round them (public/js/karak-terrain.bin, gzipped), from the OpenStreetMap ways
// fetch.mjs cached ((c) OpenStreetMap contributors, ODbL) and the AWS terrain tiles (dem.mjs: SRTM via Mapzen).
//
// The real roads, placed north of the city: Gombak toll plaza at world (0, 5500), real east -x, north +z (as the
// Nordschleife), y the elevation less 60 m. The KL-Karak Expressway and the Genting Highlands road are at real size;
// the East Coast Expressway (LPT) from Karak to Kuantan is shrunk to 0.3 of its size about Karak's toll plaza (its
// bends, rises and land with it), ~48 km instead of 159
import fs from 'node:fs';
import zlib from 'node:zlib';
import { load, route, dist, metres } from './osm.mjs';
import { preload, elev } from './dem.mjs';
import * as THREE from './.cache/three.module.js';

const OUT = process.env.OUT ? new URL(`file://${process.env.OUT}/`) : new URL('../../public/js/', import.meta.url); // (OUT=<dir>: somewhere else, to compare)
const G = { lat: 3.24200, lon: 101.72720 }, GX = 0, GZ = 5500, E0 = 60; // Gombak toll plaza, where it sits, sea level's y
const K = { lat: 3.44372, lon: 102.02754 }, LPT_K = 0.3; // Karak toll plaza, the LPT's scale about it
const world = ({ lat, lon }) => { const [e, n] = metres(lat, lon, G.lat, G.lon); return [GX - e, GZ + n]; };
const KW = world(K);
const shrink = ([x, z]) => [KW[0] + (x - KW[0]) * LPT_K, KW[1] + (z - KW[1]) * LPT_K];

const ways = [...new Map(['kk.json', 'lpt.json', 'west.json', 'top.json'].flatMap(f => load(f)).map(w => [w.id, w])).values()]
  .filter(w => w.type === 'way' && w.tags?.highway && w.geometry);
const motorway = w => /^motorway/.test(w.tags.highway);
const P = (lat, lon) => ({ lat, lon });

// a polyline [{lat, lon}] resampled every `step` m (in real metres)
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], d = dist(a, b);
    let s = step - carry;
    for (; s <= d; s += step) out.push(P(a.lat + (b.lat - a.lat) * s / d, a.lon + (b.lon - a.lon) * s / d));
    carry = d - (s - step);
  }
  if (dist(out.at(-1), pts.at(-1)) > step * 0.3) out.push(pts.at(-1));
  return out;
}
// the middle of a dual carriageway: each point of one way's line (resampled) paired with the nearest of the other's,
// going the other way, within `apart` m (where they part further, the one way's own line); then smoothed over ~60 m
function middle(one, other, apart = 120, step = 10) {
  const a = resample(one, step), b = resample(other, step).reverse();
  let j = 0;
  const mid = a.map(p => {
    let best = j, bd = Infinity;
    for (let k = Math.max(0, j - 30); k < Math.min(b.length, j + 200); k++) { const d = dist(p, b[k]); if (d < bd) { bd = d; best = k; } }
    if (bd > apart) return p;
    j = best;
    return P((p.lat + b[best].lat) / 2, (p.lon + b[best].lon) / 2);
  });
  return smooth2(mid, 3);
}
const smooth2 = (pts, r) => pts.map((p, i) => {
  if (i === 0 || i === pts.length - 1) return p;
  let la = 0, lo = 0, n = 0;
  for (let k = Math.max(0, i - r); k <= Math.min(pts.length - 1, i + r); k++) { la += pts[k].lat; lo += pts[k].lon; n++; }
  return P(la / n, lo / n);
});
const along = (pts, q) => { let s = 0, best = 0, bs = 0, bd = Infinity; for (let k = 0; k < pts.length; k++) { if (k) s += dist(pts[k - 1], pts[k]); const d = dist(pts[k], q); if (d < bd) { bd = d; best = k; bs = s; } } return { k: best, s: bs, d: bd }; };
const cut = (pts, from, to) => { let s = 0; return pts.filter((p, k) => { if (k) s += dist(pts[k - 1], p); return s >= from && s <= to; }); };

const byWays = ids => ids.flatMap((id, k) => { const g = ways.find(w => w.id === id).geometry.map(p => P(p.lat, p.lon)); return k ? g.slice(1) : g; });
const centroid = ids => { const g = ids.flatMap(id => ways.find(w => w.id === id).geometry); return P(g.reduce((s, p) => s + p.lat, 0) / g.length, g.reduce((s, p) => s + p.lon, 0) / g.length); };

// --- the roads, real lat/lon lines ---
// the expressways: one way each, Gombak to Kuantan's exit and back, and their middle. KK runs from just short of
// Gombak's plaza to 400 m past Karak's; LP, the LPT (shrunk), on from there
const KUANTAN = P(3.87109, 103.23738), START = P(3.24200, 101.72460);
const east = route(ways, motorway, START, KUANTAN, w => w.tags.highway === 'motorway' ? 1 : 3);
const west = route(ways, motorway, KUANTAN, START, w => w.tags.highway === 'motorway' ? 1 : 3);
const mainline = middle(east, west, 140);
const sKarak = along(mainline, K).s;
const realKK = cut(mainline, 0, sKarak + 400), realLP = cut(mainline, sKarak + 400, 1e9);
// the Genting Highlands road: from the junction over the Genting Sempah tunnel (J, a small roundabout) up to Gohtong
// Jaya's roundabout (GR), on to where the way up and the way down part (S), the way up (GA) to the resort, round it one
// way (TL) and the way down (GD) back to S; two ways' middle where it's a dual carriageway
const J = centroid([154985788, 157245724, 157245740, 154985790]), GR = P(3.398855, 101.769732), R = centroid([157030459]); // (GR: its nodes' middle)
const genting = w => !motorway(w) && /^(secondary|tertiary|unclassified)(_link)?$/.test(w.tags.highway);
const gcost = w => (/Genting Sempah - Genting|Descent Genting|Lim Goh Tong|Bulatan Gohtong/.test(w.tags.name || '') ? 1 : 4);
const dual = (a, b) => middle(route(ways, genting, a, b, gcost, 30), route(ways, genting, b, a, gcost, 30), 60);
const S_UP = P(3.40664, 101.78718), S_DOWN = P(3.40674, 101.78718), TOP_IN = P(3.42165, 101.79235), TOP_OUT = P(3.41908, 101.79732);
// (at Gohtong Jaya's roundabout each carriageway meets the ring where OSM has it: up from the south-southwest, on out to
// the north-northwest; back in from the northeast, out to the south-southeast)
const rt = (a, b) => route(ways, genting, a, b, gcost, 20);
const realGH = middle(rt(P(3.35118, 101.78360), P(3.39816, 101.76943)), rt(P(3.39810, 101.77008), P(3.35053, 101.78277)), 60);
const realGU = middle(rt(P(3.39949, 101.76954), S_UP), rt(S_DOWN, P(3.39913, 101.77031)), 60);
const realGA = route(ways, genting, S_UP, TOP_IN, gcost, 15), realTL = route(ways, genting, TOP_IN, TOP_OUT, gcost, 15), realGD = route(ways, genting, TOP_OUT, S_DOWN, gcost, 15);
// the interchange: west of the tunnel the slip off the eastbound carriageway up to J (EX1) and J's slip down onto the
// westbound one, bridging the eastbound (EN1); east of it, the road from J to the rest area's roundabout (R, EC), R's
// slip off the westbound carriageway (EX2) and its slip onto the eastbound, bridging the westbound (EN2, below)
const realEX1 = byWays([35358269, 35809363]), realEN1 = byWays([157245691, 35809365, 157245545, 157245542]);
const realEC = middle(byWays([157245734, 737865791, 157030457]), byWays([737865790, 157258870]), 60);
const realEX2 = byWays([157245663]);

// --- into the world ---
const xz = pts => pts.map(world);
const KKw = xz(realKK), KEND = KKw.at(-1); // LP shrinks about KK's end, so the two meet
const LPw = xz(realLP).map(([x, z]) => [KEND[0] + (x - KEND[0]) * LPT_K, KEND[1] + (z - KEND[1]) * LPT_K]);
const realOfLP = ([x, z]) => { const [e, n] = [GX - (KEND[0] + (x - KEND[0]) / LPT_K), (KEND[1] + (z - KEND[1]) / LPT_K) - GZ]; return latlonOf(e, n); };
function latlonOf(e, n) { const R0 = 6371008.8, c = Math.cos(3.3 * Math.PI / 180); return P(G.lat + n / R0 * 180 / Math.PI, G.lon + e / (R0 * c) * 180 / Math.PI); }
const realOf = ([x, z]) => latlonOf(GX - x, z - GZ);
const arc = pts => { const s = [0]; for (let k = 1; k < pts.length; k++) s.push(s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])); return s; };
const unit2 = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
const bez2 = (a, ta, b, tb, k, n) => Array.from({ length: n }, (_, j) => { // n points of a cubic from a (heading ta) to b (heading tb)
  const t = (j + 1) / n, u = 1 - t, c1 = [a[0] + ta[0] * k, a[1] + ta[1] * k], c2 = [b[0] - tb[0] * k, b[1] - tb[1] * k];
  return [0, 1].map(m => u ** 3 * a[m] + 3 * u * u * t * c1[m] + 3 * u * t * t * c2[m] + t ** 3 * b[m]);
});
// a polyline in world [x, z] resampled every `step` m
function every(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k], d = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    for (; s <= d; s += step) out.push([ax + (bx - ax) * s / d, az + (bz - az) * s / d]);
    carry = d - (s - step);
  }
  if (Math.hypot(out.at(-1)[0] - pts.at(-1)[0], out.at(-1)[1] - pts.at(-1)[1]) > step * 0.3) out.push(pts.at(-1));
  return out;
}
const clip = (pts, c, r, end) => { // drop the end of a line inside the circle (c, r) and finish it on the circle
  const inside = p => Math.hypot(p[0] - c[0], p[1] - c[1]) < r;
  const a = end ? [...pts] : [...pts].reverse();
  while (a.length > 2 && inside(a.at(-1))) a.pop();
  const p = a.at(-1), u = unit2(c, p);
  a.push([c[0] + u[0] * r, c[1] + u[1] * r]);
  return end ? a : a.reverse();
};

// the Gombak link (GB), the city to the plaza: north off the ring road's north side at x 2580, over the direct road
// (K2) on a bridge, up the valley along the hills' west edge, then round west to the expressway's start - a 2+2 highway
const kkStart = KKw[0], kkDir = unit2(KKw[0], KKw[3]);
const gbPts = [[2580, 7.5], [2580, 120], [2580, 250], [2580, 340], [2578, 440], [2565, 700], [2520, 1200], [2440, 2000], [2400, 3000], [2380, 3800],
  [2340, 4400], ...bez2([2340, 4400], [-0.05, 1], [1500, 5500], [-1, 0.02], 700, 14), ...bez2([1500, 5500], [-1, 0.02], kkStart, kkDir, 500, 12)];

const nearest = (pts, q) => { let b = 0, bd = Infinity; pts.forEach((p, k) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; b = k; } }); return b; };
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
// R's slip onto the eastbound carriageway (EN2), drawn: OSM's runs between the real road's two carriageways, which are
// one road here, so it zigzagged over it. East out of R, over the expressway at 60 degrees, round east alongside its
// north side (26 m out) and into its outer lane, short of the rest area
function en2Line() {
  const R0 = world(R), c = nearest(KKw, R0) + 11, t = unit2(KKw[c - 1], KKw[c + 1]), L = [t[1], -t[0]], at = (k, o) => [KKw[k][0] + L[0] * o, KKw[k][1] + L[1] * o];
  const d = [0.87 * L[0] + 0.5 * t[0], 0.87 * L[1] + 0.5 * t[1]], A = [R0[0] - 30, R0[1]];
  const Pa = [KKw[c][0] - d[0] * 45, KKw[c][1] - d[1] * 45], Pb = [KKw[c][0] + d[0] * 30, KKw[c][1] + d[1] * 30];
  const side = k => { const u = unit2(KKw[k - 1], KKw[k + 1]); return [k, [u[1], -u[0]], u]; };
  const run = Array.from({ length: 24 }, (_, n) => { const [k, Lk] = side(c + 15 + n), o = 26 - 14.1 * ease((n - 11) / 12); return [KKw[k][0] + Lk[0] * o, KKw[k][1] + Lk[1] * o]; });
  return [R0, A, ...bez2(A, [-1, 0], Pa, d, 70, 12), Pb, ...bez2(Pb, d, at(c + 14, 26), side(c + 14)[2], 60, 10), ...run];
}
const ROADS = { // world [x, z] lines every 10 m
  GB: every(gbPts, 10), KK: KKw, LP: every(LPw, 10),
  GH: every(xz(realGH), 10), GU: every(xz(realGU), 10), GA: every(xz(realGA), 10), TL: every(xz(realTL), 10), GD: every(xz(realGD), 10),
  EX1: every(xz(realEX1), 10), EN1: every(xz(realEN1), 10), EC: every(xz(realEC), 10), EX2: every(xz(realEX2), 10), EN2: every(en2Line(), 10),
};
// the roundabouts: J over the tunnel, R by the rest area, GR at Gohtong Jaya (radius to the ring's centre line)
const RINGS = { J: { c: world(J), r: 22 }, R: { c: world(R), r: 20 }, GR: { c: world(GR), r: 74 } };
for (const [name, ends] of [['J', [['GH', 0], ['EC', 0]]], ['R', [['EC', 1], ['EX2', 1], ['EN2', 0]]], ['GR', [['GH', 1], ['GU', 0]]]])
  for (const [road, end] of ends) ROADS[road] = every(clip(ROADS[road], RINGS[name].c, RINGS[name].r + 1.5, end), 10); // (onto the ring's edge lane)
// the slips' ends onto the expressway: into its outer lane (3+3: 11.9 m out; + is left of the way it runs, Gombak to
// Karak), easing into the slip's own line over its first (or last) 150 m
const leftOf = (pts, k) => { const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, pts.length - 1)], u = unit2(a, b); return [u[1], -u[0]]; };
function ontoLane(name, end, side, o = 11.9, len = 150) {
  const r = ROADS[name], p = end ? r.at(-1) : r[0], k = nearest(ROADS.KK, p), L = leftOf(ROADS.KK, k);
  const want = [ROADS.KK[k][0] + L[0] * side * o, ROADS.KK[k][1] + L[1] * side * o], dx = want[0] - p[0], dz = want[1] - p[1], s = arc(r), S = s.at(-1);
  ROADS[name] = r.map((q, j) => { const w = 1 - ease((end ? S - s[j] : s[j]) / len); return [q[0] + dx * w, q[1] + dz * w]; });
}
ontoLane('EX1', 0, 1); ontoLane('EN1', 1, -1); ontoLane('EX2', 0, -1); ontoLane('EN2', 1, 1);
// alongside the expressway a slip keeps clear of its edge (24 m out: its 16.75, the slip's own half-width and 2), but for
// its last (or first) 120 m where it eases into or out of the outer lane, and across it where it bridges it
function alongside(name, end, side) {
  const r = ROADS[name], s = arc(r), S = s.at(-1), KKl = ROADS.KK, off = r.map(q => { const k = nearest(KKl, q), L = leftOf(KKl, k); return [k, L, (q[0] - KKl[k][0]) * L[0] + (q[1] - KKl[k][1]) * L[1]]; });
  const cross = off.findIndex(([, , o], j) => j && Math.sign(o) !== Math.sign(off[j - 1][2])), sc = cross > 0 ? s[cross] : -1e9;
  ROADS[name] = r.map((q, j) => {
    const d = end ? S - s[j] : s[j], [k, L, o] = off[j], near = Math.abs(s[j] - sc) < 60;
    const want = d < 120 ? side * (11.9 + (24 - 11.9) * ease(d / 120)) : Math.sign(o || side) * 24;
    if (near || Math.abs(o) >= Math.abs(want) || (d < 120 && Math.sign(o) !== side)) return q;
    return [KKl[k][0] + L[0] * want, KKl[k][1] + L[1] * want];
  }).map((q, j, a) => j < 2 || j > a.length - 3 ? q : [0, 1].map(m => (a[j - 2][m] + a[j - 1][m] + q[m] + a[j + 1][m] + a[j + 2][m]) / 5));
}
alongside('EX1', 0, 1); alongside('EN1', 1, -1); alongside('EX2', 0, -1); alongside('EN2', 1, 1);
// the way up to J and the way down from it run side by side (one road's two carriageways): kept 15 m apart, so their
// edges don't overlap; then both J's legs (below)
function apart(na, nb, gap, keep = 0) { // two roads' lines pushed apart to gap m where nearer (not their first `keep` m)
  for (let pass = 0; pass < 6; pass++) {
    const [a, b] = [ROADS[na], ROADS[nb]], push = (line, other) => { const s = arc(line); return line.map((p, k) => {
      const q = other[nearest(other, p)], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      return d < gap && d > 0.01 && s[k] >= keep ? [p[0] + (p[0] - q[0]) / d * (gap - d) / 2, p[1] + (p[1] - q[1]) / d * (gap - d) / 2] : p;
    }); };
    ROADS[na] = push(a, b); ROADS[nb] = push(b, a);
  }
  for (const n of [na, nb]) ROADS[n] = ROADS[n].map((p, k, a) => k < 2 || k > a.length - 3 ? p : [0, 1].map(m => (a[k - 2][m] + a[k - 1][m] + p[m] + a[k + 1][m] + a[k + 2][m]) / 5));
}
apart('EX1', 'EN1', 15);
// OSM has them on the Genting road just past J (the way down across its uphill lanes, the way up merging past J's
// edge): here J's legs, as GH and EC are - the way up (the northern of the two) in from the north-northwest (ang, radians
// from +x), the way down out to the west - each turning off its line 60 m short of where it passes J
function toRing(name, end, g, ang) {
  const r = ROADS[name], k = nearest(r, g.c), u = [Math.cos(ang), Math.sin(ang)], C = [g.c[0] + u[0] * (g.r + 1.5), g.c[1] + u[1] * (g.r + 1.5)];
  if (end) { const j = k - 6; ROADS[name] = every([...r.slice(0, j + 1), ...bez2(r[j], unit2(r[j - 1], r[j]), C, [-u[0], -u[1]], 25, 8)], 10); }
  else { const j = k + 6; ROADS[name] = every([C, ...bez2(C, u, r[j], unit2(r[j], r[j + 1]), 25, 8), ...r.slice(j + 1)], 10); }
}
toRing('EX1', 1, RINGS.J, 70 * Math.PI / 180); toRing('EN1', 0, RINGS.J, -5 * Math.PI / 180);
// the way up and the way down from S: off and onto the dual carriageway's lanes (2+2: its middle 4 m either side)
for (const [name, end, side] of [['GA', 0, 1], ['GD', 1, -1]]) {
  const r = ROADS[name], g = ROADS.GU, k = g.length - 1, L = leftOf(g, k), want = [g[k][0] + L[0] * side * 4, g[k][1] + L[1] * side * 4];
  const p = end ? r.at(-1) : r[0], dx = want[0] - p[0], dz = want[1] - p[1], s = arc(r), S = s.at(-1);
  ROADS[name] = r.map((q, j) => { const w = 1 - ease((end ? S - s[j] : s[j]) / 120); return [q[0] + dx * w, q[1] + dz * w]; });
}
apart('GA', 'GD', 13, 0); // (the ways up and down out of S, side by side at first)
{ // the way down starts where the loop round the top ends
  const r = ROADS.GD, t = ROADS.TL.at(-1), dx = t[0] - r[0][0], dz = t[1] - r[0][1], s = arc(r);
  ROADS.GD = r.map((q, j) => { const w = 1 - ease(s[j] / 60); return [q[0] + dx * w, q[1] + dz * w]; });
}

// --- the places along the way, [road, where]: toll plazas, rest-and-service areas (fuel both sides, a workshop),
// roadside fuel, the safe house's drive at the top. Positions as found in OSM (the R&Rs a little along where slips
// are in the way), shrunk onto the LPT's line there
const onto = (road, q) => nearest(ROADS[road], q);
const lp = q => { const [x, z] = world(q); return [KEND[0] + (x - KEND[0]) * LPT_K, KEND[1] + (z - KEND[1]) * LPT_K]; };
const kkAlong = (q, ds) => { const s = arc(ROADS.KK), k = nearest(ROADS.KK, world(q)); return ROADS.KK[s.findIndex(v => v >= s[k] + ds)]; };
const PLACES = {
  gombakToll: ['KK', world(G)], gentingToll: ['GH', world(P(3.36280, 101.77510))], karakToll: ['KK', world(K)],
  kuantanToll: ['LP', ROADS.LP[ROADS.LP.length - 80]],
  sempahRR: ['KK', kkAlong(P(3.35296, 101.79234), 450)], bentongRR: ['KK', world(P(3.42090, 101.89070))],
  temerlohRR: ['LP', lp(P(3.51190, 102.44030))], gambangRR: ['LP', lp(P(3.72410, 102.92270))],
  gohtongFuel: ['GH', world(P(3.38710, 101.77370))], topFuel: ['TL', world(P(3.42260, 101.79890))],
  safeHouse: ['TL', ROADS.TL[Math.round(ROADS.TL.length * 0.42)]],
  // workshops on the way up from the Sempah exit and at the top; the sights: Awana's SkyWay station (by Sky Sentral),
  // Chin Swee's temple (off the way up 160 m short of the real one, where it's gentle enough to be level), a lookout
  // off the way down where the land falls away 60 m in 150 m (the top's a plateau: none there), the SkyWay going by
  sempahShop: ['GH', ROADS.GH[55]], topShop: ['TL', ROADS.TL[20]],
  skyway: ['GA', world(P(3.40508, 101.78266))], chinSwee: ['GA', ROADS.GA[286]], lookout: ['GD', ROADS.GD[340]],
};
for (const p of Object.values(PLACES)) p[2] = onto(p[0], p[1]); // its index on the road's 10 m line
// the places off to one side of their road, on ground level with it there: [side (1 its left), m out, m either way
// along] - the fuel stations' and workshops' aprons, the safe house's drive and yard, the sights' paved sites
const SITES = { gohtongFuel: [1, 46, 20], topFuel: [1, 46, 20], safeHouse: [1, 64, 24], sempahShop: [1, 70, 10], topShop: [1, 70, 10],
  skyway: [1, 80, 26], chinSwee: [-1, 64, 30], lookout: [1, 36, 22] };
// the flat ground each needs, [road, from, to (m along), half-width either side]: a site's road level past its edges
const PADS = Object.entries(PLACES).map(([name, [road, , k]]) => {
  const [before, after, half] = /Toll/.test(name) ? [240, 240, 38] : /RR/.test(name) ? [120, 240, 62] : [SITES[name][2] + 15, SITES[name][2] + 15, 0];
  const at = arc(ROADS[road])[k]; // (not k * 10: the lines' points are only ~10 m apart - 72 m out by Chin Swee)
  return [road, at - before, at + after, half, name in SITES];
});

// --- the land: a 20 m grid in 960 m tiles over everything within 1.55 km of a road (fog hides the rest) ---
const CELL = 20, TILE = 48, REACH = 1550;
const HALF = { GB: 10.5, KK: 16.75, LP: 13, GH: 9.5, GU: 9.5, GA: 5.5, TL: 5.5, GD: 5.5, EX1: 5, EN1: 5, EC: 6, EX2: 5, EN2: 5 };
const allPts = Object.values(ROADS).flat();
const gx0 = Math.floor((Math.min(...allPts.map(p => p[0])) - REACH) / (CELL * TILE)) * CELL * TILE, gz0 = Math.floor((Math.min(...allPts.map(p => p[1])) - REACH) / (CELL * TILE)) * CELL * TILE;
const NX = Math.ceil((Math.max(...allPts.map(p => p[0])) + REACH - gx0) / (CELL * TILE)) * TILE + 1, NZ = Math.ceil((Math.max(...allPts.map(p => p[1])) + REACH - gz0) / (CELL * TILE)) * TILE + 1;
console.log('grid', NX, 'x', NZ, 'from', gx0, gz0);
const cx = i => gx0 + i * CELL, cz = j => gz0 + j * CELL;
// nearest seed to every grid point (two raster passes over 8 neighbours): seeds [x, z, ...data]
function nearestSeeds(seeds) {
  const idx = new Int32Array(NX * NZ).fill(-1), d2 = new Float32Array(NX * NZ).fill(Infinity);
  seeds.forEach(([x, z], s) => {
    const i = Math.round((x - gx0) / CELL), j = Math.round((z - gz0) / CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return;
    const k = j * NX + i, e = (cx(i) - x) ** 2 + (cz(j) - z) ** 2;
    if (e < d2[k]) { d2[k] = e; idx[k] = s; }
  });
  const relax = (k, n, i, j) => { const s = idx[n]; if (s < 0) return; const e = (cx(i) - seeds[s][0]) ** 2 + (cz(j) - seeds[s][1]) ** 2; if (e < d2[k]) { d2[k] = e; idx[k] = s; } };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (i) relax(k, k - 1, i, j); if (j) { relax(k, k - NX, i, j); if (i) relax(k, k - NX - 1, i, j); if (i < NX - 1) relax(k, k - NX + 1, i, j); } }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) { const k = j * NX + i; if (i < NX - 1) relax(k, k + 1, i, j); if (j < NZ - 1) { relax(k, k + NX, i, j); if (i < NX - 1) relax(k, k + NX + 1, i, j); if (i) relax(k, k + NX - 1, i, j); } }
  }
  return { idx, d: d2.map(Math.sqrt) };
}
// every road's line every 3 m (as drive.html samples it), with the road it's on
const samples = name => { const r = ROADS[name], out = []; for (let k = 1; k < r.length; k++) { const [ax, az] = r[k - 1], [bx, bz] = r[k], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 3)); for (let t = k === 1 ? 0 : 1; t <= n; t++) out.push([ax + (bx - ax) * t / n, az + (bz - az) * t / n, name, k - 1 + t / n]); } return out; };
const seedsAll = [...Object.keys(ROADS).flatMap(samples), ...Object.values(RINGS).flatMap(g => Array.from({ length: 64 }, (_, a) => [g.c[0] + g.r * Math.cos(a / 10.19), g.c[1] + g.r * Math.sin(a / 10.19)]))];
const near1 = nearestSeeds(seedsAll);
const tiles = [];
for (let tj = 0; tj < (NZ - 1) / TILE; tj++) for (let ti = 0; ti < (NX - 1) / TILE; ti++) {
  let any = false;
  for (let j = tj * TILE; j <= (tj + 1) * TILE && !any; j++) for (let i = ti * TILE; i <= (ti + 1) * TILE; i++) if (near1.d[j * NX + i] <= REACH) { any = true; break; }
  if (any) tiles.push([ti, tj]);
}
console.log(tiles.length, 'tiles,', tiles.length * (TILE + 1) ** 2, 'vertices');
const inside = new Uint8Array(NX * NZ); // the tiles' grid points, and 6 more round them (for the filters below)
for (const [ti, tj] of tiles) for (let j = Math.max(0, tj * TILE - 6); j <= Math.min(NZ - 1, (tj + 1) * TILE + 6); j++) for (let i = Math.max(0, ti * TILE - 6); i <= Math.min(NX - 1, (ti + 1) * TILE + 6); i++) inside[j * NX + i] = 1;
// the bare land: elevation at every grid point near a road (the LPT's from its real place, shrunk), then the trees and
// buildings taken off - opened (the lowest within 40 m, then the highest of those: anything narrower goes, slopes
// stay; 80 m round the resort at the top), blurred - and faded down to the
// plain towards the hills and the autobahn's oval (the old world's land) and the coast at Kuantan
const isB = new Uint8Array(NX * NZ);
for (let k = 0; k < NX * NZ; k++) { const s = near1.idx[k]; isB[k] = s >= 0 && seedsAll[s][2] === 'LP' ? 1 : 0; }
const raw = new Float32Array(NX * NZ).fill(NaN), eK = (q => elev(q.lat, q.lon, 12))(realOf(KEND)), offB = eK * (1 - LPT_K) - E0; // (the two lands meet at KK's end)
{
  const t0 = Date.now();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (!inside[k]) continue;
    const p = [cx(i), cz(j)];
    raw[k] = isB[k] ? (() => { const q = realOfLP(p); return elev(q.lat, q.lon, 12) * LPT_K + offB; })() : (() => { const q = realOf(p); return elev(q.lat, q.lon, 13) - E0; })();
  }
  console.log('elevations', Math.round((Date.now() - t0) / 1000), 's');
}
const resort = (x, z) => ROADS.TL.some(p => Math.hypot(p[0] - x, p[1] - z) < 700);
function filter(src, rOf, op) { // separable min / max / box mean over radius rOf(i, j) cells, skipping NaN
  const tmp = new Float32Array(src.length).fill(NaN), out = new Float32Array(src.length).fill(NaN);
  for (const [a, b, dir] of [[src, tmp, 0], [tmp, out, 1]]) for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (Number.isNaN(a[k])) continue;
    const r = rOf(i, j);
    let m = op === 'min' ? Infinity : op === 'max' ? -Infinity : 0, n = 0;
    for (let t = -r; t <= r; t++) {
      const ii = dir ? i : i + t, jj = dir ? j + t : j;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
      const v = a[jj * NX + ii];
      if (Number.isNaN(v)) continue;
      if (op === 'min') m = Math.min(m, v); else if (op === 'max') m = Math.max(m, v); else { m += v; n++; }
    }
    b[k] = op === 'mean' ? m / n : m;
  }
  return out;
}
const rMin = new Uint8Array(NX * NZ);
for (let j = 0; j < NZ; j += 4) for (let i = 0; i < NX; i += 4) if (inside[j * NX + i] && !isB[j * NX + i] && resort(cx(i), cz(j))) for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) rMin[(j + b) * NX + i + a] = 1;
const rOpen = (i, j) => rMin[j * NX + i] ? 4 : 2;
let ground = filter(filter(raw, rOpen, 'min'), rOpen, 'max');
ground = filter(filter(ground, () => 2, 'mean'), () => 2, 'mean');
const boxGap = (x, z, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
const LAND = { x0: 2100, x1: 9705, z0: -2000, z1: 7405 }, OVAL = { x0: -500, x1: 2100, z0: -4900, z1: 2500 };
const smooth = (v, a, b) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i, x = cx(i), z = cz(j);
  if (Number.isNaN(ground[k])) continue;
  const f = Math.min(smooth(boxGap(x, z, LAND), 0, 1200), smooth(boxGap(x, z, OVAL), 0, 1200), smooth(x, -73500, -71500));
  ground[k] = -0.1 + (ground[k] + 0.1) * f;
}
const groundAt = ([x, z]) => { // bilinear
  const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, g = (a, b) => ground[(j + b) * NX + i + a];
  return g(0, 0) * (1 - u) * (1 - v) + g(1, 0) * u * (1 - v) + g(0, 1) * (1 - u) * v + g(1, 1) * u * v;
};

// --- each road's heights: the land along it (or `ground(s)`, a line drawn for it) smoothed over ~sigma m, tunnels
// straight through, fixed heights where it meets another (blended in over w m), no steeper than `grade` ---
// heights y along s held to `pins` ([sample, height]), at least `mins` ([sample, height]), and no steeper than grade
// anywhere: each clamped into what every pin's cone (and every min's) allows there, then each step to the grade, which
// stays inside them
function settle(y, s, pins, grade, mins = []) {
  for (let k = 0; k < y.length; k++) {
    let lo = -Infinity, hi = Infinity;
    for (const [j, v] of pins) { const d = grade * Math.abs(s[k] - s[j]); lo = Math.max(lo, v - d); hi = Math.min(hi, v + d); }
    for (const [j, v] of mins) lo = Math.max(lo, v - grade * Math.abs(s[k] - s[j]));
    y[k] = lo > hi ? (lo + hi) / 2 : Math.min(Math.max(y[k], lo), hi); // (pins that can't both be met: halfway)
  }
  for (let k = 1; k < y.length; k++) y[k] = Math.min(Math.max(y[k], y[k - 1] - grade * (s[k] - s[k - 1])), y[k - 1] + grade * (s[k] - s[k - 1]));
  for (let k = y.length - 2; k >= 0; k--) y[k] = Math.min(Math.max(y[k], y[k + 1] - grade * (s[k + 1] - s[k])), y[k + 1] + grade * (s[k + 1] - s[k]));
  return y;
}
const LEVEL = {}; // [sample, height] of each road's level stretches (its places' pads), held in every settle after
function profile(name, { sigma = 60, grade = 0.07, tunnels = [], fix = [], ground, level = [] } = {}) {
  const pts = ROADS[name], s = arc(pts), n = pts.length, raw = ground ? s.map(ground) : pts.map(groundAt);
  let y = raw.map((_, k) => {
    let a = 0, w = 0;
    for (let j = k; j >= 0 && s[k] - s[j] < 3 * sigma; j--) { const g = Math.exp(-((s[k] - s[j]) ** 2) / (2 * sigma * sigma)); a += raw[j] * g; w += g; }
    for (let j = k + 1; j < n && s[j] - s[k] < 3 * sigma; j++) { const g = Math.exp(-((s[j] - s[k]) ** 2) / (2 * sigma * sigma)); a += raw[j] * g; w += g; }
    return a / w;
  });
  const at = v => { let k = 0; while (k < n - 1 && s[k + 1] <= v) k++; return k; };
  for (const [a, b] of tunnels) { const i = at(a), j = at(b); for (let k = i; k <= j; k++) y[k] = y[i] + (y[j] - y[i]) * (s[k] - s[i]) / (s[j] - s[i]); }
  // ends pinned by a straight-line correction along the whole road (or blended in over w m at one end only), at-least
  // heights (bridges over others) by a bump 40 m flat each side easing out over 150 m; then the grade limit, and what
  // it undid at the ends blended back in, again
  const exact = fix.filter(f => f.y !== undefined), least = fix.filter(f => f.min !== undefined);
  const blend = (f, d, w) => { for (let k = 0; k < n; k++) y[k] += d * (1 - ease(Math.abs(s[k] - f.s) / w)); };
  if (exact.length === 2) { const [a, b] = exact.map(f => f.y - y[at(f.s)]), S = s.at(-1); for (let k = 0; k < n; k++) y[k] += a * (1 - s[k] / S) + b * s[k] / S; }
  else for (const f of exact) blend(f, f.y - y[at(f.s)], Math.max(f.w ?? 150, Math.abs(f.y - y[at(f.s)]) / grade * 2.5));
  for (let pass = 0; pass < 8; pass++) {
    for (const f of least) { const d = f.min - y[at(f.s)]; if (d > 0) for (let k = 0; k < n; k++) y[k] += d * (1 - ease((Math.abs(s[k] - f.s) - 40) / 150)); }
    if (pass) for (const f of exact) { const d = f.y - y[at(f.s)]; if (Math.abs(d) > 0.01) blend(f, d, Math.max(f.w ?? 150, Math.abs(d) / grade * 2.5)); } // (what the limit took back)
    for (let k = 1; k < n; k++) y[k] = Math.min(Math.max(y[k], y[k - 1] - grade * (s[k] - s[k - 1])), y[k - 1] + grade * (s[k] - s[k - 1]));
    for (let k = n - 2; k >= 0; k--) y[k] = Math.min(Math.max(y[k], y[k + 1] - grade * (s[k + 1] - s[k])), y[k + 1] + grade * (s[k + 1] - s[k]));
  }
  for (let pass = 0; pass < 6; pass++) for (const f of exact) { const d = f.y - y[at(f.s)]; if (Math.abs(d) > 0.01) blend(f, d, Math.max(f.w ?? 150, Math.abs(d) / grade * 4)); } // (the last of it)
  LEVEL[name] = level.flatMap(([a, b]) => { const i = at(a), j = at(b), v = y.slice(i, j + 1).reduce((p, q) => p + q) / (j - i + 1); return Array.from({ length: j - i + 1 }, (_, n) => [i + n, v]); });
  settle(y, s, [...exact.map(f => [at(f.s), f.y]), ...LEVEL[name]], grade, least.map(f => [at(f.s), f.min])); // (which can steepen it past the grade: held to it)
  for (const f of exact) if (Math.abs(y[at(f.s)] - f.y) > 0.3) console.warn(`  ${name}: a fixed height missed by ${(y[at(f.s)] - f.y).toFixed(2)} m`);
  for (const f of least) if (y[at(f.s)] < f.min - 0.3) console.warn(`  ${name}: ${(f.min - y[at(f.s)]).toFixed(2)} m short of clearing what it bridges`);
  return y.map(v => Math.max(0, v));
}
const ends = (name, y0, y1, w) => [...(y0 !== undefined ? [{ s: 0, y: y0, w }] : []), ...(y1 !== undefined ? [{ s: arc(ROADS[name]).at(-1), y: y1, w }] : [])];
// pads: the road straight along them (level along those with a site beside: level is all the site's flat land can meet)
const flats = (name, sites) => PADS.filter(p => p[0] === name && (!sites || p[4])).map(([, a, b]) => [a, b]);
const kkS = arc(ROADS.KK), sOf = (name, q) => arc(ROADS[name])[nearest(ROADS[name], q)];
// the Genting Sempah tunnel on KK: where both bores (OSM tunnel ways) run, end to end, 10 m past each portal
const bores = ways.filter(w => motorway(w) && w.tags.tunnel === 'yes' && /Karak/.test(w.tags.name || '')).flatMap(w => [w.geometry[0], w.geometry.at(-1)].map(q => sOf('KK', world(q))));
const TUNNEL = [Math.min(...bores) - 10, Math.max(...bores) + 10];
const H = {};
H.KK = profile('KK', { sigma: 90, grade: 0.065, tunnels: [TUNNEL, ...flats('KK')] });
const kkAt = q => H.KK[nearest(ROADS.KK, q)];
const landAround = (c, r) => { let a = 0, n = 0; for (let dx = -r; dx <= r; dx += 10) for (let dz = -r; dz <= r; dz += 10) { a += groundAt([c[0] + dx, c[1] + dz]); n++; } return a / n; };
RINGS.J.y = Math.max(landAround(RINGS.J.c, 30), kkAt(RINGS.J.c) + 14); RINGS.R.y = landAround(RINGS.R.c, 30); RINGS.GR.y = landAround(RINGS.GR.c, 60);
H.GH = profile('GH', { sigma: 40, grade: 0.13, tunnels: flats('GH'), level: flats('GH', true), fix: ends('GH', RINGS.J.y, RINGS.GR.y) });
const yS = landAround(ROADS.GU.at(-1), 30);
H.GU = profile('GU', { sigma: 40, grade: 0.13, fix: ends('GU', RINGS.GR.y, yS) });
H.TL = profile('TL', { sigma: 40, grade: 0.13, tunnels: flats('TL'), level: flats('TL', true) });
H.GA = profile('GA', { sigma: 40, grade: 0.15, tunnels: flats('GA'), level: flats('GA', true), fix: ends('GA', yS, H.TL[0], 100) });
H.GD = profile('GD', { sigma: 40, grade: 0.15, tunnels: flats('GD'), level: flats('GD', true), fix: ends('GD', H.TL.at(-1), yS, 100) });
// where a road crosses another (not where it joins it): the first goes over, 7.3 m clear
function crossing(a, b) {
  const A = ROADS[a], B = ROADS[b], sa = arc(A);
  for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
    const [p, q, r, t] = [A[i - 1], A[i], B[j - 1], B[j]], d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]);
    if (!d) continue;
    const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && sa[i] > 60 && sa[i] < sa.at(-1) - 60) return { s: sa[i - 1] + u * (sa[i] - sa[i - 1]), at: j };
  }
}
// over the whole stretch where it's over the other's asphalt (out to 2 m past its edge), every 10 m
const overSpan = (a, b) => { const A = ROADS[a], B = ROADS[b], s = arc(A), c = crossing(a, b); if (!c) return null;
  const inside = A.map(q => { const k = nearest(B, q), L = leftOf(B, k); return [Math.abs((q[0] - B[k][0]) * L[0] + (q[1] - B[k][1]) * L[1]) < HALF[b] + 2, k]; });
  let i = A.findIndex((_, j) => s[j] >= c.s), j = i; while (i > 0 && inside[i - 1][0]) i--; while (j < A.length - 1 && inside[j + 1][0]) j++;
  return { from: s[i], to: s[j], at: inside.slice(i, j + 1).map(([, k], n) => [s[i + n], k]) }; };
const over = (a, b) => { const o = overSpan(a, b); return o ? o.at.filter((_, n) => n % 1 === 0).map(([sv, k]) => ({ s: sv, min: H[b][k] + 7.3 })) : []; };
// the slips between J and the expressway climb (EX1) and fall (EN1) at their grade end to end, not with the land (the
// one up couldn't keep up with it, and ended 30 m under the one down beside it): so they meet where they run side by side
{
  const [a0, a1, b0, b1] = [kkAt(ROADS.EX1[0]), RINGS.J.y, RINGS.J.y, kkAt(ROADS.EN1.at(-1))];
  H.EX1 = profile('EX1', { sigma: 40, grade: 0.12, ground: v => Math.min(a0 + 0.11 * v, a1), fix: ends('EX1', a0, a1, 150) });
  H.EN1 = profile('EN1', { sigma: 40, grade: 0.12, ground: v => Math.max(b0 - 0.11 * v, b1), fix: [...ends('EN1', b0, b1, 150), ...over('EN1', 'KK')] });
}
H.EC = profile('EC', { sigma: 40, grade: 0.1, fix: ends('EC', RINGS.J.y, RINGS.R.y, 150) });
H.EX2 = profile('EX2', { sigma: 30, grade: 0.11, fix: ends('EX2', kkAt(ROADS.EX2[0]), RINGS.R.y, 60) });
H.EN2 = profile('EN2', { sigma: 30, grade: 0.09, fix: [...ends('EN2', RINGS.R.y, kkAt(ROADS.EN2.at(-1)), 120), ...over('EN2', 'KK')] });
H.LP = profile('LP', { sigma: 50, grade: 0.045, tunnels: flats('LP'), fix: ends('LP', H.KK.at(-1), 0, 300) });
{ // the link: level with the ring, 7.3 m over the direct road at z 340, down to the plain past it, then up to the plaza
  const s = arc(ROADS.GB), S = s.at(-1), sEdge = s[ROADS.GB.findIndex(([x]) => x < 2100)];
  const kinks = [[0, 0], [270, 10.9], [410, 10.9], [800, 2.5], [sEdge - 600, 2.5], [sEdge, 1.5], [S, H.KK[0]]];
  H.GB = s.map(v => { let k = 0; while (k < kinks.length - 2 && kinks[k + 1][0] < v) k++; const [a, ya] = kinks[k], [b, yb] = kinks[k + 1]; return ya + (yb - ya) * ease((v - a) / (b - a)); });
}
// where a road runs onto another's asphalt (a slip's taper, a leg into a roundabout, the LPT off the KL-Karak's end),
// its height there the other's at the foot of the perpendicular, so the surfaces meet with no step; then held to its
// grade between. Asphalt half-widths as drive.html draws them (KK's three-lane), the rings' either side of their line
const ASPH = { GB: 7.6, KK: 16.75, LP: 11.5, GH: 8.4, GU: 8.4, GA: 4.2, TL: 4.2, GD: 4.2, EX1: 3.6, EN1: 3.6, EC: 4.5, EX2: 3.6, EN2: 3.6, J: 5, R: 5, GR: 6.5 };
function surfaceOf(name, q, dir) { // [height, how far off its line, whether q heading dir runs along it (within 25 degrees)]
  const g = RINGS[name];                 // at the foot of the perpendicular from q; none past its ends
  if (g) return [g.y, Math.abs(Math.hypot(q[0] - g.c[0], q[1] - g.c[1]) - g.r) - 5, true]; // (a leg's first 10 m pinned too)
  const P = ROADS[name], k = nearest(P, q);
  let best;
  for (const j of [k - 1, k]) {
    if (j < 0 || j + 1 >= P.length) continue;
    const [a, b] = [P[j], P[j + 1]], dx = b[0] - a[0], dz = b[1] - a[1], t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz);
    if (t < -0.01 || t > 1.01) continue;
    const u = Math.min(1, Math.max(0, t)), d = Math.hypot(q[0] - a[0] - dx * u, q[1] - a[1] - dz * u);
    if (!best || d < best[1]) best = [H[name][j] + (H[name][j + 1] - H[name][j]) * u, d, Math.abs(dir[0] * dx + dir[1] * dz) > 0.9 * Math.hypot(dx, dz)];
  }
  return best;
}
for (const [name, onto, grade] of [['GH', ['J', 'GR'], 0.13], ['GU', ['GR'], 0.13], ['GA', ['GU', 'TL'], 0.15], ['GD', ['TL', 'GU'], 0.15], ['EX1', ['KK', 'J'], 0.12],
  ['EN1', ['J', 'KK'], 0.12], ['EC', ['J', 'R'], 0.1], ['EX2', ['KK', 'R'], 0.11], ['EN2', ['R', 'KK'], 0.09], ['LP', ['KK'], 0.045]]) {
  const pins = new Map();
  ROADS[name].forEach((q, k, r) => { for (const o of onto) { const f = surfaceOf(o, q, unit2(r[Math.max(k - 1, 0)], r[Math.min(k + 1, r.length - 1)])); if (f && f[1] < ASPH[o] + ASPH[name] + 1 && (f[2] || Math.abs(f[0] - H[name][k]) < 3)) pins.set(k, f[0]); } }); // (not a bridge over it)
  if (process.env.PINS) console.log('pins', name, [...pins].map(([k, v]) => `${k}:${(v - H[name][k]).toFixed(1)}`).join(' '));
  const mins = name === 'EN1' || name === 'EN2' ? over(name, 'KK').map(f => [nearest(arc(ROADS[name]).map(v => [v, 0]), [f.s, 0]), f.min]) : [];
  settle(H[name], arc(ROADS[name]), [...pins, ...(LEVEL[name] ?? [])], grade, mins);
}
for (const n of Object.keys(ROADS)) { const s = arc(ROADS[n]); let g = 0; for (let k = 1; k < s.length; k++) g = Math.max(g, Math.abs(H[n][k] - H[n][k - 1]) / (s[k] - s[k - 1])); console.log(n.padEnd(4), Math.round(s.at(-1)), 'm, y', Math.round(Math.min(...H[n])), '..', Math.round(Math.max(...H[n])), 'steepest', (g * 100).toFixed(1) + '%'); }
console.log('rings', Object.entries(RINGS).map(([n, r]) => n + ' ' + Math.round(r.y)).join(', '), 'S', Math.round(yS), 'tunnel', TUNNEL.map(Math.round));

// --- spans along each road, as fractions of its length: bridges (no land under them: the slips over the expressway,
// and viaducts - 12 m or more over the land for 60 m or more), the tunnel, the KL-Karak's three-lane stretches ---
// (fractions of the curve drive.html draws through the line - Catmull-Rom over [x, y, z], its samples spaced by 3D arc
// length - not of the line's own length: that put the tunnel's ends 40 m off)
const curves = {};
function curveFrac(name, v) {
  if (!curves[name]) { const c = new THREE.CatmullRomCurve3(ROADS[name].map(([x, z], k) => new THREE.Vector3(x, H[name][k], z))); curves[name] = [arc(ROADS[name]), c.getLengths(20000)]; }
  const [s, lens] = curves[name], n = s.length;
  let k = 0;
  while (k < n - 2 && s[k + 1] <= v) k++;
  const t = Math.min(1, Math.max(0, (k + (v - s[k]) / (s[k + 1] - s[k])) / (n - 1))) * 20000, i = Math.min(Math.floor(t), 19999);
  return +((lens[i] + (lens[i + 1] - lens[i]) * (t - i)) / lens[20000]).toFixed(6);
}
const frac = (name, a, b) => [curveFrac(name, a), curveFrac(name, b)];
const BRIDGES = {};
for (const name of Object.keys(ROADS)) {
  const s = arc(ROADS[name]), spans = [];
  let from = -1;
  for (let k = 0; k <= s.length; k++) {
    const high = k < s.length && H[name][k] - groundAt(ROADS[name][k]) > 12 && !(name === 'KK' && s[k] > TUNNEL[0] && s[k] < TUNNEL[1]);
    if (high && from < 0) from = k;
    if (!high && from >= 0) { if (s[k - 1] - s[from] >= 60) spans.push([s[from] - 15, s[k - 1] + 15]); from = -1; }
  }
  if (name === 'EN1' || name === 'EN2') { const o = overSpan(name, 'KK'); spans.push([o.from - 15, o.to + 15]); } // (over the expressway, its whole width)
  if (spans.length) BRIDGES[name] = spans;
}
BRIDGES.GB = [[245, 435]]; // (the link's bridge over the direct road)
console.log('bridges', Object.entries(BRIDGES).map(([n, sp]) => `${n} ${sp.length} (${Math.round(sp.reduce((a, [x, y]) => a + y - x, 0))} m)`).join(', '));
const inSpan = (spans, v) => spans?.some(([a, b]) => v >= a && v <= b);
const LANES3 = []; // where the expressway has three lanes each way (OSM's lanes on the eastbound carriageway), 1.5 km at least
{
  const eastW = east.map(p => [world(p), +(p.way?.tags.lanes || 2)]), s = arc(ROADS.KK);
  const three = ROADS.KK.map(q => { let b = 0, bd = Infinity; for (let k = 0; k < eastW.length; k += 2) { const d = (eastW[k][0][0] - q[0]) ** 2 + (eastW[k][0][1] - q[1]) ** 2; if (d < bd) { bd = d; b = k; } } return eastW[b][1] >= 3; });
  let from = -1;
  for (let k = 0; k <= three.length; k++) {
    if (k < three.length && three[k] && from < 0) from = k;
    if ((k === three.length || !three[k]) && from >= 0) { if (s[k - 1] - s[from] > 1500) LANES3.push(frac('KK', s[from], s[k - 1])); from = -1; }
  }
  console.log('three lanes', LANES3.map(([a, b]) => `${Math.round(a * s.at(-1) / 1000)}-${Math.round(b * s.at(-1) / 1000)} km`).join(', '));
}

// --- the land carved round the roads: each grid point's nearest road (bridges left out) sets it - level with the road
// (a ditch's depth under it) out to 8 m past its edge, easing back to the land over 30-200 m (as much as the height
// between needs); over the tunnel, the hill at least 10 m over the road; the pads level with their road out to their
// half-width. Flags: 1 under a road (drive.html leaves those triangles out), 2 over the tunnel, 3 the hills' land ---
const DIP = { KK: 1.5, LP: 1.5, GB: 1.5 }, padOf = (name, v) => PADS.find(p => p[0] === name && v >= p[1] && v <= p[2]);
const seeds2 = [];
for (const name of Object.keys(ROADS)) {
  const s = arc(ROADS[name]);
  for (const [x, z, , t] of samples(name)) {
    const k = Math.floor(t), f = t - k, v = s[k] + (s[Math.min(k + 1, s.length - 1)] - s[k]) * f, y = H[name][k] + (H[name][Math.min(k + 1, s.length - 1)] - H[name][k]) * f;
    if (inSpan(BRIDGES[name], v)) continue;
    const pad = padOf(name, v), tunnel = name === 'KK' && v > TUNNEL[0] && v < TUNNEL[1];
    seeds2.push([x, z, y, HALF[name], DIP[name] ?? 1.2, pad ? pad[3] : 0, tunnel, name]);
  }
}
for (const g of Object.values(RINGS)) {
  const half = g === RINGS.GR ? 7.5 : 6;
  for (let a = 0; a < 64; a++) seeds2.push([g.c[0] + g.r * Math.cos(a / 10.19), g.c[1] + g.r * Math.sin(a / 10.19), g.y, half, 0.3, 0, false]);
  seeds2.push([...g.c, g.y, g.r, 0.05, 0, false]); // (the island, level)
}
// the places' sites, level with their road there (its pad): a grid of points step m apart over each, and its height
const siteGrid = (name, step) => {
  const [road, , k] = PLACES[name], [side, out, along] = SITES[name], q = ROADS[road][k], L = leftOf(ROADS[road], k), pts = [];
  for (let o = 0; o <= out + 0.01; o += step) for (let a = -along; a <= along + 0.01; a += step) pts.push([q[0] + L[0] * side * o - L[1] * a, q[1] + L[1] * side * o + L[0] * a]);
  return [pts, H[road][k]];
};
for (const name of Object.keys(SITES)) { const [pts, y] = siteGrid(name, 5); for (const [x, z] of pts) seeds2.push([x, z, y, 4, 0.3, 0, false, 'site']); }
const near2 = nearestSeeds(seeds2), nearT = nearestSeeds(seeds2.filter(p => p[6])); // (and how far the tunnel is)
const HGT = new Float32Array(NX * NZ), FLAG = new Uint8Array(NX * NZ);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i, n = ground[k];
  if (Number.isNaN(n)) continue;
  const [, , y, half, dip, pad, tunnel] = seeds2[near2.idx[k]], d = near2.d[k];
  let v, flag = 0;
  if (tunnel) { v = Math.max(n, y + 10 - 10 * smooth(d - half, 20, 60)); if (d < half + 0.5) flag = 2; }
  else {
    const base = pad && d < pad ? y - (d < half ? dip : 0.05) : y - dip, e = d - Math.max(half, pad), L = Math.min(200, Math.max(30, 1.6 * Math.abs(n - base)));
    v = e < 8 ? base : base + (n - base) * smooth(e, 8, 8 + L);
    if (d < half - 0.5 && (seeds2[near2.idx[k]][7] === 'KK' || nearT.d[k] > HALF.KK + 30)) flag = 1; // (not the roads over the tunnel: drive.html leaves out what mixes a road and the tunnel, a hole)
  }
  if (cx(i) > LAND.x0 - 10 && cx(i) < LAND.x1 + 10 && cz(j) > LAND.z0 - 10 && cz(j) < LAND.z1 + 10) flag = 3;
  HGT[k] = Math.max(-0.1, v); FLAG[k] = flag;
}
// and none of it over a road: wherever a triangle drive.html draws (as it splits each cell, k00 k10 k01 and k11 k01 k10;
// not those mixing a road and the tunnel - its mouths - nor the hills' land, nor all down on the plain) rises over a road's
// asphalt (a road beside another, higher; a hairpin's other leg), its corners are lowered just enough, least squares,
// 0.3 m under it (the tunnel's own samples left out: the hill is over it)
{
  const top = []; // [x, z, the most the land may be there]
  for (const name of Object.keys(ROADS)) {
    const s = arc(ROADS[name]), r = ROADS[name];
    for (const [x, z, , t] of samples(name)) {
      const k = Math.floor(t), f = t - k, k1 = Math.min(k + 1, r.length - 1), v = s[k] + (s[k1] - s[k]) * f, y = H[name][k] + (H[name][k1] - H[name][k]) * f;
      if (name === 'KK' && v > TUNNEL[0] && v < TUNNEL[1]) continue;
      const L = leftOf(r, k);
      for (let o = -ASPH[name] - 1; o <= ASPH[name] + 1.01; o += (ASPH[name] + 1) / Math.ceil((ASPH[name] + 1) / 2)) top.push([x + L[0] * o, z + L[1] * o, y - 0.3]); // (and the shoulders)
    }
  }
  for (const name of Object.keys(SITES)) { const [pts, y] = siteGrid(name, 2); for (const [x, z] of pts) top.push([x, z, y - 0.3]); }
  for (const [name, g] of Object.entries(RINGS)) for (let a = 0; a < 2 * Math.PI * g.r / 2; a++) for (const o of [-ASPH[name] - 1, 0, ASPH[name] + 1]) top.push([g.c[0] + (g.r + o) * Math.cos(a * 2 / g.r), g.c[1] + (g.r + o) * Math.sin(a * 2 / g.r), g.y - 0.3]);
  const drawn = ks => !(ks.some(k => FLAG[k] === 3) || ks.every(k => HGT[k] < -0.08) || (ks.every(k => FLAG[k]) && ks.some(k => FLAG[k] === 1) && ks.some(k => FLAG[k] === 2)));
  let lowered = 0;
  for (let pass = 0; pass < 60; pass++) {
    let n = 0;
    for (const [x, z, most] of top) {
      const fi = (x - gx0) / CELL, fj = (z - gz0) / CELL, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * NX + i;
      if (i < 0 || j < 0 || i >= NX - 1 || j >= NZ - 1) continue;
      const tri = u + v <= 1 ? [[k, 1 - u - v], [k + 1, u], [k + NX, v]] : [[k + NX + 1, u + v - 1], [k + NX, 1 - u], [k + 1, 1 - v]];
      if (tri.some(([q]) => Number.isNaN(ground[q])) || !drawn(tri.map(([q]) => q))) continue;
      const h = tri.reduce((a, [q, w]) => a + HGT[q] * w, 0), ww = tri.reduce((a, [, w]) => a + w * w, 0);
      if (h <= most + 0.01) continue;
      for (const [q, w] of tri) HGT[q] -= (h - most) * w / ww;
      n++;
    }
    lowered += n;
    if (!n) break;
  }
  console.log('land lowered under the asphalt at', lowered, 'points');
}

// --- the resort's buildings at the top and Gohtong Jaya's (OSM footprints; storeys as tagged, else by kind) ---
const BUILDINGS = load('top.json').filter(w => w.type === 'way' && w.tags?.building && w.geometry?.length > 3).map(w => {
  const t = w.tags, n = t.name || '', foot = w.geometry.slice(0, -1).map(p => world(p).map(v => +v.toFixed(1)));
  const area = Math.abs(foot.reduce((a, p, k) => { const q = foot[(k + 1) % foot.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const storeys = +(t['building:levels'] || 0) || (/hotel|tower|resort|apartment|ria |rsc|kayangan|first world|genting grand/i.test(n) || t.building === 'hotel' || t.building === 'apartments' ? 18 : area > 3000 ? 6 : area > 600 ? 4 : 2);
  return [foot, storeys, n];
}).filter(([foot]) => foot.length >= 3);
console.log(BUILDINGS.length, 'buildings');

// --- out: the terrain tiles (each (TILE+1)^2 uint16: (height + 100) * 5 << 2 | flag), gzipped; and the module ---
{
  const N = TILE + 1, buf = new Uint16Array(tiles.length * N * N);
  tiles.forEach(([ti, tj], t) => {
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      const k = (tj * TILE + b) * NX + ti * TILE + a, h = Number.isNaN(HGT[k]) ? -0.1 : HGT[k];
      buf[t * N * N + b * N + a] = (Math.round((Math.min(Math.max(h, -100), 3000) + 100) * 5) << 2) | FLAG[k];
    }
  });
  const gz = zlib.gzipSync(Buffer.from(buf.buffer), { level: 9 });
  fs.writeFileSync(new URL('karak-terrain.bin', OUT), gz);
  console.log('terrain', tiles.length, 'tiles,', (gz.length / 1e6).toFixed(2), 'MB');
}
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const roadsOut = Object.fromEntries(Object.entries(ROADS).map(([n, pts]) => [n, pts.map(([x, z], k) => [r1(x), r2(H[n][k]), r1(z)])]));
const spans = Object.fromEntries(Object.entries(BRIDGES).map(([n, sp]) => [n, sp.map(([a, b]) => frac(n, Math.max(0, a), Math.min(arc(ROADS[n]).at(-1), b)))]));
const placesOut = Object.fromEntries(Object.entries(PLACES).map(([n, [road, , k]]) => [n, [road, curveFrac(road, arc(ROADS[road])[k])]]));
const js = `// The Gombak - Genting Highlands - Kuantan route for drive.html, made by tools/karak/gen.mjs - don't edit by hand.
// From OpenStreetMap ((c) OpenStreetMap contributors, ODbL): the KL-Karak Expressway, the Genting Highlands road and the
// East Coast Expressway (LPT, shrunk to ${LPT_K} of its size about Karak), heights from the AWS terrain tiles (SRTM via
// Mapzen) with trees and buildings taken off, smoothed. Placed north of the city: real east -x, north +z, y the
// elevation less ${E0} m (Gombak's toll plaza at x ${GX}, z ${GZ}).
// roads: each one's centre line, [x, y, z] every ~10 m; rings: the roundabouts, centre, radius, height; spans: as
// fractions of a road's length, bridges (no land under), the tunnel, the KL-Karak's three-lane stretches; places:
// [road, fraction along]; sites: the level ground off to one side of some, [side (1 its left), m out, m either way];
// buildings: [footprint [x, z]..., storeys, name]; terrain: the land's tiles in karak-terrain.bin
export default ${JSON.stringify({
  roads: roadsOut,
  rings: Object.fromEntries(Object.entries(RINGS).map(([n, g]) => [n, { x: r1(g.c[0]), z: r1(g.c[1]), r: g.r, y: r2(g.y) }])),
  bridges: spans, tunnel: ['KK', ...frac('KK', TUNNEL[0], TUNNEL[1])], lanes3: LANES3, places: placesOut, sites: SITES,
  buildings: BUILDINGS, terrain: { x0: gx0, z0: gz0, cell: CELL, tile: TILE, tiles },
})};
`;
fs.writeFileSync(new URL('karak.js', OUT), js);
console.log('karak.js', (js.length / 1e6).toFixed(2), 'MB');
if (process.env.OVERLAPS) { // where two roads (or two legs of one) at one level run closer than their edges allow
  const names = Object.keys(ROADS), out = {};
  for (const a of names) for (const b of names) {
    if (b < a) continue;
    const A = ROADS[a], B = ROADS[b], sA = arc(A), sB = arc(B);
    for (let i = 0; i < A.length; i += 2) for (let j = 0; j < B.length; j += 2) {
      if (a === b && Math.abs(sA[i] - sB[j]) < 80) continue;
      const d = Math.hypot(A[i][0] - B[j][0], A[i][1] - B[j][1]);
      if (d < HALF[a] + HALF[b] - 1 && Math.abs(H[a][i] - H[b][j]) < 6) { const k = a + '/' + b; (out[k] ??= []).push(Math.round(sA[i])); }
    }
  }
  for (const [k, v] of Object.entries(out)) console.log('overlap', k, v.length, v.slice(0, 12).join(','));
}
