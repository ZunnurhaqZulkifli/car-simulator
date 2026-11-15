// G30 6WB lamp positions: BMW ST1501 "G12 Displays and Controls" p.13 fig. TE15-0720 (same 6WB KOMBI as the pre-LCI G30),
// read off an 8x PDFKit render (half-res px), mapped onto the 530e / M550d pages' 1200x500 TFT viewBox by a least-squares
// affine on the dial centres, the clock and the two side gauges. usage: node tools/lamps/g2/fit-g30.mjs
const F = [[490, 335], [1182, 338], [838, 183], [255, 462], [1421, 462]];      // figure: speedo, tach, clock, fuel, temp
const P = [[330, 250], [870, 250], [600, 96], [180, 357], [1020, 357]];        // page: SC, TC, clock, FC, BC
const solve3 = (m, b) => { // Cramer on a 3x3
  const d = a => a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1]) - a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0]) + a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0]);
  const D = d(m); return [0, 1, 2].map(c => d(m.map((r, i) => r.map((v, j) => j === c ? b[i] : v))) / D); };
const fit = k => { const A = F.map(([x, y]) => [x, y, 1]), m = [0, 1, 2].map(i => [0, 1, 2].map(j => A.reduce((s, r) => s + r[i]*r[j], 0)));
  return solve3(m, [0, 1, 2].map(i => A.reduce((s, r, n) => s + r[i]*P[n][k], 0))); };
const [ax, ay] = [fit(0), fit(1)], map = ([x, y]) => [ax[0]*x + ax[1]*y + ax[2], ay[0]*x + ay[1]*y + ay[2]];
console.log('anchor residuals', F.map((f, i) => map(f).map((v, k) => +(v - P[i][k]).toFixed(1))));
const L = { turnLw: [62, 268], abs: [62, 325], side: [62, 437], rbelt: [187, 320], belt: [180, 265], lane: [222, 212], airbag: [222, 265],
  turnL: [655, 80], ffog: [720, 80], hba: [780, 80], high: [840, 80], rfog: [902, 80], turnR: [1018, 80], eps: [1495, 272], autoh: [1497, 332],
  turnRw: [1612, 268], park: [1612, 325], dscoff: [1612, 437], mil: [240, 628], tpms: [290, 628], dsc: [1383, 628], brake: [1428, 628] };
for (const [k, v] of Object.entries(L)) console.log(k.padEnd(7), map(v).map(n => n.toFixed(0)).join(', '));
