// drive probe (tools/rs6/harness.mjs): start button + creep, 0-100 (D floored, and launch control), 100-0, top speed,
// then dumps the page's last real /state POST body to $OUT/state-body.json for the saveState validation test
import { writeFileSync } from 'node:fs';
export default async ({ run, key, hold, wait, until, log }) => {
  // speed log off CarDyno.tick, timed in page time
  await run(`window.__log = []; (function f(){ const a = window.__tap.tick; if(a) window.__log.push([performance.now(), a.speed, a.rpm, a.gearLabel]); requestAnimationFrame(f); })()`);
  const state = () => run(`JSON.stringify({ ign: window.__tap.tick?.ignition, speed: +(window.__tap.tick?.speed||0).toFixed(1), rpm: Math.round(window.__tap.tick?.rpm||0), gear: window.__tap.tick?.gearLabel, cls: document.querySelector('.cluster').className, lp: [...document.querySelectorAll('.lp.on')].length })`);
  await key('i'); await wait(60); await key('i', false); await wait(500);
  log('key on      ', await state());
  await key('i'); await wait(60); await key('i', false); await wait(1500);
  log('started (P) ', await state());
  await hold('s', 300); await wait(4000); // brake once: out of P, then creep with no pedal
  log('creep 4 s   ', await state());
  await hold('s', 2500); await wait(500);
  await run('window.__warm = true'); await wait(300);
  const t0 = await run('performance.now()');
  await key('w'); await until('window.__tap.tick.speed >= 100', 20000);
  const t1 = await run('performance.now()'); await key('w', false);
  log(`0-100 D     ${((t1 - t0)/1000).toFixed(2)} s`);
  await key('s'); const b0 = await run('performance.now()'); await until('window.__tap.tick.speed < 0.5', 20000); const b1 = await run('performance.now()'); await key('s', false);
  const dist = await run(`(() => { const L = window.__log.filter(r => r[0] >= ${b0}); let d = 0; for(let i = 1; i < L.length; i++) d += L[i][1]/3.6*(L[i][0]-L[i-1][0])/1000; return d.toFixed(1); })()`);
  log(`100-0       ${((b1 - b0)/1000).toFixed(2)} s, ${dist} m`);
  await wait(800);
  // launch control: W + S at a stop, let go of S
  await key('s'); await key('w'); await wait(1800); const l0 = await run('performance.now()'); await key('s', false);
  await until('window.__tap.tick.speed >= 100', 20000); const l1 = await run('performance.now()');
  log(`0-100 launch ${((l1 - l0)/1000).toFixed(2)} s (from releasing the brake)`);
  await until('window.__tap.tick.speed >= 200 || false', 40000).catch(() => {});
  log('0-200 at    ', ((await run('performance.now()') - l0)/1000).toFixed(1), 's', await state());
  await wait(25000);
  log('flat out    ', await state());
  await key('w', false);
  await run('window.saveCarState()'); await wait(300);
  const body = await run(`(() => { const p = window.__posts.filter(p => /\\/state/.test(p.u)); return p.length ? p[p.length-1].body : null; })()`);
  writeFileSync(process.env.OUT + '/state-body.json', body || 'null'); log('state posts', await run(`window.__posts.filter(p => /\\/state/.test(p.u)).length`), 'body bytes', (body||'').length);
};
