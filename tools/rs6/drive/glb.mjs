// GLB read/write helpers: parse, world-space positions per primitive, write back (re-padding chunks)
import fs from 'node:fs';
export function readGlb(path) {
  const buf = fs.readFileSync(path), jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString()), bl = buf.readUInt32LE(20 + jl);
  return { json, bin: Buffer.from(buf.subarray(28 + jl, 28 + jl + bl)) };
}
export function writeGlb(path, json, bin) {
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4, c)]);
  const jb = pad(Buffer.from(JSON.stringify(json)), 0x20), bb = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
  const ch = (b, t) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(t, 4); return Buffer.concat([h, b]); };
  fs.writeFileSync(path, Buffer.concat([head, ch(jb, 0x4e4f534a), ch(bb, 0x004e4942)]));
}
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
export function accessor(json, bin, i) { // a plain array of the accessor's elements
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = CT[a.componentType], n = SIZE[a.type];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT, base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Array(a.count * n);
  for (let e = 0; e < a.count; e++) for (let k = 0; k < n; k++) {
    const o = base + e * stride + k * T.BYTES_PER_ELEMENT;
    out[e * n + k] = T === Float32Array ? bin.readFloatLE(o) : T === Uint32Array ? bin.readUInt32LE(o) : T === Uint16Array ? bin.readUInt16LE(o) : T === Uint8Array ? bin.readUInt8(o) : T === Int16Array ? bin.readInt16LE(o) : bin.readInt8(o);
  }
  return out;
}
export const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) r[k * 4 + i] += a[m * 4 + i] * b[k * 4 + m]; return r; };
export const local = n => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
export const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
// every mesh node: { node, name, world matrix, prims: [{ prim, pos (world, flat), idx }] }
export function meshNodes(json, bin) {
  const out = [];
  const walk = (i, pm) => {
    const n = json.nodes[i], wm = mul(pm, local(n));
    if (n.mesh !== undefined) out.push({ node: i, name: n.name, wm, prims: json.meshes[n.mesh].primitives.map(p => {
      const raw = accessor(json, bin, p.attributes.POSITION), pos = new Array(raw.length);
      for (let v = 0; v < raw.length; v += 3) { const q = apply(wm, raw[v], raw[v + 1], raw[v + 2]); pos[v] = q[0]; pos[v + 1] = q[1]; pos[v + 2] = q[2]; }
      return { prim: p, pos, idx: p.indices !== undefined ? accessor(json, bin, p.indices) : [...Array(raw.length / 3).keys()] };
    }) });
    for (const c of n.children || []) walk(c, wm);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}
