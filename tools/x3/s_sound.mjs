// sound clips (tools/rs6/harness.mjs) for the X3 and, for comparison, the M140i page: per mode (Comfort, then Sport) a
// warm idle, three free-rev blips in P, a full-throttle pull from rest in D and the lift-off after it. One WAV + rpm log
// ("t rpm km/h gear throttle boost", for tools/f80/sound/bands.mjs / orders.mjs) per clip, named $TAG-<clip>: the WAVs land in
// the harness's out dir, the rpm logs in $OUT - give both the same dir.
import { writeFileSync } from 'node:fs';
export default async ({ run, key, hold, wait, rec, until, log }) => {
  const OUT = process.env.OUT, TAG = process.env.TAG || 'car';
  const start = async () => { await rec.start(); await run(`(() => { window.__rl = []; const t0 = performance.now(); window.__rlOn = true;
    (function f(){ const t = window.__tap.tick; if(t) window.__rl.push([(performance.now() - t0)/1000 + 0.1, t.rpm, t.speed, t.gearLabel, t.throttle, t.boost]); if(window.__rlOn) requestAnimationFrame(f); })(); })()`); };
  const stop = async name => { await run('window.__rlOn = false'); await rec.stop(`${TAG}-${name}`);
    const rl = await run('window.__rl.map(r => r.map(v => typeof v === "number" ? +v.toFixed(3) : v).join(" ")).join("\\n")');
    writeFileSync(`${OUT}/${TAG}-${name}.rpm.txt`, rl + '\n'); };
  const mode = m => run(`document.querySelector('.mode-btn[data-mode="${m}"]').click()`);
  await run('window.__warm = true');
  await key('i'); await wait(60); await key('i', false); await wait(300);
  await key('i'); await wait(60); await key('i', false); // start in P (no brake)
  await until('window.__tap.tick && window.__tap.tick.rpm > 500', 8000); await wait(5000);
  for (const m of ['comfort', 'sport']) {
    await mode(m); await wait(800);
    await start(); await wait(4000); await stop(`idle-${m}`);
    await start(); for (const ms of [500, 700, 900]) { await hold('w', ms); await wait(1800); } await stop(`blip-${m}`);
    await hold('s', 400); await key('k'); await key('k', false); await key('s'); await wait(1500); // out of P / N into D, held on the brake
    await start(); await key('s', false); await key('w'); await wait(8500); await stop(`pull-${m}`);
    log(m, 'pull end', await run('JSON.stringify([Math.round(window.__tap.tick.rpm), Math.round(window.__tap.tick.speed), window.__tap.tick.gearLabel])'));
    await start(); await wait(500); await key('w', false); await wait(6000); await stop(`lift-${m}`); // the lift happens inside the clip
    await key('s'); await until('window.__tap.tick.speed < 0.5', 30000); await wait(600);
    await key('s', false); await key('n'); await key('n', false); await wait(800); // N for the next mode's idle + blips (P is behind us)
  }
};
