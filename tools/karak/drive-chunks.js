// the run's tiles, drawn near the car only: its land (the grid's triangles - under the roads too, gen.mjs keeps it under
// their asphalt - but not those mixing a road and the tunnel, its mouths, nor on the hills' own land, nor down on the
// plain), its roads' stripes and its trees - rainforest, and an oil palm estate along the LPT - built within 2 km of the
// camera, two a frame (their trees shown within ~1.4 km), and let go past 3 km. Each in its tile's own frame (its
// corner the origin), so they hold steady even 75 km out
const kTileKey = (x, z) => Math.floor((x - KT.x0) / KT_W) * 4096 + Math.floor((z - KT.z0) / KT_W);
const kSamples = new Map(); // tile -> road -> its samples there
for (const r of KARAK_ROADS) for (let i = 0; i < r.N; i++) {
  const k = kTileKey(r.P[i].x, r.P[i].z);
  if (!kSamples.has(k)) kSamples.set(k, new Map());
  const m = kSamples.get(k);
  if (!m.has(r)) m.set(r, []);
  m.get(r).push(i);
}
const kTiles = [...new Set([...KT.tiles.map(([i, j]) => i * 4096 + j), ...kSamples.keys()])];
const kMats = new Map(), kMat = (color, lit) => {
  const key = color + (lit ? 'lit' : '');
  if (!kMats.has(key)) kMats.set(key, lit ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  return kMats.get(key);
};
for (const [, , , , , color, , lit] of KSTRIPS) kMat(color, lit); // (all made now, for the weather to find)
const kLandMat = new THREE.MeshLambertMaterial({ vertexColors: true }), kTreeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const kTint = (geo, hex) => { const c = new THREE.Color(hex), n = geo.attributes.position.count; geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, k) => [c.r, c.g, c.b][k % 3]), 3)); return geo; };
const kBare = g => { g = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a); return g; };
// a rainforest tree: a straight trunk, a broad crown of two lumps; an oil palm: its trunk and a drooping crown of fronds
const kTreeGeo = mergeGeometries([kTint(new THREE.CylinderGeometry(0.25, 0.4, 9, 5, 1, true).translate(0, 4.5, 0), 0x5b4632),
  kTint(new THREE.IcosahedronGeometry(1, 0).scale(4.6, 2.6, 4.6).translate(0, 10, 0), 0xffffff), kTint(new THREE.IcosahedronGeometry(1, 0).scale(3, 2, 3).translate(1.6, 12, -1), 0xe6e6e6)].map(kBare));
const kPalmGeo = mergeGeometries([kTint(new THREE.CylinderGeometry(0.3, 0.38, 5.5, 5, 1, true).translate(0, 2.75, 0), 0x6b5a44),
  kTint(new THREE.ConeGeometry(4.2, 2.6, 7, 1, true).rotateX(Math.PI).translate(0, 5.9, 0), 0xffffff), kTint(new THREE.ConeGeometry(1.2, 2, 5, 1, true).translate(0, 7, 0), 0xffffff)].map(kBare));
