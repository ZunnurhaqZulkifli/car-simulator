// wind vs engine (AUDIO=1): on the autobahn's long straight, flat out to each speed, then held there on the car's own
// cruise control (F); each window's output A-weighted - engine = the car page's AudioContext, wind = drive.html's.
// dB(A) relative to the same analyser full scale, so only differences mean anything. Chase, then in-car (C)
export default async ({ ev, sleep, tap, key }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const lvl = () => ev(`({ wind: window.__lvl(), engine: document.getElementById('carpage').contentWindow.__lvl(), kmh: Math.round(__dbg.carPage.speed), rpm: Math.round(__dbg.carPage.rpm), gear: __dbg.carPage.gear })`);
  const out = {};
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(3000);
  await lvl(); await sleep(1500); out.idle = await lvl();
  await ev(`__ev("teleport(TELEPORTS.find(t => t[0] === 'Autobahn')[2])")`); await sleep(1500);
  await tap('KeyK'); await sleep(600);
  for (const target of [100, 160, 250]) {
    await key('KeyW', 'keyDown');
    let s = 0, t0 = Date.now();
    await lvl();
    while ((s = await ev('__dbg.carPage.speed')) < target - 6 && Date.now() - t0 < 40000) await sleep(100);
    await lvl(); await sleep(500);
    const wot = await lvl();
    await key('KeyW', 'keyUp');
    await tap('KeyF'); await sleep(3500);
    await lvl(); await sleep(1500);
    const cruise = await lvl();
    await tap('KeyC'); await sleep(1200); await lvl(); await sleep(1500);
    const inCar = await lvl();
    await tap('KeyC'); await sleep(500);
    const d = x => x.wind && x.engine ? +(x.wind[0] - x.engine[0]).toFixed(1) : null;
    out[target] = { wot: { ...wot, windOverEngine: d(wot) }, cruise: { ...cruise, windOverEngine: d(cruise) }, inCar: { ...inCar, windOverEngine: d(inCar) } };
    if (s < target - 6) { out[target].note = 'never got there'; break; }
  }
  return out;
};
