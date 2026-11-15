// tools/drive-settings/probe.mjs steps: in-car at rest and with the wheel turned (A held), plus the wheel's pivot
export default async ({ shot, sleep, tap, key, ev }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  await tap('KeyC'); await sleep(2500); await shot('incar');
  await key('KeyA', 'keyDown'); await sleep(1200); await shot('incar-turned'); await key('KeyA', 'keyUp');
  return ev(`({ eye: __dbg.EYE.toArray().map(v => +v.toFixed(3)), dash: __dbg.dashAnchor.position.toArray().map(v => +v.toFixed(3)) })`);
};
