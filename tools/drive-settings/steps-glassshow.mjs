// the clear windows painted solid green (the lenses and mirror glass left as they are), from behind and the front
export default async ({ ev, sleep, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  await ev(`__ev("Object.assign(windowGlass, { opacity: 1, transparent: false, depthWrite: true, needsUpdate: true }); windowGlass.color.setHex(0x00ff00); windowGlass.specularColor.setScalar(0); setCam('dist', 5); setCam('height', 2.2)")`);
  await sleep(1500); await shot('rear');
  await ev(`__ev("orbitYaw = Math.PI * 0.8")`); await sleep(1500); await shot('front');
};
