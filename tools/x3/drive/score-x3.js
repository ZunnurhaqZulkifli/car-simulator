// evaluated in a probe page once the car page has loaded; works on __dbg.snap (swaps.mjs probe: the model in car space as
// it loaded, the wheel's meshes tagged). seat: the dash top straight ahead of the wheel (rays down at the wheel's x,
// 5-50 cm in front of it, past glass and the wheel) - good cars have hood - wheel centre 0.11-0.15 m, eye - hood
// 0.15-0.19. screen: where the model's own (blacked) cluster screen sits from the eye. rows (window.__SCORE set): for
// each look / inset, the biggest cluster size that keeps the OS7 display's two bracket outlines (sampled off the page's
// own polylines, both mirror images) and the centre readouts clear of the model, by raycasting them from EYE (a hit
// nearer than the cluster = something in front of it); `wheel`: the same with the steering wheel left out (what only
// the rim and hub hide, as they do in the car)
(() => {
  const { THREE, snap, EYE, wheelAt } = window.__dbg;
  snap.updateMatrixWorld(true);
  const glassy = o => o.material.transparent && o.material.opacity < 0.95;
  const solid = [], swMeshes = []; let screen = null;
  snap.traverse(o => { if (!o.isMesh) return; if (o.userData.sw) swMeshes.push(o); else if (!glassy(o)) solid.push(o); if (o.material.name === 'x3_screen_off') screen = o; });
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  let hood = -9, hoodDz = 0, hoodHit = '';
  for (let dz = 0.05; dz <= 0.5001; dz += 0.01) {
    rc.set(new THREE.Vector3(wheelAt.x, wheelAt.y + 0.45, wheelAt.z + dz), down);
    const h = rc.intersectObjects(solid, false)[0];
    if (h && h.point.y > hood) { hood = h.point.y; hoodDz = dz; hoodHit = h.object.name + '/' + h.object.material.name; }
  }
  const seat = { wheel: wheelAt.toArray().map(v => +v.toFixed(3)), eye: EYE.toArray().map(v => +v.toFixed(3)), hood: +hood.toFixed(3), hoodDz: +hoodDz.toFixed(2), hoodHit,
    hoodMinusWheel: +(hood - wheelAt.y).toFixed(3), eyeMinusHood: +(EYE.y - hood).toFixed(3) };
  let scr = null;
  if (screen) { screen.geometry.computeBoundingBox(); const b = screen.geometry.boundingBox.clone().applyMatrix4(screen.matrixWorld), c = b.getCenter(new THREE.Vector3());
    const dir = c.clone().sub(EYE).normalize(), m = new THREE.Matrix4().lookAt(EYE, c, new THREE.Vector3(0, 1, 0)), xr = new THREE.Vector3().setFromMatrixColumn(m, 0);
    // the look that aims the eye's ray at the screen's middle (as drive.html builds it: wheel + (0, look, 0) - EYE), and the angle it spans across
    const k = (wheelAt.z - EYE.z) / (c.z - EYE.z), lookAtScreen = EYE.y + (c.y - EYE.y) * k - wheelAt.y;
    const ends = [b.min.x, b.max.x].map(x => new THREE.Vector3(x, c.y, c.z).sub(EYE));
    scr = { centre: c.toArray().map(v => +v.toFixed(3)), size: b.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)), dist: +c.distanceTo(EYE).toFixed(3), lookAtScreen: +lookAtScreen.toFixed(3),
      widthPerDist: +(Math.abs(ends[1].dot(xr) - ends[0].dot(xr)) / c.distanceTo(EYE)).toFixed(3) }; }
  if (!window.__SCORE) return { seat, screen: scr };
  const cp = document.getElementById('carpage').contentDocument, cl = cp.querySelector('.cluster').getBoundingClientRect(), H = cl.height;
  const svg = cp.getElementById('cl-svg'), ctm = svg.getScreenCTM(), sv = svg.getBoundingClientRect();
  const uv = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(ctm); return [(q.x - cl.left) / cl.width, (q.y - cl.top) / H]; };
  const outline = id => { const pts = [...cp.querySelector(`#${id} .os-line`).points]; return pts.filter((_, i) => i % 8 === 0).map(p => uv(p.x, p.y)); };
  const groups = { speedo: outline('os-spd'), tach: outline('os-tach'), centre: [uv(792, 430), uv(792, 500), uv(792, 570), uv(740, 520), uv(844, 520)] };
  const near = []; solid.forEach(o => { o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (s.center.distanceTo(wheelAt) < 0.9 + s.radius) near.push(o); });
  const first = (from, dir, withSw) => { rc.set(from, dir); return rc.intersectObjects(withSw ? [...near, ...swMeshes] : near, false)[0]; };
  const rows = [];
  for (let look = 0.0; look <= 0.141; look += 0.02) {
    const dir = wheelAt.clone().add(new THREE.Vector3(0, look, 0)).sub(EYE).normalize(), hit = first(EYE, dir, false); if (!hit) continue;
    for (const inset of [0.01, 0.03, 0.06, 0.1]) {
      const at = hit.point.clone().addScaledVector(dir, -inset), dist = at.distanceTo(EYE); if (dist < 0.55) continue;
      const m = new THREE.Matrix4().lookAt(EYE, at, new THREE.Vector3(0, 1, 0)), xr = new THREE.Vector3().setFromMatrixColumn(m, 0), yu = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const blockedAt = (size, withSw) => { const W = size * dist, Hm = W * H / cl.width, b = {}; let by = '';
        for (const [g, s] of Object.entries(groups)) b[g] = s.filter(([u, v]) => { const p = at.clone().addScaledVector(xr, (0.5 - u) * W).addScaledVector(yu, (0.5 - v) * Hm), d = p.clone().sub(EYE), L = d.length(); const h = first(EYE, d.normalize(), withSw); if (h && h.distance < L - 0.004) { by += (h.object.userData.sw ? 'wheel' : h.object.name) + ' '; return true; } }).length;
        b.by = [...new Set(by.trim().split(' '))].join(' '); return b; };
      const clear = b => !b.speedo && !b.tach && !b.centre;
      const biggest = withSw => { let lo = 0.16, hi = 0.8; if (!clear(blockedAt(lo, withSw))) return 0; for (let it = 0; it < 8; it++) { const mid = (lo + hi) / 2; if (clear(blockedAt(mid, withSw))) lo = mid; else hi = mid; } return +lo.toFixed(3); };
      const dash = biggest(false), all = biggest(true);
      rows.push({ look: +look.toFixed(2), inset, dist: +dist.toFixed(3), hit: hit.object.name, dashOnly: dash, withWheel: all, atDash: dash ? blockedAt(dash * 1.06, false).by : '', atWheel: all ? blockedAt(all * 1.06, true) : blockedAt(0.16, true) });
    }
  }
  return { seat, screen: scr, cluster: [cl.left, cl.top, cl.width, H].map(v => Math.round(v)), svgInCluster: [(sv.left - cl.left) / cl.width, (sv.right - cl.left) / cl.width].map(v => +v.toFixed(3)), rows };
})()
