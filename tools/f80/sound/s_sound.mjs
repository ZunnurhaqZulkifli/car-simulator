// the F80's sound over the scenarios the reference recording has: warm idle, free revs in P, a full-throttle pull in
// S through the gears, the lift-off after it. One WAV + rpm log ("t rpm km/h gear throttle boost") per clip into $OUT.
// usage: OUT=<dir> node tools/rs6/harness.mjs <page.html> <dir> tools/f80/sound/s_sound.mjs
// Run it on a warm copy of the page (the oil takes ~2 min to free the full rev range otherwise):
//   sed 's/let coolantC = AMBIENT_C, oilC = AMBIENT_C/let coolantC = 90, oilC = 90/' bmw-m3-f80.html > <dir>/page.html
import { writeFileSync } from 'node:fs';
export default async ({ run, key, hold, wait, rec, until, log }) => {
  const OUT = process.env.OUT;
  const T = () => run('JSON.stringify((({rpm, speed, gearLabel}) => ({rpm: Math.round(rpm), v: +speed.toFixed(1), g: gearLabel}))(window.__tap.tick))').then(JSON.parse);
  // rpm log sampled every frame from the moment the recorder starts; the WAV runs ~0.1 s behind the page (the
  // recorder's ScriptProcessor buffering), so the log is shifted to match - checked with track.mjs on the clip
  const start = async () => { await rec.start(); await run(`(() => { window.__rl = []; const t0 = performance.now(); window.__rlOn = true;
    (function f(){ const t = window.__tap.tick; if(t) window.__rl.push([(performance.now() - t0)/1000 + 0.1, t.rpm, t.speed, t.gearLabel, t.throttle, t.boost]); if(window.__rlOn) requestAnimationFrame(f); })(); })()`); };
  const stop = async name => { await run('window.__rlOn = false'); await rec.stop(name);
    const rl = await run('window.__rl.map(r => r.map(v => typeof v === "number" ? +v.toFixed(3) : v).join(" ")).join("\\n")');
    writeFileSync(`${OUT}/${name}.rpm.txt`, rl + '\n'); log(name, 'logged', rl.split('\n').length, 'frames'); };
  await run('window.__warm = true');
  await key('x'); await key('x'); await wait(100); // Sport Plus: the M exhaust's flaps open
  await key(' '); await key('i'); await wait(30); await key('i', false); await key(' ', false);
  await until('window.__tap.tick && window.__tap.tick.rpm > 500', 8000);
  await wait(6000); // past the start flare
  log('idle', JSON.stringify(await T()));
  await start(); await wait(4000); await stop('idle');
  // free revs in P: three blips, then one held to the cut
  await start();
  for (const ms of [600, 800, 1000]) { await hold('w', ms); await wait(2200); }
  await key('w'); await wait(2200); await key('w', false); await wait(3000);
  await stop('revs');
  // D, a full-throttle pull from rest through the gears, then the lift
  await key('k'); await wait(400);
  await start();
  await key('w');
  for (const t = Date.now(); Date.now() - t < 11000;) { const s = await T(); if (s.v > 200) break; await wait(50); }
  log('pull end', JSON.stringify(await T()));
  await stop('pull');
  await start(); await key('w', false); await wait(3500); await stop('lift');
  await key('s'); await until('window.__tap.tick.speed < 0.5', 25000); await key('s', false);
};
