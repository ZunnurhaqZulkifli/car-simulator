// overlay renders: the cluster alone, big; unlit, bulb check, and lit running
import { writeFileSync } from 'node:fs';
export default async ({ run, key, wait, shot, log }) => {
  await run(`(() => { const s = document.createElement('style'); s.textContent = '.side-panel,.deck,.keys,.mute-fab,.dyno-toggle-btn{display:none!important} .page-layout{max-width:none!important;padding:4px!important} .rig{width:1420px!important;flex:0 0 1420px!important} body{background:#000!important}'; document.head.appendChild(s); })()`);
  await wait(900);
  const r = await run(`JSON.stringify(document.getElementById('cl-svg').getBoundingClientRect())`);
  writeFileSync(process.env.OUT + '/rect.json', r); log('rect', r);
  await shot('ov-unlit');
  await run('window.__bulbs = true');
  await key('i'); await wait(30); await key('i', false);
  await wait(1200);
  await shot('ov-bulbs');
  await run('window.__bulbs = false');
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await wait(4500);
  await shot('ov-lit');
};
