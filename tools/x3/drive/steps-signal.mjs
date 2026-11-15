// probe.mjs steps: engine on, ← signal, then where drive.html's green arrows sit against the OS7 display's own arrow
// telltales (px apart) and whether they light; a crop of the chase-view cluster while lit
export default async ({ shot, sleep, tap, key, ev }) => {
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2500);
  await tap('ArrowLeft');
  const seen = [];
  for (let i = 0; i < 8; i++) { await sleep(110); seen.push(await ev(`document.getElementById('carpage').contentDocument.querySelector('[data-turn="1"]')?.className`)); if (i === 0) await shot('signal'); }
  const geo = await ev(`(() => { const d = document.getElementById('carpage').contentDocument, c = r => [(r.left + r.right) / 2, (r.top + r.bottom) / 2, r.width];
    const own = [...d.querySelectorAll('#os-lamps .lp')], arrow = s => c(d.querySelector('[data-turn="' + s + '"]').getBoundingClientRect());
    // the page's own turnL / turnR telltales: the lamp groups nearest each arrow
    const near = p => own.map(g => c(g.getBoundingClientRect())).sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))[0];
    const L = arrow(1), R = arrow(-1);
    return { left: { arrow: L.map(v => +v.toFixed(1)), telltale: near(L).map(v => +v.toFixed(1)) }, right: { arrow: R.map(v => +v.toFixed(1)), telltale: near(R).map(v => +v.toFixed(1)) } }; })()`);
  return { classes: seen, geo };
};
