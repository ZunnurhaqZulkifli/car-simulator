// node drive-patch.mjs <in drive.html> <out drive.html> - the Genting Highlands and Kuantan run in drive.html: the roads
// and land gen.mjs made (js/karak.js, js/karak-terrain.bin), their toll plazas, tunnel, rest areas, fuel, the Kuantan
// home and the Genting safe house, Kuantan by the sea, the resort's buildings, traffic, teleports and the maps. Each
// anchor must match once; run it on the live file into a scratch copy, test that, then run it again and swap
import fs from 'node:fs';
const [src, dst] = process.argv.slice(2);
let s = fs.readFileSync(src, 'utf8');
const swap = (a, b, n = 1) => {
  const c = s.split(a).length - 1;
  if (c !== n) throw new Error(`anchor found ${c}x: ${a.slice(0, 90)}`);
  s = s.split(a).join(b);
};
const after = (a, b) => swap(a, a + b);

// --- the teleport list, longer now: three columns where there's room, scrolling where there isn't ---
after(`  #teleport-places { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }
`, `  #teleport { max-height: calc(100vh - 32px); overflow-y: auto; }
  @media (min-width: 900px) { #teleport-places { grid-template-columns: 1fr 1fr 1fr; } }
`);

// --- the data, and the land's tiles fetched while the rest builds ---
after(`import NORDSCHLEIFE from './js/nordschleife.js';
`, `import KARAK from './js/karak.js?v=2';
`);
after(`const query = new URLSearchParams(location.search), TEST_DRIVE = query.has('test_drive');
`, `// the land round the Genting / Kuantan run, gzipped tiles of (height + 100) * 5 << 2 | flag (tools/karak/gen.mjs)
const karakLandIn = fetch('/js/karak-terrain.bin?v=2').then(r => new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
`);

// --- every road's stripes drawn in 6 km squares (each its own mesh about its middle): what's off screen or past the
// fog isn't drawn, and what's 75 km out holds steady - the batches' and the one-off stripes' alike; and the reflector
// posts the same way ---
swap(`  } else scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
}`, `  } else squares(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}
// geometry g (unindexed, positions) drawn in 6 km squares: its triangles by the square of their first corner, each
// square a mesh of its own about its middle
const SQ = 6000;
function squares(g, material) {
  const p = g.attributes.position.array, parts = new Map();
  for (let t = 0; t < p.length; t += 9) {
    const k = Math.floor(p[t] / SQ) * 1e5 + Math.floor(p[t + 2] / SQ);
    if (!parts.has(k)) parts.set(k, []);
    parts.get(k).push(t);
  }
  for (const [k, ts] of parts) {
    const ox = (Math.floor(k / 1e5 + 0.5) + 0.5) * SQ, oz = (k - Math.floor(k / 1e5 + 0.5) * 1e5 + 0.5) * SQ, v = new Float32Array(ts.length * 9);
    ts.forEach((t, n) => { for (let q = 0; q < 9; q += 3) v.set([p[t + q] - ox, p[t + q + 1], p[t + q + 2] - oz], n * 9 + q); });
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(v, 3)), mesh = new THREE.Mesh(geo, material);
    geo.computeVertexNormals();
    mesh.position.set(ox, 0, oz);
    scene.add(mesh);
  }
}`);
swap(`  for (const [color, geos] of batch) scene.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));`,
  `  for (const [color, geos] of batch) squares(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));`);
