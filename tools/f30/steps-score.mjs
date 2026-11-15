// tools/drive-settings/probe.mjs steps (DRIVE=<staged drive.html>): for each look / inset, the biggest cluster size whose
// two dials (rings at u 0.28 / 0.72, v 0.5, r 0.165 of the width, as the 320d page draws them) no model part covers -
// the steering wheel may (it turns in front of them, as in the car). Placement as drive.html does it; rows nearer than
// ~0.7 m put the cluster in front of the binnacle. Also the seat numbers (hood - wheel centre, eye - hood).
export default async ({ ev, sleep }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  return ev(`(() => {
    const { THREE, EYE, body, steeringWheel } = __dbg; body.updateMatrixWorld(true);
    const M = body.matrixWorld, Mi = M.clone().invert(), sw = new Set(); steeringWheel.traverse(o => o.isMesh && sw.add(o));
    const wheelAt = steeringWheel.parent.getWorldPosition(new THREE.Vector3()).applyMatrix4(Mi);
    const solid = []; body.traverse(o => o.isMesh && o.visible && !(o.material.transparent && o.material.opacity < 0.95) && solid.push(o));
    const near = solid.filter(o => { o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); return s.center.distanceTo(wheelAt.clone().applyMatrix4(M)) < 0.9 + s.radius; });
    const rc = new THREE.Raycaster(), W = v => v.clone().applyMatrix4(M);
    const first = (from, to, list) => { const d = W(to).sub(W(from)); const L = d.length(); rc.set(W(from), d.normalize()); const h = rc.intersectObjects(list, false)[0]; return h && h.distance < L - 0.004 ? h : null; };
    let hood = -9; for (let dz = 0.05; dz <= 0.5; dz += 0.01) { rc.set(W(new THREE.Vector3(wheelAt.x, wheelAt.y + 0.45, wheelAt.z + dz)), new THREE.Vector3(0, -1, 0).transformDirection(M)); const h = rc.intersectObjects(solid.filter(o => !sw.has(o)), false)[0]; if (h) hood = Math.max(hood, h.point.clone().applyMatrix4(Mi).y); }
    const seat = { wheel: wheelAt.toArray().map(v => +v.toFixed(3)), hoodMinusWheel: +(hood - wheelAt.y).toFixed(3), eyeMinusHood: +(EYE.y - hood).toFixed(3) };
    const pts = []; for (const cu of [0.28, 0.72]) { pts.push([cu, 0.5]); for (let a = 0; a < 12; a++) pts.push([cu + 0.165 * Math.cos(a / 12 * 6.283), 0.5 + 0.165 * 1100 / 522 * Math.sin(a / 12 * 6.283)]); }
    const model = near.filter(o => !sw.has(o)), rows = [];
    for (let look = 0.03; look <= 0.161; look += 0.01) {
      const dir = wheelAt.clone().add(new THREE.Vector3(0, look, 0)).sub(EYE).normalize();
      rc.set(W(EYE), dir.clone().transformDirection(M)); const hit = rc.intersectObjects(model, false)[0]; if (!hit) continue;
      const hp = hit.point.clone().applyMatrix4(Mi);
      for (const inset of [0.01, 0.03, 0.06]) {
        const at = hp.clone().addScaledVector(dir, -inset), dist = at.distanceTo(EYE);
        const m = new THREE.Matrix4().lookAt(EYE, at, new THREE.Vector3(0, 1, 0)), xr = new THREE.Vector3().setFromMatrixColumn(m, 0), yu = new THREE.Vector3().setFromMatrixColumn(m, 1);
        const blocked = size => { const Wd = size * dist, Hd = Wd * 522 / 1100; let n = 0, by = ''; for (const [u, v] of pts) { const p = at.clone().addScaledVector(xr, (0.5 - u) * Wd).addScaledVector(yu, (0.5 - v) * Hd), h = first(EYE, p, model); if (h) { n++; by = h.object.material.name; } } return [n, by]; };
        let lo = 0.15, hi = 0.5; const b0 = blocked(lo); if (b0[0]) { rows.push(look.toFixed(2) + ' inset ' + inset + ' dist ' + dist.toFixed(3) + ' blocked at min by ' + b0[1]); continue; }
        for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2; if (!blocked(mid)[0]) lo = mid; else hi = mid; }
        rows.push(look.toFixed(2) + ' inset ' + inset + ' dist ' + dist.toFixed(3) + ' size ' + lo.toFixed(3) + ' (then ' + blocked(hi)[1] + ')');
      }
    }
    return { seat, rows };
  })()`);
};
