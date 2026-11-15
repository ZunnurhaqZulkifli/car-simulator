// node fetch.mjs - caches the OpenStreetMap data the route is built from (Overpass, (c) OpenStreetMap contributors,
// ODbL) and three.js for gen.mjs's road sampling, in .cache/. Elevation tiles come later, on demand (dem.mjs)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const DIR = new URL('./.cache/', import.meta.url), UA = 'sim-app-route-builder/1.0 (personal project)';
fs.mkdirSync(DIR, { recursive: true });
const QUERIES = {
  // the KL-Karak Expressway (Gombak toll to Karak), its links, and the Genting Sempah interchange
  'kk.json': 'way["highway"~"^(motorway|motorway_link)$"](3.20,101.68,3.56,102.08);out geom;',
  // the East Coast Expressway (LPT1), Karak to Kuantan
  'lpt.json': 'way["highway"~"^(motorway|motorway_link)$"]["ref"~"E8"](3.36,101.98,3.90,103.40);out geom;',
  // the Genting Highlands road up from Genting Sempah, Gohtong Jaya, and the resort's roads and buildings at the top
  'top.json': '(way["highway"~"^(secondary|tertiary|tertiary_link|unclassified|secondary_link)$"](3.340,101.760,3.435,101.810);way["building"](3.380,101.760,3.430,101.805);way["amenity"="fuel"](3.34,101.76,3.44,101.81););out geom;',
  // toll plazas, rest areas and fuel stations along the way
  'poi.json': '(node["barrier"="toll_booth"](3.20,101.68,3.90,103.40);node["highway"~"services|rest_area"](3.20,101.68,3.90,103.40);way["highway"~"services|rest_area"](3.20,101.68,3.90,103.40);node["amenity"="fuel"](3.20,101.68,3.56,102.08);way["amenity"="fuel"](3.20,101.68,3.56,102.08););out center tags;',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const [file, q] of Object.entries(QUERIES)) {
  const path = new URL(file, DIR);
  if (fs.existsSync(path) && !process.argv.includes('--fresh')) { console.log('have', file); continue; }
  for (let wait = 15000; ; wait *= 2) { // the public server is often at capacity: back off and retry
    // (curl: Node's own fetch can't resolve hosts in the sandboxed shell)
    let text = '';
    try { text = execFileSync('curl', ['-s', '-m', '240', '-A', UA, '--data-urlencode', 'data=[out:json][timeout:180];' + q, 'https://overpass-api.de/api/interpreter'], { maxBuffer: 1 << 26 }).toString(); } catch {}
    if (text.includes('"elements"')) { fs.writeFileSync(path, text); console.log('fetched', file, text.length); break; }
    if (wait > 240000) throw new Error(`${file}: ${text.slice(0, 200)}`);
    console.log(file, 'busy, retrying in', wait / 1000, 's'); await sleep(wait);
  }
}
for (const f of ['three.module.js', 'three.core.js']) {
  const path = new URL(f, DIR);
  if (!fs.existsSync(path)) execFileSync('curl', ['-sf', '-m', '60', '-o', path.pathname, `https://cdn.jsdelivr.net/npm/three@0.182.0/build/${f}`]);
}
