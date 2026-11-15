// load test for any car: the model in, its clear windows hidden in-car, the Settings menu opening and closing; NARROW=1
// also shoots the menu's three tabs in a 390 px wide window
export default async ({ ev, sleep, tap, shot, send }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const r = await ev(`({ model: __dbg.usingModel, windows: (() => { let n = 0; __dbg.car.traverse(o => o.material === __dbg.windowGlass && n++); return n; })(), engine: __dbg.ENGINE.toArray().map(x => +x.toFixed(2)), title: document.title })`);
  await tap('KeyC'); await sleep(600);
  r.inCar = await ev(`({ fov: Math.round(__dbg.camera.fov), glassShown: __dbg.windowGlass.visible })`);
  await tap('KeyC'); await sleep(300);
  await tap('BracketRight', 80, ']'); await sleep(200);
  r.menu = await ev(`!document.getElementById('settings').hidden`);
  if (process.env.NARROW) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false }); await sleep(800);
    for (const t of ['gfx', 'cam', 'pad']) { await ev(`document.querySelector('#set-tabs [data-tab=${t}]').click()`); await sleep(300); await shot('narrow-' + t); }
    r.narrowOverflow = await ev(`(() => { const b = document.getElementById('settings').getBoundingClientRect(); return { left: b.left, right: b.right, width: innerWidth }; })()`);
  }
  await tap('Escape', 80, 'Escape'); await sleep(200);
  r.menuClosed = await ev(`document.getElementById('settings').hidden`);
  return r;
};
