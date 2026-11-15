// node fig-map.mjs - BMW ST1855 "Displays and Controls 2018" fig. TE18-0859 (OS7 cluster, lamps numbered) -> the
// reference photo's frame: least-squares affine on the 14 dial numerals (centres read off an 8x PDFKit render, page
// 29, cropped at +600,+4100), then every lamp and the figure's two needles mapped through it (photo px)
import { solve } from '../../f80/measure/lib.mjs';
const PAIRS = [ // [fig x, y] -> [photo x, y]
  [[900, 934], [510.5, 608]], [[790, 794], [477, 565]], [[720, 626], [458.5, 515.3]], [[850, 464], [496.5, 467.5]], [[1010, 344], [547, 432]], [[1224, 294], [612.5, 417.6]], [[1464, 274], [684, 412.7]],
  [[2780, 910], [1083, 609.8]], [[2886, 786], [1111, 565]], [[2946, 634], [1132.7, 518.3]], [[2834, 466], [1103.4, 474.4]], [[2660, 354], [1052, 438]], [[2440, 310], [996.4, 422.5]], [[2204, 280], [934.5, 415.3]]];
const fit = k => { const A = [], b = []; for (const [[x, y], q] of PAIRS) { A.push([x, y, 1]); b.push(q[k]); }
  const AtA = [0, 1, 2].map(i => [0, 1, 2].map(j => A.reduce((s, r) => s + r[i] * r[j], 0))), Atb = [0, 1, 2].map(i => A.reduce((s, r, n) => s + r[i] * b[n], 0)); return solve(AtA, Atb); };
const ax = fit(0), ay = fit(1), F = ([x, y]) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]];
console.log('affine x', ax.map(v => v.toFixed(5)).join(' '), ' y', ay.map(v => v.toFixed(5)).join(' '));
console.log('residuals', PAIRS.map(([p, q]) => Math.hypot(F(p)[0] - q[0], F(p)[1] - q[1]).toFixed(1)).join(' '));
const PTS = { turnL_tft: [1510, 340], turnR_tft: [2156, 346], laneDep: [656, 386], brake: [576, 476], tpms: [576, 556], abs: [560, 630], dsc: [556, 714],
  autoH: [3036, 420], parkP: [3106, 480], eps: [3108, 554], R_turn: [3316, 600], R_ffog: [3316, 676], R_rfog: [3316, 754], R_slot: [3316, 834], R_mil: [3316, 910], R_dscoff: [3316, 994],
  beltsRear: [1240, 1130], beltDrv: [1340, 1126], airbag: [1410, 1122], sign: [1256, 1020], range: [780, 1106], clock: [1056, 1106], temp: [2680, 1106], COMFORT: [2290, 686], D: [2604, 654],
  spdNeedleOut: [740, 476], spdNeedleIn: [966, 560], tachNeedleOut: [2940, 476], tachNeedleIn: [2696, 560], digital90: [1160, 660], oilIcon: [3116, 994], pump: [536, 1014] };
for (const [k, p] of Object.entries(PTS)) console.log(k.padEnd(14), F(p).map(v => v.toFixed(1)).join(', '));
export { F };