swap(`  const posts = new THREE.InstancedMesh(mergeGeometries([tint(new THREE.BoxGeometry(0.1, 1.05, 0.12).translate(0, 0.525, 0), 0xe8e8e2), tint(new THREE.BoxGeometry(0.104, 0.26, 0.124).translate(0, 0.89, 0), 0x1d1d1f)]),
    new THREE.MeshLambertMaterial({ vertexColors: true }), REFLECTOR_POSTS.length);
  REFLECTOR_POSTS.forEach((at, n) => posts.setMatrixAt(n, at));
  const plates = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.18).translate(0, 0.89, 0.063), new THREE.MeshLambertMaterial(), REFLECTOR_PLATES.length);
  REFLECTOR_PLATES.forEach(([at, c], n) => { plates.setMatrixAt(n, at); plates.setColorAt(n, c); });
  scene.add(posts, plates);`, `  const postGeo = mergeGeometries([tint(new THREE.BoxGeometry(0.1, 1.05, 0.12).translate(0, 0.525, 0), 0xe8e8e2), tint(new THREE.BoxGeometry(0.104, 0.26, 0.124).translate(0, 0.89, 0), 0x1d1d1f)]);
  const postMat = new THREE.MeshLambertMaterial({ vertexColors: true }), plateGeo = new THREE.PlaneGeometry(0.07, 0.18).translate(0, 0.89, 0.063), plateMat = new THREE.MeshLambertMaterial();
  const bySquare = list => list.reduce((m, it) => { const at = it[0] ?? it, k = Math.floor(at.elements[12] / SQ) + ',' + Math.floor(at.elements[14] / SQ); if (!m.has(k)) m.set(k, []); m.get(k).push(it); return m; }, new Map());
  for (const [geo, mat, list] of [[postGeo, postMat, REFLECTOR_POSTS], [plateGeo, plateMat, REFLECTOR_PLATES]]) for (const [k, items] of bySquare(list)) { // (6 km squares, about their middles)
    const [i, j] = k.split(',').map(Number), mesh = new THREE.InstancedMesh(geo, mat, items.length), to = new THREE.Matrix4().makeTranslation(-(i + 0.5) * SQ, 0, -(j + 0.5) * SQ);
    mesh.position.set((i + 0.5) * SQ, 0, (j + 0.5) * SQ);
    items.forEach((it, n) => { mesh.setMatrixAt(n, to.clone().multiply(it[0] ?? it)); if (it[1]) mesh.setColorAt(n, it[1]); });
    scene.add(mesh);
  }`);
// the run's road colours darken in the rain like the rest (its stripes' materials, made ahead for that)
after(`  o.children.forEach(sort);
})(scene);
`, `for (const m of kMats.values()) { // (the run's tiles, built later)
  const hsl = {};
  if (!m.isMeshLambertMaterial || m.userData.dry) continue;
  m.color.getHSL(hsl, THREE.SRGBColorSpace);
  const green = hsl.h > 0.2 && hsl.h < 0.42 && hsl.s > 0.12 && hsl.s < 0.45, grey = hsl.s < 0.12 && hsl.l > 0.15 && hsl.l < 0.31;
  if (green || grey) (green ? greens : asphalt).push(m), m.userData.dry = m.color.clone();
}
`);

// --- a site's boxes merged into a mesh or two (its colours in the vertices), so the scene isn't thousands of objects
// to walk every frame: the fuel stations, workshops and homes, and the run's plazas, signs and portals ---
after(`const site = (x, y, z, rot) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; scene.add(g); return g; };
`, `function mergeSite(g) { // its untextured meshes, by kind (lit or not), into one each - its own frame kept, its boxes solid as before
  const kinds = new Map(), col = new THREE.Color();
  g.updateMatrixWorld(true);
  for (const m of [...g.children]) {
    if (!m.isMesh || m.material.map || m.isInstancedMesh) continue;
    if (m.geometry.type === 'BoxGeometry') boxSolid(m);
    m.updateMatrix();
    const geo = m.geometry.clone().applyMatrix4(m.matrix), n = geo.attributes.position.count, key = m.material.type + m.material.side;
    col.copy(m.material.color);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [col.r, col.g, col.b][k % 3]), 3));
    for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(a)) geo.deleteAttribute(a);
    if (!kinds.has(key)) kinds.set(key, [m.material, []]);
    kinds.get(key)[1].push(geo.index ? geo.toNonIndexed() : geo);
    g.remove(m);
  }
  for (const [mat, geos] of kinds.values()) g.add(new THREE.Mesh(mergeGeometries(geos), new mat.constructor({ vertexColors: true, side: mat.side })));
}
`);
swap(`scene.updateMatrixWorld();
scene.traverse(o => {
  if (o.geometry?.type !== 'BoxGeometry') return;
  const b = new THREE.Box3()`, `scene.updateMatrixWorld();
scene.traverse(o => { if (o.geometry?.type === 'BoxGeometry') boxSolid(o); });
function boxSolid(o) { // (and any merged into a site's mesh, before it was)
  const b = new THREE.Box3()`);
swap(`  c.forEach((p, k) => solid(p.x, p.z, c[(k + 1) % 4].x, c[(k + 1) % 4].z, 0, b.min.y, b.max.y));
});`, `  c.forEach((p, k) => solid(p.x, p.z, c[(k + 1) % 4].x, c[(k + 1) % 4].z, 0, b.min.y, b.max.y));
}`);
swap(`  STATIONS.push(station.position);`, `  mergeSite(station);
  STATIONS.push(station.position);`);
swap(`  SHOPS.push({ x, z, rot });`, `  mergeSite(shop);
  SHOPS.push({ x, z, rot });`);
swap(`  glowAt(home, [[0, 2.9, 0, 20, 7]]);`, `  glowAt(home, [[0, 2.9, 0, 20, 7]]);
  mergeSite(home);`);

