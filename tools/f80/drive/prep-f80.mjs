// node prep-f80.mjs <bmw_m3_f80.glb> <out.glb> <work dir>  - GT Cars: Hyperspeed's "BMW M3 (F80)" (Sketchfab, CC BY 4.0) for
// drive.html. A Sketchfab "materialmerger" export of an OBJ: 84 meshes named Object_2..85 under one z-up -> y-up root, one
// per (material, 65k-vertex chunk), the materials named by colour in French (etriers = calipers, sieges = seats, toit =
// roof); 1.35M triangles with a full cabin. Left-hand drive (kept: nothing is mirrored), a bright metallic blue, 19"
// double-spokes with gold calipers on drilled discs, chrome kidney slats. Prep
// - turns it nose-first: the car lies along +x, so a root quarter turn about y puts its nose on +z;
// - names every part by role (paint_N, glass_N, lens_N, wheel_rim_N, wheel_tyre_N, wheel_disc_N, body_caliper_N,
//   head_lights_N, tail_lights_N, reverse_lights_N, cabin_steering_N, cabin_N inside, body_N outside), one primitive per
//   node, so drive.html's "material|node|parent" ids are these names. Parts are cut out of the merged meshes:
//   - the wheels by cylinder: a triangle whose 3 corners lie inside one tyre's cylinder (its x span, its radius) goes to
//     that role by material - tyre, rim (rims, bolts, centre caps), disc (discs, hats) - and spins; the calipers stay;
//   - the steering wheel by its rim's circle fit (plane by PCA, circle by Kasa, refitted on the grip's centreline): the
//     leather, the spokes' aluminium U and the roundel inside its disc; the stalks and the column stay. It goes RAISE
//     higher (the seat height drive.html derives from it); steering.near is printed;
// - lamps: the corona rings (and their eyebrow) are head_lights_1, lit white as BMW's DRLs are; the projector bowls
//   head_lights_2, dark until drive.html lights the headlamps; the red tail lenses tail_lights_1 (an emissive drive.html
//   scales: dim, lights, braking), not the bumper reflectors; the white panes in the boot-lid lamps reverse_lights_1;
//   the headlamp lenses split off the window glass onto a clear lens of their own;
// - the model's own dial faces go black and their chrome rings go (the live cluster sits there); the centre screen's
//   glow from 10x to a screen's;
// - materials for three r182: the roof's 97%-opaque black "glass" becomes an opaque gloss black (the carbon roof); every
//   roughness-0 part gets a real finish (silver rims, ceramic-grey discs, matt rubber, a darker mirror); the black, grey
//   and aluminium that serve both outside and in are split by where they are seen: what the chase camera can see with the
//   windows made opaque is outside (gloss black trim, chrome), the rest is cabin (satin black plastic, leather, brushed
//   aluminium). "chrome_ok" was exported black: it stays gloss black (grilles, discs) but for one mesh that really is
//   chrome (exhaust tips, kidney surround, door lock). The specular and emissive-strength extensions are dropped;
// - cuts what no drive.html camera can see (tools/x3/drive/vis.html: the chase camera all round at every pitch and
//   distance it takes, the in-car eye every way, each triangle in its own id colour; kept: what any view saw, plus its
//   neighbours) - engine bay, underbody, door and seat insides - and merges each role's pieces into one primitive;
// - simplifies each primitive (simplify.mjs: collapses that move no surface more than 0.5 mm outside / 0.3 mm in the
//   cabin and turn no normal more than 8 degrees on the paint / 14 elsewhere; borders, creases and the model's bounds stay)
//   and keeps only the vertices it uses (no UVs where nothing is textured). Same bytes every run.
// <work dir> gets stage-a.glb (roles, before the cut).
import fs from 'node:fs';
import { readGlb, writeGlb, accessor, meshNodes } from '../../rs6/drive/glb.mjs';
import { runVis } from '../../x3/drive/run.mjs';
import { simplify } from './simplify.mjs';

const [src, out, work] = process.argv.slice(2);
if (!work) throw new Error('usage: prep-f80.mjs <src.glb> <out.glb> <work dir>');
fs.mkdirSync(work, { recursive: true });
const LENGTH = 4.671; // the F80's, as drive.html scales it

