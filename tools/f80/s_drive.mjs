// a short drive: start, D, a full-throttle pull, stop; S + Drivelogic 3 + DSC off launch; shift lights; warm idle; lit shot
export default async ({ run, key, hold, wait, shot, until, log }) => {
  const T = () => run('JSON.stringify((({rpm, speed, gearLabel, coolant, boost}) => ({rpm: Math.round(rpm), v: +speed.toFixed(1), g: gearLabel, cool: +coolant.toFixed(1), boost: +boost.toFixed(2)}))(window.__tap.tick))').then(JSON.parse);
  const leds = () => run(`[...document.querySelectorAll('#leds .led')].map(e => (e.getAttribute('class').split(' ')[1] || '-')).join('')`);
  const tft = () => run(`['tft-gear','tft-sel','tft-spd','tft-msg'].map(id => document.getElementById(id).textContent).join(' | ') + ' | flag ' + document.getElementById('tft-flag').getAttribute('opacity')`);
  await run('window.__warm = true');
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await wait(2500);
  log('idle', JSON.stringify(await T()), 'leds', await leds());
  // ---- D, full throttle from rest ----
  await key('k'); await wait(400);
  log('in D', await tft());
  await key('w');
  const t0 = Date.now(); let t100 = null, gears = new Set();
  while(Date.now() - t0 < 14000){ const s = await T(); gears.add(s.g); if(s.v >= 100 && !t100) t100 = (Date.now() - t0)/1000; if(s.v > 175) break; await wait(40); }
  const s1 = await T(); await key('w', false);
  log(`D2 pull: 0-100 ${t100?.toFixed(2)} s; at end ${JSON.stringify(s1)} gears seen ${[...gears].join(',')}`);
  await shot('d-pull');
  await key('s'); await until('window.__tap.tick.speed < 0.5', 20000); await key('s', false);
  // ---- S, Drivelogic 3, DSC off: launch control ----
  await key('m'); await wait(200);
  for(let i = 0; i < 3 && (await run(`document.querySelectorAll('#dl-seg .active')[0]?.dataset.val`)) !== '3'; i++){ await key('g'); await wait(80); }
  for(let i = 0; i < 3 && (await run(`document.getElementById('tc-btn').textContent`)) !== 'DSC OFF'; i++){ await key('t'); await wait(80); }
  log('S/DL/DSC', await run(`document.getElementById('dl-seg').querySelector('.active').dataset.val + ' ' + document.getElementById('tc-btn').textContent`), await tft());
  await key('s'); await key('w'); await wait(1600);
  log('launch armed', JSON.stringify(await T()), await tft());
  await shot('launch-armed');
  await key('s', false);
  const t1 = Date.now(); let l100 = null; const lg = [];
  while(Date.now() - t1 < 12000){ const s = await T(); if(!lg.includes(s.g)) lg.push(s.g); if(s.v >= 100 && !l100) l100 = (Date.now() - t1)/1000; if(s.v > 160) break; await wait(40); }
  await key('w', false);
  log(`launch: 0-100 ${l100?.toFixed(2)} s; gears ${lg.join(',')}; end ${JSON.stringify(await T())}`);
  await key('s'); await until('window.__tap.tick.speed < 0.5', 20000); await key('s', false);
  // ---- shift lights: S, 2nd gear, pull up to the shift point (DSC back on so it isn't the launch) ----
  await key('t'); await wait(100);
  await key('w'); let seen = [];
  const t2 = Date.now();
  while(Date.now() - t2 < 8000){ const s = await T(); const L = await leds(); if(s.g === 'S1' && s.rpm > 6400){ seen.push(`${s.rpm}:${L}`); if(seen.length === 2) await shot('shift-lights'); if(s.rpm > 7300){ await shot('shift-flash'); break; } } await wait(25); }
  await key('w', false);
  log('shift lights (rpm:fields 4.0..8.6)', seen.slice(-6).join('  '));
  await key('s'); await until('window.__tap.tick.speed < 0.5', 20000); await key('s', false);
  log('fields now (cold oil?)', await leds(), 'oil', await run(`document.getElementById('oil-readout').textContent`));
};