// --- the roads ---
after(`W.auto = i => i >= W.iA + 60 && i < W.iB - 60;
`, `// the run to the Genting Highlands and Kuantan (js/karak.js, from OpenStreetMap - tools/karak): off the city's ring
// road north, the Gombak link (GB, 2+2) over the direct road and round onto the KL-Karak Expressway at Gombak's toll
// plaza (KK: the real road and its heights, three lanes each way to past Genting Sempah and two on to Karak, through the
// Genting Sempah tunnel), past Karak's plaza onto the East Coast Expressway (LP: the LPT shrunk to 0.3 of its size, two
// lanes each way) to Kuantan's plaza and into the town (KU). At Genting Sempah, the slip off the eastbound carriageway
// up to the junction over the tunnel (EX1) and the one back down onto the westbound over a bridge (EN1); from that
// junction (a roundabout) the Genting Highlands road (GH, two lanes each way) up to Gohtong Jaya's roundabout and on
// (GU) to where its ways part - the way up (GA), round the resort at the top (TL) and the way down (GD), one way each;
// and east, the road over the tunnel to the rest area's roundabout (EC) and its slips off the westbound (EX2) and onto
// the eastbound carriageway (EN2)
const KR = KARAK.roads;
const kRoad = (name, half, dip = 1.2) => Object.assign(makeRoad(KR[name], false, half, dip), { name });
const GB = kRoad('GB', 10.5, 1.5), KK = kRoad('KK', 16.75, 1.5), LP = kRoad('LP', 13, 1.5), GH = kRoad('GH', 9.5), GU = kRoad('GU', 9.5),
  GA = kRoad('GA', 5.5), TL = kRoad('TL', 5.5), GD = kRoad('GD', 5.5), EX1 = kRoad('EX1', 5), EN1 = kRoad('EN1', 5), EC = kRoad('EC', 6), EX2 = kRoad('EX2', 5), EN2 = kRoad('EN2', 5);
// the roundabouts, laid out as the city's (their way: the island on the right): J over the tunnel, R by the rest area, Gohtong Jaya's
const kRing = ({ x, z, r, y }, half, name) => Object.assign(makeRoad(Array.from({ length: 24 }, (_, k) => [x + r * Math.cos(k * Math.PI / 12), y, z + r * Math.sin(k * Math.PI / 12)]), true, half, 0.3), { name, c: { x, z, r, y } });
const JR = kRing(KARAK.rings.J, 6, 'JR'), RR = kRing(KARAK.rings.R, 6, 'RR'), GRR = kRing(KARAK.rings.GR, 7.5, 'GRR');
const KARAK_ROADS = [GB, KK, LP, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, JR, RR, GRR], kBy = Object.fromEntries(KARAK_ROADS.map(r => [r.name, r]));
const kSpans = (r, spans = []) => { const at = spans.map(([a, b]) => [a * r.N, b * r.N]); return i => at.some(([a, b]) => i >= a && i <= b); };
for (const r of KARAK_ROADS) r.bridge = kSpans(r, KARAK.bridges[r.name]);
KK.tunnel = kSpans(KK, [KARAK.tunnel.slice(1)]);
KK.three = kSpans(KK, KARAK.lanes3);
for (const r of KARAK_ROADS) r.tunnel ??= () => false;
const KASPH = { GB: 7.6, LP: 11.5, GH: 8.4, GU: 8.4, GA: 4.2, TL: 4.2, GD: 4.2, EX1: 3.6, EN1: 3.6, EC: 4.5, EX2: 3.6, EN2: 3.6 };
for (const r of KARAK_ROADS) r.asph = r === KK ? i => KK.three(i) ? 16.75 : 13.75 : () => KASPH[r.name] ?? r.half - 1; // its asphalt's half-width (a ring's, either side of its line)
// the places along it: [road, sample]
const KP = Object.fromEntries(Object.entries(KARAK.places).map(([n, [road, f]]) => [n, { r: kBy[road], i: Math.round(f * kBy[road].N) }]));
KP.gombakToll.i = Math.max(KP.gombakToll.i, 90); // (room before it to widen)
// Kuantan, 2 x 1.5 km on the plain at the end of the run, by the sea (east of it, -x); the Kuantan home in its corner
// block, laid out as the first; the safe house at the top of the Genting Highlands, off the loop round the resort on
// its left, facing it
const X5 = Array.from({ length: 9 }, (_, k) => -77600 + 250 * k), Z5 = Array.from({ length: 7 }, (_, k) => 41600 + 250 * k);
const HOME3 = { x: X5[0] + 125, z: Z5[1] - 54 };
const D3 = makeRoad([54, 33, 13, -5].map(z => [HOME3.x, 0, HOME3.z + z]), false, 3, 0.05);
const Y3 = makeRoad([21, 2, -17].map(z => [HOME3.x + 9, 0, HOME3.z + z]), false, 10, 0.05);
const HOME4 = (() => { const { r, i } = KP.safeHouse, L = r.L[i], p = r.P[i]; return { x: p.x + L.x * 44, y: p.y, z: p.z + L.z * 44, rot: Math.atan2(-L.x, -L.z) }; })();
const homeAt = (H, lx, lz) => [H.x + lx * Math.cos(H.rot ?? 0) + lz * Math.sin(H.rot ?? 0), H.y ?? 0, H.z - lx * Math.sin(H.rot ?? 0) + lz * Math.cos(H.rot ?? 0)]; // a home's local spot in the world
const D4 = makeRoad([39.5, 27, 13, -5].map(z => homeAt(HOME4, 0, z)), false, 3, 0.05), Y4 = makeRoad([21, 2, -17].map(z => homeAt(HOME4, 9, z)), false, 10, 0.05);
HOMES.push(HOME3, HOME4);
`);
// the Kuantan road: from the LPT's end round onto the town's ring (after bez)
after(`const CLOSED = [[K1, 150], [K3, 160], [W, W.iC]]; // [road, sample]: its way -1 lanes closed from there on (to sample 0)
`, `const KU = (() => { const e = LP.P[LP.N], t = unit([LP.P[LP.N - 4].x, LP.P[LP.N - 4].z], [e.x, e.z]);
  return makeRoad([[e.x, e.y, e.z], ...bez([e.x, e.z], t, [X5.at(-1) + 7.5, Z5[3]], [-1, 0], 600, 16).map(([x, z], k) => [x, e.y * (1 - (k + 1) / 16), z])], false, 10.5, 0); })();
`);
swap(`  street([[3200, -1000], [3200, -500], [3200, 0]]), street([[1000, 0], [1000, 650], [1000, 1300]]), ...grid(X4, Z4),
`, `  street([[3200, -1000], [3200, -500], [3200, 0]]), street([[1000, 0], [1000, 650], [1000, 1300]]), ...grid(X4, Z4), ...grid(X5, Z5),
`);
swap(`  ...crossings(X4, Z4), { x: HOME2.x, z: Z4[1] }];`, `  ...crossings(X4, Z4), { x: HOME2.x, z: Z4[1] }, ...crossings(X5, Z5), { x: HOME3.x, z: Z5[1] }, { x: 2580, z: 0 }, { x: X5.at(-1), z: Z5[3] }];`);
// roadside fuel at Gohtong Jaya and at the top
swap(`  [W, -3000, -1120, true], [W, -43000, -1500, true], [W, -43200, -1520, false]].map(([r, x, z, fuel]) => {
  const i = nearestSample(r, x, z), half = fuel ? 20 : 9;`, `  [W, -3000, -1120, true], [W, -43000, -1500, true], [W, -43200, -1520, false],
  ...[KP.gohtongFuel, KP.topFuel].map(({ r, i }) => [r, r.P[i].x, r.P[i].z, true])].map(([r, x, z, fuel]) => {
  const i = nearestSample(r, x, z), half = fuel ? 20 : 9;`);
