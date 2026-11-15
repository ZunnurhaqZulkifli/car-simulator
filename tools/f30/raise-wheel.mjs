// node raise-wheel.mjs <in.glb> <out.glb> <raise m>
// Raises the 320d's steering wheel (its cabin_steering node) straight up by <raise> m, car space. The column shroud and
// stalks (welded pieces of cabin_85|Object_221, the black trim) stay put: raised with the wheel they cover the bottom of
// the binnacle's dial window; left, the hub hides the shroud's face instead of it showing over the hub as a plate.
// drive.html's f30 `steering.eye` keeps the driver's head where it was, so the wheel rises in the view.
// 2026-11-14: v=3 = the v=2 model raised 0.06 (v=2 was the original raised 0.1, memory/tools/wheel.mjs).
import fs from 'node:fs';
const [inp, outp, raiseArg] = process.argv.slice(2), raise = +raiseArg;
const b = fs.readFileSync(inp), jn = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jn).toString()), rest = b.subarray(20 + jn);
const mul = (a, c) => { const r = new Array(16).fill(0); for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) for (let m = 0; m < 4; m++) r[k * 4 + i] += a[m * 4 + i] * c[k * 4 + m]; return r; };
const trs = n => { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1]; };
const parent = {}; j.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parent[c] = i));
const sw = j.nodes.findIndex(n => n.name === 'cabin_steering'), node = j.nodes[sw];
if (sw < 0 || node.matrix) throw new Error('no cabin_steering node with a translation');
let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; for (let p = parent[sw]; p != null; p = parent[p]) M = mul(trs(j.nodes[p]), M);
// the world shift in the parent's frame: solve M3 x = (0, raise, 0)
const [a, b1, c, d, e, f, g, h, k] = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]], D = a * (e * k - f * h) - d * (b1 * k - c * h) + g * (b1 * f - c * e);
const inv = [e * k - f * h, -(b1 * k - c * h), b1 * f - c * e, -(d * k - f * g), a * k - c * g, -(a * f - c * d), d * h - e * g, -(a * h - b1 * g), a * e - b1 * d].map(v => v / D);
const local = [inv[3] * raise, inv[4] * raise, inv[5] * raise];
node.translation = (node.translation ?? [0, 0, 0]).map((v, i) => v + local[i]);
console.log('cabin_steering', sw, 'local shift', local.map(v => v.toFixed(4)).join(' '));
let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8); head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
fs.writeFileSync(outp, Buffer.concat([head, js, rest]));
