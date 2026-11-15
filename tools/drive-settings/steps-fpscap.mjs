// the FPS cap alone: frames rendered a second at each setting, twice (PERF=1: uncapped rAF; without: the display's)
export default async ({ ev, sleep }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  await ev(`__ev("renderer.render = (r => function (...a) { window.__renders = (window.__renders || 0) + 1; return r.apply(this, a); })(renderer.render)")`);
  const out = {};
  for (const round of [0, 1]) for (const f of [30, 60, 120, 0]) {
    const t = Date.now();
    await ev(`__ev("setGfx('fps', ${f})")`); await sleep(400); await ev('window.__renders = 0'); await sleep(3000);
    const raf = await ev(`new Promise(r => { let n = 0; const t0 = performance.now(), f = () => ++n < 30 ? requestAnimationFrame(f) : r(+((performance.now() - t0) / 30).toFixed(2)); requestAnimationFrame(f); })`);
    (out[f || 'unlimited'] ||= []).push({ renders: Math.round(await ev('window.__renders') / 3), rafMs: raf, stepS: (Date.now() - t) / 1000 });
  }
  return out;
};
