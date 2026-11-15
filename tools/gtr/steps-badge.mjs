// node tools/drive-settings/probe.mjs gtr <out prefix> tools/gtr/steps-badge.mjs &at=home4 - in-car shots of the GT-R's
// steering wheel straight, turned left and right (state.steer held by a getter: window.__steer), and where the hub badge
// mesh ended up (in the turning steeringWheel group or not)
export default async ({ ev, sleep, tap, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  await ev(`__ev("Object.defineProperty(state, 'steer', { get: () => window.__steer ?? 0, set() {} })")`);
  await tap('KeyC'); await sleep(1500);
  const r = { badgeTurns: await ev(`__ev("(() => { let n = 0; steeringWheel.traverse(o => o.isMesh && /BadgeA/.test(o.material.name) && (n += o.geometry.index.count / 3)); return n; })()")`) };
  for (const [name, s] of [['straight', 0], ['left', 0.04], ['right', -0.04], ['straight2', 0]]) {
    await ev(`window.__steer = ${s}`); await sleep(800); await shot(name);
  }
  return r;
};
