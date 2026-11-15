// node prep-x3.mjs <2024_bmw_x3_m40i.glb> <out.glb> <work dir>  - Ddiaz Design's "2024 BMW X3 M40i" (Sketchfab, CC BY-NC-SA
// 4.0) for drive.html. Already nose-first (+z), left-hand drive, Alpine White under a black panoramic roof, on round 21s
// (each tyre's PCA axle is within 0.03 deg of x): all kept. Prep
// - names every node by role (paint_N, glass_N, lens_N, wheel_rim_N, wheel_tyre_N, wheel_disc_N, body_caliper_N,
//   head_lights_N, tail_lights_N, reverse_lights_N, mirror_lights_N, cabin_steering_N, cabin_N inside, body_N outside),
//   one primitive per node, so drive.html's "material|node|parent" ids are these names;
// - splits the lamps by their texture: the model's one lamp material carries a glow map baked fully lit (tail lights,
//   DRLs, projectors, amber signals, reversing lights), so every lamp looked on in daylight. Each role gets its own copy
//   with only its colour left in the glow map: head_lights_1 the white DRL light guides (lit, as BMW's DRLs are),
//   head_lights_2 the three LED projectors (dark until drive.html lights the headlamps), tail_lights_1/3 the red only
//   (drive.html scales it: dim, lights, braking), tail_lights_2 the third brake light (a third as strong, so only braking
//   shows), reverse_lights_1 the white bar in each tailgate lamp (dark until reversing - CAR.lamps.reverse). The amber
//   signals go dark (drive.html flashes its own); the bumper reflectors and the mirror signals lose their glow;
// - clears the lamp lenses (they were 45% black: the DRLs read grey) to a light smoke;
// - the model's own cluster screen goes black - the live cluster covers that spot. (The cabin decals stay alpha BLEND:
//   they are only icons and badges, and as MASK their thin strokes broke up into speckles from the seat);
// - the steering wheel is already its own five meshes (rim, spokes, buttons, paddles: cabin_steering_1..5); its circle
//   fit is printed (steering.near). It goes 1.5 cm up (RAISE: the seat height drive.html derives from it);
// - cuts what no drive.html camera can see (vis.html, headless Chrome: every chase-camera position all the way round and
//   the in-car eye looking every way, each triangle drawn in its own id colour; kept: what any view saw, plus its
//   neighbours) - the engine bay, suspension, most of the underbody, the insides of the doors, seats and dash;
// - drops the second and third UV sets and the tangents (no material reads them; three makes tangents from the
//   normal map's derivatives), and UVs where a material has no texture; every primitive keeps only the vertices it uses.
// <work dir> gets the glow textures (ImageMagick) and stage-a.glb (roles, before the cut).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readGlb, writeGlb, accessor, meshNodes, mul, local } from '../../rs6/drive/glb.mjs';
import { runVis } from './run.mjs';

const [src, out, work] = process.argv.slice(2);
if (!work) throw new Error('usage: prep-x3.mjs <src.glb> <out.glb> <work dir>');
fs.mkdirSync(work, { recursive: true });
const LENGTH = 4.716; // the G01 LCI M40i's, as drive.html scales it

// ======== stage a: roles, lamps, materials ========
const { json, bin } = readGlb(src);
const mn = meshNodes(json, bin), byNode = new Map(mn.map(n => [n.node, n]));
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of mn) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p.pos[v + k]); B[k + 3] = Math.max(B[k + 3], p.pos[v + k]); }
const K = LENGTH / (B[5] - B[2]), car = (pos, v) => [(pos[v] - (B[0] + B[3]) / 2) * K, (pos[v + 1] - B[1]) * K, (pos[v + 2] - (B[2] + B[5]) / 2) * K];
const prim = i => json.meshes[json.nodes[i].mesh].primitives[0];
const matOf = i => json.materials[prim(i).material].name;
const matIx = name => { const i = json.materials.findIndex(m => m.name === name); if (i < 0) throw new Error('no material ' + name); return i; };
const nodesWhere = test => json.nodes.map((n, i) => i).filter(i => json.nodes[i].mesh !== undefined && test(json.nodes[i].name, i));
const one = (test, what) => { const l = nodesWhere(test); if (l.length !== 1) throw new Error(`expected one ${what}, found ${l.length}`); return l[0]; };
const parentOf = i => json.nodes.findIndex(n => (n.children || []).includes(i));

