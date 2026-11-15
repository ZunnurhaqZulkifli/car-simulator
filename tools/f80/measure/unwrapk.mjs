// node unwrapk.mjs in.ppm out.ppm cx cy K a0 a1 da r0 r1 dr - polar unwrap in design space (photo y squashed by K about cy):
// x = angle clockwise from up, y = radius (outer at top)
import fs from 'fs'; import { ppm } from './lib.mjs';
const [,, f, out, cx, cy, K, a0, a1, da, r0, r1, dr] = process.argv.map((v,i)=> i>3 ? +v : v);
const P = ppm(f), cols = Math.round((a1-a0)/da)+1, rows = Math.round((r1-r0)/dr)+1, o = Buffer.alloc(cols*rows*3);
for (let j=0;j<rows;j++){ const r = r1 - j*dr; for (let i=0;i<cols;i++){ const a = (a0 + i*da)*Math.PI/180, x = cx + r*Math.sin(a), y = cy - r*Math.cos(a)*K;
  for (let c=0;c<3;c++) o[(j*cols+i)*3+c] = Math.round(P.bil(x, y, c)); } }
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${cols} ${rows}\n255\n`), o]));
