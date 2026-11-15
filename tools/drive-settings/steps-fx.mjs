// exhaust smoke and the engine letting go, forced (car-tune may not set ch.oilSmoke / ch.blown / petrol ch.smoke yet):
// blue oil smoke, petrol black smoke, then a fake 'engineblow' on the car page with ch.blown held true. Shots (chase from
// behind and in-car) unless PERF=1, which instead times uncapped frames (ms) for each state, twice, interleaved
export default async ({ ev, sleep, tap, key, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const perf = !!process.env.PERF, out = {};
  const force = (k, v) => ev(`Object.defineProperty(document.getElementById('carpage').contentWindow.CarTune.ch, '${k}', { get: () => ${v}, set() {}, configurable: true })`);
  const ms = t => ev(`new Promise(r => { let n = 0; const t0 = performance.now(), f = () => { n++; performance.now() - t0 < ${t} ? requestAnimationFrame(f) : r(+((performance.now() - t0) / n).toFixed(2)); }; requestAnimationFrame(f); })`);
  const sprites = () => ev(`(() => { let n = 0; __dbg.scene.traverse(o => o.isSprite && o.visible && n++); return n; })()`);
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2500);
  await ev(`__ev("orbitYaw = Math.PI * 0.85; orbitPitch = 0.25")`); await sleep(800);
  out.engine = await ev(`({ fuel: document.getElementById('carpage').contentWindow.CarTune?.fuel, petrol: __dbg.carPage.petrol, on: __dbg.carPage.ignition })`);
  if (perf) out.base = [await ms(3000)];
  await force('oilSmoke', 60); await sleep(4000);
  out.oilSprites = await sprites();
  if (perf) out.oil = [await ms(3000)]; else await shot('oil');
  await force('oilSmoke', 0); await force('smoke', 40); await sleep(2500);
  out.petrolSprites = await sprites();
  if (perf) out.petrol = [await ms(3000)]; else await shot('petrol');
  await force('smoke', 0); await sleep(4000);
  if (perf) out.base.push(await ms(3000));
  await ev(`document.getElementById('carpage').contentDocument.dispatchEvent(new CustomEvent('engineblow', { detail: { cause: 'rod', cyl: 3, rpm: 7000, speed: 0 } }))`);
  await force('blown', true);
  if (perf) out.blow = [await ms(2000)];
  else { await sleep(120); await shot('blow-0.1s'); await sleep(450); await shot('blow-0.6s'); await sleep(1400); await shot('blow-2s'); }
  out.burstSprites = await ev(`__dbg.fumes.filter(p => p.age < 1).length`);
  await ev(`document.getElementById('carpage').contentDocument.dispatchEvent(new CustomEvent('engineblow', { detail: {} }))`); await sleep(100);
  out.secondEventShake = await ev(`__dbg.shake`); // (stays decayed: no replay)
  await sleep(6000);
  out.trickleSprites = await ev(`__dbg.fumes.filter(p => p.age < 1).length`);
  if (perf) out.trickle = [await ms(3000)]; else await shot('trickle-chase');
  await tap('KeyC'); await ev(`__ev("orbitYaw = 0; orbitPitch = PITCH")`); await sleep(2500);
  if (perf) out.trickleInCar = [await ms(3000)]; else await shot('trickle-incar');
  out.engineAt = await ev(`__dbg.ENGINE.toArray().map(x => +x.toFixed(2))`);
  return out;
};