let tail = bin.length; const extra = []; // new data appended after the source BIN
const addAcc = (arr, comp) => {
  const ta = comp === 5125 ? Uint32Array.from(arr) : Uint16Array.from(arr), buf = Buffer.from(ta.buffer);
  while (tail % 4) { extra.push(Buffer.alloc(1)); tail++; }
  json.bufferViews.push({ buffer: 0, byteOffset: tail, byteLength: buf.length, target: 34963 }); extra.push(buf); tail += buf.length;
  json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: comp, count: arr.length, type: 'SCALAR' });
  return json.accessors.length - 1;
};
const addImage = (name, file) => {
  const buf = fs.readFileSync(file);
  while (tail % 4) { extra.push(Buffer.alloc(1)); tail++; }
  json.bufferViews.push({ buffer: 0, byteOffset: tail, byteLength: buf.length }); extra.push(buf); tail += buf.length;
  json.images.push({ name, mimeType: 'image/png', bufferView: json.bufferViews.length - 1 });
  json.textures.push({ sampler: 0, source: json.images.length - 1 });
  return json.textures.length - 1;
};
const big = list => list.length && Math.max(...list) > 65535 ? 5125 : 5123;
// a node's triangles split by pick(corners in car metres, UV centroid): the picked go to a new sibling node (same transform
// and vertex data, its own index list and material), the rest stay
const split = (node, pick, name, material) => {
  const p = byNode.get(node).prims[0], uv = accessor(json, bin, p.prim.attributes.TEXCOORD_0), yes = [], no = [];
  for (let t = 0; t < p.idx.length; t += 3) {
    const c = [0, 1, 2].map(i => car(p.pos, p.idx[t + i] * 3)), u = [0, 1, 2].reduce((s, i) => s + uv[p.idx[t + i] * 2], 0) / 3, w = [0, 1, 2].reduce((s, i) => s + uv[p.idx[t + i] * 2 + 1], 0) / 3;
    (pick(c, u, w) ? yes : no).push(p.idx[t], p.idx[t + 1], p.idx[t + 2]);
  }
  if (!yes.length) throw new Error('nothing split off for ' + name);
  json.meshes.push({ name, primitives: [{ ...prim(node), indices: addAcc(yes, big(yes)), material }] });
  prim(node).indices = addAcc(no, big(no));
  byNode.get(node).prims[0].idx = no; // (later splits of this node see only what's left)
  const s0 = json.nodes[node];
  json.nodes.push({ name, mesh: json.meshes.length - 1, ...['matrix', 'translation', 'rotation', 'scale'].reduce((o, k) => (s0[k] ? { ...o, [k]: s0[k] } : o), {}) });
  json.nodes[parentOf(node)].children.push(json.nodes.length - 1);
  named.add(json.nodes.length - 1);
  return yes.length / 3;
};
const named = new Set(); const nameNode = (i, name) => { json.nodes[i].name = name; json.meshes[json.nodes[i].mesh].name = name; named.add(i); };

// ---- the lamps: glow maps keyed on colour (the source's 512 px glow map) ----
const LIGHT = matIx('X3MI_Light_007'), light = json.materials[LIGHT];
{ const bv = json.bufferViews[json.images[json.textures[light.emissiveTexture.index].source].bufferView];
  fs.writeFileSync(`${work}/glow-src.png`, bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); }
