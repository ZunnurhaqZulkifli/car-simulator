// node textfit.mjs <run dir> <region> name:x0,y0,x1,y1 ... - ink box of bright pixels inside each box (photo px of the
// region) in the scaled photo crop and in the render, both at the render's scale; prints w, h, w/h and render/photo
// (the box must hold only the element - numerals are bright and unsaturated, so the red line / glow don't count)
import { execSync } from 'node:child_process';
import { ppm } from '../../f80/measure/lib.mjs';
const [, , dir, region, ...boxes] = process.argv;
const R = JSON.parse(execSync(`cat ${dir}/regions.json`)).find(r => r.n === region), k = R.W / R.w;
for (const f of ['photo', 'svg']) execSync(`magick ${dir}/${region}-${f}.png ${dir}/${region}-${f}.ppm`);
const P = { photo: ppm(`${dir}/${region}-photo.ppm`), svg: ppm(`${dir}/${region}-svg.ppm`) };
const box = (I, x0, y0, x1, y1) => { // threshold at half the box's max luminance, unsaturated pixels only
  let mx = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const [r, g, b] = I.px(x, y); const l = 0.3 * r + 0.59 * g + 0.11 * b; if (Math.max(r, g, b) - Math.min(r, g, b) < 0.4 * Math.max(r, g, b)) mx = Math.max(mx, l); }
  let a = [1e9, 1e9, -1, -1]; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const [r, g, b] = I.px(x, y); const l = 0.3 * r + 0.59 * g + 0.11 * b;
    if (l > mx / 2 && Math.max(r, g, b) - Math.min(r, g, b) < 0.4 * Math.max(r, g, b)) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; }
  return { w: (a[2] - a[0] + 1) / k, h: (a[3] - a[1] + 1) / k, cx: (a[0] + a[2]) / 2 / k + R.x, cy: (a[1] + a[3]) / 2 / k + R.y }; };
console.log('name        photo w x h (w/h)        render w x h (w/h)       w ratio  h ratio  centre shift');
for (const b of boxes) { const [n, v] = b.split(':'); const [x0, y0, x1, y1] = v.split(',').map(Number).map((q, i) => Math.round((q - (i % 2 ? R.y : R.x)) * k));
  const p = box(P.photo, x0, y0, x1, y1), s = box(P.svg, x0, y0, x1, y1);
  console.log(`${n.padEnd(10)} ${p.w.toFixed(1).padStart(6)} x ${p.h.toFixed(1).padStart(5)} (${(p.w / p.h).toFixed(2)})   ${s.w.toFixed(1).padStart(6)} x ${s.h.toFixed(1).padStart(5)} (${(s.w / s.h).toFixed(2)})   ${(s.w / p.w).toFixed(3)}   ${(s.h / p.h).toFixed(3)}   ${(s.cx - p.cx).toFixed(1)},${(s.cy - p.cy).toFixed(1)}`); }
