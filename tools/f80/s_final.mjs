// final smoke: ignition + start (recorded), idle, a few revs in N, D and shifts up / down with the paddles; dump the
// last /state body the page tried to post (it never left the page)
import { writeFileSync } from 'node:fs';
export default async ({ run, key, wait, rec, until, log }) => {
  const T = () => run('JSON.stringify((({rpm, speed, gearLabel}) => ({rpm: Math.round(rpm), v: +speed.toFixed(1), g: gearLabel}))(window.__tap.tick))').then(JSON.parse);
  await run('window.__warm = true');
  await rec.start();
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await wait(3000);
  await key('n'); await wait(200);
  for(let i = 0; i < 2; i++){ await key('w'); await wait(900); await key('w', false); await wait(1300); }
  log('after revs', JSON.stringify(await T()));
  await key('k'); await wait(300); await key('m'); await wait(200); // D, then S
  await key('w'); await wait(1500);
  for(let i = 0; i < 3; i++){ await key('e'); await wait(1200); log('paddle up', JSON.stringify(await T())); }
  await key('w', false); await wait(800);
  for(let i = 0; i < 2; i++){ await key('q'); await wait(600); log('paddle down', JSON.stringify(await T())); }
  await key('s'); await until('window.__tap.tick.speed < 0.5', 20000); await key('s', false);
  await rec.stop('drive');
  await wait(11000); // an autosave
  const body = await run(`(() => { const p = window.__posts.filter(p => /\\/state/.test(p.u)); return p.length ? p[p.length-1].body : null; })()`);
  writeFileSync(process.env.OUT + '/state-body.json', body || 'null');
  log('posts', await run('window.__posts.map(p => p.u).join(", ")'));
};