const mk = (out, fx) => execFileSync('magick', [`${work}/glow-src.png`, '-alpha', 'off', '-fx', fx, '-strip', `PNG24:${work}/${out}`]);
mk('glow-white.png', '(min(r,min(g,b)) > 0.6*max(r,max(g,b)) && max(r,max(g,b)) > 0.06) ? u : 0'); // DRLs, projectors, reversing light
mk('glow-red.png', '(r > 1.8*g && r > 1.8*b) ? u : 0'); // tail and brake lights
const whiteTex = addImage('x3_glow_white', `${work}/glow-white.png`), redTex = addImage('x3_glow_red', `${work}/glow-red.png`);
const lampMat = (name, tex, f) => { json.materials.push({ ...JSON.parse(JSON.stringify(light)), name, ...(tex === null ? {} : { emissiveTexture: { index: tex } }), emissiveFactor: [f, f, f] });
  if (tex === null) delete json.materials.at(-1).emissiveTexture; return json.materials.length - 1; };
const M = { drl: lampMat('x3_head_drl', whiteTex, 1), beam: lampMat('x3_head_beam', whiteTex, 0), tail: lampMat('x3_tail', redTex, 1), brake: lampMat('x3_brake', redTex, 0.35),
  reverse: lampMat('x3_reverse', whiteTex, 0), unlit: lampMat('x3_lamp_unlit', null, 0) };
// UV boxes on the lamp atlas: the three projector lenses (front), the tailgate lamps' white bar, the third brake light
const PROJ = (u, w) => u > 0.71 && u < 0.91 && w > 0.14 && w < 0.5, REV = (u, w) => u > 0.91 && u < 0.99 && w > 0.19 && w < 0.465, HMSL = (u, w) => w > 0.08 && w < 0.16;
const front = one((n, i) => /SM_Light_F_/.test(n) && matOf(i) === 'X3MI_Light_007', 'front lamp'), rearBody = one((n, i) => /SM_Light_B_/.test(n) && matOf(i) === 'X3MI_Light_007', 'rear lamp');
const rearGate = one((n, i) => /SK_Trunk_/.test(n) && matOf(i) === 'X3MI_Light_007', 'tailgate lamp'), reflectors = one((n, i) => /SM_Bumper_B_/.test(n) && matOf(i) === 'X3MI_Light_007', 'bumper reflector');
const counts = {};
counts.projectors = split(front, (c, u, w) => PROJ(u, w), 'head_lights_2', M.beam);
prim(front).material = M.drl; nameNode(front, 'head_lights_1');
prim(rearBody).material = M.tail; nameNode(rearBody, 'tail_lights_1');
counts.reverse = split(rearGate, (c, u, w) => REV(u, w), 'reverse_lights_1', M.reverse);
counts.hmsl = split(rearGate, (c, u, w) => HMSL(u, w) && c.every(q => q[1] > 1.4), 'tail_lights_2', M.brake);
prim(rearGate).material = M.tail; nameNode(rearGate, 'tail_lights_3');
prim(reflectors).material = M.unlit;
nodesWhere((n, i) => /SideMirror/.test(n) && matOf(i) === 'X3MI_Light_007').forEach((i, k) => { prim(i).material = M.unlit; nameNode(i, `mirror_lights_${k + 1}`); });
// the lenses: a light smoke over the lamps instead of 45% black
json.materials[matIx('X3MI_Glass_021')].pbrMetallicRoughness.baseColorFactor = [0.02, 0.02, 0.025, 0.18];

