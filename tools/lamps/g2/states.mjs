// the four lamp states, cluster-only PNGs: 1 key-on bulb check, 1b key on after the check (engine off), 2 running at idle
// (lights + high beam on), 3 full throttle from rest on a snowy road (window.surfaceGrip .3, drive.html's weather) until
// traction control cuts in, 4 ?bulbs (window.__bulbs)
export default async ({ run, key, hold, wait, shotEl, until, log }) => {
  const lit = () => run(`[...document.querySelectorAll('.lp.on, .wl[class*="on-"]')].map(e => (e.id || '') + (e.getAttribute('transform') || '').slice(10, 22)).length`);
  await run(`document.getElementById('power-btn').click()`); await wait(700);
  await shotEl('1-keyon'); log('key-on lit', await lit());
  await wait(6500); await shotEl('1b-keyon-after'); log('key-on after check lit', await lit());
  await run(`document.getElementById('power-btn').click()`);
  await until('window.__tap.tick && window.__tap.tick.rpm > 300', 15000).catch(() => log('no rpm after start'));
  await wait(3000); await key('l'); await wait(200); await key('l', false); await key('h'); await wait(200); await key('h', false); await wait(400);
  await shotEl('2-idle'); log('idle lit', await lit(), 'rpm', await run('Math.round(window.__tap.tick.rpm)'));
  await key('h'); await wait(150); await key('h', false); await key('l'); await wait(150); await key('l', false);
  await run('window.surfaceGrip = 0.3'); await key('w'); let tc = false;
  for (let i = 0; i < 160 && !tc; i++) { tc = await run('!!(window.__tap.tick && window.__tap.tick.tc)'); if (!tc) await wait(50); }
  await shotEl('3-tc'); log('tc seen', tc, 'speed', await run('Math.round(window.__tap.tick.speed)'));
  await key('w', false); await run('window.surfaceGrip = 1');
  await run('window.__bulbs = true'); await wait(500); await shotEl('4-bulbs');
};
