// the in-car cluster's place for the RS 6: from EYE, which look / inset / size keeps the tach, the speedo and the FIS clear of
// the model (binnacle walls, hood, wheel rim) - the biggest size for each look and inset
(() => {
  const { THREE, root, EYE, wheelAt, swMeshes } = window.__dbg;
  const cp = document.getElementById('carpage').contentDocument, H = cp.querySelector('.cluster').getBoundingClientRect().height;
  const svg = cp.getElementById('cl-svg'), ctm = svg.getScreenCTM();
  const uv = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(ctm); return [q.x / 1100, q.y / H]; };
  const ring = (cx, cy, r, n) => [uv(cx, cy), ...Array.from({ length: n }, (_, a) => uv(cx + r * Math.cos(a / n * 6.283), cy + r * Math.sin(a / n * 6.283)))];
  const groups = { tach: ring(587.83, 599.37, 200, 12), speedo: ring(1355.27, 591.62, 200, 12), fis: [uv(972, 540), uv(815, 420), uv(1130, 420), uv(815, 670), uv(1130, 670)] };
  root.updateMatrixWorld(true);
  const near = []; root.traverse(o => { if (!o.isMesh) return; o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (s.center.distanceTo(wheelAt) < 0.9 + s.radius) near.push(o); });
  const rc = new THREE.Raycaster();
  const first = (from, dir, skipSw) => { rc.set(from, dir); return rc.intersectObjects(near, false).find(h => !skipSw || !swMeshes.includes(h.object)); };
  const out = [];
  for (let look = 0.06; look <= 0.181; look += 0.02) {
    const dir = wheelAt.clone().add(new THREE.Vector3(0, look, 0)).sub(EYE).normalize(), hit = first(EYE, dir, true); if (!hit) continue;
    for (const inset of [0.01, 0.04, 0.08, 0.12]) {
      const at = hit.point.clone().addScaledVector(dir, -inset), dist = at.distanceTo(EYE); if (dist < 0.55) continue;
      const m = new THREE.Matrix4().lookAt(EYE, at, new THREE.Vector3(0, 1, 0)), xr = new THREE.Vector3().setFromMatrixColumn(m, 0), yu = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const blockedAt = size => { const W = size * dist, Hm = W * H / 1100, b = {};
        for (const [g, s] of Object.entries(groups)) b[g] = s.filter(([u, v]) => { const p = at.clone().addScaledVector(xr, (0.5 - u) * W).addScaledVector(yu, (0.5 - v) * Hm), d = p.clone().sub(EYE), L = d.length(); const h = first(EYE, d.normalize(), false); return h && h.distance < L - 0.004; }).length;
        return b; };
      let lo = 0.18, hi = 0.7; const b0 = blockedAt(lo); if (b0.tach || b0.speedo || b0.fis) { out.push({ look: +look.toFixed(2), inset, dist: +dist.toFixed(3), blockedAtMin: b0 }); continue; }
      for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2, b = blockedAt(mid); if (!b.tach && !b.speedo && !b.fis) lo = mid; else hi = mid; }
      out.push({ look: +look.toFixed(2), inset, size: +lo.toFixed(3), dist: +dist.toFixed(3), hit: hit.object.material.name.slice(-22) });
    }
  }
  return { H, eye: EYE.toArray().map(v => +v.toFixed(3)), wheel: wheelAt.toArray().map(v => +v.toFixed(3)), tachUV: groups.tach[0].map(v => +v.toFixed(3)), rows: out };
})()
