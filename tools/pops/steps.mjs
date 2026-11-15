// pop scenario for tools/pops/harness.mjs, one WAV (+ pop log .json) per drive mode, named $TAG-<i>:
// start warm, D then M (manual), full throttle in 1st to $LIFT rpm, upshift ('up'), on to $LIFT in 2nd, lift and coast
// 2.5 s ('lift'), back on it to $LIFT, up to 3rd, on to $LIFT, lift and downshift twice ('down'), brake to a stop. Two
// gears of pull before each lift: the F80-style pages only crackle once the exhaust has heated up.
// MODES = '|'-separated JS expressions run before each clip (e.g. a mode button click); default: one clip as loaded.
export default async ({ run, key, hold, wait, rec, until, log }) => {
  const TAG = process.env.TAG || 'car', LIFT = +(process.env.LIFT || 5000), MODES = (process.env.MODES || '0').split('|');
  const rpm = () => run('Math.round(window.__tap.tick ? window.__tap.tick.rpm : 0)');
  const phase = p => run(`window.__phase = ${JSON.stringify(p)}`);
  const toRpm = async (r, ms = 9000) => { for (const t = Date.now(); Date.now() - t < ms; await wait(30)) if (await rpm() >= r) return true; return false; };
  await run('window.__warm = true');
  await key('i'); await wait(60); await key('i', false); await wait(300);
  await key('i'); await wait(60); await key('i', false);
  if (!await until('window.__tap.tick && window.__tap.tick.rpm > 400', 8000).catch(() => false)) {
    await key('s'); await key('i'); await wait(60); await key('i', false); await wait(300); await key('i'); await wait(60); await key('i', false);
    await until('window.__tap.tick && window.__tap.tick.rpm > 400', 8000).catch(() => log(TAG, 'no idle rpm (EV start?) - driving on')); await key('s', false);
  }
  await wait(3000);
  for (const [i, m] of MODES.entries()) {
    await run(m); await wait(600);
    await key('s'); await wait(300); await key('k'); await key('k', false); await wait(300); await key('m'); await key('m', false); await wait(800);
    await rec.start(); await phase('pull'); await key('s', false); await key('w');
    const a = await toRpm(LIFT); await phase('up'); await key('e'); await key('e', false); await wait(300);
    await phase('pull'); const b = await toRpm(LIFT); await phase('lift'); await key('w', false); await wait(2500);
    await phase('pull'); await key('w'); const c = await toRpm(LIFT); await phase('up'); await key('e'); await key('e', false); await wait(300);
    await phase('pull'); const d = await toRpm(LIFT); await phase('down'); await key('w', false); await wait(60); await key('q'); await key('q', false);
    await wait(1200); await key('q'); await key('q', false); await wait(1500);
    await rec.stop(`${TAG}-${i}`);
    log(TAG, i, m.slice(0, 60), 'reached', a, b, c, d, 'rpm', await rpm(), 'gear', await run('window.__tap.tick && window.__tap.tick.gearLabel'));
    await key('s'); await until('window.__tap.tick.speed < 0.5', 30000).catch(() => {}); await wait(400); await key('s', false);
  }
};
