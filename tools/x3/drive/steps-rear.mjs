// probe.mjs steps (with the cam swap and "&dist=3.4&pitch=0.1"): engine on, a close look at the rear - running, braking,
// in R - then the front with the lights on
export default async ({ shot, sleep, orbit, tap, key }) => {
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2500);
  await orbit(-120, 0); await sleep(900); await shot('run');
  await key('KeyS', 'keyDown'); await sleep(1000); await shot('brake');
  await tap('KeyR'); await sleep(800); await key('KeyS', 'keyUp'); await sleep(500); await shot('rev');
  await key('KeyS', 'keyDown'); await tap('KeyN'); await sleep(500); await key('KeyS', 'keyUp');
  await tap('KeyL'); await orbit(-630, 0); await sleep(1200); await shot('front-lit');
  return 'ok';
};
