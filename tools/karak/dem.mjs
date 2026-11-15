// Elevation: the AWS / Mapzen terrain tiles (Terrarium PNGs, SRTM ~30 m here), fetched once into .cache/tiles and
// decoded with ImageMagick; elev(lat, lon, z) interpolates the tile at zoom z
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DIR = new URL('./.cache/tiles/', import.meta.url);
const tiles = new Map();
const tileOf = (lat, lon, z) => {
  const n = 2 ** z, x = (lon + 180) / 360 * n, r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return [x, y];
};
function get(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const png = new URL(`${z}-${x}-${y}.png`, DIR);
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(png)) {
    // (curl: Node's own fetch can't resolve the host in the sandboxed shell)
    execFileSync('curl', ['-sf', '--retry', '4', '-m', '60', '-o', png.pathname, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`]);
  }
  const raw = execFileSync('magick', [png.pathname, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 22 }), h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) h[i] = raw[i * 3] * 256 + raw[i * 3 + 1] + raw[i * 3 + 2] / 256 - 32768;
  tiles.set(key, h);
  return h;
}
// fetch every tile a list of [lat, lon] points needs up front (elev fetches any it lacks as it goes)
export function preload(points, z) {
  const need = new Set();
  for (const [lat, lon] of points) { const [x, y] = tileOf(lat, lon, z); for (const dx of [-0.6, 0, 0.6]) for (const dy of [-0.6, 0, 0.6]) need.add(`${Math.floor(x + dx / 256 * 2)}/${Math.floor(y + dy / 256 * 2)}`); }
  const list = [...need];
  for (const t of list) get(z, ...t.split('/').map(Number));
  return list.length;
}
export function elev(lat, lon, z) {
  const [fx, fy] = tileOf(lat, lon, z), px = fx * 256 - 0.5, py = fy * 256 - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), u = px - x0, v = py - y0;
  const at = (X, Y) => {
    const t = tiles.get(`${z}/${Math.floor(X / 256)}/${Math.floor(Y / 256)}`) ?? get(z, Math.floor(X / 256), Math.floor(Y / 256)); // (fetched the first time)
    return t[(Y & 255) * 256 + (X & 255)];
  };
  return at(x0, y0) * (1 - u) * (1 - v) + at(x0 + 1, y0) * u * (1 - v) + at(x0, y0 + 1) * (1 - u) * v + at(x0 + 1, y0 + 1) * u * v;
}
