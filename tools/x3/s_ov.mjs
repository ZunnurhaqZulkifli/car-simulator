// overlay renders (tools/rs6/harness.mjs): the cluster SVG alone, viewBox cropped to each photo region so it renders big.
// OUT = out dir; FACE = comfort (key on, engine off - the reference photo's state) | sport (running, Sport) | bulbs
// REGIONS = name:x,y,w,h;... in photo px. Writes <name>.png (top-left W x H) + regions.json for tools/x3/blend.sh
import { writeFileSync } from 'node:fs';
export default async ({ run, key, wait, shot, log }) => {
  const face = process.env.FACE || 'comfort';
  const regions = (process.env.REGIONS || 'full:322,372,940,340').split(';').map(r => { const [n, v] = r.split(':'); const [x, y, w, h] = v.split(',').map(Number); return { n, x, y, w, h }; });
  await run(`(() => { const s = document.createElement('style'); s.textContent = 'body{background:#000!important} .side-panel,.deck,.keys,.mute-fab,.dyno-toggle-btn,.dyno-panel{display:none!important} #cl-svg{position:fixed!important;left:0;top:0;border-radius:0!important;z-index:99}'; document.head.appendChild(s); })()`);
  if(face === 'bulbs') await run('window.__bulbs = true');
  await key('i'); await wait(60); await key('i', false); // ignition on
  if(face === 'sport'){ // the Sport photo's state: running, still in P (started without the brake), lights on
    await wait(300); await key('i'); await wait(60); await key('i', false);
    await run(`document.querySelector('.mode-btn[data-mode="sport"]').click()`); await key('l'); await wait(60); await key('l', false); }
  await wait(face === 'bulbs' ? 1500 : 6800);
  const out = [];
  for (const r of regions) {
    const W = Math.floor(Math.min(1440, 900 * r.w / r.h)), H = Math.round(W * r.h / r.w);
    await run(`(() => { const s = document.getElementById('cl-svg'); s.setAttribute('viewBox', '${r.x} ${r.y} ${r.w} ${r.h}'); s.style.width = '${W}px'; s.style.height = '${H}px'; })()`);
    await wait(250); await shot(r.n); out.push({ ...r, W, H });
  }
  writeFileSync(process.env.OUT + '/regions.json', JSON.stringify(out));
  log(face, JSON.stringify(out.map(o => [o.n, o.W, o.H])));
};