// ---- the cabin ----
json.materials.push({ name: 'x3_screen_off', pbrMetallicRoughness: { baseColorFactor: [0.004, 0.004, 0.005, 1], metallicFactor: 0, roughnessFactor: 0.12 } });
const dash = one((n, i) => matOf(i) === 'X3MI_Dashboard_002', 'dashboard screen');
counts.clusterScreen = split(dash, c => c.every(q => q[0] > 0.12), 'cabin_cluster_screen', json.materials.length - 1);
// the steering wheel: the five meshes under the body bones on the driver's side; its rim = the leather's biggest ring
const minX = i => { const p = byNode.get(i).prims[0].pos; let m = Infinity; for (let v = 0; v < p.length; v += 3) m = Math.min(m, car(p, v)[0]); return m; };
const wheelNodes = nodesWhere((n, i) => /SK_Body_Bones/.test(n) && minX(i) > 0.15); // (not the wipers, also on the body bones)
if (wheelNodes.length !== 5) throw new Error('expected 5 steering wheel meshes, found ' + wheelNodes.length);
wheelNodes.forEach((i, k) => nameNode(i, `cabin_steering_${k + 1}`));
// all of it RAISE m higher: drive.html's eye is the wheel's centre + 0.3 m up, and as modelled the dash top stood 0.152 over
// the wheel and so the eye only 0.148 over the dash - at the edge of where the M5, G30, E60 and M3 sit (0.11-0.15 / 0.15-0.19)
const RAISE = 0.015;
{ const world = [], walk = (i, pm) => { world[i] = mul(pm, local(json.nodes[i])); for (const c of json.nodes[i].children || []) walk(c, world[i]); };
  json.scenes[0].nodes.forEach(r => walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const toLocal = (m, d) => { // a world-space shift in a node's parent's axes: the inverse of the parent's 3x3 (column-major m) times d
    const a = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], c = (i, j) => a[(i + 1) % 3][(j + 1) % 3] * a[(i + 2) % 3][(j + 2) % 3] - a[(i + 1) % 3][(j + 2) % 3] * a[(i + 2) % 3][(j + 1) % 3];
    const det = a[0][0] * c(0, 0) + a[0][1] * c(0, 1) + a[0][2] * c(0, 2);
    return [0, 1, 2].map(i => (c(0, i) * d[0] + c(1, i) * d[1] + c(2, i) * d[2]) / det); };
  for (const i of wheelNodes) {
    const n = json.nodes[i];
    if (n.matrix || n.translation || n.rotation || n.scale) throw new Error(`${n.name} has a transform of its own`);
    n.translation = toLocal(world[parentOf(i)], [0, RAISE / K, 0]);
  }
}
let rim;
{ const p = byNode.get(wheelNodes.find(i => matOf(i) === 'X3MI_Cabin_Leather_A_007' && byNode.get(i).prims[0].idx.length > 3000)).prims[0];
  const P = [...new Set(p.idx)].map(v => car(p.pos, v * 3));
  const fit = R => { // plane (PCA) + circle (Kasa) in it
    const c = [0, 1, 2].map(i => R.reduce((s, q) => s + q[i], 0) / R.length), Mx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const q of R) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Mx[i][j] += (q[i] - c[i]) * (q[j] - c[j]);
    const tr = Mx[0][0] + Mx[1][1] + Mx[2][2]; let N = [0, 0.3, 1];
    for (let t = 0; t < 300; t++) { const b = Mx.map((row, i) => tr * N[i] - row[0] * N[0] - row[1] * N[1] - row[2] * N[2]), l = Math.hypot(...b); N = b.map(x => x / l); }
    if (N[2] < 0) N = N.map(x => -x);
    const U = [1, 0, 0].map((x, i) => x - N[0] * N[i]), ul = Math.hypot(...U); for (let i = 0; i < 3; i++) U[i] /= ul;
    const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
    const uv = R.map(q => { const d = q.map((x, i) => x - c[i]); return [d[0] * U[0] + d[1] * U[1] + d[2] * U[2], d[0] * V[0] + d[1] * V[1] + d[2] * V[2]]; });
    let su = 0, sw = 0, suu = 0, sww = 0, suw = 0, suz = 0, swz = 0, sz = 0; const m = uv.length;
    for (const [u, w] of uv) { const z = u * u + w * w; su += u; sw += w; suu += u * u; sww += w * w; suw += u * w; suz += u * z; swz += w * z; sz += z; }
    const A = [[suu, suw, su, suz], [suw, sww, sw, swz], [su, sw, m, sz]];
    for (let i = 0; i < 3; i++) { let pv = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[pv][i])) pv = k; [A[i], A[pv]] = [A[pv], A[i]]; for (let k = 0; k < 3; k++) if (k !== i) { const ff = A[k][i] / A[i][i]; for (let j = i; j < 4; j++) A[k][j] -= ff * A[i][j]; } }
    const cu = A[0][3] / A[0][0] / 2, cw = A[1][3] / A[1][1] / 2, rad = Math.sqrt(A[2][3] / A[2][2] + cu * cu + cw * cw);
    return { C: c.map((x, i) => x + cu * U[i] + cw * V[i]), N, rad, rms: Math.sqrt(uv.reduce((s, [u, w]) => s + (Math.hypot(u - cu, w - cw) - rad) ** 2, 0) / m), m };
  };
  rim = fit(P);
  for (let it = 0; it < 6; it++) { // only the points about the grip's centreline (its section ~3 cm)
    const geo = q => { const d = q.map((x, i) => x - rim.C[i]), h = d[0] * rim.N[0] + d[1] * rim.N[1] + d[2] * rim.N[2]; return [h, Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - h * h))]; };
    rim = fit(P.filter(q => { const [h, r] = geo(q); return Math.abs(h) < 0.03 && Math.abs(r - rim.rad) < 0.03; }));
  }
  rim.C[1] += RAISE; // (fitted on the vertices as modelled)
  console.log(`rim fit (raised ${RAISE} m): centre ${rim.C.map(x => x.toFixed(4))} axis ${rim.N.map(x => x.toFixed(3))} tilt ${(Math.atan2(-rim.N[1], rim.N[2]) * 180 / Math.PI).toFixed(1)}° r ${rim.rad.toFixed(4)} rms ${rim.rms.toFixed(4)} (${rim.m} pts)`);
}