// the toll plazas' widened asphalt, as roads of their own over the expressway (for the car to stand on)
after(`const ROADS = [A, M, K1, K2, K3, RW, D, Y, V, S, ...STREETS, T, TR, PL, PG, ...UTURNS, CR, SL, VL, ON, NR, NPL, NPG, NA, BP1, BP2, DP, DS, MP, W, `, `...KARAK_ROADS, KU, D3, Y3, D4, Y4, ...['gombakToll', 'gentingToll', 'karakToll', 'kuantanToll'].map(n => {
  const { r, i } = KP[n], w = r === GH ? 22 : 36; // (over its widest: the booths)
  return Object.assign(makeRoad(Array.from({ length: 31 }, (_, k) => i - 60 + 4 * k).map(j => [r.P[j].x, r.P[j].y, r.P[j].z]), false, w, 0.05), { plaza: true });
}), `);

// --- the land: the tiles' heights (karakLand), the hills' land meeting them, the corridor's chunks drawn near the car ---
swap(`const coarse = ROADS.filter(r => r !== T && r !== W && `, `const coarse = ROADS.filter(r => r !== T && r !== W && (!r.name || r === GB) && !r.plaza && ![KU, D3, Y3, D4, Y4].includes(r) && `);
swap(`  if (edge <= 0) return -0.1; // the plain`, `  if (edge <= 0) return karakLand(x, z) ?? -0.1; // the plain, or the run's land`);
after(`const LAND = { x0: 2100, x1: 9705, z0: -2000, z1: 7405 };
`, `// the run's land (js/karak-terrain.bin): 20 m grid points in 960 m tiles, each height and flag (1 under a road, 2 over
// the tunnel, 3 the hills' own land); bilinear between them. Undefined off its tiles
const KT = KARAK.terrain, KT_N = KT.tile + 1, KT_W = KT.cell * KT.tile, ktIndex = new Map(KT.tiles.map(([i, j], t) => [i + ',' + j, t]));
const KARAK_LAND = new Uint16Array(await karakLandIn);
function ktAt(gi, gj) { // the grid point's [height, flag], or undefined (on a tile's edge, either tile's)
  const ti = Math.floor(gi / KT.tile), tj = Math.floor(gj / KT.tile);
  for (const [a, b] of [[ti, tj], [ti - 1, tj], [ti, tj - 1], [ti - 1, tj - 1]]) {
    const t = ktIndex.get(a + ',' + b), u = gi - KT.tile * a, v = gj - KT.tile * b;
    if (t === undefined || u < 0 || v < 0 || u > KT.tile || v > KT.tile) continue;
    const h = KARAK_LAND[t * KT_N * KT_N + v * KT_N + u];
    return [(h >> 2) / 5 - 100, h & 3];
  }
}
function karakLand(x, z) {
  const fi = (x - KT.x0) / KT.cell, fj = (z - KT.z0) / KT.cell, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  const a = ktAt(i, j), b = ktAt(i + 1, j), c = ktAt(i, j + 1), d = ktAt(i + 1, j + 1);
  if (!a || !b || !c || !d) return;
  return a[0] * (1 - u) * (1 - v) + b[0] * u * (1 - v) + c[0] * (1 - u) * v + d[0] * u * v;
}
`);

