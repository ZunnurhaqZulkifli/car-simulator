(async () => {
  const k = (code, type, key) => dispatchEvent(new KeyboardEvent(type, { code, key: key || code.replace('Key', '').toLowerCase(), bubbles: true }));
  const tap = async code => { k(code, 'keydown'); await new Promise(r => setTimeout(r, 80)); k(code, 'keyup'); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fps = async ms => { let n = 0, run = true; const f = () => { n++; if (run) requestAnimationFrame(f); }; requestAnimationFrame(f); await sleep(ms); run = false; return +(n / ms * 1000).toFixed(1); };
  const cp = document.getElementById('carpage').contentWindow.document, st = () => ({ v: +cp.getElementById('led-speed-txt').textContent, rpm: +cp.getElementById('led-rpm-txt').textContent, g: cp.getElementById('led-gear-txt').textContent });
  const out = { idleFps: await fps(2000) };
  await tap('KeyI'); await sleep(600); k('KeyS', 'keydown'); await sleep(100); await tap('KeyI'); await sleep(300); k('KeyS', 'keyup'); await sleep(3000);
  out.idle = st();
  await tap('KeyK'); await sleep(500);
  k('KeyW', 'keydown'); const t0 = performance.now(); const log = [];
  for (let i = 0; i < 25; i++) { await sleep(200); const s = st(); log.push(`${((performance.now() - t0)/1000).toFixed(1)}s ${s.g} ${s.v}km/h ${s.rpm}`); }
  out.drivingFps = await fps(1500); k('KeyW', 'keyup');
  out.pull = log.filter((_, i) => i % 3 === 0);
  k('KeyS', 'keydown'); await sleep(900);
  const imgs = {}; out.braking = st();
  return out;
})()