// ---- every other node by role ----
const ROLE = { X3MI_1347060001_015: 'paint', X3MI_Glass_023: 'glass', X3MI_Glass_021: 'lens', X3MI_ChangeA_Rim_002: 'wheel_rim', X3MI_ChangeA_Tyre_002: 'wheel_tyre' };
const count = {};
const wheelCentres = [];
for (const [i, n] of json.nodes.entries()) {
  if (n.mesh === undefined || named.has(i)) continue;
  const mat = matOf(i);
  const role = /Ani_Disc_Scale/.test(n.name) ? 'wheel_disc' : /Ani_Wheel_Caliper|SK_Brake_101/.test(n.name) ? 'body_caliper' : ROLE[mat] ?? (/^X3MI_Cabin|^Costuras|^X3MI_Dashboard|^X3MI_Mirror/.test(mat) && !/SideMirror/.test(n.name) ? 'cabin' : 'body');
  if (role === 'wheel_tyre') { const p = byNode.get(i).prims[0], c = [0, 0, 0]; for (let v = 0; v < p.pos.length; v += 3) car(p.pos, v).forEach((x, k) => c[k] += x * 3 / p.pos.length); wheelCentres.push(c); }
  nameNode(i, `${role}_${count[role] = (count[role] || 0) + 1}`);
}
if (count.wheel_rim !== 4 || count.wheel_tyre !== 4 || count.wheel_disc !== 4 || count.body_caliper !== 4) throw new Error('wheels: ' + JSON.stringify(count));
const midZ = (Math.max(...wheelCentres.map(c => c[2])) + Math.min(...wheelCentres.map(c => c[2]))) / 2;
console.log('stage a:', JSON.stringify(counts), JSON.stringify(count), `midZ ${midZ.toFixed(4)}`);
json.buffers = [{ byteLength: tail }];
writeGlb(`${work}/stage-a.glb`, json, Buffer.concat([bin, ...extra]));

