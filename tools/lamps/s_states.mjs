// four lamp states, cluster-cropped: key-on bulb check, running at idle, traction control cutting in, ?bulbs
// env SEL = the cluster selector (default .cluster), TC = js run each frame-ish to force the tc state if a launch won't spin
export default async ({ run, key, wait, shot, until, log }) => {
  const SEL = process.env.SEL || '.cluster';
  const lamps = () => run(`[...document.querySelectorAll('.wl')].filter(e => /on-|lit/.test(e.className.baseVal ?? e.className)).map(e => e.id || e.title).join(' ')`);
  await key('i'); await wait(30); await key('i', false);
  await wait(500); await shot('1-keyon-bulbcheck', SEL); log('keyon 0.5s:', await lamps());
  await wait(4000); await shot('1b-keyon-6s', SEL); log('keyon 4.5s:', await lamps());
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await run('window.__warm = true');
  await wait(4500); await shot('2-idle', SEL); log('idle:', await lamps());
  await key('k'); await wait(200);
  await run('window.surfaceGrip = 0.25'); // drive.html's snow grip: full throttle in first spins the wheels
  await key('w');
  try { await until('window.__tap.tick && window.__tap.tick.tc', 4000); } catch { log('no tc within 4 s'); }
  await wait(120);
  log('tick', await run('JSON.stringify(window.__tap.tick && {tc: window.__tap.tick.tc, spin: window.__tap.tick.spin, v: window.__tap.tick.speed})'));
  await shot('3-tc', SEL); log('tc:', await lamps());
  await key('w', false); await run('window.surfaceGrip = 1');
  await run('window.__bulbs = true'); await wait(300); await shot('4-bulbs', SEL); log('bulbs:', await lamps());
};
