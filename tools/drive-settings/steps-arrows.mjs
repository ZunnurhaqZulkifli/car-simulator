// turn arrows: how many [data-turn] elements the car page has after drive.html's load hook, which ones it injected
// (.wl[data-turn] with a style), and the left signal lighting the page's own arrow
export default async ({ ev, sleep, tap }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const q = `document.getElementById('carpage').contentDocument`;
  const r = await ev(`({ turn1: ${q}.querySelectorAll('[data-turn="1"]').length, turnR: ${q}.querySelectorAll('[data-turn="-1"]').length,
    injected: [...${q}.querySelectorAll('.wl[data-turn]')].map(e => e.getAttribute('style') || 'in the row'), own: ${q}.querySelector('[data-turn="1"]').tagName + '#' + ${q}.querySelector('[data-turn="1"]').id })`);
  await tap('ArrowLeft', 80, 'ArrowLeft'); await sleep(150);
  r.leftLit = await ev(`${q}.querySelector('[data-turn="1"]').classList.contains('on-green')`);
  return r;
};