// --- homes: four, each with its height and turn ---
swap(`  home.position.set(H.x, 0, H.z);`, `  home.position.set(H.x, H.y ?? 0, H.z);
  home.rotation.y = H.rot ?? 0;`);
swap(`const atHome = () => HOMES.findIndex(h => Math.abs(state.x - h.x) < 2.4 && Math.abs(state.z - h.z) < 4); // which home's garage it's in (-1: none)`,
  `const atHome = () => HOMES.findIndex(h => { // which home's garage it's in (-1: none), in its own axes
  const dx = state.x - h.x, dz = state.z - h.z, c = Math.cos(h.rot ?? 0), sn = Math.sin(h.rot ?? 0);
  return Math.abs(dx * c - dz * sn) < 2.4 && Math.abs(dx * sn + dz * c) < 4 && Math.abs(state.y - (h.y ?? 0)) < 3;
});`);
swap(`swapCar(b.dataset.car, inBay() ?? (atHome() > 0 ? 'home2' : undefined));`, `swapCar(b.dataset.car, inBay() ?? (atHome() > 0 ? 'home' + (atHome() + 1) : undefined));`);
swap(`const HOME_SPOT = { x: HOME.x, y: 0, z: HOME.z + 14, heading: 0 }, HOME2_SPOT = { x: HOME2.x, y: 0, z: HOME2.z + 14, heading: 0 };`,
  `const HOME_SPOTS = HOMES.map(h => { const [x, y, z] = homeAt(h, 0, 14); return { x, y, z, heading: h.rot ?? 0 }; }), [HOME_SPOT, HOME2_SPOT, HOME3_SPOT, HOME4_SPOT] = HOME_SPOTS;`);
swap(`const state = { ...(startPit ? pitSpot(startPit) : query.get('at') === 'home2' ? HOME2_SPOT : HOME_SPOT), speed: 0, steer: 0 };`,
  `const state = { ...(startPit ? pitSpot(startPit) : HOME_SPOTS[/^home(\\d)$/.exec(query.get('at'))?.[1] - 1] ?? HOME_SPOT), speed: 0, steer: 0 };`);

