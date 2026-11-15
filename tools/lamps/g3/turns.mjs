// drive.html's load hook, replayed (public/drive.html ~l.3896): it adds its own arrows to .warning-lights (row ends or
// CAR.arrows spots), then flashes the FIRST [data-turn] pair in the document. Checks that what lights is the page's own
// arrow at its real place, and that the injected ones stay invisible. Prints one line per side; nothing is saved.
export default async ({ run, hold, wait, shot, log }) => {
  await hold('i', 60); await wait(4000); // past the bulb check
  const r = await run(`(() => {
    const wls = document.querySelector('.warning-lights'), row = getComputedStyle(wls).display.includes('flex');
    for (const [s, d] of [[1, 'M2 12l9-8v5h11v6H11v5z'], [-1, 'M22 12l-9-8v5H2v6h11v5z']]) wls.insertAdjacentHTML(s === 1 && row ? 'afterbegin' : 'beforeend',
      '<div class="wl" data-turn="' + s + '"' + (row ? '' : ' style="left:38.5%;top:11%"') + '><svg viewBox="0 0 24 24"><path fill="currentColor" d="' + d + '"/></svg></div>');
    const out = { row };
    for (const s of [1, -1]) { const a = document.querySelector('[data-turn="' + s + '"]'); a.classList.add('on-green');
      out[s] = { tag: a.tagName, id: a.id || a.className.baseVal || a.className, injected: !!a.closest('.warning-lights') }; }
    out.injectedVisible = [...wls.querySelectorAll('[data-turn]')].filter(e => !e.classList.contains('on-green')).map(e => getComputedStyle(e).opacity + '/' + getComputedStyle(e).color);
    return out; })()`);
  await wait(200);
  r.litLamps = await run(`[...document.querySelectorAll('#os-lamps .lp.on')].length`);
  log(JSON.stringify(r));
  await shot('turns', '.cluster');
};
