// probe.mjs steps (cam swap; "&dist=5.5&pitch=0.12" frames the car, add "&hour=22" for night): engine on, drive.html's
// HUD and chase-view cluster hidden; the car from behind, rear three-quarter, side, front three-quarter and front; the
// lights on (front, rear), braking, R; then in-car (cluster back in the dash) at rest and with the wheel turned. Saves
// the shots; returns the lamp levels (tail / head / reverse emissive) at each step
const lv = ev => ev(`(() => { const d = window.__dbg, r = m => +(m.emissiveIntensity ?? 0).toFixed(2);
  return { tail: d.modelTail.map(([m]) => r(m)).join(' '), head: d.modelHead.map(([m]) => r(m)).join(' '), reverse: d.modelReverse.filter(m => !m.isMeshBasicMaterial).map(r).join(' '),
    gear: document.getElementById('carpage').contentDocument.getElementById('led-gear-txt')?.textContent }; })()`);
const hide = (ev, hud, cluster) => ev(`(() => { for (const s of ['#hud', '#map', '#map-legend', '#tele', '#credit', '#fps', '#laptime']) { const e = document.querySelector(s); if (e) e.style.opacity = ${hud ? 0 : 1}; }
  document.getElementById('carpage').style.opacity = ${cluster ? 0 : 1}; })()`);
export default async ({ shot, sleep, orbit, tap, key, ev }) => {
  const out = {};
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(3000);
  await hide(ev, true, true);
  out.running = await lv(ev);
  await shot('behind');
  for (const [n, dx] of [['rq', -280], ['side', -200], ['fq', -200], ['front', -150]]) { await orbit(dx, 0); await sleep(900); await shot(n); }
  await tap('KeyL'); await sleep(1500); out.lit = await lv(ev); await shot('lit-front');
  await orbit(150, 0); await sleep(900); await shot('lit-fq');
  await orbit(680, 0); await sleep(900); await shot('lit-rq');
  await key('KeyS', 'keyDown'); await sleep(1200); out.brake = await lv(ev); await shot('brake-rq'); await key('KeyS', 'keyUp'); await sleep(600);
  await key('KeyS', 'keyDown'); await tap('KeyR'); await sleep(800); await key('KeyS', 'keyUp'); await sleep(600); out.reverse = await lv(ev); await shot('reverse-rq');
  await key('KeyS', 'keyDown'); await tap('KeyN'); await sleep(500); await key('KeyS', 'keyUp');
  await hide(ev, true, false);
  await tap('KeyW'); await sleep(300); await tap('KeyC'); await sleep(2500); await shot('incar');
  await key('KeyA', 'keyDown'); await sleep(1200); await shot('incar-turned'); await key('KeyA', 'keyUp');
  return out;
};
