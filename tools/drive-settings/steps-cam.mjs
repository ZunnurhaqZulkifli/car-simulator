// the Camera settings: the field of view (vertical, and horizontal at this window) in-car and chase, and whether the live
// cluster (the CSS3D iframe) still lands exactly on its hole in the WebGL view after a field of view or head change -
// both corner sets projected to screen px, the worst corner's miss. Shots of the extremes
export default async ({ ev, sleep, tap, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const hasSet = await ev(`(() => { try { return !!__dbg.camSet; } catch { return false; } })()`);
  const fit = () => ev(`(() => {
    const { THREE, camera, hole, frame } = __dbg, h = hole.geometry.parameters.height, w = hole.geometry.parameters.width, v = new THREE.Vector3();
    hole.updateMatrixWorld(); camera.updateMatrixWorld();
    const px = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { v.set(a * w / 2, b * h / 2, 0).applyMatrix4(hole.matrixWorld).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
    const xs = px.map(p => p[0]), ys = px.map(p => p[1]), r = frame.getBoundingClientRect();
    const fov = camera.fov, hfov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI;
    return { fov: +fov.toFixed(1), hfov: +hfov.toFixed(1), miss: +Math.max(Math.abs(Math.min(...xs) - r.left), Math.abs(Math.max(...xs) - r.right), Math.abs(Math.min(...ys) - r.top), Math.abs(Math.max(...ys) - r.bottom)).toFixed(2), clusterPx: Math.round(r.width) };
  })()`);
  const set = (k, v) => ev(`__ev("setCam('${k}', ${v})")`);
  const out = { chase: await fit() };
  await tap('KeyC'); await sleep(1500);
  out.inCarDefault = await fit();
  await shot('incar-default');
  if (!hasSet) return out;
  for (const [f, z, y] of [[50, 0, 0], [90, 0, 0], [70, 0.1, 0.08], [70, -0.1, -0.08], [100, 0.1, -0.08]]) {
    await set('fovIn', f); await set('headZ', z); await set('headY', y); await sleep(1500);
    out[`in fov${f} head${z},${y}`] = await fit();
    if (f === 90 || (f === 70 && z > 0)) await shot(`incar-${f}-${z}`);
  }
  await tap('KeyC'); await set('fovOut', 85); await set('dist', 5); await set('height', 2); await sleep(2500);
  out.chaseWide = await fit();
  await shot('chase-wide');
  out.stored = await ev(`localStorage.getItem('drive-cam')`);
  await ev(`document.querySelector('#set-btn').click()`); await ev(`document.querySelector('#set-tabs [data-tab=cam]').click()`); await ev(`document.querySelector('#settings [data-reset]').click()`); await sleep(300);
  out.afterReset = await ev(`({ ...__dbg.camSet, PITCH: +__dbg.PITCH.toFixed(3), CAM_DIST: __dbg.CAM_DIST })`);
  return out;
};
