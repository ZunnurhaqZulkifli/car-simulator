// 5 running, then car-tune's blown flag set with the ignition left on (the engine dead): the oil / charge / drive-system lamps;
// 6 ?bulbs on the Sport face (overlaps). Lamp keys lit are logged from the page's own .lp elements.
export default async ({ run, wait, shotEl, until, log }) => {
  const lit = () => run(`[...document.querySelectorAll('.lp.on')].map(e => e.id || e.dataset.k || e.innerHTML.length).join(' ')`);
  await run(`document.getElementById('power-btn').click()`); await wait(400);
  await run(`document.getElementById('power-btn').click()`); await wait(7000);
  log('running lit', await lit());
  await run('CarTune.ch.blown = true'); await wait(600);
  await shotEl('5-blown'); log('blown lit', await lit());
  await run('CarTune.ch.blown = false');
  await run(`(document.querySelector('.mode-btn[data-mode="sport"]') || {}).click?.()`);
  await run('window.__bulbs = true'); await wait(900); await shotEl('6-bulbs-sport');
};