const JUNGLE = [0x2f5a29, 0x26502a, 0x3b6630, 0x1f4622, 0x45703a].map(h => new THREE.Color(h)), PALMS = [0x4d7a2f, 0x58873a, 0x436d2a].map(h => new THREE.Color(h));
// where no tree grows: the plazas, the rest areas, the homes and drives, round the resort's and Gohtong Jaya's buildings
const kClear = [
  ...PLAZAS.map(p => [p.r.P[p.i].x, p.r.P[p.i].z, p.w + 40]),
  ...RNR.flatMap(p => [1, -1].map(s => { const j = p.i + 20; return [p.r.P[j].x + p.r.L[j].x * s * 35, p.r.P[j].z + p.r.L[j].z * s * 35, 90]; })),
  [HOME4.x, HOME4.z, 45], [HOME3.x, HOME3.z, 60],
  ...KARAK.buildings.map(([foot]) => { const x = foot.reduce((a, p) => a + p[0], 0) / foot.length, z = foot.reduce((a, p) => a + p[1], 0) / foot.length; return [x, z, Math.max(...foot.map(p => Math.hypot(p[0] - x, p[1] - z))) + 10]; }),
];
const kRnd = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const kBuilt = new Map(), kSolids = new Set();
function kBuild(key) {
  const ti = Math.floor(key / 4096), tj = key - ti * 4096, ox = KT.x0 + ti * KT_W, oz = KT.z0 + tj * KT_W, g = new THREE.Group(), c = new THREE.Color();
  g.position.set(ox, 0, oz);
  const t = ktIndex.get(ti + ',' + tj), estate = ox + KT_W / 2 < LP.P[0].x; // (past Karak: the LPT's)
  if (t !== undefined) { // the land
    const N = KT_N, pos = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), flag = new Uint8Array(N * N), low = new Uint8Array(N * N), index = [];
    const h = (gi, gj) => ktAt(gi, gj)?.[0];
    const near = new Uint8Array(N * N); // within ~40 m of a road (2 grid steps from one): a cut or a fill there, not a hillside
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) if ((KARAK_LAND[t * N * N + b * N + a] & 3) === 1) for (let db = -2; db <= 2; db++) for (let da = -2; da <= 2; da++) { const bb = b + db, aa = a + da; if (bb >= 0 && aa >= 0 && bb < N && aa < N) near[bb * N + aa] = 1; }
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      const k = b * N + a, v = KARAK_LAND[t * N * N + k], y = (v >> 2) / 5 - 100, gi = ti * KT.tile + a, gj = tj * KT.tile + b;
      pos.set([a * KT.cell, y, b * KT.cell], k * 3);
      flag[k] = v & 3; low[k] = y < -0.08;
      const nx = ((h(gi - 1, gj) ?? y) - (h(gi + 1, gj) ?? y)) / (2 * KT.cell), nz = ((h(gi, gj - 1) ?? y) - (h(gi, gj + 1) ?? y)) / (2 * KT.cell), l = Math.hypot(nx, 1, nz);
      nrm.set([nx / l, 1 / l, nz / l], k * 3);
      // rainforest green, mottled; montane higher up, lighter in the estates; bare red laterite or rock on the cuts
      const x = ox + a * KT.cell, z = oz + b * KT.cell, mott = noise.noise(x / 90, z / 90, 3.1) * 0.5 + 0.5, up = 1 / l;
      c.setHex(estate ? 0x557f37 : y > 1250 ? 0x35603a : 0x2c5726).lerp(c.clone().setHex(estate ? 0x6a8f45 : 0x3d6b2e), mott);
      if (up < 0.85 && near[k]) c.lerp(c.clone().setHex(0x7d5a40), 0.6 * THREE.MathUtils.smoothstep(0.85 - up, 0, 0.25)); // red laterite on the cuts
      else if (up < 0.6) c.lerp(c.clone().setHex(0x5f5e4c), 0.5 * THREE.MathUtils.smoothstep(0.6 - up, 0, 0.2)); // rock on the steepest
      col.set([c.r, c.g, c.b], k * 3);
    }
    const skip = (...ks) => ks.some(k => flag[k] === 3) || ks.every(k => low[k]) || (ks.every(k => flag[k]) && ks.some(k => flag[k] === 1) && ks.some(k => flag[k] === 2));
    for (let b = 0; b < KT.tile; b++) for (let a = 0; a < KT.tile; a++) {
      const k00 = b * N + a, k10 = k00 + 1, k01 = k00 + N, k11 = k01 + 1;
      if (!skip(k00, k01, k10)) index.push(k00, k01, k10);
      if (!skip(k10, k01, k11)) index.push(k10, k01, k11);
    }
    if (index.length) {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('normal', new THREE.BufferAttribute(nrm, 3)).setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(index);
      g.add(new THREE.Mesh(geo, kLandMat));
    }
  }
  const samples = kSamples.get(key); // the roads' stripes, by colour
  if (samples) {
    const parts = new Map();
    for (const [r, O1, y1, O2, y2, color, on, lit] of KSTRIPS) {
      const list = samples.get(r);
      if (!list) continue;
      const v = [], at = (i, o, y) => [r.P[i].x + r.L[i].x * o - ox, r.P[i].y + y, r.P[i].z + r.L[i].z * o - oz];
      for (const i of list) {
        const f = on(i);
        if (!f) continue;
        const a = at(i, O1(i), y1), b = at(i, O2(i), y2);
        let p = at(i + 1, O1(i + 1), y1), q = at(i + 1, O2(i + 1), y2);
        if (f < 1) p = p.map((w, k) => a[k] + (w - a[k]) * f), q = q.map((w, k) => b[k] + (w - b[k]) * f);
        v.push(...a, ...b, ...p, ...b, ...q, ...p);
      }
      if (!v.length) continue;
      const m = kMat(color, lit);
      if (!parts.has(m)) parts.set(m, []);
      parts.get(m).push(v);
    }
    for (const [m, vs] of parts) {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vs.flat(), 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, m));
    }
  }
  if (t !== undefined) { // the trees: rainforest, or the estate's palms in rows (blocks of them, some fallow) by the LPT
    const rnd = kRnd(key + 7), list = [], solids = !kSolids.has(key);
    const clear = kClear.filter(([x, z, r]) => x + r > ox && x - r < ox + KT_W && z + r > oz && z - r < oz + KT_W), cleared = (x, z) => clear.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < r * r);
    const lp = []; // the LPT's line nearby (for the estate's rows along it)
    if (estate) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of kSamples.get((ti + a) * 4096 + tj + b)?.get(LP) ?? []) if (i % 6 === 0) lp.push(LP.P[i]);
    const plant = (x, z, palm, s) => {
      const y = karakLand(x, z), r = onRoad(x, z);
      if (y === undefined || y < 0.3 || r.out < (palm ? 9 : 7) || cleared(x, z)) return;
      const gi = Math.round((x - KT.x0) / KT.cell), gj = Math.round((z - KT.z0) / KT.cell), f = ktAt(gi, gj)?.[1];
      if (f) return;
      list.push([x - ox, y - 0.3, z - oz, s, palm]);
      if (solids && r.out < 40) solid(x, z, x, z, palm ? 0.5 : 0.6);
    };
    if (estate) {
      for (let bz = 0; bz < KT_W; bz += 120) for (let bx = 0; bx < KT_W; bx += 120) { // blocks within 220 m of the road; a quarter fallow
        const mx = ox + bx + 60, mz = oz + bz + 60;
        if (rnd() < 0.25 || !lp.some(p => Math.hypot(p.x - mx, p.z - mz) < 220)) continue;
        for (let z = bz + 5; z < bz + 120; z += 10) for (let x = bx + 5 + (Math.round(z / 10) % 2) * 5; x < bx + 120; x += 10) if (list.length < 3000) plant(ox + x, oz + z, true, 0.85 + rnd() * 0.3);
      }
      for (let n = 0; n < 60; n++) plant(ox + rnd() * KT_W, oz + rnd() * KT_W, false, 0.8 + rnd() * 0.6);
    } else for (let n = 0; n < 420; n++) plant(ox + rnd() * KT_W, oz + rnd() * KT_W, false, 0.75 + rnd() * 0.8);
    for (const palm of [false, true]) {
      const these = list.filter(p => p[4] === palm);
      if (!these.length) continue;
      const trees = new THREE.InstancedMesh(palm ? kPalmGeo : kTreeGeo, kTreeMat, these.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      these.forEach(([x, y, z, s], n) => {
        trees.setMatrixAt(n, m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rnd() * 6.28, 0)), new THREE.Vector3(s, s * (0.85 + rnd() * 0.3), s)));
        trees.setColorAt(n, (palm ? PALMS : JUNGLE)[Math.floor(rnd() * (palm ? 3 : 5))]);
      });
      g.add(trees);
      (g.userData.trees ??= []).push(trees);
    }
    kSolids.add(key);
  }
  scene.add(g);
  kBuilt.set(key, g);
}
function kDrop(key) {
  const g = kBuilt.get(key);
  scene.remove(g);
  g.traverse(o => o.geometry?.dispose());
  kBuilt.delete(key);
}
// each frame: the tiles within 2 km of the camera built, nearest first (two a frame, or all at once after a jump),
// those past 3 km let go
let kJump = true;
function karakTick() {
  const cx = camera.position.x, cz = camera.position.z, want = [];
  for (const key of kTiles) {
    const ti = Math.floor(key / 4096), tj = key - ti * 4096, d = Math.hypot(KT.x0 + (ti + 0.5) * KT_W - cx, KT.z0 + (tj + 0.5) * KT_W - cz);
    if (d < 2700 && !kBuilt.has(key)) want.push([d, key]);
    else if (d > 3700 && kBuilt.has(key)) kDrop(key);
    else if (kBuilt.has(key)) for (const m of kBuilt.get(key).userData.trees ?? []) m.visible = d < 1900; // (the trees of the far tiles lost in the haze anyway)
  }
  want.sort((a, b) => a[0] - b[0]);
  for (const [, key] of want.slice(0, kJump ? Infinity : 2)) kBuild(key);
  kJump = false;
}