// ======== stage a: roles ========
const { json, bin } = readGlb(src);
if (json.meshes.length !== 84 || json.nodes[1]?.children?.length !== 84) throw new Error('not the expected BMW M3 (F80) export');
const holder = json.nodes[1]; // the materialmerger node: every mesh is a child of it, with no transform of its own
holder.name = 'bmw_m3_f80';
for (const c of holder.children) if (['matrix', 'translation', 'rotation', 'scale'].some(k => json.nodes[c][k])) throw new Error('a part has its own transform');
json.nodes.push({ name: 'f80', rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2], children: json.scenes[0].nodes }); // nose-first
json.scenes[0].nodes = [json.nodes.length - 1];
const mn = meshNodes(json, bin), byName = new Map(mn.map(n => [n.name, n]));
const B = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of mn) for (let v = 0, p = n.prims[0].pos; v < p.length; v += 3) for (let k = 0; k < 3; k++) { B[k] = Math.min(B[k], p[v + k]); B[k + 3] = Math.max(B[k + 3], p[v + k]); }
const K = LENGTH / (B[5] - B[2]);
// car space as drive.html makes it: metres, centred, tyres on the ground. Per part: its corners there, once
for (const n of mn) { const p = n.prims[0].pos, c = new Float64Array(p.length);
  for (let v = 0; v < p.length; v += 3) { c[v] = (p[v] - (B[0] + B[3]) / 2) * K; c[v + 1] = (p[v + 1] - B[1]) * K; c[v + 2] = (p[v + 2] - (B[2] + B[5]) / 2) * K; }
  n.car = c; n.idx = n.prims[0].idx; n.mat = json.materials[n.prims[0].prim.material].name; n.tris = n.idx.length / 3; }
const part = name => { const n = byName.get(name); if (!n) throw new Error('no ' + name); return n; };
const corner = (n, t, i) => { const v = n.idx[t * 3 + i] * 3; return [n.car[v], n.car[v + 1], n.car[v + 2]]; };
const centroid = (n, t) => [0, 1, 2].map(k => (corner(n, t, 0)[k] + corner(n, t, 1)[k] + corner(n, t, 2)[k]) / 3);

// every triangle gets one group (its final node); unassigned ones are 'rest:<material>' (outside or cabin: decided by the
// visibility pass); DROP = gone
const DROP = '-';
const groupOf = new Map(mn.map(n => [n.name, new Array(n.tris).fill(null)]));
const assign = (name, test, group) => { const n = part(name), g = groupOf.get(name); let c = 0;
  for (let t = 0; t < n.tris; t++) if (g[t] === null && test(n, t)) { g[t] = group; c++; } return c; };
const counts = {};
const all = () => true;

// ---- the steering wheel: its rim fitted on the leather near the driver's seat ----
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
const hr = (q, r) => { const d = q.map((x, i) => x - r.C[i]), h = d[0] * r.N[0] + d[1] * r.N[1] + d[2] * r.N[2]; return [h, Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - h * h))]; };
let rim;
{ const n = part('Object_64'), SEED = [0.37, 0.86, 0.4], P = []; // (sieges: the seats' and the wheel's leather)
  for (const v of new Set(n.idx)) { const q = [n.car[v * 3], n.car[v * 3 + 1], n.car[v * 3 + 2]]; if (Math.hypot(...q.map((x, i) => x - SEED[i])) < 0.26) P.push(q); }
  rim = fit(P); // the whole wheel: its plane and centre
  const rs = P.map(q => hr(q, rim)[1]), far = Math.max(...rs);
  rim = fit(P.filter((q, i) => rs[i] > 0.8 * far)); // the outer ring
  for (let it = 0; it < 8; it++) rim = fit(P.filter(q => { const [h, r] = hr(q, rim); return Math.abs(h) < 0.03 && Math.abs(r - rim.rad) < 0.03; })); // the grip's centreline
  console.log(`rim fit: centre ${rim.C.map(x => x.toFixed(4))} axis ${rim.N.map(x => x.toFixed(4))} tilt ${(Math.atan2(-rim.N[1], rim.N[2]) * 180 / Math.PI).toFixed(1)}° r ${rim.rad.toFixed(4)} rms ${rim.rms.toFixed(4)} (${rim.m} pts)`);
}
// what turns: inside the wheel's disc, 6 cm in front of the rim's plane to 7 cm behind it (the hub's back); the column
// shroud and the stalks (other materials) start further back and stay
const inWheel = (n, t) => [0, 1, 2].every(i => { const [h, r] = hr(corner(n, t, i), rim); return h > -0.06 && h < 0.07 && r < rim.rad + 0.035; });
counts.steering = [assign('Object_64', inWheel, 'cabin_steering_1'), assign('Object_11', inWheel, 'cabin_steering_2'), assign('Object_83', inWheel, 'cabin_steering_3')];

