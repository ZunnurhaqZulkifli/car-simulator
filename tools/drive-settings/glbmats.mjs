// node glbmats.mjs <glb...> - each model's glass-like / see-through materials and its biggest textures (no deps)
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString()), bin = 20 + jl + 8;
  const dims = (j.images || []).map(im => {
    const v = j.bufferViews[im.bufferView], o = bin + (v.byteOffset || 0), s = b.slice(o, o + Math.min(v.byteLength, 64 * 1024));
    if (s[0] === 0x89) return [s.readUInt32BE(16), s.readUInt32BE(20)];
    for (let i = 2; i < s.length;) { const m = s[i + 1], l = s.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return [s.readUInt16BE(i + 7), s.readUInt16BE(i + 5)]; i += 2 + l; }
    return [0, 0];
  });
  const used = new Map();
  for (const m of j.meshes) for (const p of m.primitives) used.set(p.material, (used.get(p.material) || 0) + 1);
  console.log(`\n${f.split('/').pop()}: ${j.materials.length} materials, textures max ${Math.max(...dims.map(d => Math.max(...d)))} px, sizes ${[...new Set(dims.map(d => d.join('x')))].join(' ')}`);
  j.materials.forEach((m, i) => {
    const pb = m.pbrMetallicRoughness || {}, ext = Object.keys(m.extensions || {});
    if (!(m.alphaMode === 'BLEND' || /glas|window|wind|screen|transp|clear|lens/i.test(m.name) || ext.includes('KHR_materials_transmission'))) return;
    console.log(`  #${i} ${m.name} ${m.alphaMode || 'OPAQUE'} base ${JSON.stringify(pb.baseColorFactor?.map(x => +x.toFixed(2)))} met ${pb.metallicFactor} rough ${pb.roughnessFactor} tex ${pb.baseColorTexture ? 'y' : '-'} 2side ${!!m.doubleSided} ext ${ext.join(',')} trans ${m.extensions?.KHR_materials_transmission?.transmissionFactor ?? ''} prims ${used.get(i) || 0}`);
  });
}
