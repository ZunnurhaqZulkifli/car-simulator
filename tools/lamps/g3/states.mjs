// The four lamp states, cluster only: key-on bulb check, idle, traction control intervening, ?bulbs.
// env: SEL (cluster selector, default .cluster), DRIVE (keys that select a forward gear, e.g. "k"), WARM=1
export default async ({ run, key, hold, wait, shot, until, log }) => {
  const sel = process.env.SEL || '.cluster';
  const tap = k => hold(k, 60);
  if(process.env.WARM) await run('window.__warm = true');
  await tap('i'); await wait(900); await shot('1-keyon', sel);
  await wait(7000); await shot('1b-ignition-dead', sel); // ignition on, engine not started: charge / oil / MIL should show
  await tap('i');
  await until('window.__tap.tick && window.__tap.tick.rpm > 400', 15000).catch(() => log('no start'));
  await wait(7000); await shot('2-idle', sel);
  log('idle tick', JSON.stringify(await run('(({tc, rpm, gearLabel, speed}) => ({tc, rpm: Math.round(rpm), gearLabel, speed}))(window.__tap.tick)')));
  // traction control: a slick road and full throttle from a standstill
  await run('window.surfaceGrip = 0.15');
  for(const k of (process.env.DRIVE || '').split(',').filter(Boolean)) { await tap(k); await wait(250); }
  await key('w');
  let got = false;
  for(let t = 0; t < 120 && !got; t++){ await wait(50); got = await run('!!(window.__tap.tick && window.__tap.tick.tc)'); }
  await wait(120); await shot('3-tc', sel); await key('w', false);
  log('tc seen', got, JSON.stringify(await run('(({tc, rpm, gearLabel, speed}) => ({tc, rpm: Math.round(rpm), gearLabel, speed}))(window.__tap.tick)')));
  await run('window.surfaceGrip = 1; window.__bulbs = true'); await wait(400); await shot('4-bulbs', sel);
};
