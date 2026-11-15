// node sights-patch.mjs <drive.html> <out.html> - the Genting Highlands' workshops and sights, onto drive.html as
// anchored replacements (each anchor must match once), as drive-patch.mjs: workshops on the way up from the Sempah exit
// and at the top (roadside aprons, as Gohtong Jaya's fuel); Chin Swee's temple, the lookout off the way down and
// the Awana SkyWay (SIGHTS: each on the level site gen.mjs makes beside its road, karak.js's `sites`); their teleports
// and map markers; karak.js and karak-terrain.bin's ?v=3. Already applied; kept as the record of what changed
import fs from 'node:fs';

const [src, out] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
const swap = (a, b) => { const n = html.split(a).length - 1; if (n !== 1) throw new Error(`anchor matched ${n} times: ${a.slice(0, 80)}`); html = html.replace(a, () => b); };

swap(`import KARAK from './js/karak.js?v=2';`, `import KARAK from './js/karak.js?v=3';`);
swap(`fetch('/js/karak-terrain.bin?v=2')`, `fetch('/js/karak-terrain.bin?v=3')`);

// the aprons: either side of the road (s), the run's two new workshops, and the sights' sites
swap(`// deep and 40 wide, a workshop's 66 by 18): on the valley road past the track road, and on the Ring road by the loop
const apron = (r, i, len, half) => makeRoad([0, 1, 2, 3].map(k => [r.P[i].x + r.L[i].x * len * k / 3, r.P[i].y, r.P[i].z + r.L[i].z * len * k / 3]), false, half, 0.05);`,
`// deep and 40 wide, a workshop's 66 by 18): on the valley road past the track road, on the Ring road by the loop, and
// on the Genting Highlands road (fuel at Gohtong Jaya and the top, workshops up from the Sempah exit and at the top)
const apron = (r, i, len, half, s = 1) => makeRoad([0, 1, 2, 3].map(k => [r.P[i].x + s * r.L[i].x * len * k / 3, r.P[i].y, r.P[i].z + s * r.L[i].z * len * k / 3]), false, half, 0.05);`);
swap(`  ...[KP.gohtongFuel, KP.topFuel].map(({ r, i }) => [r, r.P[i].x, r.P[i].z, true])].map(([r, x, z, fuel]) => {
  const i = nearestSample(r, x, z), half = fuel ? 20 : 9;
  return { r, i, fuel, half, apron: apron(r, i, fuel ? 46 : 66, half) };
});`,
`  ...[KP.gohtongFuel, KP.topFuel].map(({ r, i }) => [r, r.P[i].x, r.P[i].z, true]), ...[KP.sempahShop, KP.topShop].map(({ r, i }) => [r, r.P[i].x, r.P[i].z, false])].map(([r, x, z, fuel]) => {
  const i = nearestSample(r, x, z), half = fuel ? 20 : 9;
  return { r, i, fuel, half, apron: apron(r, i, fuel ? 46 : 66, half) };
});
// the Genting Highlands' sights, each on a paved site out from its road on the side gen.mjs made level for it (a
// margin inside): the Awana SkyWay's station on the way up, Chin Swee's temple, the lookout off the way down
const SIGHTS = Object.fromEntries(['skyway', 'chinSwee', 'lookout'].map(n => {
  const { r, i } = KP[n], [s, out, along] = KARAK.sites[n];
  return [n, { r, i, s, len: out - 4, half: along - 2, apron: apron(r, i, out - 4, along - 2, s) }];
}));`);
swap(`}), D2, Y2, ...SIDE.map(p => p.apron), ...CP_ROADS,`, `}), D2, Y2, ...SIDE.map(p => p.apron), ...Object.values(SIGHTS).map(p => p.apron), ...CP_ROADS,`);
swap(`const sideSpots = r => SIDE.filter(p => p.r === r).map(p => spot(p.apron, 1, p.half + 4)); // its roadside aprons`,
  `const sideSpots = r => [...SIDE, ...Object.values(SIGHTS)].filter(p => p.r === r).map(p => spot(p.apron, 1, p.half + 4)); // its roadside aprons`);
