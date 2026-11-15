// the clear-window triangles near the front corners (car space: z > 0.9 m, |x| > 0.55): how many, and their box
export default async ({ ev, sleep }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  return ev(`(() => {
    const { THREE, car, windowGlass } = __dbg, v = new THREE.Vector3(), c = new THREE.Vector3(), b = new THREE.Box3(), list = [];
    car.updateMatrixWorld(true);
    const inv = car.matrixWorld.clone().invert();
    car.traverse(o => {
      if (!o.isMesh || o.material !== windowGlass || !o.geometry.index) return;
      const pos = o.geometry.attributes.position, ix = o.geometry.index.array, m = o.matrixWorld.clone().premultiply(inv);
      for (let t = 0; t < ix.length; t += 3) {
        c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, ix[t + k]).applyMatrix4(m)); c.divideScalar(3);
        if (c.z > 0.9 && Math.abs(c.x) > 0.55) { b.expandByPoint(c); if (list.length < 12) list.push(c.toArray().map(x => +x.toFixed(2))); }
      }
    });
    return { box: b.isEmpty() ? null : [b.min.toArray(), b.max.toArray()].map(p => p.map(x => +x.toFixed(2))), some: list, length: __dbg.CAR.length };
  })()`);
};
