// drive.html's turn arrows (its load hook, copied: flex-row ends or CAR.arrows [l, r, top] %, env ARROWS="l,r,t"), lit;
// then a dead engine with the ignition on (CarTune.ch.blown, as car-tune sets after a blow-up): charge, oil, MIL must light
export default async ({ run, key, wait, shot, log }) => {
  const SEL = process.env.SEL || '.cluster';
  const lamps = () => run(`[...document.querySelectorAll('.wl')].filter(e => /on-/.test(e.className)).map(e => e.id || e.title || 'arrow').join(' ')`);
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await run('window.__warm = true'); await wait(7000);
  await run(`(() => { const w = window, wls = w.document.querySelector('.warning-lights'), row = w.getComputedStyle(wls).display.includes('flex');
    const [al, ar, at] = ${JSON.stringify((process.env.ARROWS || '38.5,61.5,11').split(',').map(Number))};
    for (const [s, x, d] of [[1, al, 'M2 12l9-8v5h11v6H11v5z'], [-1, ar, 'M22 12l-9-8v5H2v6h11v5z']]) wls.insertAdjacentHTML(s === 1 && row ? 'afterbegin' : 'beforeend',
      \`<div class="wl on-green" data-turn="\${s}"\${row ? '' : \` style="left:\${x}%;top:\${at}%"\`}><svg viewBox="0 0 24 24"><path fill="currentColor" d="\${d}"/></svg></div>\`); })()`);
  await run('window.__bulbs = true'); await wait(300); await shot('5-arrows-bulbs', SEL); await run('window.__bulbs = false');
  await wait(300); log('running:', await lamps());
  await run('CarTune.ch.blown = true'); await wait(400); await shot('6-dead-engine', SEL); log('dead engine:', await lamps());
};
