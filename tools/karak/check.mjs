// node check.mjs - the run's roads against its land, as drive.html draws them: where a land triangle (one it doesn't
// skip) rises over the asphalt ("green on the road"), and where two roads' asphalt overlaps at heights 0.05-4 m apart
// (a step or a z-fight at a junction). Reads public/js/karak.js and karak-terrain.bin (or DIR=<gen.mjs's OUT>)
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from './.cache/three.module.js';
const DIR = process.env.DIR ? new URL(`file://${process.env.DIR}/`) : new URL('../../public/js/', import.meta.url);
const K = (await import(new URL('karak.js', DIR))).default;
const LAND = new Uint16Array(zlib.gunzipSync(fs.readFileSync(new URL('karak-terrain.bin', DIR))).buffer.slice(0));
const KT = K.terrain, N = KT.tile + 1, W = KT.cell * KT.tile, tIdx = new Map(KT.tiles.map(([i, j], t) => [i + ',' + j, t]));
// as drive.html's makeRoad: a Catmull-Rom curve sampled every ~3 m, L its left
function makeRoad(points, closed, half) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), closed);
  curve.arcLengthDivisions = 20000;
  const n = Math.round(curve.getLength() / 3), P = curve.getSpacedPoints(n);
  for (const p of P) p.y = Math.max(0, p.y);
  const L = P.map((_, i) => { const t = curve.getTangentAt(i / n); return new THREE.Vector3(t.z, 0, -t.x).normalize(); });
  return { N: n, P, L, half };
}
const ASPH = { GB: 7.6, KK: 13.75, LP: 11.5, GH: 8.4, GU: 8.4, GA: 4.2, TL: 4.2, GD: 4.2, EX1: 3.6, EN1: 3.6, EC: 4.5, EX2: 3.6, EN2: 3.6 };
const roads = Object.entries(K.roads).map(([name, pts]) => Object.assign(makeRoad(pts, false, ASPH[name]), { name, ring: false }));
for (const [name, g] of Object.entries(K.rings)) roads.push(Object.assign(makeRoad(Array.from({ length: 24 }, (_, k) => [g.x + g.r * Math.cos(k * Math.PI / 12), g.y, g.z + g.r * Math.sin(k * Math.PI / 12)]), true, name === 'GR' ? 6.5 : 5), { name: name + 'R', ring: true }));
const spans = (name, list = []) => i => list.some(([a, b]) => i >= a * roads.find(r => r.name === name).N && i <= b * roads.find(r => r.name === name).N);
const bridge = Object.fromEntries(roads.map(r => [r.name, spans(r.name, K.bridges[r.name])]));
// the land under (x, z) as drawn: its triangle's height, or undefined where drive.html leaves that triangle out
function landAt(x, z) {
  const ti = Math.floor((x - KT.x0) / W), tj = Math.floor((z - KT.z0) / W), t = tIdx.get(ti + ',' + tj);
  if (t === undefined) return;
  const fx = (x - KT.x0 - ti * W) / KT.cell, fz = (z - KT.z0 - tj * W) / KT.cell, a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b;
  const g = (da, db) => { const h = LAND[t * N * N + (b + db) * N + a + da]; return [(h >> 2) / 5 - 100, h & 3]; };
  const tri = u + v <= 1 ? [g(0, 0), g(1, 0), g(0, 1)] : [g(1, 1), g(0, 1), g(1, 0)];
  if (tri.some(p => p[1] === 3) || tri.every(p => p[0] < -0.08) || (tri.every(p => p[1]) && tri.some(p => p[1] === 1) && tri.some(p => p[1] === 2))) return;
  return u + v <= 1 ? tri[0][0] + u * (tri[1][0] - tri[0][0]) + v * (tri[2][0] - tri[0][0]) : tri[0][0] + (1 - u) * (tri[1][0] - tri[0][0]) + (1 - v) * (tri[2][0] - tri[0][0]);
}
// 1. land over the asphalt
const pokes = {};
for (const r of roads) for (let i = 0; i <= r.N; i++) {
  const p = r.P[i], L = r.L[i];
  let worst = 0, at = 0;
  for (let o = -r.half; o <= r.half + 1e-6; o += r.half / 4) { const y = landAt(p.x + L.x * o, p.z + L.z * o); if (y !== undefined && y - p.y - 0.01 > worst) { worst = y - p.y - 0.01; at = o; } }
  if (worst > 0.05 && !(r.name === 'KK' && i >= K.tunnel[1] * r.N && i <= K.tunnel[2] * r.N)) (pokes[r.name] ??= []).push([i, +worst.toFixed(2), Math.round(p.x), Math.round(p.z), at]);
}
const runs = list => { const out = []; for (const e of list) { const last = out.at(-1); if (last && e[0] - last.to <= 3) { last.to = e[0]; last.max = Math.max(last.max, e[1]); last.n++; } else out.push({ from: e[0], to: e[0], max: e[1], n: 1, x: e[2], z: e[3] }); } return out; };
console.log('land over the asphalt (road: samples from-to, worst m, at x z)');
for (const [n, list] of Object.entries(pokes)) { const rs = runs(list); console.log(' ', n, rs.length, 'stretches,', list.length, 'samples'); for (const s of rs.sort((a, b) => b.max - a.max).slice(0, 8)) console.log('    ', s.from + '-' + s.to, s.max, s.x, s.z); }
// 2. asphalt over asphalt at a slightly different height: each sample of one road on another's asphalt (the foot of its
// perpendicular onto the other's line within the other's half-width, running within 25 degrees of it) against the
// other's height there
const grid = new Map(), key = (x, z) => Math.floor(x / 20) * 100000 + Math.floor(z / 20);
for (const r of roads) for (let i = 0; i < r.N; i++) { const k = key(r.P[i].x, r.P[i].z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([r, i]); }
const steps = {};
for (const r of roads) for (let i = 0; i <= r.N; i++) {
  const p = r.P[i], t = r.P[Math.min(i + 1, r.N)].clone().sub(r.P[Math.max(i - 1, 0)]).setY(0).normalize();
  let best = {};
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const [q, j] of grid.get(key(p.x + dx * 20, p.z + dz * 20)) ?? []) {
    if (q === r) continue;
    const a = q.P[j], b = q.P[j + 1], ux = b.x - a.x, uz = b.z - a.z, l2 = ux * ux + uz * uz, u = ((p.x - a.x) * ux + (p.z - a.z) * uz) / l2;
    if (u < 0 || u > 1 || Math.abs(t.x * ux + t.z * uz) < 0.9 * Math.sqrt(l2) && !q.ring) continue;
    const d = Math.hypot(p.x - a.x - ux * u, p.z - a.z - uz * u), dy = p.y - (a.y + (b.y - a.y) * u);
    if (d < q.half && Math.abs(dy) < 4 && (!best[q.name] || d < best[q.name][0])) best[q.name] = [d, dy];
  }
  for (const [n, [, dy]] of Object.entries(best)) if (Math.abs(dy) > 0.05 && !bridge[r.name](i)) (steps[r.name + ' on ' + n] ??= []).push([i, +Math.abs(dy).toFixed(2), Math.round(p.x), Math.round(p.z)]);
}
console.log('roads overlapping at different heights (pair: samples, worst dy, at x z)');
for (const [n, list] of Object.entries(steps)) { const rs = runs(list.sort((a, b) => a[0] - b[0])); console.log(' ', n, rs.map(s => `${s.from}-${s.to} ${s.max}m @${s.x},${s.z}`).slice(0, 6).join(' | ')); }
// 3. the places' sites (fuel and workshop aprons, the safe house's drive and yard, the sights): the road level across
// its mouth, and no land over the ground it stands on (the rectangle out from the road at its place)
console.log('sites (place: road rise across its mouth m, land over it m at [out, along])');
for (const [n, [side, out, along]] of Object.entries(K.sites ?? {})) {
  const [road, f] = K.places[n], r = roads.find(q => q.name === road), i = Math.round(f * r.N), p = r.P[i], L = r.L[i], m = Math.ceil(along / 3);
  const rise = Math.max(...r.P.slice(Math.max(0, i - m), i + m + 1).map(q => Math.abs(q.y - p.y)));
  let worst = [0];
  for (let o = 0; o <= out; o += 2) for (let a = -along; a <= along; a += 2) {
    const y = landAt(p.x + L.x * side * o - L.z * a, p.z + L.z * side * o + L.x * a);
    if (y !== undefined && y - p.y > worst[0]) worst = [+(y - p.y).toFixed(2), o, a];
  }
  if (rise > 0.1 || worst[0] > 0.05) console.log(' ', n, road, i, +rise.toFixed(2), JSON.stringify(worst));
}
