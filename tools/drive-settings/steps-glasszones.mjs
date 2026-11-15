// where a car's clear windows are: triangle centroid heights in the front / rear 60 cm (car space), 5 cm bins
export default async ({ ev, sleep }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  return ev(`(() => {
    const { THREE, car, windowGlass, CAR } = __dbg, v = new THREE.Vector3(), c = new THREE.Vector3(), out = { front: {}, rear: {}, xmax: 0 };
    car.updateMatrixWorld(true);
    const inv = car.matrixWorld.clone().invert();
    car.traverse(o => {
      if (!o.isMesh || o.material !== windowGlass || !o.geometry.index) return;
      const pos = o.geometry.attributes.position, ix = o.geometry.index.array, m = o.matrixWorld.clone().premultiply(inv);
      for (let t = 0; t < ix.length; t += 3) {
        c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, ix[t + k]).applyMatrix4(m)); c.divideScalar(3);
        out.xmax = Math.max(out.xmax, Math.abs(c.x));
        const zone = c.z > 0 ? 'front' : 'rear', y = (Math.floor(c.y * 20) / 20).toFixed(2);
        if (Math.abs(c.z) > 1.6) out[zone][y] = (out[zone][y] || 0) + 1;
      }
    });
    return out;
  })()`);
};