// ---- the wheels: each tyre's cylinder from the tyre meshes (below the dash, where the same material is the dash top) ----
const TYRES = mn.filter(n => n.mat === 'tire'), W = [0, 1, 2, 3].map(() => [9, -9, 9, -9, 9, -9]); // x, y, z ranges
const cornerOf = q => (q[0] > 0) + 2 * (q[2] > 0);
for (const n of TYRES) for (let v = 0; v < n.car.length; v += 3) { const q = [n.car[v], n.car[v + 1], n.car[v + 2]]; if (q[1] > 0.7) continue;
  const w = W[cornerOf(q)]; for (let k = 0; k < 3; k++) { w[k * 2] = Math.min(w[k * 2], q[k]); w[k * 2 + 1] = Math.max(w[k * 2 + 1], q[k]); } }
const cyl = W.map(([x0, x1, y0, y1, z0, z1]) => ({ x0, x1, c: [(y0 + y1) / 2, (z0 + z1) / 2], R: Math.max(y1 - y0, z1 - z0) / 2 }));
const wheelOf = q => cyl.findIndex(w => q[0] > w.x0 - 0.02 && q[0] < w.x1 + 0.02 && Math.hypot(q[1] - w.c[0], q[2] - w.c[1]) < w.R + 0.005);
const inTyre = (n, t) => { const w = wheelOf(corner(n, t, 0)); return w >= 0 && wheelOf(corner(n, t, 1)) === w && wheelOf(corner(n, t, 2)) === w; };
const WHEEL_ROLE = { tire: 'wheel_tyre_1', alum: 'wheel_rim_1', logo: 'wheel_rim_2', chrome_ok: 'wheel_disc_1', gris: 'wheel_disc_2', etriers: 'body_caliper_1' };
counts.wheels = {};
for (const n of mn) if (WHEEL_ROLE[n.mat]) { const c = assign(n.name, inTyre, WHEEL_ROLE[n.mat]); if (c) counts.wheels[WHEEL_ROLE[n.mat]] = (counts.wheels[WHEEL_ROLE[n.mat]] || 0) + c; }
if (groupOf.get('Object_2').some(g => g !== 'body_caliper_1')) throw new Error('a caliper outside the wheels');
console.log('tyres:', cyl.map(w => `x ${w.x0.toFixed(3)}..${w.x1.toFixed(3)} hub y ${w.c[0].toFixed(4)} z ${w.c[1].toFixed(4)} R ${w.R.toFixed(4)}`).join(' | '),
  `wheelbase ${((cyl[2].c[1] + cyl[3].c[1] - cyl[0].c[1] - cyl[1].c[1]) / 2).toFixed(4)}`);

