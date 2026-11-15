// probe.mjs steps: the seat height, the model's own screen from the eye, and for each look / inset the biggest cluster that
// keeps the OS7 display clear of the dash alone and of the dash and wheel together (score-x3.js)
import fs from 'node:fs';
export default async ({ ev }) => {
  await ev('window.__SCORE = 1');
  const r = await ev(fs.readFileSync(new URL('./score-x3.js', import.meta.url), 'utf8'));
  return { seat: r.seat, screen: r.screen, cluster: r.cluster, svgInCluster: r.svgInCluster, rows: r.rows.map(x => JSON.stringify(x)) };
};
