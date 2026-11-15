// final smoke (tools/rs6/harness.mjs): full-page shots in Comfort / Sport / ECO PRO running, then the ?bulbs URL hook
// (reloads the page with ?bulbs: display on, every lamp lit with the key off). Prints lamp counts and any check-control text.
export default async ({ run, key, wait, shot, log }) => {
  const lamps = () => run(`[...document.querySelectorAll('.lp.on')].length`);
  await key('i'); await wait(60); await key('i', false); await wait(700);
  log('bulb check lamps', await lamps());
  await wait(6000); log('after 6 s', await lamps());
  await key('i'); await wait(60); await key('i', false); await wait(2500);
  log('running in P lamps', await run(`[...document.querySelectorAll('.lp.on')].map(e => e.getAttribute('transform').split(')')[0]).join(' | ')`));
  await shot('page-comfort');
  await run(`document.querySelector('.mode-btn[data-mode="sport"]').click()`); await wait(500); await shot('page-sport');
  await run(`document.querySelector('.mode-btn[data-mode="eco"]').click()`); await wait(500); await shot('page-eco');
  await run(`document.querySelector('.mode-btn[data-mode="comfort"]').click()`);
  await key('t'); await key('t', false); await wait(300); log('DSC pressed: tc-btn =', await run(`document.getElementById('tc-btn').textContent`), 'dscoff lamp', await run(`lamp => 0`).catch(() => '?'));
  await run(`location.href = location.href.split('?')[0] + '?bulbs'`); await wait(2500);
  log('?bulbs, key off: display on =', await run(`!document.querySelector('.cluster').classList.contains('tft-off')`), 'lamps', await lamps());
  await shot('page-bulbs');
};
