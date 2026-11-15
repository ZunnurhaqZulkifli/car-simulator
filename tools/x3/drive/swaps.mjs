// node swaps.mjs <entry.js> <out.json> [probe] [cam] [live]  - [find, replace] pairs for drive.html: the CARS entry in entry.js
// after the F80's, and the reversing-lamp hook it uses (CAR.lamps.reverse: those parts get their own material, and a
// soft white glow over each side's, both lit in R with the engine running; no other car sets it). `probe` adds window.__dbg (the model loader's locals, and snap: the model in car space as
// it loaded, the steering wheel's meshes tagged userData.sw - what score-x3.js raycasts); `cam` lets ?dist= / ?pitch=
// move the chase camera. Without them the pairs are the real edit: apply.mjs writes it.
import fs from 'node:fs';
const [entry, out, ...opt] = process.argv.slice(2);
const F80_END = "    exhaustX: 0.33, exhaustBoth: true, // a pair of tips each side\n  },\n";
const swaps = opt.includes('live') ? [] : [ // (live: the edit is in drive.html already - only the probe / cam hooks)
  [F80_END, F80_END + fs.readFileSync(entry, 'utf8').replace(/\n?$/, '\n')],
  ['// amber signals go), credit (', '// amber signals go; reverse: the reversing lamps, lit in R), credit ('],
  ['const modelLamps = { 1: [], [-1]: [] }, modelTail = [], modelTailGlow = [], modelHeadGlow = [], modelHead = [];',
    'const modelLamps = { 1: [], [-1]: [] }, modelTail = [], modelTailGlow = [], modelHeadGlow = [], modelHead = [], modelReverse = [];'],
  ['    } else root.add(new THREE.Mesh(p.geo, p.mat));\n  }\n',
    '    } else if (is(p, CAR.lamps.reverse)) { // reversing lamps: their own copy, lit warm white in reverse (below, every frame)\n      const lamp = p.mat.clone();\n      lamp.emissive.setHex(0xfff4e6);\n      lamp.userData.on = 2.5;\n      modelReverse.push(lamp);\n      root.add(new THREE.Mesh(p.geo, lamp));\n    } else root.add(new THREE.Mesh(p.geo, p.mat));\n  }\n'],
  ['      root.add(glow);\n      modelTailGlow.push(glow.material);\n    }\n',
    '      root.add(glow);\n      modelTailGlow.push(glow.material);\n    }\n    const rev = CAR.lamps.reverse && sideBox(CAR.lamps.reverse, s);\n    if (rev && !rev.isEmpty()) { // the reversing lamp\'s glow, this side (off until reversing; many cars have only one)\n      const glow = new THREE.Mesh(new THREE.PlaneGeometry(rev.getSize(new THREE.Vector3()).x * 2.5, 0.22),\n        new THREE.MeshBasicMaterial({ map: blob(\'rgba(255,250,240,1)\', 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));\n      glow.position.copy(rev.getCenter(new THREE.Vector3())).setZ(rev.min.z - 0.02);\n      glow.material.userData.on = 0.8;\n      root.add(glow);\n      modelReverse.push(glow.material);\n    }\n'],
  ['  for (const g of modelTailGlow) g.opacity = braking ? 1 : lit ? 0.3 : 0;\n',
    '  for (const g of modelTailGlow) g.opacity = braking ? 1 : lit ? 0.3 : 0;\n  for (const m of modelReverse) m[m.isMeshBasicMaterial ? \'opacity\' : \'emissiveIntensity\'] = carPage.reverse && carPage.ignition ? m.userData.on : 0; // (the lamps, their glows)\n'],
];
if (opt.includes('probe')) {
  const SIZED = "dashAnchor.scale.setScalar((CAR.steering.size ?? 0.36) * at.distanceTo(EYE) / 1100); // about as wide, to the eye, as the model's own cluster\n";
  swaps.push([SIZED, SIZED + 'swMeshes.forEach(m => m.userData.sw = 1); window.__dbg = { THREE, root, parts, pivots, pivot, EYE: EYE.clone(), wheelAt, swMeshes, steeringWheel, dashAnchor, hit, look, body, car, modelReverse, modelTail, modelHead, snap: root.clone(true) };\n']);
}
if (opt.includes('cam')) swaps.push(['const PITCH = 0.3, CAM_DIST = 8.4;', 'const PITCH = +(query.get(\'pitch\') ?? 0.3), CAM_DIST = +(query.get(\'dist\') ?? 8.4);']);
fs.writeFileSync(out, JSON.stringify(swaps));
