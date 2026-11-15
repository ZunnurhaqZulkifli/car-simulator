// node prep-rs6.mjs <src.glb> <out.glb> - Ddiaz Design's "2020 Audi RS6 Avant" (Sketchfab, CC BY-NC-SA 4.0) for drive.html.
// Already nose-first (+z) and left-hand drive, as built (drive.html keeps it that way). Two changes, as the GT-R's: its
// wheels come as ~140 little meshes each and its calipers as 25-60, ~720 draw calls - every wheel and caliper is merged
// into one mesh per material, the pieces' own transforms baked in (the right side's mirror flips the triangles'
// winding); and the steering wheel is cut out of the interior meshes into cabin_steering nodes (further down).
import { readGlb, writeGlb, accessor, mul, local, meshNodes } from './glb.mjs';
const [src, out] = process.argv.slice(2);
const { json, bin } = readGlb(src);
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const world = [];
const walk = (i, pm) => { world[i] = mul(pm, local(json.nodes[i])); for (const c of json.nodes[i].children || []) walk(c, world[i]); };
for (const r of json.scenes[0].nodes) walk(r, I);
function inv(m) { // a general 4x4 inverse (column-major)
  const a = m, o = new Array(16);
  o[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  o[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  o[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  o[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  o[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  o[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  o[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  o[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  o[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  o[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  o[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  o[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  o[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  o[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  o[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  o[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  const det = a[0]*o[0] + a[1]*o[4] + a[2]*o[8] + a[3]*o[12];
  return o.map(v => v/det);
}
const det3 = m => m[0]*(m[5]*m[10]-m[6]*m[9]) - m[4]*(m[1]*m[10]-m[2]*m[9]) + m[8]*(m[1]*m[6]-m[2]*m[5]);

// new data goes into views held in memory; the BIN is rebuilt at the end from whatever is still referenced
const pending = []; // [viewIndex, Buffer]
const addView = (buf, target) => { json.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: buf.length, ...(target ? { target } : {}) }); pending.push([json.bufferViews.length - 1, buf]); return json.bufferViews.length - 1; };
const addAccessor = (arr, type, comp, target, minmax) => {
  const T = comp === 5126 ? Float32Array : comp === 5125 ? Uint32Array : Uint16Array, ta = T.from(arr);
  const acc = { bufferView: addView(Buffer.from(ta.buffer), target), componentType: comp, count: arr.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type], type };
  if (minmax) { const n = 3, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i += n) for (let k = 0; k < n; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); } Object.assign(acc, { min: mn, max: mx }); }
  json.accessors.push(acc); return json.accessors.length - 1;
};

// car-space bounds as drive.html takes them (every vertex), before anything moves
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of meshNodes(json, bin)) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p.pos[v + k]); B[k + 3] = Math.max(B[k + 3], p.pos[v + k]); }
const GROUPS = ['3DWheel Front L', '3DWheel Front R', '3DWheel Rear L', '3DWheel Rear R', 'Calliper Front L_02', 'Calliper Front R_03', 'Calliper Rear L_04', 'Calliper Rear R_05'];
let before = 0, after = 0;
for (const gname of GROUPS) {
  const g = json.nodes.findIndex(n => n.name === gname);
  if (g < 0) throw new Error('no node ' + gname);
  const gInv = inv(world[g]), buckets = new Map();
  const collect = i => {
    const n = json.nodes[i];
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) throw new Error('not triangles in ' + n.name);
      before++;
      const keys = Object.keys(p.attributes).sort(), key = p.material + '|' + keys.join(',');
      if (!buckets.has(key)) buckets.set(key, { material: p.material, keys, data: Object.fromEntries(keys.map(k => [k, []])), idx: [] });
      const b = buckets.get(key), R = mul(gInv, world[i]), flip = det3(R) < 0;
      const Ninv = inv(R), N = [Ninv[0], Ninv[4], Ninv[8], Ninv[1], Ninv[5], Ninv[9], Ninv[2], Ninv[6], Ninv[10]]; // normal matrix: (R^-1)^T, row-major
      const base = b.data.POSITION.length / 3;
      for (const k of keys) {
        const a = accessor(json, bin, p.attributes[k]), d = b.data[k];
        if (k === 'POSITION') for (let v = 0; v < a.length; v += 3) { const [x, y, z] = [a[v], a[v + 1], a[v + 2]]; d.push(R[0]*x + R[4]*y + R[8]*z + R[12], R[1]*x + R[5]*y + R[9]*z + R[13], R[2]*x + R[6]*y + R[10]*z + R[14]); }
        else if (k === 'NORMAL') for (let v = 0; v < a.length; v += 3) { const [x, y, z] = [a[v], a[v + 1], a[v + 2]]; const q = [N[0]*x + N[1]*y + N[2]*z, N[3]*x + N[4]*y + N[5]*z, N[6]*x + N[7]*y + N[8]*z], l = Math.hypot(...q) || 1; d.push(q[0]/l, q[1]/l, q[2]/l); }
        else if (k === 'TANGENT') for (let v = 0; v < a.length; v += 4) { const [x, y, z, w] = [a[v], a[v + 1], a[v + 2], a[v + 3]]; const q = [R[0]*x + R[4]*y + R[8]*z, R[1]*x + R[5]*y + R[9]*z, R[2]*x + R[6]*y + R[10]*z], l = Math.hypot(...q) || 1; d.push(q[0]/l, q[1]/l, q[2]/l, flip ? -w : w); }
        else for (const v of a) d.push(v);
      }
      const ix = p.indices !== undefined ? accessor(json, bin, p.indices) : [...Array(json.accessors[p.attributes.POSITION].count).keys()];
      for (let t = 0; t < ix.length; t += 3) flip ? b.idx.push(base + ix[t], base + ix[t + 2], base + ix[t + 1]) : b.idx.push(base + ix[t], base + ix[t + 1], base + ix[t + 2]);
    }
    for (const c of n.children || []) collect(c);
  };
  for (const c of json.nodes[g].children || []) collect(c);
  const kids = [];
  for (const b of buckets.values()) {
    const TYPE = { POSITION: 'VEC3', NORMAL: 'VEC3', TANGENT: 'VEC4', TEXCOORD_0: 'VEC2', TEXCOORD_1: 'VEC2' };
    const attributes = Object.fromEntries(b.keys.map(k => { if (!TYPE[k]) throw new Error('attribute ' + k); return [k, addAccessor(b.data[k], TYPE[k], 5126, 34962, k === 'POSITION')]; }));
    const nv = b.data.POSITION.length / 3, indices = addAccessor(b.idx, 'SCALAR', nv > 65535 ? 5125 : 5123, 34963);
    json.meshes.push({ name: gname.replace(/ /g, '_') + '_merged', primitives: [{ attributes, indices, material: b.material, mode: 4 }] });
    json.nodes.push({ name: gname.replace(/ /g, '_') + '_' + (json.materials[b.material].name.match(/2020_?(\w+?)_?Material1|Wheel1A_3D/)?.[1] || json.materials[b.material].name.slice(-8)), mesh: json.meshes.length - 1 });
    kids.push(json.nodes.length - 1); after++;
  }
  json.nodes[g].children = kids;
}

// the steering wheel: cut out of the interior meshes into cabin_steering nodes, so drive.html turns the wheel and nothing
// else. In car metres (as drive.html scales the model: 4.995 m long, centred, on the ground) about the rim's circle fit
// (centre C, column axis N, + into the dash): a connected piece lying wholly inside the wheel's disc goes - the rim (the
// leather mesh), spokes, badges, buttons - and so do the two paddles behind it at the hub's height (Audi's turn with the
// wheel). The stalks sit lower and further back and stay. The hub's piece runs on into the column shroud, so a piece
// within the disc's radius but deeper gives up only its triangles in front
{
  const L = 4.995, C = [0.3808, 0.9132, 0.4648], N = [0.005, -0.380, 0.925], H = [-0.08, 0.07], RMAX = 0.215, PADDLE_H = 0.17;
  const k = L / (B[5] - B[2]), car = q => [(q[0] - (B[0] + B[3]) / 2) * k, (q[1] - B[1]) * k, (q[2] - (B[2] + B[5]) / 2) * k];
  const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
  const geo = q => { const d = q.map((v, i) => v - C[i]), h = d[0] * N[0] + d[1] * N[1] + d[2] * N[2]; return [h, Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - h * h))]; };
  json.scenes[0].nodes.forEach(r => walk(r, I)); // world matrices for the merged nodes too
  const SRC = /InteriorA_Material1|InteriorTillingA_Material1|InteriorTillingColourZo|BadgeA_Material1|Coloured_Material1|Base_Material1/;
  const W = { POSITION: 3, NORMAL: 3, TANGENT: 4, TEXCOORD_0: 2, TEXCOORD_1: 2 }, TYPE = { 3: 'VEC3', 4: 'VEC4', 2: 'VEC2' };
  let cut = 0;
  for (const ni of json.nodes.map((n, i) => i).filter(i => json.nodes[i].mesh !== undefined && world[i])) {
    for (const prim of json.meshes[json.nodes[ni].mesh].primitives) {
      if (!SRC.test(json.materials[prim.material].name)) continue;
      const pos = accessor(json, bin, prim.attributes.POSITION), idx = accessor(json, bin, prim.indices);
      const P = []; for (let v = 0; v < pos.length; v += 3) P.push(car(apply(world[ni], pos[v], pos[v + 1], pos[v + 2])));
      const G = P.map(geo);
      if (!G.some(([h, r]) => r < RMAX && h > H[0] && h < PADDLE_H)) continue;
      const weld = new Map(), wid = P.map(q => { const kk = q.map(x => Math.round(x * 1000)).join(); if (!weld.has(kk)) weld.set(kk, weld.size); return weld.get(kk); });
      const par = [...Array(weld.size).keys()], f = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
      for (let t = 0; t < idx.length; t += 3) { const a = f(wid[idx[t]]); par[f(wid[idx[t + 1]])] = a; par[f(wid[idx[t + 2]])] = a; }
      const pieces = new Map();
      for (let t = 0; t < idx.length; t += 3) { const id = f(wid[idx[t]]); if (!pieces.has(id)) pieces.set(id, { h0: 9, h1: -9, r1: 0, y: 0, n: 0, tris: 0 }); const o = pieces.get(id); o.tris++;
        for (let i = 0; i < 3; i++) { const [h, r] = G[idx[t + i]]; o.h0 = Math.min(o.h0, h); o.h1 = Math.max(o.h1, h); o.r1 = Math.max(o.r1, r); o.y += P[idx[t + i]][1]; o.n++; } }
      const whole = o => o.r1 <= RMAX && o.h0 >= H[0] && (o.h1 <= H[1] || (Math.abs(o.y / o.n - C[1]) < 0.035 && o.h1 <= PADDLE_H && o.tris >= 60));
      const front = v => G[v][0] >= H[0] && G[v][0] <= H[1] && G[v][1] <= RMAX;
      const wheel = [], rest = [];
      for (let t = 0; t < idx.length; t += 3) {
        const o = pieces.get(f(wid[idx[t]]));
        const go = whole(o) || (o.r1 <= RMAX && front(idx[t]) && front(idx[t + 1]) && front(idx[t + 2]));
        (go ? wheel : rest).push(idx[t], idx[t + 1], idx[t + 2]);
      }
      if (!wheel.length) continue;
      // the wheel's own vertices, re-indexed; the rest keeps its vertices with the wheel's triangles gone
      const remap = new Map(), keys = Object.keys(prim.attributes), data = Object.fromEntries(keys.map(kk => [kk, []])), src = Object.fromEntries(keys.map(kk => [kk, accessor(json, bin, prim.attributes[kk])]));
      const wIdx = wheel.map(v => { if (!remap.has(v)) { remap.set(v, remap.size); for (const kk of keys) for (let c = 0; c < W[kk]; c++) data[kk].push(src[kk][v * W[kk] + c]); } return remap.get(v); });
      const attributes = Object.fromEntries(keys.map(kk => [kk, addAccessor(data[kk], TYPE[W[kk]], 5126, 34962, kk === 'POSITION')]));
      const name = 'cabin_steering_' + ++cut;
      json.meshes.push({ name, primitives: [{ ...prim, attributes, indices: addAccessor(wIdx, 'SCALAR', remap.size > 65535 ? 5125 : 5123, 34963) }] });
      prim.indices = addAccessor(rest, 'SCALAR', 5125, 34963);
      const src0 = json.nodes[ni], parent = json.nodes.findIndex(n => (n.children || []).includes(ni));
      json.nodes.push({ name, mesh: json.meshes.length - 1, ...['matrix', 'translation', 'rotation', 'scale'].reduce((o, kk) => (src0[kk] ? { ...o, [kk]: src0[kk] } : o), {}) });
      json.nodes[parent].children.push(json.nodes.length - 1);
      console.log(`${name}: ${wheel.length / 3} of ${idx.length / 3} triangles of ${json.materials[prim.material].name.replace(/.*2020_?/, '')}`);
    }
  }
}

// its one skin binds nothing (no node uses it, no mesh has joint weights) and its joints' indices die in the compaction
delete json.skins;
// compact: only the nodes reachable from the scene, the meshes they use, the accessors those use, the images
const keepNode = [], seen = new Set(), mark = i => { if (seen.has(i)) return; seen.add(i); for (const c of json.nodes[i].children || []) mark(c); };
json.scenes[0].nodes.forEach(mark);
const nodeMap = new Map(); [...seen].sort((a, b) => a - b).forEach((i, k) => { nodeMap.set(i, k); keepNode.push(json.nodes[i]); });
for (const n of keepNode) if (n.children) n.children = n.children.map(c => nodeMap.get(c));
json.scenes[0].nodes = json.scenes[0].nodes.map(i => nodeMap.get(i));
const meshMap = new Map(), keepMesh = [];
for (const n of keepNode) if (n.mesh !== undefined) { if (!meshMap.has(n.mesh)) { meshMap.set(n.mesh, keepMesh.length); keepMesh.push(json.meshes[n.mesh]); } n.mesh = meshMap.get(n.mesh); }
const accMap = new Map(), keepAcc = [], mapAcc = i => { if (!accMap.has(i)) { accMap.set(i, keepAcc.length); keepAcc.push(json.accessors[i]); } return accMap.get(i); };
for (const m of keepMesh) for (const p of m.primitives) { for (const k in p.attributes) p.attributes[k] = mapAcc(p.attributes[k]); if (p.indices !== undefined) p.indices = mapAcc(p.indices); }
const viewData = new Map(pending), oldBin = bin, views = [], viewMap = new Map(), mapView = i => {
  if (!viewMap.has(i)) { const v = json.bufferViews[i]; viewMap.set(i, views.length); views.push({ v, data: viewData.get(i) ?? oldBin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength) }); }
  return viewMap.get(i);
};
for (const a of keepAcc) a.bufferView = mapView(a.bufferView);
for (const im of json.images) im.bufferView = mapView(im.bufferView);
let blob = Buffer.alloc(0); const newViews = [];
for (const { v, data } of views) { while (blob.length % 4) blob = Buffer.concat([blob, Buffer.alloc(1)]); newViews.push({ ...v, byteOffset: blob.length, byteLength: data.length }); blob = Buffer.concat([blob, data]); }
Object.assign(json, { nodes: keepNode, meshes: keepMesh, accessors: keepAcc, bufferViews: newViews });
json.buffers = [{ byteLength: blob.length }];
json.asset.extras = { ...json.asset.extras, prepared: 'sim-app drive.html: each wheel and caliper merged into one mesh per material, the steering wheel cut out (prep-rs6.mjs)' };
writeGlb(out, json, blob);
console.log(`merged ${before} wheel/caliper primitives into ${after}; nodes ${keepNode.length}, meshes ${keepMesh.length}, bytes ${blob.length}`);
