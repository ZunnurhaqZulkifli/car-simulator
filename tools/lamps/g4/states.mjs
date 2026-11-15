// The four lamp states for one car page (env CAR = slug): key-on bulb check, warm idle, a wet-road launch with
// traction control cutting in, and the ?bulbs hold. Shots are cluster-only (2x) into the harness's out dir.
const DRIVE = { 'audi-rs6-avant': 'k', 'nissan-gt-r-nismo': 'k', 'porsche-911-gt3-rs': 'k', 'honda-nsx-r': 'e', 'proton-iriz': 'e' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export default async ({ run, key, hold, shot, until, log }) => {
  const car = process.env.CAR, C = '.cluster';
  const lit = () => run(`[...document.querySelectorAll('.warning-lights > *, .lamps > *')].filter(w => getComputedStyle(w).opacity > .5 && /on/.test(w.className)).map(w => (w.id || w.title).replace(/^(wl|lamp)-/, '')).join(' ')`);
  await key('i'); await key('i', false);
  await sleep(700); await shot('1-keyon', C); log('key-on  :', await lit());
  await sleep(3500); log('key-on 4s:', await lit());
  await run('window.__warm = true');
  await key('i'); await sleep(300); await key('i', false);
  await sleep(5000); await shot('2-idle', C); log('idle    :', await lit());
  // a wet road so the launch spins the tyres; the stability system cuts in
  await run('window.surfaceGrip = 0.35');
  await hold(DRIVE[car], 120); await sleep(300);
  await key('w'); let tc = false;
  for (let i = 0; i < 40 && !tc; i++) { await sleep(60); tc = await run('!!(window.__tap.tick && window.__tap.tick.tc)'); }
  await sleep(90); await shot('3-tc', C);
  log('tc      :', tc, await lit(), '| flashing:', await run(`[...document.querySelectorAll('.blink')].map(w => w.id || w.title).join(' ')`));
  await key('w', false); await hold('s', 2500);
  await run('window.__bulbs = true'); await sleep(300); await shot('4-bulbs', C); log('bulbs   :', await lit());
  await run('window.__bulbs = false');
};