// --- drawing: the roads and land by tiles, the plazas, the tunnel, the rest areas, the signs, Kuantan's road and sea ---
const snippet = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
after(`    workshop(W.P[j].x + W.L[j].x * s * 32, W.P[j].y, W.P[j].z + W.L[j].z * s * 32, away(W, j, s));
  }
}
`, '\n' + snippet('drive-world.js') + '\n' + snippet('drive-chunks.js'));
after(`  town(X4, Z4, 20261031, [10, 22], (k, j) => k === 0 && j === 0); // Westhaven
`, snippet('drive-town.js'));
after(`scene.add(trees);
`, '\n' + snippet('drive-resort.js'));
swap(`for (const d of [D, D2]) strip(d, -3, 0.011, 3, 0.011, 0x77746e); // concrete drives`, `for (const d of [D, D2, D3, D4]) strip(d, -3, 0.011, 3, 0.011, 0x77746e); // concrete drives`);
swap(`    if (r === BR || r === XK) return; // (on piers)`, `    if (r === BR || r === XK || (r === GB && GB.bridge(i))) return; // (on piers)`);
// Kuantan's streets: their own (lighter) traffic
swap(`  street([[3200, -1000], [3200, -500], [3200, 0]]), street([[1000, 0], [1000, 650], [1000, 1300]]), ...grid(X4, Z4), ...grid(X5, Z5),
`, `  street([[3200, -1000], [3200, -500], [3200, 0]]), street([[1000, 0], [1000, 650], [1000, 1300]]), ...grid(X4, Z4), ...KUANTAN_STREETS,
`);
swap(`const STREETS = [AV, RING, RB, ...grid(X2, Z2), ...grid(X3, Z3), BR, BV, AR,`, `const KUANTAN_STREETS = grid(X5, Z5);
const STREETS = [AV, RING, RB, ...grid(X2, Z2), ...grid(X3, Z3), BR, BV, AR,`);

// --- lamps and reflectors: the resort's loop, the roundabouts, the Genting road round Gohtong Jaya and its plaza, masts
// down the expressways' medians at the plazas and rest areas; reflectors along the expressway and the mountain road ---
after(`  [[A], 16, 8, [1, -1], 0, [7.5, 14, 48], 1.4, 1.1, false, 3],
`, `  [[KK], 16, 8, [1, -1], 0, [7.5, 14, 48], 1.4, 1.1, false, 3, i => !KK.tunnel(i)], // the expressways: twin-arm masts down the median, all the way
  [[LP], 16, 8, [1, -1], 0, [7.5, 14, 48], 1.4, 1.1, false, 3],
  [[EX1, EN1, EX2, EN2], 12, 6, [1], 4.6, [2.6, 9, 12], 0.9, 0.9], [[EC], 14, 6, [1, -1], 5.3, [3, 9, 12], 0.8, 0.85], // (and Genting Sempah's slips)
  [[GH], 14, 6, [1, -1], 9.4, [3, 9, 12], 0.8, 0.85, false, 1, i => plazaAt(GH, i) || GH.P[i].distanceTo(GRR.P[0]) < 450],
  [[GU], 14, 6, [1, -1], 9.4, [3, 9, 12], 0.8, 0.85, false, 1, i => GU.P[i].distanceTo(GRR.P[0]) < 450],
  [[TL], 10, 4, [1, -1], 5.3, [2.6, 9, 12], 0.8, 0.9], [[JR, RR, GRR], 4, 2, [1], 6.6, [2.5, 8, 10], 0.8, 0.9],
`);
after(`  [[ON, KS, WS], 12, 4.95, () => [1]], [[A], 16, 17.7, s => [s]],`, ` [[KK], 16, 17.7, s => [s], false, i => !KK.tunnel(i) && !plazaAt(KK, i) && !atRnr(KK, i)],
  [[GH, GU], 16, 9.2, s => [s], false, i => !plazaAt(GH, i)], [[GA, GD, TL], 12, 4.95, () => [1]],`);

// --- traffic, light on the run: each road's lanes (the plazas' booth lanes), a car every few km ---
after(`const TRAFFIC = [ // [roads, lanes fast to slow (m left of the centre line, for the road's way; or by sample), both ways,
  // km/h, cars per km each way, grip in bends (m/s² sideways)]
`, `  [[GB, KU], [1.95, 5.45], true, 80, 0.8, 2.5],
  [[KK], i => plazaAt(KK, i) ? [4.5, 8.5, 12.5] : KK.three(i) ? [4.4, 8.1, 11.9] : [4.4, 8.1], true, 110, 0.6, 2.5],
  [[LP], i => plazaAt(LP, i) ? [4.5, 8.5] : [3.9, 7.6], true, 110, 0.45, 2.5],
  [[GH, GU], i => plazaAt(GH, i) ? [2.6, 6.6] : [2.4, 5.9], true, 60, 0.5, 3],
  [[GA, TL, GD], [-1.75, 1.75], false, 50, 0.6, 3],
  [[EX1, EN1, EX2, EN2], [0], false, 60, 0.3, 3],
  [[EC], [1.9], true, 50, 0.3, 3],
  [[JR, RR, GRR], [0], false, 30, 0.6, 3],
  [KUANTAN_STREETS, [2.25], true, 45, 1, 3],
`);
swap(`  [STREETS.filter(r => r !== RB), [2.25], true, 45, 4, 3],`, `  [STREETS.filter(r => r !== RB && !KUANTAN_STREETS.includes(r)), [2.25], true, 45, 4, 3],`);

