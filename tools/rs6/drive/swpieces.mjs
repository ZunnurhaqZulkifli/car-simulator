// connected pieces of the interior meshes near the steering wheel (car metres): their depth h along the column (+ = into the
// dash) and radius r off its axis - node swpieces.mjs <glb> <length>
import { readGlb, meshNodes } from './glb.mjs';
const { json, bin } = readGlb(process.argv[2]), L = +process.argv[3], nodes = meshNodes(json, bin);
const C = [0.3808, 0.9132, 0.4648], N = [0.005, -0.380, 0.925];
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of nodes) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p.pos[v + k]); B[k + 3] = Math.max(B[k + 3], p.pos[v + k]); }
const k = L / (B[5] - B[2]), car = (x, y, z) => [(x - (B[0] + B[3]) / 2) * k, (y - B[1]) * k, (z - (B[2] + B[5]) / 2) * k];
const geo = q => { const d = q.map((v, i) => v - C[i]), h = d[0]*N[0]+d[1]*N[1]+d[2]*N[2]; return [h, Math.sqrt(Math.max(0, d[0]**2+d[1]**2+d[2]**2-h*h))]; };
for (const nd of nodes) { const mat = json.materials[nd.prims[0].prim.material].name.replace('AAudi_RS6AvantRewardRecycled_2020', '');
  if (/Wheel1A|Calliper/.test(mat)) continue;
  for (const p of nd.prims) { const P = []; for (let v = 0; v < p.pos.length; v += 3) P.push(car(p.pos[v], p.pos[v+1], p.pos[v+2]));
    if (!P.some(q => { const [h, r] = geo(q); return r < 0.25 && h > -0.15 && h < 0.2; })) continue;
    const weld = new Map(), wid = P.map(q => { const kk = q.map(x => Math.round(x * 1000)).join(); if (!weld.has(kk)) weld.set(kk, weld.size); return weld.get(kk); });
    const par = [...Array(weld.size).keys()], f = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    for (let t = 0; t < p.idx.length; t += 3) { const a = f(wid[p.idx[t]]); par[f(wid[p.idx[t+1]])] = a; par[f(wid[p.idx[t+2]])] = a; }
    const comps = new Map();
    for (let t = 0; t < p.idx.length; t += 3) { const id = f(wid[p.idx[t]]); if (!comps.has(id)) comps.set(id, { tris: 0, h0: 9, h1: -9, r0: 9, r1: 0, c: [0,0,0], n: 0 }); const o = comps.get(id); o.tris++;
      for (let i = 0; i < 3; i++) { const q = P[p.idx[t+i]], [h, r] = geo(q); o.h0 = Math.min(o.h0, h); o.h1 = Math.max(o.h1, h); o.r0 = Math.min(o.r0, r); o.r1 = Math.max(o.r1, r); o.c = o.c.map((v, j) => v + q[j]); o.n++; } }
    const near = [...comps.values()].filter(o => o.r0 < 0.24 && o.h0 < 0.15 && o.h1 > -0.15).sort((a, b) => b.tris - a.tris);
    for (const o of near.slice(0, 25)) console.log(`${mat.padEnd(32)} tris ${String(o.tris).padStart(5)} h ${o.h0.toFixed(3)}..${o.h1.toFixed(3)} r ${o.r0.toFixed(3)}..${o.r1.toFixed(3)} c ${o.c.map(v => (v / o.n).toFixed(2))}`);
    if (near.length > 25) console.log(`  ... ${near.length - 25} more small pieces`);
  } }
