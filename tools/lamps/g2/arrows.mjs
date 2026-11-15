// drive.html's load hook, replayed (its code, drive.html ~3896): turn arrows go at the ends of a flex .warning-lights, else at
// CAR.arrows [left%, right%, top%]; both lit with the bulb check held, to see them land on the row
export default async ({ run, wait, shotEl, log }) => {
  log(await run(`(() => { const wls = document.querySelector('.warning-lights'), row = getComputedStyle(wls).display.includes('flex');
    const [al, ar, at] = [38.5, 61.5, 11];
    for (const [s, x, d] of [[1, al, 'M2 12l9-8v5h11v6H11v5z'], [-1, ar, 'M22 12l-9-8v5H2v6h11v5z']]) wls.insertAdjacentHTML(s === 1 && row ? 'afterbegin' : 'beforeend',
      '<div class="wl" data-turn="' + s + '"' + (row ? '' : ' style="left:' + x + '%;top:' + at + '%"') + '><svg viewBox="0 0 24 24"><path fill="currentColor" d="' + d + '"/></svg></div>');
    document.querySelectorAll('[data-turn]').forEach(a => a.classList.add('on-green'));
    return 'row ' + row + ', children ' + wls.children.length; })()`));
  await run('window.__bulbs = true'); await wait(700); await shotEl('7-arrows');
};
