// probe.mjs steps: the seat height (hood - wheel centre, eye - hood) and, for each look / inset, the biggest cluster size
// that keeps the F80's dials clear of the model (score-f80.js) - rows nearer than ~0.7 m put the cluster in front of the rim
import fs from 'node:fs';
export default async ({ ev }) => {
  await ev('window.__SCORE = 1');
  const r = await ev(fs.readFileSync(new URL('./score-f80.js', import.meta.url), 'utf8'));
  return { seat: r.seat, rows: r.rows.map(x => JSON.stringify(x).replace(/"by":"([^"]{60})[^"]*"/, '"by":"$1…"')) };
};
