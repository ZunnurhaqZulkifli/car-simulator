// node tools/pops/run.mjs <out dir> [slug...] - runs steps.mjs on each car's live page (storage/app/public/cars, or
// DIR=resources/cars for the seed copies - the 'before' while the live pages are being edited), four
// at a time, then analyze.mjs on every clip. Clips: <out>/<slug>/<slug>-<mode index>.wav, one per entry in MODES below.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const btn = s => `document.querySelector(${JSON.stringify(s)}).click()`;
const keys = (...k) => k.map(c => `['keydown','keyup'].forEach(t => document.body.dispatchEvent(new KeyboardEvent(t, { key: '${c}', bubbles: true })))`).join(';');
const bmw = [btn('.mode-btn[data-mode=comfort]'), btn('.mode-btn[data-mode=sport]')];
const mcar = ['0', keys('x', 'x')]; // Efficient (engine_map 1), then Sport Plus
export const MODES = {
  'bmw-140i': bmw, 'bmw-x3-m40i': bmw, 'bmw-530e': bmw, 'bmw-320d': bmw, 'bmw-550d': bmw, 'bmw-550d-mk2': bmw,
  'audi-rs6-avant': [btn('#mode-seg [data-val=comfort]'), btn('#mode-seg [data-val=dynamic]')],
  'bmw-m3-f80': mcar, 'bmw-m5-cs': mcar, 'bmw-m3-touring': mcar,
  'nissan-gt-r-nismo': [btn('#trans-seg [data-val=normal]'), btn('#trans-seg [data-val=r]')],
  'bmw-m5-e60': ['0', btn('#pwr-btn')],
  'porsche-911-gt3-rs': [btn('#mode-seg [data-mode=normal]'), btn('#mode-seg [data-mode=track]')],
  // pops only on Stage 2 (downshift crackle); a manual box with no K / M: 'e' takes it from N into 1st
  'proton-iriz': [btn('#stage-2-btn') + ';' + btn('.mode-btn[data-mode=normal]') + ';' + keys('e'), btn('.mode-btn[data-mode=sport]')],
};
const LIFT = { 'bmw-m5-e60': 6500, 'porsche-911-gt3-rs': 7000 }; // lift rpm, default 5000: the NA cars crackle from 5-5.5k
const [out, ...pick] = process.argv.slice(2);
const slugs = pick.length ? pick : Object.keys(MODES);
const sh = (cmd, args, env = {}) => new Promise(r => { const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env } }); let o = '';
  p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => r(o)); });
const queue = [...slugs];
await Promise.all([0, 1, 2, 3].map(async () => { for (let s; (s = queue.shift());) {
  const o = await sh('node', ['tools/pops/harness.mjs', `${process.env.DIR || 'storage/app/public/cars'}/${s}.html`, `${out}/${s}`, 'tools/pops/steps.mjs'], { TAG: s, MODES: MODES[s].join('|'), LIFT: LIFT[s] || 5000 });
  console.log(`--- ${s}\n${o.trim()}`); } }));
for (const s of slugs) console.log((await sh('node', ['tools/pops/analyze.mjs', ...MODES[s].map((_, i) => `${out}/${s}/${s}-${i}.wav`)])).trim());
