// quick wind-vs-engine sweep (AUDIO=1): flat out to 160 km/h on the autobahn, held on cruise control, chase then in-car
export default async ({ ev, sleep, tap, key }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const lvl = () => ev(`({ wind: window.__lvl()?.[0], engine: document.getElementById('carpage').contentWindow.__lvl()?.[0], kmh: Math.round(__dbg.carPage.speed), gear: __dbg.carPage.gear })`);
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2500);
  await ev(`__ev("teleport(TELEPORTS.find(t => t[0] === 'Autobahn')[2])")`); await sleep(1500);
  await tap('KeyK'); await sleep(600);
  await key('KeyW', 'keyDown');
  for (let t0 = Date.now(); (await ev('__dbg.carPage.speed')) < 156 && Date.now() - t0 < 30000;) await sleep(100);
  await key('KeyW', 'keyUp'); await tap('KeyF'); await sleep(3000);
  await lvl(); await sleep(1500); const chase = await lvl();
  await tap('KeyC'); await sleep(1200); await lvl(); await sleep(1500); const inCar = await lvl();
  const d = x => x.wind != null && x.engine != null ? +(x.wind - x.engine).toFixed(1) : null;
  return { kmh: chase.kmh, gear: chase.gear, engine: chase.engine, chase: d(chase), inCar: d(inCar) };
};
