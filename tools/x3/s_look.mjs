// smoke look at the X3 page (tools/rs6/harness.mjs): key-on bulb check, running Comfort, Sport, ECO PRO
export default async ({ run, key, wait, shot, log }) => {
  await shot('0-off');
  await key('i'); await wait(60); await key('i', false);
  await wait(900); await shot('1-keyon-bulbs');
  await wait(3500); await shot('2-keyon');
  await key(' '); await key('i'); await wait(60); await key('i', false); await key(' ', false); // brake + I = start
  await wait(3000); await shot('3-comfort-idle');
  await run(`document.querySelector('.mode-btn[data-mode="sport"]').click()`);
  await wait(600); await shot('4-sport-idle');
  await run(`document.querySelector('.mode-btn[data-mode="eco"]').click()`);
  await wait(400); await shot('5-eco');
  log('tick', await run('JSON.stringify(window.__tap.tick)'));
};
