// the run to the Genting Highlands and Kuantan: its land and its roads are drawn tile by tile (960 m, the land's), only
// near the car (karakTiles, below) - each stripe a spec now, [road, offset 1, height 1, offset 2, height 2, colour, on,
// lit] (offsets m left of the centre line, or by sample), walls solid everywhere from the start
const KSTRIPS = [];
const kOff = o => typeof o === 'function' ? o : () => o;
function kStrip(r, o1, y1, o2, y2, color, on = () => true, lit = false) {
  const O1 = kOff(o1), O2 = kOff(o2);
  KSTRIPS.push([r, O1, y1, O2, y2, color, on, lit]);
  if (o1 === o2 && Math.max(y1, y2) > 0.3) for (let i = 0; i < r.N; i++) if (on(i)) { // (a wall)
    const o = O1(i), a = r.P[i], b = r.P[i + 1];
    solid(a.x + r.L[i].x * o, a.z + r.L[i].z * o, b.x + r.L[i + 1].x * o, b.z + r.L[i + 1].z * o, 0, Math.min(a.y, b.y) + Math.min(y1, y2), Math.max(a.y, b.y) + Math.max(y1, y2));
  }
}
const kPaint = (r, o, w, on) => { const O = kOff(o); kStrip(r, i => O(i) - w / 2, 0.022, i => O(i) + w / 2, 0.022, 0xeeeeee, on); };
const ASPH = 0x3a3a3c, GRAVEL = 0x77706a, SKIRT = 0x5f574d, RAIL = 0x9aa0a6, CONC = 0xb8b5ad, BARRIER = 0xc9c6bf;
// the toll plazas: the road widening to the booths (w, m out each side, against sample i)
const PLAZAS = ['gombakToll', 'gentingToll', 'karakToll', 'kuantanToll'].map(n => {
  const { r, i } = KP[n], w = r === GH ? 18.6 : 34.5;
  return { n, r, i, w, wide: j => r.half + (w - r.half) * ease((60 - Math.abs(j - i)) / 40), near: j => Math.abs(j - i) < 62 };
});
const plazaAt = (r, i) => PLAZAS.some(p => p.r === r && p.near(i));
// the rest-and-service areas: fuel either side, a workshop 120 m on each side (as the west road's)
const RNR = ['sempahRR', 'bentongRR', 'temerlohRR', 'gambangRR'].map(n => ({ n, ...KP[n] }));
const atRnr = (r, i) => RNR.some(p => p.r === r && Math.abs(i - p.i - 18) <= 44);
// where something joins - a roadside apron, or another of the run's roads running onto this one's edge at its level (a
// slip's taper, a leg into a roundabout; not one over or under it, nor one beside it): no edge line or rail on that side
// there, and only there. out: how far out that side's rail stands
const kJoins = (r, i, o) => {
  const memo = r.joins ??= new Map(), key = i * 2 + (o > 0); // (one out each side)
  if (memo.has(key)) return memo.get(key);
  const x = r.P[i].x + r.L[i].x * o, z = r.P[i].z + r.L[i].z * o;
  let hit = false;
  eachNear(x, z, 1, (q, j) => { if (!hit && q !== r && q.asph && Math.abs(q.P[j].y - r.P[i].y) < 1.5 && Math.hypot(q.P[j].x - x, q.P[j].z - z) < q.asph(j) + 0.5) hit = true; });
  memo.set(key, hit);
  return hit;
};
const kOpen = (r, spots, out) => { const side = opens(r, [...spots, ...sideSpots(r)]); return (i, s) => side(i, s) || kJoins(r, i, s * out); };
const kEnds = (r, m) => i => awayFrom(r, r.P[0], m)(i) && awayFrom(r, r.P[r.N], m)(i);
{
  // KK, the KL-Karak: the 3+3 like the autobahn, the 2+2 its two inner lanes, the third a hard shoulder; a concrete
  // median barrier, guardrails, gravel and a skirt down into the ditch (12 m: a wall where the land beside is a road's
  // lower down); open where the slips' tapers leave and join, at the plazas and rest areas; a tunnel (walls, the bores'
  // divide, the roof, lights) through Genting Sempah
  const open = kOpen(KK, [], 17.5);
  const out = i => !KK.tunnel(i) && !plazaAt(KK, i), road = i => out(i) && !atRnr(KK, i), dry = i => road(i) && !KK.bridge(i);
  kStrip(KK, -13.75, 0.01, 13.75, 0.01, ASPH, i => !plazaAt(KK, i));
  for (const s of [1, -1]) {
    kStrip(KK, s * 13.75, 0.01, s * 16.75, 0.01, ASPH, i => KK.three(i) || KK.tunnel(i));
    kStrip(KK, s * 13.75, 0.008, s * 16.75, 0.008, GRAVEL, i => !KK.three(i) && out(i) && !atRnr(KK, i));
    kPaint(KK, s * 2.5, 0.3, i => !plazaAt(KK, i));
    kPaint(KK, s * 6.25, 0.15, i => dashed(i) && !plazaAt(KK, i));
    kPaint(KK, s * 10, 0.15, i => KK.three(i) && dashed(i) && !plazaAt(KK, i));
    kPaint(KK, s * 10, 0.3, i => !KK.three(i) && out(i) && !open(i, s));
    kPaint(KK, s * 13.75, 0.3, i => KK.three(i) && out(i) && !open(i, s));
    kStrip(KK, s * 17.5, 0, s * 17.5, 0.75, RAIL, i => road(i) && !open(i, s) && i > 6 && i < KK.N - 6);
    kStrip(KK, s * 16.75, 0.008, s * 17.9, 0.008, GRAVEL, dry);
    kStrip(KK, s * 17.9, -12, s * 17.9, 0.008, SKIRT, dry);
    kStrip(KK, s * 17.5, -1.5, s * 17.5, 0.9, CONC, i => KK.bridge(i) && !KK.tunnel(i)); // (the parapet over a bridge)
    kStrip(KK, s * 16.75, 0.012, s * 46, 0.012, 0x4a4a4c, i => atRnr(KK, i)); // forecourts
    kStrip(KK, s * 17.6, 0, s * 17.6, 7.5, 0xd9d6cc, KK.tunnel); // the tunnel's walls, a kerb along them
    kStrip(KK, s * 16.75, 0.2, s * 17.6, 0.2, 0xa9a69e, KK.tunnel);
    kStrip(KK, s * 16.75, 0.01, s * 16.75, 0.2, 0xa9a69e, KK.tunnel);
    kStrip(KK, s * 6, 7.45, s * 6.5, 7.45, 0xfff6dc, i => KK.tunnel(i) && i % 3 === 0, true); // its lights
    kStrip(KK, s * 12, 7.45, s * 12.5, 7.45, 0xfff6dc, i => KK.tunnel(i) && i % 3 === 0, true);
  }
  kStrip(KK, 0, 0, 0, 0.9, BARRIER, i => !KK.tunnel(i)); // the median barrier
  kStrip(KK, 0, 0.9, 0, 7.5, 0xd9d6cc, KK.tunnel); // the bores' divide
  kStrip(KK, -17.6, 7.5, 17.6, 7.5, 0x8d8a83, KK.tunnel); // the roof
  kStrip(KK, -17.5, -1.5, 17.5, -1.5, CONC, KK.bridge); // under a bridge
  // LP, the LPT: 2+2 either side of a grass median and its guardrail, hard shoulders, guardrails
  const lpOpen = kOpen(LP, [], 12.3), lpRoad = i => !plazaAt(LP, i) && !atRnr(LP, i);
  for (const s of [1, -1]) {
    kStrip(LP, s * 1.6, 0.01, s * 11.5, 0.01, ASPH, i => !plazaAt(LP, i));
    kPaint(LP, s * 2.0, 0.2, i => !plazaAt(LP, i));
    kPaint(LP, s * 5.75, 0.15, i => dashed(i) && !plazaAt(LP, i));
    kPaint(LP, s * 9.5, 0.2, i => lpRoad(i) && !lpOpen(i, s));
    kStrip(LP, s * 12.3, 0, s * 12.3, 0.75, RAIL, i => lpRoad(i) && !lpOpen(i, s) && i > 6 && i < LP.N - 6);
    kStrip(LP, s * 11.5, 0.008, s * 13.2, 0.008, GRAVEL, i => lpRoad(i) && !LP.bridge(i));
    kStrip(LP, s * 13.2, -12, s * 13.2, 0.008, SKIRT, i => lpRoad(i) && !LP.bridge(i));
    kStrip(LP, s * 12.3, -1.5, s * 12.3, 0.9, CONC, LP.bridge);
    kStrip(LP, s * 13, 0.012, s * 42, 0.012, 0x4a4a4c, i => atRnr(LP, i));
    kStrip(LP, s * 0.75, 0, s * 0.75, 0.75, RAIL, i => !plazaAt(LP, i));
  }
  kStrip(LP, -1.6, 0.006, 1.6, 0.006, 0x587a3c, i => !plazaAt(LP, i)); // (the median's grass)
  kStrip(LP, -13, -1.5, 13, -1.5, CONC, LP.bridge);
  // GB, the Gombak link: as the west road's highway (2+2 either side of a double line), over the direct road on a bridge
  const gbOpen = kOpen(GB, [], 10), gbRail = i => kEnds(GB, 30)(i) && !gbOpen(i, 1) && !GB.bridge(i);
  kStrip(GB, -7.6, 0.013, 7.6, 0.013, ASPH);
  for (const s of [1, -1]) {
    kPaint(GB, s * 0.2, 0.15);
    kPaint(GB, s * 3.7, 0.15, dashed);
    kPaint(GB, s * 7.3, 0.2, kEnds(GB, 12));
    kStrip(GB, s * 7.6, 0.009, s * 9.6, 0.009, GRAVEL, i => !GB.bridge(i));
    kStrip(GB, s * 9.6, -12, s * 9.6, 0.009, SKIRT, i => !GB.bridge(i) && kEnds(GB, 12)(i));
    kStrip(GB, s * 10, 0, s * 10, 0.75, RAIL, gbRail);
    kStrip(GB, s * 7.8, -1.5, s * 7.8, 0.9, CONC, GB.bridge);
  }
  kStrip(GB, -7.8, -1.5, 7.8, -1.5, CONC, GB.bridge);
  // the Genting Highlands road (GH, GU): two lanes each way either side of a concrete barrier; open at Gohtong Jaya's
  // fuel, its plaza; the ways up and down and round the top (GA, GD, TL) two lanes one way; the slips one lane (up to J
  // and down from it, its legs as GH and EC are), the road to R one each way; the roundabouts
  for (const r of [GH, GU]) {
    const open = kOpen(r, [], 9), road = i => !plazaAt(r, i);
    kStrip(r, -8.4, 0.01, 8.4, 0.01, ASPH, road);
    kStrip(r, 0, 0, 0, 0.8, BARRIER, i => i > 10 && (kEnds(r, 30)(i) || r === GU && i > r.N / 2));
    for (const s of [1, -1]) {
      kPaint(r, s * 0.6, 0.15, road);
      kPaint(r, s * 4.15, 0.15, i => dashed(i) && road(i));
      kPaint(r, s * 7.7, 0.15, i => road(i) && !open(i, s));
      kStrip(r, s * 9.0, 0, s * 9.0, 0.75, RAIL, i => road(i) && !open(i, s) && kEnds(r, 35)(i) && !r.bridge(i));
      kStrip(r, s * 8.4, 0.008, s * 9.5, 0.008, GRAVEL, i => road(i) && !r.bridge(i));
      kStrip(r, s * 9.5, -12, s * 9.5, 0.008, SKIRT, i => road(i) && !r.bridge(i));
      kStrip(r, s * 8.8, -1.5, s * 8.8, 0.9, CONC, r.bridge);
    }
    kStrip(r, -8.8, -1.5, 8.8, -1.5, CONC, r.bridge);
  }
  for (const [r, half, lanes] of [[GA, 4.2, 2], [GD, 4.2, 2], [TL, 4.2, 2], [EX1, 3.6, 1], [EN1, 3.6, 1], [EX2, 3.6, 1], [EN2, 3.6, 1], [EC, 4.5, 2]]) {
    const open = kOpen(r, r === TL ? [spot(D4, 0, 12)] : [], half + 0.6), slip = half < 4, far = kEnds(r, slip ? 8 : 25); // (TL: open at the safe house's drive)
    kStrip(r, -half, 0.014, half, 0.014, ASPH);
    if (lanes === 2) kPaint(r, 0, r === EC ? 0.2 : 0.15, r === EC ? undefined : dashed);
    for (const s of [1, -1]) {
      const edge = i => far(i) && !(slip && open(i, s)); // (a slip's edges but where it's on the road it leaves or joins)
      kPaint(r, s * (half - 0.35), 0.15, i => edge(i) && !open(i, s));
      kStrip(r, s * half, 0.008, s * (half + 1), 0.008, GRAVEL, i => !r.bridge(i) && edge(i));
      kStrip(r, s * (half + 1), -12, s * (half + 1), 0.008, SKIRT, i => !r.bridge(i) && edge(i));
      kStrip(r, s * (half + 0.6), 0, s * (half + 0.6), 0.75, RAIL, i => !r.bridge(i) && edge(i) && !open(i, s));
      kStrip(r, s * (half + 0.3), -1.5, s * (half + 0.3), 0.9, CONC, r.bridge);
    }
    kStrip(r, -half - 0.3, -1.5, half + 0.3, -1.5, CONC, r.bridge);
  }
  for (const r of [JR, RR, GRR]) {
    const h = r.half - 1;
    kStrip(r, -h, 0.016, h, 0.016, ASPH);
    kPaint(r, h - 0.4, 0.15); // (its outer edge, + being out from its middle; the island's kerb inside)
    kStrip(r, -h, 0.016, -h, 0.25, 0xd4d2cc);
    kStrip(r, -h, 0.25, -r.c.r, 0.25, 0x5f8f4a); // the island
  }
  // the plazas: the asphalt out to the booths, edge rails round it
  for (const p of PLAZAS) {
    kStrip(p.r, j => -p.wide(j), 0.016, j => p.wide(j), 0.016, ASPH, p.near);
    for (const s of [1, -1]) { const edge = j => s * (p.wide(j) + 0.8); kStrip(p.r, edge, 0, edge, 0.75, RAIL, j => p.near(j) && Math.abs(j - p.i) > 8); }
  }
}
// the bridges' piers: every ~24 m under each, one under a narrow deck, two under a wide one, down to the land
{
  const piers = [];
  for (const r of KARAK_ROADS) for (let i = 4; i < r.N; i += 8) {
    if (!r.bridge(i) || !r.bridge(i - 4) || !r.bridge(i + 4)) continue;
    for (const o of r.half > 10 ? [-r.half * 0.55, r.half * 0.55] : [0]) {
      const x = r.P[i].x + r.L[i].x * o, z = r.P[i].z + r.L[i].z * o, top = r.P[i].y - 1.5, bottom = (karakLand(x, z) ?? terrainAt(x, z)) - 1;
      let clear = true; // (not on a road under it)
      eachNear(x, z, 1, (q, j) => { if (q !== r && Math.hypot(q.P[j].x - x, q.P[j].z - z) < q.half + 1.5 && q.P[j].y < top - 2) clear = false; });
      if (top - bottom < 2 || !clear) continue;
      piers.push(new THREE.BoxGeometry(2.2, top - bottom, 2.2).translate(0, (top + bottom) / 2, 0).rotateY(Math.atan2(r.L[i].x, r.L[i].z)).translate(x, 0, z));
      solid(x, z, x, z, 1.1, bottom, top);
    }
  }
  if (piers.length) scene.add(new THREE.Mesh(mergeGeometries(piers), new THREE.MeshLambertMaterial({ color: CONC })));
}
// a sign: white words on a board (expressway green; or blue, the plazas'), on its posts or under the canopy, facing
// the way along road r at i it's read from (way: 1 along it, -1 back)
function kBoard(lines, w, h, bg = '#0b6b3a') {
  const c = document.createElement('canvas'), g = c.getContext('2d'), px = 64;
  c.width = Math.round(w * px); c.height = Math.round(h * px);
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  lines.forEach(([text, size = 0.55, align = 'left'], k) => {
    g.font = `bold ${size * px}px system-ui, sans-serif`; g.textAlign = align;
    g.fillText(text, align === 'center' ? c.width / 2 : align === 'right' ? c.width - 30 : 30, (k + 0.5) * c.height / lines.length);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: Object.assign(new THREE.CanvasTexture(c), { colorSpace: THREE.SRGBColorSpace }) }));
}
function kSign(r, i, way, side, lines, w = 7, h = 3) { // side: m left of the centre line, for the way it's read
  const p = r.P[i], L = r.L[i], o = side * way, x = p.x + L.x * o, z = p.z + L.z * o, g = site(x, p.y, z, Math.atan2(-L.z * way, L.x * way)); // (local +z the way it's read)
  const board = kBoard(lines, w, h);
  board.position.y = 2.6 + h / 2;
  board.rotation.y = Math.PI; // (its face back down the road)
  g.add(board);
  for (const px of [-w / 2 + 0.6, w / 2 - 0.6]) siteBox(g, 0.18, 2.6 + h, 0.18, 0x8c9096, px, (2.6 + h) / 2, 0.08);
  mergeSite(g);
  solid(x, z, x, z, 0.5);
}
{ // the plazas' booths and canopies, their names, lit
  for (const p of PLAZAS) {
    const { r, i, w } = p, t = r.curve.getTangentAt(i / r.N), g = site(r.P[i].x, r.P[i].y, r.P[i].z, Math.atan2(t.x, t.z)); // local +z along the road, +x its left
    const islands = [];
    for (let o = (r === GH ? 4.6 : 6.5); o < w - 1; o += 4) islands.push(o, -o);
    for (const o of islands) {
      siteBox(g, 1.2, 0.3, 14, 0xd4d2cc, o, 0.15, 0);
      siteBox(g, 1.6, 2.6, 3, 0xe9e6dd, o, 1.6, 0);                // the booth
      siteBox(g, 1.65, 0.5, 3.05, 0x1c4f8a, o, 2.9, 0);            // its band
      siteBox(g, 0.12, 2.6, 0.12, 0xd0302a, o - Math.sign(o) * 0.45, 1.6, -4.5); // the barrier arm, raised
      for (const z of [-7, 7]) siteBox(g, 0.5, 0.9, 0.5, 0xf2c200, o, 0.45, z); // bollards
      const a = g.localToWorld(new THREE.Vector3(o, 0, -7)), b = g.localToWorld(new THREE.Vector3(o, 0, 7));
      solid(a.x, a.z, b.x, b.z, 0.8, r.P[i].y - 1, r.P[i].y + 6);
    }
    siteBox(g, 2 * w + 2, 0.8, 20, 0xeeeeea, 0, 6.6, 0, THREE.MeshBasicMaterial); // the canopy (lit by its own lights)
    siteBox(g, 2 * w + 2.4, 0.3, 20.4, 0x1c4f8a, 0, 6.15, 0);
    const name = { gombakToll: 'PLAZA TOL GOMBAK', gentingToll: 'GENTING HIGHLANDS', karakToll: 'PLAZA TOL KARAK', kuantanToll: 'PLAZA TOL KUANTAN' }[p.n];
    for (const way of [1, -1]) {
      const sign = kBoard([[name, 0.9, 'center'], ["Touch 'n Go  ·  SmartTAG  ·  RFID", 0.45, 'center']], 16, 2.6, '#1c4f8a');
      sign.position.set(0, 8.4, -way * 10.25);
      sign.rotation.y = way > 0 ? Math.PI : 0;
      g.add(sign);
    }
    floodlit(g, [[-w - 4, -30, 0, -30], [w + 4, -30, 0, -30], [-w - 4, 30, 0, 30], [w + 4, 30, 0, 30]], [[0, 0, 2 * w, 24], [0, -32, 2 * w, 26], [0, 32, 2 * w, 26]], 1.4, 1.3);
    glowAt(g, islands.filter((_, k) => k % 2 === 0).map(o => [o, 6.1, 0, 140, 18]));
    mergeSite(g);
  }
}
{ // the tunnel's portals: a concrete face round both bores, named; dimming the light inside (karakTick)
  const ends = [0, 1].map(e => { let i = e ? KK.N : 0; if (e) { while (i > 0 && !KK.tunnel(i)) i--; } else { while (i < KK.N && !KK.tunnel(i)) i++; } return i; });
  for (const [k, i] of ends.entries()) {
    const t = KK.curve.getTangentAt(i / KK.N), g = site(KK.P[i].x, KK.P[i].y, KK.P[i].z, Math.atan2(t.x, t.z));
    for (const s of [1, -1]) siteBox(g, 14, 24, 3, CONC, s * 24.6, 10, 0);
    siteBox(g, 35.2, 16, 3, CONC, 0, 15.5, 0);
    siteBox(g, 0.8, 7.5, 3, CONC, 0, 3.75, 0);
    const plate = kBoard([['TEROWONG GENTING SEMPAH', 0.7, 'center']], 14, 1.4, '#3a3d42');
    plate.position.set(0, 9.6, k ? 1.55 : -1.55);
    plate.rotation.y = k ? 0 : Math.PI;
    g.add(plate);
    mergeSite(g);
  }
  KK.tunnelEnds = ends;
}
// the rest-and-service areas, and the signs on the way
for (const p of RNR) for (const s of [1, -1]) {
  fuelStation(p.r, p.i, s, p.r === KK ? 31 : 27);
  const j = p.i + 40, o = p.r === KK ? 32 : 28;
  workshop(p.r.P[j].x + p.r.L[j].x * s * o, p.r.P[j].y, p.r.P[j].z + p.r.L[j].z * s * o, away(p.r, j, s));
}
{
  const km = (r, a, b) => Math.round(Math.abs(b - a) * 3 / 1000), rr = { sempahRR: 'Genting Sempah', bentongRR: 'Bentong', temerlohRR: 'Temerloh', gambangRR: 'Gambang' };
  for (const p of RNR) for (const way of [1, -1]) {
    const i = p.i - way * 360 + (way > 0 ? 0 : 36), off = p.r === KK ? 19 : 14;
    if (i > 10 && i < p.r.N - 10) kSign(p.r, i, way, off, [[`R&R ${rr[p.n]}`, 0.75], ['Petrol · Servis · Rehat   1 km', 0.5]], 7.5, 2.8);
  }
  const ex = nearestSample(KK, EX1.P[0].x, EX1.P[0].z);
  for (const [d, label] of [[330, '1 km'], [130, '400 m']]) kSign(KK, ex - d, 1, 19, [['Genting Highlands', 0.75], [`Genting Sempah  ↖  ${label}`, 0.55]], 8, 3);
  kSign(KK, KP.gombakToll.i + 140, 1, 19, [[`Genting Sempah  ${km(KK, KP.gombakToll.i, ex)} km`, 0.55], [`Bentong  ${km(KK, KP.gombakToll.i, KP.bentongRR.i)} km`, 0.55], [`Karak  ${km(KK, KP.gombakToll.i, KP.karakToll.i)} km`, 0.55]], 7, 3.4);
  kSign(LP, 120, 1, 14, [[`Temerloh  ${km(LP, 0, KP.temerlohRR.i)} km`, 0.55], [`Gambang  ${km(LP, 0, KP.gambangRR.i)} km`, 0.55], [`Kuantan  ${km(LP, 0, LP.N)} km`, 0.55]], 7, 3.4);
  kSign(GH, 40, 1, 10.5, [[`Gohtong Jaya  ${km(GH, 0, GH.N)} km`, 0.55], [`Genting Highlands  ${Math.round((GH.N + GU.N + GA.N) * 3 / 1000)} km`, 0.55]], 7, 2.6);
}
// the sea at Kuantan, east of the town (-x), and its beach
{
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 60000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b6f8c, roughness: 0.12, metalness: 0.1 }));
  sea.position.set(X5[0] - 700 - 6000, 0.03, 42000);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(320, 60000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe3d3a6 }));
  sand.position.set(X5[0] - 700 + 160, 0.02, 42000);
  scene.add(sea, sand);
}
{ // Kuantan's road in, from the LPT's end: as the west road's highway
  batch = new Map([[ASPH, []]]);
  strip(KU, -7.6, 0.013, 7.6, 0.013, ASPH);
  for (const s of [1, -1]) {
    paint(KU, s * 0.2, 0.15);
    paint(KU, s * 3.7, 0.15, dashed);
    paint(KU, s * 7.3, 0.2, i => i < KU.N - 6);
    strip(KU, s * 7.6, 0.009, s * 9.6, 0.009, GRAVEL, i => i < KU.N - 4);
    strip(KU, s * 10, 0, s * 10, 0.75, RAIL, i => i > 8 && i < KU.N - 10);
  }
  endBatch();
}