// ---- lamps, lenses, glass ----
counts.lamps = {
  drl: assign('Object_80', all, 'head_lights_1'), // the corona rings' light guides and the eyebrow
  projectors: assign('Object_81', all, 'head_lights_2'),
  tail: assign('Object_63', (n, t) => centroid(n, t)[1] > 0.6, 'tail_lights_1'), // (below: the bumper reflectors)
  reverse: assign('Object_42', all, 'reverse_lights_1'),
  dials: assign('Object_6', all, 'cabin_dials'), // the dial faces: black, the live cluster goes in front
};
// the dials' chrome rings stand in front of the faces, where the live cluster goes
counts.dialRings = assign('Object_39', (n, t) => { const [x, y, z] = centroid(n, t); return x > 0.15 && x < 0.58 && y > 0.84 && y < 1.03 && z > 0.55 && z < 0.72; }, DROP);
counts.glass = { lens: assign('Object_52', (n, t) => { const c = centroid(n, t); return c[1] < 0.92 && Math.abs(c[2]) > 1.5; }, 'lens_1'), windows: assign('Object_52', all, 'glass_1') };
assign('Object_53', all, 'lens_2'); assign('Object_54', all, 'lens_2'); // the rear reflectors' covers
assign('Object_55', all, 'body_roof'); // the black roof
assign('Object_39', all, 'rest:chrome'); // the one real chrome among the "chrome_ok": exhaust tips, kidney surround, door lock, dial rings
for (const n of mn) if (n.mat === 'body') assign(n.name, all, 'paint_1');
for (const n of mn) if (n.mat === 'interior1') assign(n.name, all, 'cabin_screen');
for (const n of mn) { const g = groupOf.get(n.name); for (let t = 0; t < n.tris; t++) if (g[t] === null) g[t] = 'rest:' + n.mat; }
console.log('stage a:', JSON.stringify(counts));

// stage-a.glb: one node per (group, source mesh), each a new index list over the source's vertices
let tail = bin.length; const extra = [], stageNodes = []; // [node index, group, source part, triangle list]
const addIndices = list => {
  const ta = list.some(x => x > 65535) ? Uint32Array.from(list) : Uint16Array.from(list), buf = Buffer.from(ta.buffer);
  while (tail % 4) { extra.push(Buffer.alloc(1)); tail++; }
  json.bufferViews.push({ buffer: 0, byteOffset: tail, byteLength: buf.length, target: 34963 }); extra.push(buf); tail += buf.length;
  json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: ta instanceof Uint32Array ? 5125 : 5123, count: list.length, type: 'SCALAR' });
  return json.accessors.length - 1;
};
holder.children = [];
for (const n of mn) {
  const g = groupOf.get(n.name), by = new Map();
  for (let t = 0; t < n.tris; t++) if (g[t] !== DROP) { if (!by.has(g[t])) by.set(g[t], []); by.get(g[t]).push(t); }
  for (const [group, tris] of by) {
    const list = []; for (const t of tris) list.push(n.idx[t * 3], n.idx[t * 3 + 1], n.idx[t * 3 + 2]);
    json.meshes.push({ name: group, primitives: [{ ...n.prims[0].prim, indices: addIndices(list) }] });
    json.nodes.push({ name: group.replace(':', '_'), mesh: json.meshes.length - 1 });
    holder.children.push(json.nodes.length - 1);
    stageNodes.push([json.nodes.length - 1, group, n, tris]);
  }
}
json.buffers = [{ byteLength: tail }];
writeGlb(`${work}/stage-a.glb`, json, Buffer.concat([bin, ...extra]));

