// probe.mjs steps: where the OS7 display's own turn telltales sit in the cluster box drive.html lays out (% of its width
// / height: CARS.x3.arrows), and the size of one (% of the width: the page's .wl width)
export default async ({ ev }) => ev(`(() => {
  const d = document.getElementById('carpage').contentDocument, cl = d.querySelector('.cluster').getBoundingClientRect();
  const at = k => { const svg = d.getElementById('cl-svg'), p = svg.createSVGPoint(); [p.x, p.y] = k; const q = p.matrixTransform(svg.getScreenCTM()); return [(q.x - cl.left) / cl.width * 100, (q.y - cl.top) / cl.height * 100]; };
  const L = at([704, 431.5]), R = at([901, 434.5]), e = at([704 + 15, 431.5]);
  return { cluster: [cl.width, cl.height], left: L.map(v => +v.toFixed(2)), right: R.map(v => +v.toFixed(2)), arrows: [+L[0].toFixed(2), +R[0].toFixed(2), +((L[1] + R[1]) / 2).toFixed(2)], lampWidthPct: +(e[0] - L[0]).toFixed(3) };
})()`);
