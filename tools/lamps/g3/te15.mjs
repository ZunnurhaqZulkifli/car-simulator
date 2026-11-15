// TE15-0720 (G12 6WB figure, ST1501 p.7, displayed px of a 3x render /1.19) -> F90 photo (paultan, 1600x1067) -> M5 CS viewBox
const TE = { side:[287,1083], abs:[287,1015], turnLo:[287,972], rbelt:[365,1005], belt:[358,972], lane:[387,945], airbag:[385,972],
  turnL:[657,858], ffog:[700,858], hba:[740,858], high:[778,858], rfog:[815,858], turnR:[890,858],
  eps:[1190,982], autoh:[1192,1018], turnRo:[1265,975], park:[1265,1015], dscoff:[1265,1083], brake:[1150,1203], dsc:[1118,1203], tpms:[430,1203], mil:[397,1203] };
const A = [TE.side, TE.park], B = [[37,740],[1545,607]];
const c = (p, q) => [p[0]-q[0], p[1]-q[1]];
const va = c(A[1], A[0]), vb = c(B[1], B[0]);
const s = Math.hypot(...vb)/Math.hypot(...va), r = Math.atan2(vb[1], vb[0]) - Math.atan2(va[1], va[0]);
const toPhoto = p => { const d = c(p, A[0]); return [B[0][0] + s*(d[0]*Math.cos(r) - d[1]*Math.sin(r)), B[0][1] + s*(d[0]*Math.sin(r) + d[1]*Math.cos(r))]; };
const toVb = p => [0.835*(p[0] - 75), 0.835*(p[1] - 316)];
console.log('scale', s.toFixed(3), 'rot', (r*180/Math.PI).toFixed(2));
for (const [k, p] of Object.entries(TE)) { const ph = toPhoto(p), v = toVb(ph); console.log(k.padEnd(8), ph.map(n => n.toFixed(0)).join(','), '-> vb', v.map(n => n.toFixed(0)).join(',')); }