// ======== the visibility passes (vis.html in headless Chrome) ========
// A, the cut: candidates are the solid parts but the moving ones (wheels, calipers, steering wheel: what's behind them
// must stay) and the see-through ones (they hide nothing); B, outside or in: the chase camera only, everything else
// drawn as an occluder - the windows too, so what it can see is the outside
const ALPHA = new Set(['glass', 'r_glass']); // (the roof's "glass" is opaque now)
const solid = ([, group, n]) => !/^(wheel_|body_caliper|cabin_steering|glass_|lens_|tail_lights)/.test(group) && !ALPHA.has(n.mat);
const candA = stageNodes.filter(solid).map(s => s[0]);
const candB = stageNodes.filter(s => s[1].startsWith('rest:')).map(s => s[0]), occB = stageNodes.filter(s => !/^(rest:|lens_|tail_lights)/.test(s[1])).map(s => s[0]); // (the lamps' lenses don't hide their insides)
// the wheel goes RAISE m up: drive.html's eye is its centre + (0, 0.3, -0.55), and as modelled the binnacle hood stood 0.150
// over its centre and the eye only 0.150 over the hood - the edge of where the M5, G30, E60 and M3 sit (0.11-0.15 / 0.15-0.19)
const RAISE = 0.012, near = [rim.C[0], rim.C[1] + RAISE, rim.C[2]];
const eye = [near[0], near[1] + 0.3, near[2] - 0.55];
const midZ = (cyl[0].c[1] + cyl[2].c[1]) / 2, t0 = Date.now();
const V = await runVis(`${work}/stage-a.glb`, LENGTH, `return { a: await vis(${JSON.stringify({ cand: candA, eye, midZ })}), b: await vis(${JSON.stringify({ cand: candB, eye, midZ, occlude: occB, chaseOnly: true })}) };`);
console.log(`vis: cut ${V.a.views} views, ${V.a.visible} of ${V.a.tris} candidate triangles seen; outside ${V.b.views} views, ${V.b.visible} of ${V.b.tris} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
// a pass's bits for a stage node, grown by one ring (every triangle sharing a corner position with a seen one: a sliver
// can fall between pixels)
const grown = (bits64, n, tris) => {
  const bits = Buffer.from(bits64, 'base64'), seen = new Set(), hot = new Set(), key = v => `${n.car[v * 3].toFixed(5)},${n.car[v * 3 + 1].toFixed(5)},${n.car[v * 3 + 2].toFixed(5)}`;
  tris.forEach((t, k) => { if (bits[k >> 3] >> (k & 7) & 1) { seen.add(t); for (let i = 0; i < 3; i++) hot.add(key(n.idx[t * 3 + i])); } });
  return new Set(tris.filter(t => seen.has(t) || [0, 1, 2].some(i => hot.has(key(n.idx[t * 3 + i])))));
};

// ======== stage b: materials, final groups, compaction ========
const SRC = Object.fromEntries(json.materials.map((m, i) => [m.name, i]));
const copy = (name, over = {}) => { const m = JSON.parse(JSON.stringify(json.materials[SRC[name]])); delete m.extensions; delete m.emissiveTexture; delete m.emissiveFactor; return { ...m, ...over, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, ...over.pbrMetallicRoughness } }; };
const plain = (base, metal, rough, over = {}) => ({ doubleSided: true, ...over, pbrMetallicRoughness: { baseColorFactor: base.length === 4 ? base : [...base, 1], metallicFactor: metal, roughnessFactor: rough } });
const grey = g => [g, g, g];
const MATS = { // linear colours
  paint: copy('body', { pbrMetallicRoughness: { metallicFactor: 0.3, roughnessFactor: 0.3 } }), // (drive.html paints it: CARS paint)
  glass: copy('glass'), lens: plain([0.9, 0.92, 0.95, 0.12], 0, 0.02, { alphaMode: 'BLEND' }),
  roof: plain(grey(0.008), 0, 0.12), // the carbon roof, as a gloss black
  rim: plain(grey(0.72), 1, 0.25), // silver paint, not a mirror
  cap: copy('logo', { pbrMetallicRoughness: { roughnessFactor: 0.3 } }),
  disc: plain(grey(0.09), 0.5, 0.55), // carbon-ceramic grey
  hat: plain(grey(0.03), 0.5, 0.35),
  tyre: plain(grey(0.022), 0, 0.82),
  caliper: copy('etriers', { pbrMetallicRoughness: { metallicFactor: 0.35, roughnessFactor: 0.35 } }), // painted gold
  drl: plain(grey(0.8), 0, 0.15, { emissiveFactor: [0.85, 0.88, 0.95] }),
  projector: copy('wire_087225143'), // chrome bowls: dark until the headlamps light them
  tail: copy('r_glass', { emissiveFactor: [0.5, 0.008, 0.004] }), reflector: copy('r_glass'), // (drive.html scales it up to 12x: no green or blue to turn it white)
  reverse: plain([0.55, 0.55, 0.57], 0, 0.08),
  screen: copy('interior1', { emissiveTexture: { index: json.materials[SRC.interior1].emissiveTexture.index }, emissiveFactor: [0.75, 0.75, 0.75], pbrMetallicRoughness: { roughnessFactor: 0.12 } }),
  // outside
  black: plain(grey(0.006), 0, 0.18), // gloss black trim (the grilles, window frames, mirror bases)
  matt: plain(grey(0.012), 0, 0.6), // the diffuser, underbody
  chrome: plain(grey(0.9), 1, 0.06), // the kidney slats and surround, exhaust tips
  logo: copy('logo', { pbrMetallicRoughness: { roughnessFactor: 0.3 } }), mbadge: copy('material', { pbrMetallicRoughness: { roughnessFactor: 0.3 } }),
  plate: copy('plate', { pbrMetallicRoughness: { roughnessFactor: 0.4 } }), mirror: copy('miroir', { pbrMetallicRoughness: { baseColorFactor: [0.45, 0.45, 0.46, 1], roughnessFactor: 0.03 } }), // (the sky in it, not a white slab)
  // the cabin
  cabinBlack: plain(grey(0.009), 0, 0.6), cabinTrim: plain(grey(0.006), 0, 0.22), cabinAlu: plain(grey(0.42), 1, 0.38), cabinChrome: plain(grey(0.7), 1, 0.18),
  leather: plain([0.013, 0.0125, 0.012], 0, 0.5), soft: plain(grey(0.011), 0, 0.75), dialsOff: plain(grey(0.003), 0, 0.4),
  console: copy('interior2', { pbrMetallicRoughness: { roughnessFactor: 0.45 } }),
};
for (const n of ['wire_060110190', 'wire_087225143', 'wire_135110008']) MATS[n] = copy(n); // lamp chrome and red reflectors, as they are
// the parts already named, and the rest by (where, material)
const ROLE_MAT = { paint_1: 'paint', glass_1: 'glass', lens_1: 'lens', lens_2: 'lens', body_roof: 'roof', wheel_rim_1: 'rim', wheel_rim_2: 'cap', wheel_disc_1: 'disc', wheel_disc_2: 'hat',
  wheel_tyre_1: 'tyre', body_caliper_1: 'caliper', head_lights_1: 'drl', head_lights_2: 'projector', tail_lights_1: 'tail', reverse_lights_1: 'reverse', cabin_screen: 'screen', cabin_dials: 'dialsOff',
  cabin_steering_1: 'leather', cabin_steering_2: 'cabinAlu', cabin_steering_3: 'logo' };
const OUT = { chrome: 'chrome', black: 'black', black_dessous: 'matt', gris: 'black', chrome_ok: 'black', alum: 'chrome', logo: 'logo', material: 'mbadge', plate: 'plate', miroir: 'mirror', r_glass: 'reflector', tire: 'soft', sieges: 'leather', interior2: 'console' };
const IN = { chrome: 'cabinChrome', black: 'cabinBlack', black_dessous: 'cabinBlack', gris: 'cabinTrim', chrome_ok: 'cabinBlack', alum: 'cabinAlu', logo: 'logo', material: 'mbadge', plate: 'plate', miroir: 'mirror', r_glass: 'reflector', tire: 'soft', sieges: 'leather', interior2: 'console' };
for (const [, group] of stageNodes) if (group.startsWith('rest:') && !(OUT[group.slice(5)] || MATS[group.slice(5)])) throw new Error('no material for ' + group);
const final = new Map(); // final name -> { mat, pieces: [[part, triangles]] }
const put = (name, mat, n, tris) => { if (!tris.length) return; if (!final.has(name)) final.set(name, { mat, pieces: [] }); final.get(name).pieces.push([n, tris]); };
let before = 0, after = 0, simplified = 0;
const EPS_OUT = 0.0005, EPS_IN = 0.0003; // m: the most a surface may move - 0.5 mm outside (a sixth of a pixel at the chase camera), 0.3 inside
const COS_PAINT = 0.99; // the paint's normals may turn 8 degrees at most (its reflections show any more), the rest 14
const restNames = new Map(); // (where, material) -> body_N / cabin_N, numbered in order of first use
const restName = (where, mat) => { const k = where + mat; if (!restNames.has(k)) restNames.set(k, `${where}_${[...restNames.keys()].filter(x => x.startsWith(where)).length + 1}`); return restNames.get(k); };
for (const [node, group, n, tris] of stageNodes) {
  before += tris.length;
  const kept = node in V.a.bits ? [...grown(V.a.bits[node], n, tris)].sort((a, b) => a - b) : tris;
  after += kept.length;
  if (!group.startsWith('rest:')) { put(group, ROLE_MAT[group] ?? (() => { throw new Error('no material for ' + group); })(), n, kept); continue; }
  const mat = group.slice(5), same = (OUT[mat] ?? mat) === (IN[mat] ?? mat);
  const outside = same ? new Set(tris.filter(t => { const [x, y, z] = centroid(n, t); return !(Math.abs(x) < 0.8 && y > 0.2 && y < 1.4 && z > -1.85 && z < 1.2); })) : grown(V.b.bits[node], n, tris); // (the cabin's box: back to the rear seat's top)
  const o = kept.filter(t => outside.has(t)), i = kept.filter(t => !outside.has(t));
  if (o.length) put(restName('body', OUT[mat] ?? mat), OUT[mat] ?? mat, n, o);
  if (i.length) put(restName('cabin', IN[mat] ?? mat), IN[mat] ?? mat, n, i);
}
// one primitive per final node: POSITION, NORMAL (+ TEXCOORD_0 if its material is textured) of the vertices it uses
const views = [], accs = [], chunks = []; let off = 0;
const push = (buf, target) => { const pad = (4 - off % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }); chunks.push(buf); off += buf.length; return views.length - 1; };
const floats = (arr, type, minmax) => {
  const w = { VEC2: 2, VEC3: 3 }[type], acc = { bufferView: push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), 34962), componentType: 5126, count: arr.length / w, type };
  if (minmax) { acc.min = [0, 1, 2].map(k => { let m = Infinity; for (let j = k; j < arr.length; j += 3) m = Math.min(m, arr[j]); return m; }); acc.max = [0, 1, 2].map(k => { let m = -Infinity; for (let j = k; j < arr.length; j += 3) m = Math.max(m, arr[j]); return m; }); }
  accs.push(acc); return accs.length - 1;
};
const srcAttr = new Map(), attrOf = (n, a) => { const k = n.name + a; if (!srcAttr.has(k)) srcAttr.set(k, accessor(json, bin, n.prims[0].prim.attributes[a])); return srcAttr.get(k); };
const matList = [], matIx = new Map(), textured = m => /Texture"/.test(JSON.stringify(m));
const nodes = [], meshes = [], order = [...final.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const BL = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; // the parts' own bounds (quarter turns from the car's): the vertices on them stay
for (const n of mn) for (let v = 0, p = attrOf(n, 'POSITION'); v < p.length; v += 3) for (let k = 0; k < 3; k++) { BL[k] = Math.min(BL[k], p[v + k]); BL[k + 3] = Math.max(BL[k + 3], p[v + k]); }
for (const name of order) {
  const { mat, pieces } = final.get(name);
  if (!matIx.has(mat)) { matIx.set(mat, matList.length); matList.push({ ...MATS[mat], name: 'f80_' + mat }); }
  const tex = textured(MATS[mat]); let P = [], Nn = [], T = [], I = [];
  for (const [n, tris] of pieces) {
    const remap = new Map(), pos = attrOf(n, 'POSITION'), nor = attrOf(n, 'NORMAL'), uv = tex ? attrOf(n, 'TEXCOORD_0') : null;
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = n.idx[t * 3 + k];
      if (!remap.has(v)) { remap.set(v, P.length / 3); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); Nn.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); if (tex) T.push(uv[v * 2], uv[v * 2 + 1]); }
      I.push(remap.get(v)); }
  }
  // fewer triangles where it can't show (not the textured parts: their UVs would stretch)
  const eps = tex || /^glass/.test(name) ? 0 : /^(cabin|head_lights|tail_lights|reverse_lights|lens)/.test(name) ? EPS_IN : EPS_OUT;
  if (eps) {
    const S = simplify(P, Nn, I, { eps, scale: K, cos: /^paint/.test(name) ? COS_PAINT : 0.97, lock: v => [0, 1, 2].some(k => P[v * 3 + k] === BL[k] || P[v * 3 + k] === BL[k + 3]) }), used = new Map(), P2 = [], N2 = [];
    for (const v of S) if (!used.has(v)) { used.set(v, P2.length / 3); P2.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); N2.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]); }
    I = [...S].map(v => used.get(v)); P = P2; Nn = N2; simplified += I.length / 3;
  } else simplified += I.length / 3;
  const attributes = { POSITION: floats(Float32Array.from(P), 'VEC3', true), NORMAL: floats(Float32Array.from(Nn), 'VEC3'), ...(tex ? { TEXCOORD_0: floats(Float32Array.from(T), 'VEC2') } : {}) };
  const ia = P.length / 3 > 65535 ? Uint32Array.from(I) : Uint16Array.from(I);
  accs.push({ bufferView: push(Buffer.from(ia.buffer), 34963), componentType: ia instanceof Uint32Array ? 5125 : 5123, count: I.length, type: 'SCALAR' });
  meshes.push({ name, primitives: [{ attributes, indices: accs.length - 1, material: matIx.get(mat), mode: 4 }] });
  nodes.push({ name, mesh: meshes.length - 1 });
}
// textures and images still used
const texMap = new Map(), keepTex = [], imgMap = new Map(), keepImg = [];
const refTex = o => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (/Texture$/.test(k) && v?.index !== undefined) { if (!texMap.has(v.index)) { texMap.set(v.index, keepTex.length); keepTex.push({ ...json.textures[v.index] }); } v.index = texMap.get(v.index); } else refTex(v); } };
matList.forEach(refTex);
for (const t of keepTex) { if (!imgMap.has(t.source)) { const im = json.images[t.source], bv = json.bufferViews[im.bufferView]; imgMap.set(t.source, keepImg.length);
  keepImg.push({ mimeType: im.mimeType, bufferView: push(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)) }); } t.source = imgMap.get(t.source); }
const root = json.nodes[json.scenes[0].nodes[0]], sk = json.nodes[0];
for (const n of nodes) if (n.name.startsWith('cabin_steering')) n.translation = [0, 0, RAISE / K]; // (the parts' z is the car's height)
const outNodes = [{ name: root.name, rotation: root.rotation, children: [1] }, { name: sk.name, matrix: sk.matrix, children: [2] }, { name: holder.name, children: nodes.map((n, i) => i + 3) }, ...nodes];
const outJson = { asset: { ...json.asset, extras: { ...json.asset.extras, prepared: 'sim-app drive.html: nose-first, parts cut out and named by role, lamps keyed, finishes for three.js, unseen triangles cut, merged per role and simplified (tools/f80/drive/prep-f80.mjs)' } },
  scene: 0, scenes: [{ name: 'f80', nodes: [0] }], nodes: outNodes, meshes, materials: matList, textures: keepTex, images: keepImg, samplers: json.samplers,
  accessors: accs, bufferViews: views, buffers: [{ byteLength: off }] };
writeGlb(out, outJson, Buffer.concat(chunks));
// drive.html sizes the model by its bounds: they must not have moved
const fin = meshNodes(outJson, Buffer.concat(chunks)), F = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const n of fin) for (let v = 0, p = n.prims[0].pos; v < p.length; v += 3) for (let k = 0; k < 3; k++) { F[k] = Math.min(F[k], p[v + k]); F[k + 3] = Math.max(F[k + 3], p[v + k]); }
if (F.some((x, k) => Math.abs(x - B[k]) > 1e-4)) throw new Error('bounds moved: ' + F + ' vs ' + B);
console.log(`steering.near: [${near.map(x => +x.toFixed(3)).join(', ')}] (raised ${RAISE}; rim r ${rim.rad.toFixed(3)}); triangles ${before} -> ${after} (cut) -> ${simplified} (simplified); nodes ${nodes.length}: ${order.map(n => `${n}=${matList[matIx.get(final.get(n).mat)].name.slice(4)}`).join(' ')}; images ${keepImg.length}; bytes ${off}`);
