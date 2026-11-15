// diagram (6WA, 2700x1160) -> design space similarity on the two dial centres
const D1 = [870.4, 554.9], D2 = [1832.6, 554.9], P1 = [542.5, 661.37], P2 = [1097.1, 656.29];
const s = Math.hypot(P2[0]-P1[0], P2[1]-P1[1])/Math.hypot(D2[0]-D1[0], D2[1]-D1[1]);
const th = Math.atan2(P2[1]-P1[1], P2[0]-P1[0]) - Math.atan2(D2[1]-D1[1], D2[0]-D1[0]), c = Math.cos(th), sn = Math.sin(th);
const map = ([x, y]) => { const dx = x - D1[0], dy = y - D1[1]; return [P1[0] + s*(dx*c - dy*sn), P1[1] + s*(dx*sn + dy*c)]; };
console.log(`s ${s.toFixed(4)} th ${(th*180/Math.PI).toFixed(3)}`);
const L = {
  turnL: [1189, 231, 77, 58], cruise: [1272, 231, 50, 58], collision: [1356, 231, 72, 58], lim: [1438, 238, 53, 35], turnR: [1521, 231, 78, 58],
  ldwMarkL: [1257, 286, 35, 18], ldwMarkR: [1445, 286, 40, 18], laneLbot: [1240, 375], laneLtop: [1320, 270], laneRbot: [1465, 375], laneRtop: [1395, 270],
  highBeam: [1310, 428, 60, 45], sensor: [1394, 433, 57, 57], hba: [1310, 505, 60, 50], dsc: [1305, 652, 50, 55], dscOff: [1395, 646, 40, 68],
  colBL: [1306, 722, 62, 45], colBR: [1397, 726, 50, 52],
  side: [551, 870, 58, 30], fogF: [557, 938, 60, 43], fogR: [636, 938, 58, 43],
  eps: [627, 1015, 50, 50], engine: [722, 1010, 60, 36], belt: [811, 1011, 32, 58], airbag: [881, 1010, 48, 50], abs: [970, 1011, 55, 38],
  tftTL: [1145, 760], tftBR: [2194, 1080], tripBtn: [235, 1045],
};
for (const [k, v] of Object.entries(L)) { const [x, y] = map(v); console.log(`${k.padEnd(10)} (${x.toFixed(1)}, ${y.toFixed(1)})${v[2] ? `  ${(v[2]*s).toFixed(1)} x ${(v[3]*s).toFixed(1)}` : ''}`); }
