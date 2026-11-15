// the Settings' Graphics options, each checked for its real effect (run with PERF=1: rAF uncapped, so a cap shows):
// frames rendered a second per FPS cap, the drawing buffer per render scale, the largest uploaded texture and its GL
// anisotropy per texture quality, fog / far plane / draw calls per view distance, antialias after a reload, the meter.
// Frame cost (ms, uncapped) for each, measured twice, interleaved
export default async ({ ev, sleep, tap, send }) => {
  const t0 = Date.now(), step = s => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s}`);
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const set = (k, v) => ev(`__ev(${JSON.stringify(`setGfx('${k}', ${JSON.stringify(v)})`)})`);
  const ms = t => ev(`new Promise(r => { let n = 0; const t0 = performance.now(), f = () => { n++; performance.now() - t0 < ${t} ? requestAnimationFrame(f) : r(+((performance.now() - t0) / n).toFixed(2)); }; requestAnimationFrame(f); })`);
  await ev(`__ev("renderer.render = (r => function (...a) { window.__renders = (window.__renders || 0) + 1; return r.apply(this, a); })(renderer.render)")`);
  const renders = async t => { await ev('window.__renders = 0'); await sleep(t); return Math.round(await ev('window.__renders') / t * 1000); };
  const out = { fps: {}, scale: {}, tex: {}, view: {} };
  step('fps cap');
  for (const f of [30, 60, 120, 0]) { await set('fps', f); await sleep(300); out.fps[f || 'unlimited'] = { rendersPerSec: await renders(3000) }; }
  await tap('KeyC'); await sleep(1500); // (in-car: the heavier view)
  step('scale');
  for (const round of [0, 1]) for (const s of [0.5, 0.67, 0.75, 1]) {
    await set('scale', s); await sleep(500);
    const r = out.scale[s] ||= { buffer: await ev(`(() => { const g = __dbg.renderer.getContext(); return g.drawingBufferWidth + 'x' + g.drawingBufferHeight; })()`), ms: [] };
    r.ms.push(await ms(2500));
  }
  const texInfo = `(() => { const { scene, renderer } = __dbg, gl = renderer.getContext(), ext = gl.getExtension('EXT_texture_filter_anisotropic'); let big = null, n = 0, px = 0;
    scene.traverse(o => { for (const m of [o.material].flat()) for (const t of Object.values(m ?? {})) if (t?.isTexture && t.image?.width && !t.isRenderTargetTexture) { n++; px += t.image.width * t.image.height; if (!big || (t.userData.full?.width ?? 0) * (t.userData.full?.height ?? 0) > (big.userData.full?.width ?? 0) * (big.userData.full?.height ?? 0)) big = t; } });
    renderer.initTexture(big); const p = renderer.properties.get(big); gl.bindTexture(gl.TEXTURE_2D, p.__webglTexture); // (uploaded now: one on an undrawn traffic car waits for its next draw)
    return { biggestFull: big.userData.full.width + 'x' + big.userData.full.height, uploaded: big.image.width + 'x' + big.image.height, glAniso: gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT), textures: n, mpx: +(px / 1e6).toFixed(1) }; })()`;
  await set('scale', 1);
  step('textures');
  for (const round of [0, 1]) for (const q of ['low', 'medium', 'high']) {
    await set('tex', q); await sleep(800);
    const r = out.tex[q] ||= { ...(await ev(texInfo)), ms: [] };
    r.ms.push(await ms(2500));
  }
  await tap('KeyC'); await sleep(800);
  for (const [place, at] of [['city', 'City'], ['genting', 'Genting Highlands']]) {
    step('view: ' + place); await ev(`__ev("teleport(TELEPORTS.find(t => t[0] === '${at}')[2])")`); await sleep(3000);
    for (const round of [0, 1]) for (const v of [0.6, 1, 1.5]) {
      await set('view', v); await sleep(2500);
      const r = (out.view[place] ||= {})[v] ||= { ...(await ev(`({ fogFar: __dbg.scene.fog.far, far: __dbg.camera.far, calls: __dbg.renderer.info.render.calls, tris: __dbg.renderer.info.render.triangles })`)), ms: [] };
      r.ms.push(await ms(2500));
    }
  }
  step('meter + reload');
  await set('meter', true); await sleep(1200);
  out.meter = await ev(`document.getElementById('fps').hidden ? 'hidden' : document.getElementById('fps').textContent`);
  out.storedBeforeReload = await ev(`localStorage.getItem('drive-gfx')`);
  await set('aa', false);
  out.aaBeforeReload = await ev(`__dbg.renderer.getContext().getContextAttributes().antialias`);
  await send('Page.reload'); await sleep(12000); // (CDP's own reload: an evaluated location.reload() can lose its reply)
  for (let i = 0; i < 30 && !(await ev('window.__dbg?.usingModel')); i++) await sleep(500);
  out.aaAfterReload = await ev(`__dbg.renderer.getContext().getContextAttributes().antialias`);
  out.afterReload = await ev(`({ gfx: __dbg.gfx, pixelRatio: __dbg.renderer.getPixelRatio(), meter: !document.getElementById('fps').hidden })`);
  return out;
};
