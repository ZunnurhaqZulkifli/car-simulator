// lamp positions from BMW's training diagrams -> each page's own coordinates (similarity on the two dial centres)
//   F30 6WA (ST1113 "F30 Displays, Indicators and Controls" p.8; the 2700x1160 render tools/f80/measure/lamps.mjs used)
//     -> the 140i / 320d .dials box in cqw (speedo centre 22.415, tach 77.585, both at y 22.415)
//   E84 KOMBI (ST1205 "E84 Complete Vehicle" p.63, PDFKit render of the lamp field at 8x from (232,322) pt)
//     -> the E90 / X1 cluster SVG (1310x590, dial centres (316,300) / (994,300)); % of the .warning-lights box
const k6 = 55.17/(1832.6 - 870.4), m6 = ([x, y]) => [22.415 + (x - 870.4)*k6, 22.415 + (y - 554.9)*k6];
const L6 = { turnL: [1189, 231], cruise: [1272, 231], collision: [1356, 231], lim: [1438, 238], turnR: [1521, 231],
  highBeam: [1310, 428], hba: [1310, 505], dsc: [1305, 652], dscOff: [1395, 646], brake: [1306, 722], tpms: [1397, 726],
  side: [551, 870], fogF: [557, 938], fogR: [636, 938], eps: [627, 1015], engine: [722, 1010], belt: [811, 1011], airbag: [881, 1010], abs: [970, 1011] };
console.log('6WA -> .dials cqw (x, y)');
for (const [n, p] of Object.entries(L6)) console.log(`  ${n.padEnd(10)} ${m6(p).map(v => v.toFixed(2)).join(', ')}`);
// E84 field crop px -> 4x crop of p.63 from (70,200) pt (hubs there: (470,830), (1430,830)) -> SVG
const sE = 678/960, mE = ([xf, yf]) => { const x4 = xf/2 + 648, y4 = yf/2 + 488; return [316 + (x4 - 470)*sE, 300 + (y4 - 830)*sE]; };
const LE = { turnL: [100, 92], steer: [260, 88], brake: [425, 80], engine: [785, 82], airbag: [955, 85], turnR: [1110, 92],
  fogF: [270, 235], abs: [430, 190], dtc: [430, 275], highBeam: [600, 215], belt: [775, 225], fogR: [935, 230],
  dsc: [420, 380], tpms: [775, 380] };
console.log('E84 -> cluster SVG (x, y) and % of the 1310x590 box');
for (const [n, p] of Object.entries(LE)) { const [x, y] = mE(p); console.log(`  ${n.padEnd(10)} ${x.toFixed(1)}, ${y.toFixed(1)}   ${(x/13.1).toFixed(2)}%, ${(y/5.9).toFixed(2)}%`); }
console.log(`  field px -> SVG units: x ${(sE/2).toFixed(4)}`);
