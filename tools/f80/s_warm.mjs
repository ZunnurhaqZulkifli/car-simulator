// warm idle (coolant pinned at 90 by the harness, the oil follows), then: the lit.png state shot (D, 1st, M1, side
// lights), shift lights in S (successive yellow, red flash at the shift point), the M2 confirm
import { writeFileSync } from 'node:fs';
export default async ({ run, key, wait, shot, until, log }) => {
  const T = () => run('JSON.stringify((({rpm, speed, gearLabel}) => ({rpm: Math.round(rpm), v: +speed.toFixed(1), g: gearLabel}))(window.__tap.tick))').then(JSON.parse);
  const leds = () => run(`[...document.querySelectorAll('#leds .led')].map(e => (e.getAttribute('class').split(' ')[1] || '-')).join('')`);
  const oil = () => run(`document.getElementById('oil-readout').textContent`);
  await run('window.__warm = true');
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  for(let i = 0; i < 30; i++){ await wait(5000); const o = parseFloat((await oil()).slice(1)); if(i % 4 === 0) log('oil', o, 'fields', await leds()); if(o > 86) break; }
  log('warm: oil', await oil(), 'fields', await leds());
  // ---- shift lights: S, DSC on, pull through 1st and 2nd ----
  await key('m'); await wait(200);
  await key('w'); const seen = []; let flashShot = false, t0 = Date.now();
  while(Date.now() - t0 < 9000){
    const s = await T(), L = await leds();
    if(s.rpm > 5000 && (!seen.length || seen[seen.length-1].split(':')[1] !== L)) seen.push(`${s.g}@${s.rpm}:${L}`);
    if(s.rpm > 6600 && s.rpm < 7200 && !seen.shot1){ seen.shot1 = 1; await shot('shift-yellow'); }
    if(s.rpm >= 7360 && !flashShot){ flashShot = true; await shot('shift-flash'); await wait(70); await shot('shift-flash2'); break; }
    await wait(20);
  }
  await key('w', false);
  log('shift light sequence:', seen.join('  '));
  await key('s'); await until('window.__tap.tick.speed < 0.5', 20000); await key('s', false);
  // ---- M2 needs a second press (MDM); M1 doesn't ----
  await key('2'); await wait(100);
  log('M2 once:', await run(`document.getElementById('tft-msg').textContent + ' / active ' + document.getElementById('m2-btn').className`));
  await key('2'); await wait(100);
  log('M2 twice:', await run(`document.getElementById('tft-msg').textContent + ' / ' + document.getElementById('tc-btn').textContent + ' / ' + document.querySelector('#setup-rows .seg .active').textContent`));
  await key('1'); await wait(100);
  log('M1:', await run(`document.getElementById('tft-msg').textContent + ' / ' + document.getElementById('tc-btn').textContent`));
  // ---- the night photo's state: D, 1st, M1, side lights, standing ----
  await key('k'); await wait(100); if(await run(`document.getElementById('trans-d-btn').textContent`) === 'S') await key('m');
  await key('l'); await wait(3200);
  await run(`(() => { const s = document.createElement('style'); s.textContent = '.side-panel,.deck,.keys,.mute-fab,.dyno-toggle-btn{display:none!important} .page-layout{max-width:none!important;padding:4px!important} .rig{width:1420px!important;flex:0 0 1420px!important} body{background:#000!important}'; document.head.appendChild(s); })()`);
  await wait(900);
  writeFileSync(process.env.OUT + '/rect.json', await run(`JSON.stringify(document.getElementById('cl-svg').getBoundingClientRect())`));
  await shot('lit-state');
  log('lit state', JSON.stringify(await T()), await run(`['tft-gear','tft-sel'].map(id => document.getElementById(id).textContent).join(' ')`), 'fields', await leds());
};
