// probe.mjs steps (add "&hour=22" for night, and the cam swap with "&dist=6&pitch=0.12" to come closer): engine on, then
// chase front and rear three-quarter, lights on, braking (rear), reverse (rear), in-car at rest and with the wheel
// turned. Saves the shots; returns the lamp levels (head / tail / reverse emissive) at each step
const lv = ev => ev(`(() => { const d = window.__dbg, r = m => +(m.emissiveIntensity ?? 0).toFixed(2);
  return { tail: d.modelTail.map(([m]) => r(m)).join(' '), head: d.modelHead.map(([m]) => r(m)).join(' '), reverse: d.modelReverse.map(r).join(' '),
    gear: document.getElementById('carpage').contentDocument.getElementById('led-gear-txt')?.textContent }; })()`);
export default async ({ shot, sleep, orbit, tap, key, ev }) => {
  const out = {};
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(3000);
  out.running = await lv(ev);
  await orbit(-560, 0); await sleep(900); await shot('chase-fq');
  await orbit(-640, 0); await sleep(900); await shot('chase-rq');
  await tap('KeyL'); await sleep(1500); out.lit = await lv(ev); await shot('lit-rq');
  await key('KeyS', 'keyDown'); await sleep(1200); out.brake = await lv(ev); await shot('brake-rq'); await key('KeyS', 'keyUp'); await sleep(600);
  await key('KeyS', 'keyDown'); await tap('KeyR'); await sleep(800); await key('KeyS', 'keyUp'); await sleep(600); out.reverse = await lv(ev); await shot('reverse-rq');
  await key('KeyS', 'keyDown'); await tap('KeyN'); await sleep(500); await key('KeyS', 'keyUp'); // (N: the W taps that reset the view only blip it)
  await orbit(1200, 0); await sleep(300); await tap('KeyW'); await sleep(300); await orbit(-560, 0); await sleep(900); await shot('lit-fq');
  await tap('KeyW'); await sleep(300); await tap('KeyC'); await sleep(2500); await shot('incar');
  await key('KeyA', 'keyDown'); await sleep(1200); await shot('incar-turned'); await key('KeyA', 'keyUp');
  return out;
};
