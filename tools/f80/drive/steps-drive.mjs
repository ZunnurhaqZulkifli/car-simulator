// probe.mjs steps: start, D (K), a full-throttle pull with the gear / speed / rpm log, body pitch under power and
// braking, a steady turn (roll), fps. Body angles in degrees (pitch + nose down, roll + left side up)
export default async ({ tap, key, sleep, ev }) => {
  const st = () => ev(`(() => { const d = document.getElementById('carpage').contentDocument, b = window.__dbg.body.rotation; const t = id => d.getElementById(id)?.textContent; return { v: +t('led-speed-txt'), rpm: t('led-rpm-txt'), g: t('led-gear-txt'), pitch: +(b.x * 57.3).toFixed(2), roll: +(b.z * 57.3).toFixed(2) }; })()`);
  const fps = ms => ev(`new Promise(r => { let n = 0; const t0 = performance.now(), f = () => { n++; performance.now() - t0 < ${ms} ? requestAnimationFrame(f) : r(+(n / (performance.now() - t0) * 1000).toFixed(1)); }; requestAnimationFrame(f); })`);
  const out = { idleFps: await fps(2000) };
  await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(3000);
  out.idle = await st();
  await tap('KeyK'); await sleep(600);
  await key('KeyW', 'keyDown'); out.pull = []; let maxPitchAccel = 0;
  for (let i = 0; i < 24; i++) { await sleep(250); const s = await st(); maxPitchAccel = Math.min(maxPitchAccel, s.pitch); if (i % 3 === 2) out.pull.push(`${((i + 1) / 4).toFixed(2)}s ${s.g} ${s.v} km/h ${s.rpm} rpm`); }
  out.drivingFps = await fps(1500);
  await key('KeyW', 'keyUp');
  out.squatDeg = maxPitchAccel;
  await key('KeyS', 'keyDown'); let maxDive = 0; for (let i = 0; i < 8; i++) { await sleep(150); maxDive = Math.max(maxDive, (await st()).pitch); } await key('KeyS', 'keyUp');
  out.diveDeg = maxDive; out.afterBrake = await st();
  await key('KeyW', 'keyDown'); await sleep(1500); await key('KeyA', 'keyDown'); let maxRoll = 0; const turn = [];
  for (let i = 0; i < 10; i++) { await sleep(200); const s = await st(); maxRoll = Math.max(maxRoll, Math.abs(s.roll)); if (i % 3 === 0) turn.push(`${s.v} km/h roll ${s.roll}`); }
  await key('KeyA', 'keyUp'); await key('KeyW', 'keyUp');
  out.rollDeg = maxRoll; out.turn = turn;
  await key('KeyS', 'keyDown'); await sleep(3000); out.stopped = await st(); await key('KeyS', 'keyUp');
  return out;
};