swap(`NR, NPL, NA, RW, ...SIDE.map(p => p.apron)]) for (let i = 0; i < r.N; i += 37)`, `NR, NPL, NA, RW, ...SIDE.map(p => p.apron), ...Object.values(SIGHTS).map(p => p.apron)]) for (let i = 0; i < r.N; i += 37)`);

// the sights themselves, after the run's rest areas and signs
swap(`// the sea at Kuantan, east of the town (-x), and its beach`, `// the Genting Highlands' sights: their sites paved (asphalt, Chin Swee's court past its car park in stone). Chin Swee's
// temple on its terrace below the way up - a gate where its car park meets the road, a nine-storey pagoda and Qing
// Shui's statue either side of its court, the SkyWay's middle station at its back between them; the lookout off the
// way down - a kerb and a rail round its edge over the valley, coin binoculars, its board; lit at night
const sightSite = n => { const p = SIGHTS[n], q = p.r.P[p.i]; return site(q.x, q.y, q.z, away(p.r, p.i, p.s)); }; // (local +z out from its road)
for (const [n, p] of Object.entries(SIGHTS)) {
  strip(p.apron, -p.half, 0.012, p.half, 0.012, 0x4a4a4c, i => i >= 2 && (n !== 'chinSwee' || i < 10));
  if (n === 'chinSwee') strip(p.apron, -p.half, 0.012, p.half, 0.012, 0xc9c1b1, i => i >= 10);
}
{
  const t = sightSite('chinSwee'), RED = 0xa8231b, GOLD = 0xc9a03a, STONE = 0xd5cdbd, part = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); t.add(m); };
  for (const x of [-6.5, 6.5]) siteBox(t, 1, 7, 1, RED, x, 3.5, 12);         // the gate: its posts, beam and green-tiled roof
  siteBox(t, 15, 1.2, 1.4, RED, 0, 7.4, 12);
  siteBox(t, 17, 0.6, 2.8, 0x2e7a55, 0, 8.3, 12);
  const board = kBoard([['CHIN SWEE CAVES TEMPLE', 0.6, 'center'], ['清水岩廟', 0.75, 'center']], 9, 1.9, '#8c1c13');
  board.position.set(0, 5.6, 11.25);
  board.rotation.y = Math.PI; // (facing the road)
  t.add(board);
  siteBox(t, 12, 0.8, 12, STONE, -18, 0.4, 46);                               // the pagoda: nine storeys, each a little narrower
  for (let k = 0; k < 9; k++) { const w = 8.6 - k * 0.6, y = 0.8 + k * 3.1; siteBox(t, w, 2.7, w, 0xf1ede2, -18, y + 1.35, 46); siteBox(t, w + 2.4, 0.4, w + 2.4, 0xc0512e, -18, y + 2.75, 46); }
  part(new THREE.ConeGeometry(1.4, 6, 8), GOLD, -18, 0.8 + 9 * 3.1 + 3, 46);
  siteBox(t, 8, 3, 8, STONE, 18, 1.5, 48);                                    // Qing Shui on his plinth: a lotus, gold robes, a dark face
  part(new THREE.CylinderGeometry(3.2, 3.6, 1.2, 16), 0xd9a6a0, 18, 3.6, 48);
  part(new THREE.CylinderGeometry(1.5, 3.1, 6.5, 16), GOLD, 18, 7.45, 48);
  part(new THREE.SphereGeometry(1.25, 16, 12), 0x3a2a20, 18, 11.9, 48);
  part(new THREE.CylinderGeometry(0.9, 1.1, 1.1, 12), GOLD, 18, 13.4, 48);
  floodlit(t, [[-26, 20, -18, 28], [26, 20, 18, 28], [-26, 40, -18, 46], [26, 40, 18, 46]], [[0, 18, 52, 26], [0, 44, 52, 26]], 1, 1.1, false);
  mergeSite(t);
}
{
  const p = SIGHTS.lookout, l = sightSite('lookout'), e = p.len, h = p.half;
  siteBox(l, 2 * h, 0.5, 0.5, CONC, 0, 0.25, e - 0.25);                       // the kerb round its edge, a rail along the front
  for (const x of [-h + 0.25, h - 0.25]) siteBox(l, 0.5, 0.5, e - 8, CONC, x, 0.25, (e + 8) / 2);
  siteBox(l, 2 * h, 0.08, 0.08, RAIL, 0, 1.15, e - 0.25);
  for (let x = -h + 0.5; x < h; x += 2.5) siteBox(l, 0.08, 0.7, 0.08, RAIL, x, 0.85, e - 0.25);
  for (const x of [-5, 5]) { siteBox(l, 0.14, 1.1, 0.14, 0x555a60, x, 0.55, e - 1.6); siteBox(l, 0.3, 0.3, 0.7, 0x2f3338, x, 1.25, e - 1.5); } // coin binoculars
  const board = kBoard([['GENTING HIGHLANDS', 0.75, 'center'], [\`Lookout  ·  \${Math.round(p.r.P[p.i].y + 60)} m\`, 0.6, 'center']], 7, 2.2);
  board.position.set(-h + 4, 3.2, 8);
  board.rotation.y = Math.PI; // (facing the road)
  l.add(board);
  for (const x of [-h + 1.2, -h + 6.8]) siteBox(l, 0.14, 4.3, 0.14, 0x8c9096, x, 2.15, 8.1);
  floodlit(l, [[-h + 1, e - 3, -h + 8, e - 10], [h - 1, e - 3, h - 8, e - 10]], [[0, e / 2 + 2, 2 * h, e - 6]], 1, 1.1, false);
  mergeSite(l);
}
// the Awana SkyWay: gondolas from its station at the end of its car park on the way up, by Chin Swee's temple (its
// middle station) to SkyAvenue at the top, ~2.2 km. The rope 9 m up through the stations (30 m at the top: in over the
// theme park's rides), on towers where it would come within 12 m of the land (none on a road), up on one side and back
// down the other; a cabin every ~75 m at 6 m/s (turnSkyway, each frame)
const SKYWAY = (() => {
  const ground = (x, z) => karakLand(x, z) ?? terrainAt(x, z), at = (n, o) => { const p = SIGHTS[n], q = p.r.P[p.i], L = p.r.L[p.i]; return new THREE.Vector3(q.x + L.x * p.s * o, q.y + 9, q.z + L.z * p.s * o); };
  const TOP = { x: -7631, z: 25682 }; // (a corner of SkyAvenue's footprint the rope comes into clear of the resort's other buildings)
  const stops = [at('skyway', SIGHTS.skyway.len - 10), at('chinSwee', 44), new THREE.Vector3(TOP.x, ground(TOP.x, TOP.z) + 30, TOP.z)];
  const tower = (x, z, a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l; for (const d of [0, 12, -12, 24, -24]) if (onRoad(x + d * ux, z + d * uz).out > 4) return [x + d * ux, z + d * uz]; return [x, z]; }; // (slid along a to b off any road)
  const sup = [{ p: stops[0], station: true }];
  for (let k = 0; k < 2; k++) {
    const a = stops[k], b = stops[k + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 250);
    for (let j = 1; j < n; j++) { const [x, z] = tower(a.x + (b.x - a.x) * j / n, a.z + (b.z - a.z) * j / n, a, b); sup.push({ p: new THREE.Vector3(x, Math.max(a.y + (b.y - a.y) * j / n, ground(x, z) + 22), z) }); }
    sup.push({ p: b, station: true });
  }
  for (let pass = 0; pass < 60; pass++) { // where the rope comes closest to the land under 12 m (out past the stations' own
    let worst = { short: 0 };                // ground), another tower 22 m tall - or the tower within 30 m of it taller
    for (let k = 0; k + 1 < sup.length; k++) {
      const a = sup[k].p, b = sup[k + 1].p, len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = sup[k].station ? 45 : 15; d < len - (sup[k + 1].station ? 45 : 15); d += 10) { const t = d / len, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, short = ground(x, z) + 12 - (a.y + (b.y - a.y) * t); if (short > worst.short) worst = { short, k, x, z, d, len }; }
    }
    if (worst.short < 0.1) break;
    const near = [[worst.k, worst.d], [worst.k + 1, worst.len - worst.d]].find(([k, d]) => d < 30 && !sup[k].station);
    if (near) { sup[near[0]].p.y += worst.short + 1; continue; }
    const [x, z] = tower(worst.x, worst.z, sup[worst.k].p, sup[worst.k + 1].p);
    sup.splice(worst.k + 1, 0, { p: new THREE.Vector3(x, ground(x, z) + 22, z) });
  }
  const dir = k => { const a = sup[Math.max(k - 1, 0)].p, b = sup[Math.min(k + 1, sup.length - 1)].p; return Math.atan2(b.x - a.x, b.z - a.z); }; // the rope's heading through support k
  const parts = [];
  sup.forEach(({ p, station }, k) => {
    const y0 = ground(p.x, p.z), h = p.y + 0.6 - y0;
    if (station) { // a hall it runs through, its name on both sides
      const st = site(p.x, p.y - (k === sup.length - 1 ? 30 : 9), p.z, dir(k)), H = k === sup.length - 1 ? 30 : 9, name = ['AWANA SKYWAY', 'CHIN SWEE STATION', 'SKYAVENUE STATION'][stops.indexOf(p)];
      siteBox(st, 14, 1, 28, CONC, 0, 0.5, 0);
      siteBox(st, 12, H - 4, 26, 0xd9dcdf, 0, (H - 4) / 2 + 1, 0);
      siteBox(st, 12.2, 6, 26.2, 0x6f93ad, 0, H, 0);
      siteBox(st, 15, 1.2, 30, 0xeef0f2, 0, H + 3.6, 0);
      for (const s of [1, -1]) { const b = kBoard([[name, 0.85, 'center']], 11, 1.6, '#b5122e'); b.position.set(s * 6.12, H - 4.2, 0); b.rotation.y = s * Math.PI / 2; st.add(b); }
      mergeSite(st);
      return;
    }
    parts.push(new THREE.CylinderGeometry(0.7, 1.5, h, 4).rotateY(Math.PI / 4).translate(0, h / 2, 0), new THREE.BoxGeometry(8.4, 0.7, 1.2).translate(0, h, 0));
    for (const g of parts.slice(-2)) g.rotateY(dir(k)).translate(p.x, y0, p.z);
    solid(p.x, p.z, p.x, p.z, 1.6, y0 - 1, y0 + h);
  });
  if (parts.length) scene.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0xdfe3e6 })));
  const off = (k, o) => { const a = dir(k); return new THREE.Vector3(sup[k].p.x + Math.cos(a) * o, sup[k].p.y, sup[k].p.z - Math.sin(a) * o); };
  const up = sup.map((_, k) => off(k, 3.2)), down = sup.map((_, k) => off(k, -3.2)).reverse(), loop = [...up, ...down];
  const rope = new THREE.LineBasicMaterial({ color: 0x2b2e33 });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(up), rope), new THREE.Line(new THREE.BufferGeometry().setFromPoints(down), rope));
  const s = [0];
  for (let j = 0; j < loop.length; j++) s.push(s[j] + loop[j].distanceTo(loop[(j + 1) % loop.length]));
  const total = s.at(-1), n = Math.round(total / 75), col = new THREE.Color();
  const cabin = mergeGeometries([[2.3, 2.3, 2.3, 0xf2f2ef, 0], [2.36, 0.9, 2.36, 0x2b3a48, 0.25], [2.5, 0.3, 2.5, 0xc8102e, 1.3], [0.16, 2.4, 0.16, 0x9aa0a6, 2.6]].map(([w, h, d, c, y]) => {
    const b = new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
    col.setHex(c);
    return b.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: b.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3));
  }));
  const cabins = new THREE.InstancedMesh(cabin, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
  cabins.frustumCulled = false; // (they move: the bounds made at the start don't hold)
  scene.add(cabins);
  return { sup, stops, loop, s, total, n, cabins, at: 0, m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), yAxis: new THREE.Vector3(0, 1, 0) };
})();
function turnSkyway(dt) {
  const w = SKYWAY, { loop, s } = w;
  w.at = (w.at + dt * 6) % w.total;
  for (let k = 0, j = 0; k < w.n; k++) {
    const u = (w.at + k * w.total / w.n) % w.total;
    j = 0;
    while (s[j + 1] < u) j++;
    const a = loop[j], b = loop[(j + 1) % loop.length];
    w.v.lerpVectors(a, b, (u - s[j]) / (s[j + 1] - s[j])).y -= 3.9; // (hanging under it)
    w.cabins.setMatrixAt(k, w.m.compose(w.v, w.q.setFromAxisAngle(w.yAxis, Math.atan2(b.x - a.x, b.z - a.z)), w.one));
  }
  w.cabins.instanceMatrix.needsUpdate = true;
}
turnSkyway(0);
{ // the SkyWay's car park lit
  const p = SIGHTS.skyway, g = sightSite('skyway');
  floodlit(g, [[-p.half + 1, 14, -p.half + 8, 22], [p.half - 1, 14, p.half - 8, 22], [-p.half + 1, 40, -p.half + 8, 46], [p.half - 1, 40, p.half - 8, 46]], [[0, 18, 2 * p.half, 26], [0, 44, 2 * p.half, 26]], 1, 1.1, false);
}

// the sea at Kuantan, east of the town (-x), and its beach`);
swap(`  turnFerris(dt);\n`, `  turnFerris(dt);\n  turnSkyway(dt);\n`);

