// evaluated in a probe page once the car page has loaded; works on __dbg.snap (swaps.mjs: the model in car space as it
// loaded, the wheel's meshes tagged). seat: the dash top straight ahead of the wheel (rays down at the wheel's x, 5-50 cm in front of it, past glass and the
// wheel) - good cars have hood - wheel centre 0.11-0.15 m, eye - hood 0.15-0.19. rows (window.__SCORE set): for each
// look / inset, the biggest cluster size that keeps the F80's speedo, rev counter and the fuel / oil gauges clear of
// the model, by raycasting their points from EYE (a hit nearer than the cluster = something in front of the dial)
(() => {
  const { THREE, snap, EYE, wheelAt } = window.__dbg;
  snap.updateMatrixWorld(true);
  const glassy = o => o.material.transparent && o.material.opacity < 0.95;
  const solid = [], swMeshes = []; snap.traverse(o => o.isMesh && (o.userData.sw ? swMeshes.push(o) : !glassy(o) && solid.push(o)));
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  let hood = -9, hoodDz = 0, hoodHit = '';
  for (let dz = 0.05; dz <= 0.5001; dz += 0.01) {
    rc.set(new THREE.Vector3(wheelAt.x, wheelAt.y + 0.45, wheelAt.z + dz), down);
    const h = rc.intersectObjects(solid, false)[0];
    if (h && h.point.y > hood) { hood = h.point.y; hoodDz = dz; hoodHit = h.object.name + '/' + h.object.material.name; }
  }
  const seat = { wheel: wheelAt.toArray().map(v => +v.toFixed(3)), eye: EYE.toArray().map(v => +v.toFixed(3)), hood: +hood.toFixed(3), hoodDz: +hoodDz.toFixed(2), hoodHit,
    hoodMinusWheel: +(hood - wheelAt.y).toFixed(3), eyeMinusHood: +(EYE.y - hood).toFixed(3) };
  if (!window.__SCORE) return { seat };
  const cp = document.getElementById('carpage').contentDocument, cl = cp.querySelector('.cluster').getBoundingClientRect(), H = cl.height;
  const svg = cp.getElementById('cl-svg'), ctm = svg.getScreenCTM();
  const uv = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(ctm); return [(q.x - cl.left) / cl.width, (q.y - cl.top) / H]; };
  const Y = y => 660 + (y - 660) / 0.963; // the page's un-squash
  const ring = (cx, cy, r, n) => [uv(cx, Y(cy)), ...Array.from({ length: n }, (_, a) => uv(cx + r * Math.cos(a / n * 6.283), Y(cy) + r * Math.sin(a / n * 6.283)))];
  // the big dials: their centre and the scale's arc (-121° to +124° clockwise from up on both) - the blank gap under it
  // may sit behind the wheel's hub, as in the car
  const arc = (cx, cy, r, n) => [uv(cx, Y(cy)), ...Array.from({ length: n }, (_, k) => { const a = (-121 + 245 * k / (n - 1)) * Math.PI / 180; return uv(cx + r * Math.sin(a), Y(cy) - r * Math.cos(a)); })];
  const groups = { speedo: arc(542.5, 661.37, 200, 11), tach: arc(1097.1, 656.29, 200, 11), fuel: ring(222.5, 794.5, 78, 6), oil: ring(1415.5, 786.5, 75, 6) };
  const near = []; solid.forEach(o => { o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (s.center.distanceTo(wheelAt) < 0.9 + s.radius) near.push(o); });
  const all = [...near, ...swMeshes];
  const first = (from, dir, skipSw) => { rc.set(from, dir); return rc.intersectObjects(skipSw ? near : all, false)[0]; };
  const rows = [];
  for (let look = 0.04; look <= 0.181; look += 0.02) {
    const dir = wheelAt.clone().add(new THREE.Vector3(0, look, 0)).sub(EYE).normalize(), hit = first(EYE, dir, true); if (!hit) continue;
    for (const inset of [0.01, 0.04, 0.08, 0.12, 0.16]) {
      const at = hit.point.clone().addScaledVector(dir, -inset), dist = at.distanceTo(EYE); if (dist < 0.55) continue;
      const m = new THREE.Matrix4().lookAt(EYE, at, new THREE.Vector3(0, 1, 0)), xr = new THREE.Vector3().setFromMatrixColumn(m, 0), yu = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const blockedAt = size => { const W = size * dist, Hm = W * H / cl.width, b = {};
        for (const [g, s] of Object.entries(groups)) b[g] = s.filter(([u, v]) => { const p = at.clone().addScaledVector(xr, (0.5 - u) * W).addScaledVector(yu, (0.5 - v) * Hm), d = p.clone().sub(EYE), L = d.length(); const h = first(EYE, d.normalize(), false); if (h && h.distance < L - 0.004) { b.by = (b.by || '') + (h.object.userData.sw ? 'wheel:' : '') + h.object.material.name.slice(-12) + ' '; return true; } }).length;
        return b; };
      const clear = b => !b.speedo && !b.tach && !b.fuel && !b.oil;
      let lo = 0.18, hi = 0.7; const b0 = blockedAt(lo); if (!clear(b0)) { rows.push({ look: +look.toFixed(2), inset, dist: +dist.toFixed(3), blockedAtMin: b0 }); continue; }
      for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2; if (clear(blockedAt(mid))) lo = mid; else hi = mid; }
      rows.push({ look: +look.toFixed(2), inset, size: +lo.toFixed(3), dist: +dist.toFixed(3), hit: hit.object.name, why: blockedAt(hi) });
    }
  }
  return { seat, cluster: [cl.left, cl.top, cl.width, H].map(v => Math.round(v)), speedoUV: groups.speedo[0].map(v => +v.toFixed(3)), tachUV: groups.tach[0].map(v => +v.toFixed(3)), rows };
})()
