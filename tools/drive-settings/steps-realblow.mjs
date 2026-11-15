// the real thing: the timing chain worn out (car-tune blows it at > 3,000 rpm under load), driven flat out on the
// autobahn until car-tune lets go - then what drive.html showed: the burst, the shake, the trickle, the car page's state
export default async ({ ev, sleep, tap, key, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const w = `document.getElementById('carpage').contentWindow`;
  const chain = await ev(`!!${w}.CarService.parts.find(p => p.key === 'tune-chain')`);
  if (!chain) return { note: 'no chain part on this engine' };
  await ev(`${w}.document.addEventListener('engineblow', e => window.__blowSeen = e.detail)`);
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2000);
  await ev(`__ev("teleport(TELEPORTS.find(t => t[0] === 'Autobahn')[2])")`); await sleep(1500);
  await ev(`${w}.CarService.parts.find(p => p.key === 'tune-chain').value = 100`);
  await tap('KeyK'); await sleep(500); await key('KeyW', 'keyDown');
  let t = 0; for (; t < 300 && !(await ev('!!window.__blowSeen')); t++) await sleep(100);
  const r = { secondsToBlow: t / 10, detail: await ev('window.__blowSeen'), chBlown: await ev(`${w}.CarTune.ch.blown`) };
  await sleep(150);
  Object.assign(r, await ev(`({ burst: __dbg.fumes.filter(p => p.age < 1).length, shake: +__dbg.shake.toFixed(2), blownSeen: __dbg.carPage.blown })`));
  await shot('real-0.2s');
  await key('KeyW', 'keyUp'); await sleep(6000);
  r.trickle = await ev(`__dbg.fumes.filter(p => p.age < 1).length`);
  r.ignition = await ev('__dbg.carPage.ignition');
  await shot('real-6s');
  return r;
};