// the map: the sights with the mountain's viewpoint; the teleports
swap(`['Viewpoint', '#ffd23f', [V.P[Math.round(V.N / 2)]]]`, `['Sights & views', '#ffd23f', [V.P[Math.round(V.N / 2)], ...Object.values(SIGHTS).map(p => p.apron.P[p.apron.N])]]`);
swap(`  ['Genting Highlands road', 'up from Genting Sempah', kTo(GH, 40, 2.4)],
  ['Gohtong Jaya', 'the fuel station on the way up', kTo(GH, KP.gohtongFuel.i - 30, 2.4)],
  ['Genting Highlands', 'the resort, at the top', kTo(TL, KP.topFuel.i - 30, 1.75)],`,
`  ['Genting Highlands road', 'up from Genting Sempah', kTo(GH, 40, 2.4)],
  ['Genting Sempah mechanic', 'the workshop on the way up', kTo(SIDE.find(p => p.r === GH && !p.fuel).apron, 8)],
  ['Gohtong Jaya', 'the fuel station on the way up', kTo(GH, KP.gohtongFuel.i - 30, 2.4)],
  ['Awana SkyWay', 'its car park, by the station', kTo(SIGHTS.skyway.apron, 6)],
  ['Chin Swee Temple', 'its car park, by the gate', kTo(SIGHTS.chinSwee.apron, 2)],
  ['Genting Highlands', 'the resort, at the top', kTo(TL, KP.topFuel.i - 30, 1.75)],
  ['Genting mechanic', 'the workshop at the top', kTo(SIDE.find(p => p.r === TL && !p.fuel).apron, 8)],
  ['Genting lookout', 'over the valley, on the way down', kTo(SIGHTS.lookout.apron, 4)],`);

fs.writeFileSync(out, html);
console.log('patched', out);
