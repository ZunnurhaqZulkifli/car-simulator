  // Kuantan: its corner block the home's; the state mosque (Masjid Sultan Ahmad Shah) in its own block - the prayer
  // hall under a great blue dome on a drum, four minarets
  town(X5, Z5, 19530806, [10, 18], (k, j, x0, x1, z0, z1) => {
    if (k === 0 && j === 0) return true;
    if (k !== 3 || j !== 3) return false;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    plaza(x0, x1, z0, z1, 0xd9d2c3);
    slab(76, 14, 76, 0xf3f0e8).translate(mx, 0, mz);
    fence(mx - 38, mx + 38, mz - 38, mz + 38);
    drum(26, 26, 14, 24, mx, mz, 0xf3f0e8, 32);
    piece(new THREE.SphereGeometry(27, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(mx, 24, mz), 0x2e6db4);
    piece(new THREE.CylinderGeometry(0.4, 0.8, 9, 8).translate(mx, 55, mz), 0xd9c27a);
    for (const [dx, dz] of [[-50, -50], [50, -50], [-50, 50], [50, 50]]) {
      drum(3, 2.6, 0, 62, mx + dx, mz + dz, 0xf3f0e8, 12);
      drum(3.6, 3.6, 46, 49, mx + dx, mz + dz, 0xe8e2d4, 12);
      piece(new THREE.ConeGeometry(2.8, 9, 12).translate(mx + dx, 66.5, mz + dz), 0x2e6db4);
      solid(mx + dx, mz + dz, mx + dx, mz + dz, 3);
    }
    return true;
  });
