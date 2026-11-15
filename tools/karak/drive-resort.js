// the Genting Highlands resort and Gohtong Jaya (OSM's footprints and storeys, on the land): walls in window bays as
// the towns', flat roofs; First World's in its bands of colour. None where a road runs
{
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = c.height = 64;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#56616c'; g.fillRect(9, 14, 46, 34);
  const windows = Object.assign(new THREE.CanvasTexture(c), { colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  const parts = [], col = new THREE.Color(), tint = (geo, color) => { col.setHex(color); geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: geo.attributes.position.count }, () => [col.r, col.g, col.b]).flat(), 3)); parts.push(geo); };
  const WALLS = [0xd8cfc0, 0xc9c2b6, 0xe6e1d8, 0xb9a48c, 0xa7aeb5, 0xcfd6db, 0x9c8f80], GLASS = [0x9fb6c8, 0x8ea3b5, 0xbfc9d1, 0x7f95a8];
  KARAK.buildings.forEach(([foot, storeys, name], n) => {
    if (foot.some(([x, z]) => onRoad(x, z).out < 1)) return;
    const base = Math.min(...foot.map(([x, z]) => karakLand(x, z) ?? terrainAt(x, z))) - 1.5, top = base + 1.5 + storeys * 3.5;
    const cx = foot.reduce((a, p) => a + p[0], 0) / foot.length, cz = foot.reduce((a, p) => a + p[1], 0) / foot.length;
    const BANDS = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71, 0xe67e22, 0x9b59b6], first = /First World/i.test(name), grand = /Genting Grand|Highlands Hotel|Resort|RW /i.test(name);
    const color = first ? 0 : grand ? 0xf0ece4 : (storeys > 8 ? GLASS : WALLS)[n % (storeys > 8 ? GLASS.length : WALLS.length)];
    let u = 0;
    foot.forEach(([ax, az], k) => {
      let [bx, bz] = foot[(k + 1) % foot.length], [px, pz] = [ax, az];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) return;
      if (-(bz - az) * ((ax + bx) / 2 - cx) + (bx - ax) * ((az + bz) / 2 - cz) < 0) [px, pz, bx, bz] = [bx, bz, ax, az]; // (faces out)
      const wall = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([px, base, pz, bx, base, bz, bx, top, bz, px, top, pz], 3))
        .setAttribute('uv', new THREE.Float32BufferAttribute([u / 4, 0, (u + len) / 4, 0, (u + len) / 4, (top - base) / 3.5, u / 4, (top - base) / 3.5], 2));
      wall.setIndex([0, 1, 2, 0, 2, 3]);
      wall.computeVertexNormals();
      tint(wall, first ? BANDS[k % BANDS.length] : color);
      solid(ax, az, bx, bz, 0, base, top);
      u += len;
    });
    const roof = new THREE.ShapeGeometry(new THREE.Shape(foot.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2).translate(0, top, 0);
    for (let v = 0; v < roof.attributes.uv.count; v++) roof.attributes.uv.setXY(v, 0.05, 0.05);
    tint(roof, first ? 0xd9d6cf : 0x8d8a85);
  });
  scene.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ map: windows, vertexColors: true })));
}
