// node tools/gtr/inspect-wheel.mjs [glb] - every primitive with triangles near the GT-R's steering wheel (CARS gtr
// steering.near, in drive.html's car coords: length 4.69, tyres on y=0, centred): node, material (alpha mode, texture),
// triangles near, and their spread along the column axis (h, + into the dash) and off it (r)
import { readGlb, meshNodes } from '../rs6/drive/glb.mjs';
const src = process.argv[2] ?? 'public/models/nissan-gt-r-nismo.glb', NEAR = [-0.37, 0.889, 0.278], LENGTH = 4.69;
const A = +(process.env.AXIS_DEG ?? 'NaN'); // the column's tilt (rim.a in drive.html); unset = from a quick rim fit below
const { json, bin } = readGlb(src);
const mn = meshNodes(json, bin);
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of mn) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p.pos[v + k]); B[k + 3] = Math.max(B[k + 3], p.pos[v + k]); }
const K = LENGTH / (B[5] - B[2]), car = (pos, v) => [(pos[v] - (B[0] + B[3]) / 2) * K, (pos[v + 1] - B[1]) * K, (pos[v + 2] - (B[2] + B[5]) / 2) * K];
// rim fit as drive.html's: the plane tilt a putting most cabin_steering points on a 0.15-0.2 ring round NEAR
const sw = mn.filter(n => n.name === 'cabin_steering').flatMap(n => n.prims.flatMap(p => { const o = []; for (let v = 0; v < p.pos.length; v += 9) o.push(car(p.pos, v)); return o; }))
  .filter(p => Math.hypot(p[0] - NEAR[0], p[1] - NEAR[1], p[2] - NEAR[2]) < 0.3);
let best = { n: -1 };
for (let cy = NEAR[1] - 0.03; cy <= NEAR[1] + 0.03; cy += 0.005) for (let cz = NEAR[2] - 0.03; cz <= NEAR[2] + 0.03; cz += 0.005) for (let a = 0; a < Math.PI; a += Math.PI / 180) {
  if (!isNaN(A) && Math.abs(a - A * Math.PI / 180) > 0.01) continue;
  const ny = Math.sin(a), nz = Math.cos(a); let n = 0;
  for (const p of sw) { const y = p[1] - cy, z = p[2] - cz; if (Math.abs(y * ny + z * nz) > 0.02) continue; const r = Math.hypot(p[0] - NEAR[0], y * nz - z * ny); if (r > 0.15 && r < 0.2) n++; }
  if (n > best.n) best = { n, cy, cz, a };
}
let ax = [0, Math.sin(best.a), Math.cos(best.a)]; if (ax[2] < 0) ax = ax.map(x => -x);
const piv = [NEAR[0], best.cy, best.cz];
console.log(`pivot ${piv.map(x => x.toFixed(3))} axis ${ax.map(x => x.toFixed(3))} (tilt ${(best.a * 180 / Math.PI).toFixed(1)} deg, ${best.n} rim pts)`);
const f = x => x.toFixed(3);
for (const n of mn) n.prims.forEach((p, k) => {
  const m = json.materials[p.prim.material] ?? {}, hs = [], rs = [];
  for (let t = 0; t < p.idx.length; t += 3) {
    const c = [0, 1, 2].map(j => { let s = 0; for (let q = 0; q < 3; q++) s += car(p.pos, 3 * p.idx[t + q])[j]; return s / 3 - piv[j]; });
    const h = c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2], r = Math.sqrt(Math.max(0, c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - h * h));
    if (r < 0.24 && h > -0.25 && h < 0.3) { hs.push(h); rs.push(r); }
  }
  if (!hs.length) return;
  const inDisc = hs.filter((h, i) => h > -0.15 && h < 0.1 && rs[i] < 0.22).length;
  console.log(`${n.name}#${k} mat=${m.name} alpha=${m.alphaMode ?? 'OPAQUE'} tex=${m.pbrMetallicRoughness?.baseColorTexture ? 'y' : 'n'} tris=${p.idx.length / 3} near=${hs.length} inDisc=${inDisc} h[${f(Math.min(...hs))},${f(Math.max(...hs))}] r[${f(Math.min(...rs))},${f(Math.max(...rs))}]`);
});
