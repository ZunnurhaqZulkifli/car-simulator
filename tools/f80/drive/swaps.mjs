// node swaps.mjs <entry.js | -> <out.json> [probe] [cam]  - [find, replace] pairs for drive.html: the CARS f80 entry (its
// comment and all) swapped for entry.js (- : keep the one in the file); `probe` adds window.__dbg (the model loader's
// locals, and snap: the model in car space as it loaded, the steering wheel's meshes tagged userData.sw - what
// score-f80.js raycasts); `cam` lets ?dist= / ?pitch= move the chase camera. Without them the pairs are the real edit:
// ../../x3/drive/apply.mjs writes it
import fs from 'node:fs';
const [entry, out, ...opt] = process.argv.slice(2);
const html = fs.readFileSync(new URL('../../../public/drive.html', import.meta.url), 'utf8');
const a = html.search(/\n {2}\/\/ [^\n]*\n(?: {2}\/\/[^\n]*\n)* {2}f80: \{/) + 1, b = html.indexOf('\n  },\n', a) + 6; // (its comment, then the entry)
if (a < 1 || b < a) throw new Error('no f80 entry in drive.html');
const swaps = entry === '-' ? [] : [[html.slice(a, b), fs.readFileSync(entry, 'utf8').replace(/\n?$/, '\n')]];
if (opt.includes('probe')) {
  const SIZED = "dashAnchor.scale.setScalar((CAR.steering.size ?? 0.36) * at.distanceTo(EYE) / 1100); // about as wide, to the eye, as the model's own cluster\n";
  swaps.push([SIZED, SIZED + 'swMeshes.forEach(m => m.userData.sw = 1); window.__dbg = { THREE, root, parts, pivots, pivot, EYE: EYE.clone(), wheelAt, swMeshes, steeringWheel, dashAnchor, hit, look, body, car, modelReverse, modelTail, modelHead, snap: root.clone(true) };\n']);
}
if (opt.includes('cam')) swaps.push(['let PITCH = pitchOf(), CAM_DIST = camSet.dist;', 'let PITCH = query.has(\'pitch\') ? +query.get(\'pitch\') : pitchOf(), CAM_DIST = +(query.get(\'dist\') ?? camSet.dist);']);
fs.writeFileSync(out, JSON.stringify(swaps));
