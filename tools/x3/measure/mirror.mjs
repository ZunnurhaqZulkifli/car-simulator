// node mirror.mjs <left.json> <right.json> - best mirror axis x = m (and dy) mapping the right bracket onto the left;
// prints the axis and the rms point-to-curve distance (photo px), so a symmetric design can average both traces
import { readFileSync } from 'node:fs';
const A = JSON.parse(readFileSync(process.argv[2])).map(p => [p[1], p[2]]), B = JSON.parse(readFileSync(process.argv[3])).map(p => [p[1], p[2]]);
const near = (p, set) => { let b = 1e9; for (const q of set) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
let best = null;
for (let m = 780; m <= 805; m += 0.25) for (let dy = -4; dy <= 4; dy += 0.25) for (let sy of [0.98, 0.99, 1, 1.01, 1.02]) {
  const cy = 520; const M = B.map(([x, y]) => [2 * m - x, cy + (y - cy) * sy + dy]);
  const d = M.filter((_, i) => i % 3 === 0).map(p => near(p, A)).sort((a, b) => a - b); const r = Math.sqrt(d.slice(0, Math.floor(d.length * 0.9)).reduce((s, v) => s + v * v, 0) / Math.floor(d.length * 0.9));
  if (!best || r < best.r) best = { m, dy, sy, r }; }
console.log(best);