// --- the maps, places, markers, teleports; the mini map stroking only the roads near what it shows ---
swap(`const MAP_ROADS = [A, M, K1, K2, K3, RW, ...STREETS, T, TR, PL, CR, SL, VL, ON, NR, NPL, NA, BP1, BP2, DS, W, XK, XW, KS, WS, NW];`,
  `const MAP_ROADS = [A, M, K1, K2, K3, RW, ...STREETS, T, TR, PL, CR, SL, VL, ON, NR, NPL, NA, BP1, BP2, DS, W, XK, XW, KS, WS, NW, ...KARAK_ROADS, KU];`);
swap(`['Home & car park', '#4fa8ff', [HOME, HOME2, { x: CP.x1, z: (CP.z0 + CP.z1) / 2 }]],`, `['Home & car park', '#4fa8ff', [...HOMES, { x: CP.x1, z: (CP.z0 + CP.z1) / 2 }]],`);
swap(`['North Mall', corners(890, 1110, 1300, 1545)], ['Westhaven', corners(X4[0], X4.at(-1), Z4[0], Z4.at(-1))],`,
  `['North Mall', corners(890, 1110, 1300, 1545)], ['Westhaven', corners(X4[0], X4.at(-1), Z4[0], Z4.at(-1))], ['Kuantan', corners(X5[0], X5.at(-1), Z5[0], Z5.at(-1))],
  ['Genting Highlands', [...TL.P, ...GA.P.slice(-120), ...GD.P.slice(0, 120)]], ['Gohtong Jaya', corners(GRR.c.x - 450, GRR.c.x + 450, GRR.c.z - 450, GRR.c.z + 450)],`);
after(`  ['Westhaven home', 'the drive outside the garage', HOME2_SPOT],
`, `  ['Gombak toll', 'the KL-Karak, short of the plaza', kTo(KK, KP.gombakToll.i - 70, 8.1)],
  ['Genting Sempah', 'its rest area, eastbound', kTo(KK, KP.sempahRR.i - 60, 8.1)],
  ['Genting Highlands road', 'up from Genting Sempah', kTo(GH, 40, 2.4)],
  ['Gohtong Jaya', 'the fuel station on the way up', kTo(GH, KP.gohtongFuel.i - 30, 2.4)],
  ['Genting Highlands', 'the resort, at the top', kTo(TL, KP.topFuel.i - 30, 1.75)],
  ['Genting safe house', 'the drive outside its garage', HOME4_SPOT],
  ['Bentong', 'its rest area on the KL-Karak', kTo(KK, KP.bentongRR.i - 60, 8.1)],
  ['Karak toll', 'the end of the KL-Karak', kTo(KK, KP.karakToll.i - 70, 8.1)],
  ['Temerloh', 'its rest area on the LPT', kTo(LP, KP.temerlohRR.i - 60, 7.6)],
  ['Kuantan', 'the town, by the sea', spotOn(KUANTAN_STREETS, -76600, Z5[3], -Math.PI / 2, 2.25)],
  ['Kuantan home', 'the drive outside the garage', HOME3_SPOT],
`);
after(`const roof = CP_BAYS[(CP.levels - 1) * CP_BAYS.length / CP.levels];
`, `const kTo = (r, i, side = 0) => { const t = r.P[i + 1].clone().sub(r.P[i]); return spotOn([r], r.P[i].x, r.P[i].z, Math.atan2(t.x, t.z), side); }; // on road r at i, facing along it
`);
swap(`['Links & mountain roads', '#d4d4d4', [K1, K2, K3, TR, BP1, BP2, NA, M, CR, SL, VL, DS], 11, 1.6],`, `['Links & mountain roads', '#d4d4d4', [K1, K2, K3, TR, BP1, BP2, NA, M, CR, SL, VL, DS, GH, GU, GA, TL, GD, EC], 11, 1.6],`);
swap(`  ['Highway', '#2ec4b6', [[W, W.hw]], 16, 2.2], ['Autobahn', '#3d8bfd', [A, [W, i => !W.hw(i)]], 34, 3],`, `  ['Highway', '#2ec4b6', [[W, W.hw], GB, KU], 16, 2.2], ['Autobahn & expressways', '#3d8bfd', [A, [W, i => !W.hw(i)], KK, LP], 34, 3],`);
swap(`  ['Ramps & flyovers', '#ffb020', [ON, ...UTURNS, XK, XW, KS, WS, NW], 9, 1.6]]`, `  ['Ramps & flyovers', '#ffb020', [ON, ...UTURNS, XK, XW, KS, WS, NW, EX1, EN1, EX2, EN2, JR, RR, GRR], 9, 1.6]]`);
after(`const roadPath = roadsPath(MAP_ROADS);
`, `// and the same in 2 km squares, so the mini map strokes only the squares round what it shows
const MAP_TILES = [...MAP_ROADS.reduce((m, r) => {
  for (let i = 0; i < r.N; i += 6) {
    const a = r.P[i], b = r.P[Math.min(i + 6, r.N)], k = Math.floor(a.x / 2000) + ',' + Math.floor(a.z / 2000);
    if (!m.has(k)) m.set(k, [Math.floor(a.x / 2000) * 2000 + 1000, Math.floor(a.z / 2000) * 2000 + 1000, new Path2D()]);
    m.get(k)[2].moveTo(a.x, a.z); m.get(k)[2].lineTo(b.x, b.z);
  }
  return m;
}, new Map()).values()];
`);
swap(`  map.stroke(roadPath);`, `  const seen = Math.hypot(MW, MH) / mapView.s + 1500; // (each square's middle within this of the map's)
  for (const [x, z, p] of MAP_TILES) if (Math.abs(x - mapView.x) < seen && Math.abs(z - mapView.z) < seen) map.stroke(p);`);
