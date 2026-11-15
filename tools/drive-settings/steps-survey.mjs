// what see-through materials the car's model has: in the glass list or not, colour, opacity, where (car-space box)
export default async ({ ev, sleep }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  return ev(`(() => {
    const { THREE, car, plainGlass } = __dbg, seen = new Map(), v = new THREE.Vector3();
    car.updateMatrixWorld(true);
    const inv = car.matrixWorld.clone().invert();
    car.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const m = o.material;
      if (!(m.transparent || plainGlass.includes(m) || /glas|window|wind/i.test(m.name)) || m.isMeshBasicMaterial) return;
      const L = __dbg.CAR.length / 2 - 0.6, e = seen.get(m) || { name: m.name.slice(-28), type: m.type.replace('Material', ''), glass: plainGlass.includes(m), op: +m.opacity.toFixed(2), col: m.color?.getHexString(), met: m.metalness, map: !!m.map, box: new THREE.Box3(), tris: 0, front: 0, rear: 0 };
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); e.box.expandByPoint(v); if (v.z > L) e.front++; if (v.z < -L) e.rear++; }
      e.tris += n / 3;
      seen.set(m, e);
    });
    return [...seen.values()].map(e => [e.name, e.type, e.glass ? 'GLASS' : '-', 'op' + e.op, '#' + e.col, 'met' + e.met, e.map ? 'map' : '', e.tris + ' tris', 'front ' + e.front, 'rear ' + e.rear, [e.box.min, e.box.max].map(p => [p.x, p.y, p.z].map(x => +x.toFixed(2)).join(',')).join(' .. ')].join(' | '));
  })()`);
};
