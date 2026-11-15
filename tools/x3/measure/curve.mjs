// the left (speedo) bracket outline as one arc-length curve, photo px: bottom run y 644.1 from the joint (683) to the
// fillet, the merged symmetric trace, then the top run out to its end (688, 391.1). The tach is its mirror about x 792.
import { readFileSync } from 'node:fs';
export function bracket(outlineJson, speedoTrace) {
  const o = JSON.parse(readFileSync(outlineJson)).outline.slice(1, -2);
  const raw = JSON.parse(readFileSync(speedoTrace)).map(p => [p[1], p[2]]).filter(p => p[1] < 420 && p[0] > o.at(-1)[0] + 3).sort((a, b) => a[0] - b[0]);
  const top = []; for (let x = Math.ceil(o.at(-1)[0] + 4); x <= 688; x += 4) { const near = raw.filter(p => Math.abs(p[0] - x) < 3); if (near.length) top.push([x, near.reduce((s, p) => s + p[1], 0) / near.length]); }
  const pts = [[683, 644.1], [600, 644.1], [o[0][0] + 3, 644.1], ...o, ...top, [688, 391.1]];
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = s => { s = Math.max(0, Math.min(L.at(-1), s)); let i = 0; while (i < L.length - 2 && L[i + 1] < s) i++; const t = (s - L[i]) / (L[i + 1] - L[i]);
    const p = [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
    const a = Math.max(0, i - 1), b = Math.min(pts.length - 1, i + 2), dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], n = Math.hypot(dx, dy);
    return { p, t: [dx / n, dy / n], n: [-dy / n, dx / n] }; }; // walking from the bottom joint, inward normal = (-ty, tx)
  const near = q => { let best = null; for (let s = 0; s <= L.at(-1); s += 0.25) { const d = Math.hypot(at(s).p[0] - q[0], at(s).p[1] - q[1]); if (!best || d < best.d) best = { s, d }; } return best; };
  return { pts, len: L.at(-1), at, near };
}