swap(`  · Nordschleife: <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>`,
  `  · Nordschleife, KL–Karak, Genting &amp; LPT: <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>, land: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a> (SRTM)`);

// --- each frame: the run's tiles round the camera; the light dimmed in the tunnel, and the camera kept under its roof ---
after(`// one frame drawn while loading with nothing culled or hidden, so every shader and every object's GPU pipeline is built
`, `// (two of the run's tiles built for it - rainforest and the tunnel's lights, the estate's palms - and let go after)
const kWarm = [KK.P[KP.sempahRR.i], LP.P[KP.temerlohRR.i]].map(p => kTileKey(p.x, p.z));
kWarm.forEach(kBuild);
`);
swap(`  for (const [o, culled, visible] of off) Object.assign(o, { frustumCulled: culled, visible });
}`, `  for (const [o, culled, visible] of off) Object.assign(o, { frustumCulled: culled, visible });
  kWarm.forEach(kDrop);
}
// in the Genting Sempah tunnel: the road's height there (undefined outside); the light inside, eased in and out
const kTunnelAt = (x, z, y) => { let h; eachNear(x, z, 1, (r, i) => { if (r === KK && KK.tunnel(i) && Math.hypot(r.P[i].x - x, r.P[i].z - z) < 18 && Math.abs(r.P[i].y - y) < 6) h = r.P[i].y; }); return h; };
let kDim = 0;`);
swap(`    camera.position.set(cx, Math.min(Math.max(car.position.y + 1 + Math.sin(camPitch) * dist * (1 - 0.18 * rush), terrainAt(cx, cz) + 0.5), over?.on ? over.y - 0.6 : Infinity), cz); // never under a hillside, or up through a deck - and lower at speed`,
  `    const roofed = kTunnelAt(state.x, state.z, car.position.y); // (in the tunnel: under its roof, not over the hill)
    camera.position.set(cx, Math.min(Math.max(car.position.y + 1 + Math.sin(camPitch) * dist * (1 - 0.18 * rush), roofed ?? terrainAt(cx, cz) + 0.5), over?.on ? over.y - 0.6 : roofed !== undefined ? roofed + 6.8 : Infinity), cz); // never under a hillside, or up through a deck - and lower at speed`);
swap(`  drawMap(dt);`, `  karakTick();
  drawMap(dt);`);
after(`  skyTick(dt);
`, `  kDim += ((kTunnelAt(state.x, state.z, state.y) !== undefined ? 1 : 0) - kDim) * (1 - Math.exp(-dt * 2.5)); // in the tunnel: the daylight left outside
  if (kDim > 0.001) { sun.intensity *= 1 - 0.9 * kDim; hemi.intensity *= 1 - 0.55 * kDim; scene.environmentIntensity *= 1 - 0.6 * kDim; }
`);
// --- self-checks: the car rests on every road of the run ---
after(`console.assert(steepest < 0.12, 'mountain grades should stay under 12%', steepest);
`, `for (const r of [...KARAK_ROADS, KU, D3, D4]) for (let i = 0; i < r.N; i += 37) console.assert(Math.abs(surfaceAt(r.P[i].x, r.P[i].z, r.P[i].y) - r.P[i].y) < 0.05, 'the car should rest on the run', r.name, i);
`);

fs.writeFileSync(dst, s);
console.log('ok', dst);
