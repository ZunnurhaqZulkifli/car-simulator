// probe.mjs steps: chase from behind and round the car (orbit), then in-car straight and with A held (only the wheel
// should turn). Run with "&dist=3.6&pitch=0.12" and the CAM_DIST swap for close-ups
export default async ({ shot, sleep, orbit, tap, key }) => {
  await shot('chase');
  for (const [n, dx] of [['rq', -280], ['side', -200], ['fq', -200], ['front', -150]]) { await orbit(dx, 0); await sleep(500); await shot(n); }
  await tap('KeyW'); await sleep(300);
  await tap('KeyC'); await sleep(2500); await shot('incar');
  await key('KeyA', 'keyDown'); await sleep(1200); await shot('turned'); await key('KeyA', 'keyUp');
  return 'ok';
};