// ======== stage b: what no camera sees, cut; every primitive compacted ========
const A = readGlb(`${work}/stage-a.glb`), aj = A.json;
// candidates for the cut (and the only things that hide anything): everything solid but the wheels, brakes and the
// steering wheel (they move: what's behind them must stay); see-through and alpha parts hide nothing and all stay
const keepAll = (n, m) => /^(wheel_|body_caliper|cabin_steering|glass_|lens_)/.test(n) || ['BLEND', 'MASK'].includes(m.alphaMode) && !/Engine/.test(m.name);
const cand = aj.nodes.map((n, i) => i).filter(i => aj.nodes[i].mesh !== undefined && !keepAll(aj.nodes[i].name, aj.materials[aj.meshes[aj.nodes[i].mesh].primitives[0].material]));
const eye = [rim.C[0], rim.C[1] + 0.3, rim.C[2] - 0.55]; // drive.html's EYE: the wheel's centre + (0, 0.3, -0.55)
const t0 = Date.now();
const V = await runVis(`${work}/stage-a.glb`, LENGTH, `return await vis(${JSON.stringify({ cand, eye, midZ })});`);
console.log(`vis: ${V.views} views, ${V.visible} of ${V.tris} candidate triangles seen (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const amn = meshNodes(aj, A.bin), aBy = new Map(amn.map(n => [n.node, n]));
const keepTris = new Map(); // node -> triangle indices kept
let before = 0, after = 0;
for (const [i, n] of aj.nodes.entries()) {
  if (n.mesh === undefined) continue;
  const idx = aBy.get(i).prims[0].idx, tris = idx.length / 3; before += tris;
  if (!(i in V.bits)) { keepTris.set(i, [...Array(tris).keys()]); after += tris; continue; }
  const bits = Buffer.from(V.bits[i], 'base64'), seen = t => bits[t >> 3] >> (t & 7) & 1;
  // plus every triangle sharing a corner (by position) with a seen one: a sliver can fall between pixels
  const pos = aBy.get(i).prims[0].pos, key = v => `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`, hot = new Set();
  for (let t = 0; t < tris; t++) if (seen(t)) for (let k = 0; k < 3; k++) hot.add(key(idx[t * 3 + k]));
  const kept = []; for (let t = 0; t < tris; t++) if (seen(t) || [0, 1, 2].some(k => hot.has(key(idx[t * 3 + k])))) kept.push(t);
  keepTris.set(i, kept); after += kept.length;
}
// rebuild: one fresh BIN of the kept images and, per primitive, only its used vertices (POSITION, NORMAL, and TEXCOORD_0
// if its material has a texture)
const views = [], accs = [], chunks = []; let off = 0;
const push = (buf, target) => { const pad = (4 - off % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(buf); off += buf.length; return views.length - 1; };
const floats = (arr, type, minmax) => {
  const ta = Float32Array.from(arr), n = { VEC2: 2, VEC3: 3 }[type], acc = { bufferView: push(Buffer.from(ta.buffer), 34962), componentType: 5126, count: arr.length / n, type };
  if (minmax) { acc.min = [0, 1, 2].map(k => { let m = Infinity; for (let j = k; j < arr.length; j += 3) m = Math.min(m, arr[j]); return m; }); acc.max = [0, 1, 2].map(k => { let m = -Infinity; for (let j = k; j < arr.length; j += 3) m = Math.max(m, arr[j]); return m; }); }
  accs.push(acc); return accs.length - 1;
};
const hasTex = m => /Texture"/.test(JSON.stringify(m));
const nodesOut = aj.nodes.map(n => ({ ...n })), meshes = [];
const dropped = new Set();
for (const [i, n] of nodesOut.entries()) {
  if (n.mesh === undefined) continue;
  const kept = keepTris.get(i);
  if (!kept.length) { delete n.mesh; dropped.add(i); continue; }
  const p = aj.meshes[n.mesh].primitives[0], idx = aBy.get(i).prims[0].idx, remap = new Map(), list = [];
  for (const t of kept) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; if (!remap.has(v)) remap.set(v, remap.size); list.push(remap.get(v)); }
  const attrs = { POSITION: 'VEC3', NORMAL: 'VEC3', ...(hasTex(aj.materials[p.material]) ? { TEXCOORD_0: 'VEC2' } : {}) }, attributes = {};
  for (const [a, type] of Object.entries(attrs)) { const srcA = accessor(aj, A.bin, p.attributes[a]), w = type === 'VEC3' ? 3 : 2, data = [];
    for (const v of remap.keys()) for (let c = 0; c < w; c++) data.push(srcA[v * w + c]);
    attributes[a] = floats(data, type, a === 'POSITION'); }
  const ia = list.length && remap.size > 65535 ? Uint32Array.from(list) : Uint16Array.from(list);
  accs.push({ bufferView: push(Buffer.from(ia.buffer), 34963), componentType: ia instanceof Uint32Array ? 5125 : 5123, count: list.length, type: 'SCALAR' });
  meshes.push({ name: n.name, primitives: [{ attributes, indices: accs.length - 1, material: p.material, mode: 4 }] });
  n.mesh = meshes.length - 1;
}
// nodes: drop mesh-less leaves whose subtree has no mesh left
const hasMesh = i => nodesOut[i].mesh !== undefined || (nodesOut[i].children || []).some(hasMesh);
for (const n of nodesOut) if (n.children) { n.children = n.children.filter(hasMesh); if (!n.children.length) delete n.children; }
const seenN = new Set(), mark = i => { if (seenN.has(i)) return; seenN.add(i); for (const c of nodesOut[i].children || []) mark(c); };
aj.scenes[0].nodes.forEach(mark);
const nodeMap = new Map(), keepNode = [];
[...seenN].sort((a, b) => a - b).forEach(i => { nodeMap.set(i, keepNode.length); keepNode.push(nodesOut[i]); });
for (const n of keepNode) if (n.children) n.children = n.children.map(c => nodeMap.get(c));
// materials, textures, images still used (images copied as they are: none is over 1024 px)
const matMap = new Map(), keepMat = [];
for (const m of meshes) for (const p of m.primitives) { if (!matMap.has(p.material)) { matMap.set(p.material, keepMat.length); keepMat.push(JSON.parse(JSON.stringify(aj.materials[p.material]))); } p.material = matMap.get(p.material); }
const texMap = new Map(), keepTex = [], refTex = o => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/Texture$/.test(k) && v?.index !== undefined) { if (!texMap.has(v.index)) { texMap.set(v.index, keepTex.length); keepTex.push({ ...aj.textures[v.index] }); } v.index = texMap.get(v.index); } else refTex(v); } };
keepMat.forEach(refTex);
const imgMap = new Map(), keepImg = [];
for (const t of keepTex) { if (!imgMap.has(t.source)) { const im = aj.images[t.source], bv = aj.bufferViews[im.bufferView]; imgMap.set(t.source, keepImg.length);
  keepImg.push({ ...(im.name ? { name: im.name } : {}), mimeType: im.mimeType, bufferView: push(A.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)) }); } t.source = imgMap.get(t.source); }
const outJson = { asset: { ...aj.asset, extras: { ...aj.asset.extras, prepared: 'sim-app drive.html: parts named by role, lamp glow maps split by role, lenses cleared, own cluster screen off, unseen triangles cut, spare UV sets and tangents dropped (tools/x3/drive/prep-x3.mjs)' } },
  scene: 0, scenes: [{ ...aj.scenes[0], nodes: aj.scenes[0].nodes.map(i => nodeMap.get(i)) }], nodes: keepNode, meshes, materials: keepMat, textures: keepTex, images: keepImg, samplers: aj.samplers,
  accessors: accs, bufferViews: views, buffers: [{ byteLength: off }], extensionsUsed: [...new Set(keepMat.flatMap(m => Object.keys(m.extensions || {})))] };
if (!outJson.extensionsUsed.length) delete outJson.extensionsUsed;
writeGlb(out, outJson, Buffer.concat(chunks));
// drive.html sizes the model by its bounds: they must not have moved
const fin = meshNodes(outJson, Buffer.concat(chunks)), F = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of fin) for (const p of n.prims) for (let v = 0; v < p.pos.length; v += 3) for (let k = 0; k < 3; k++) { F[k] = Math.min(F[k], p.pos[v + k]); F[k + 3] = Math.max(F[k + 3], p.pos[v + k]); }
if (F.some((x, k) => Math.abs(x - B[k]) > 1e-6)) throw new Error('bounds moved: ' + F + ' vs ' + B);
console.log(`steering.near: [${rim.C.map(x => +x.toFixed(3)).join(', ')}] (rim r ${rim.rad.toFixed(3)}); triangles ${before} -> ${after} (${dropped.size} nodes empty); nodes ${keepNode.length}, meshes ${meshes.length}, materials ${keepMat.length}, images ${keepImg.length}, bytes ${off}`);
