// recording vs synth clips, one table. Per condition and rpm band: the crank orders re order 3 at the same rpm (so the
// lines sit at the same frequencies in both - what the ear compares; idle re order 6, as the recording's mic drops the
// 37 Hz order 3), the A-weighted octave balance re the A-weighted total, the A centroid and the rasp floor (bands.mjs).
// usage: node table.mjs <rec.wav> <rec-rpm.txt> <segments.json> <synth dir> [<synth dir> ...]
//   synth dir = an s_sound.mjs output (idle / revs / pull .wav + .rpm.txt)
//   segments.json: { "idle": ["t0-t1", rpm], "coast": "t0-t1,...", "pull": "t0-t1,..." } in the recording
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [recWav, recRpm, segFile, ...dirs] = process.argv.slice(2);
const seg = JSON.parse(readFileSync(segFile, 'utf8'));
const node = (script, ...a) => execFileSync(process.execPath, [join(here, script), ...a.map(String)], { encoding: 'utf8', maxBuffer: 1 << 26 });
const nums = (line, keys) => Object.fromEntries(keys.map(k => [k, +(line.match(new RegExp(`(?:^|\\s)${k.replace('.', '\\.')}:(-?[\\d.]+)`)) || [])[1]]));
const bands = (wav, rpm, t, ...o) => { const out = node('bands.mjs', wav, rpm, t, ...o).split('\n'); if (out.length < 4) return {};
  return { ...nums(out[1], ['125', '250', '500', '1k', '2k', '4k', '8k']), ...nums(out[2], ['1.5', '4.5', '6', '7.5', '9', '12']),
    A: +out[0].match(/A (-?[\d.]+) dB/)[1], cen: +out[0].match(/centroid (\d+)/)[1], rasp: +out[3].match(/centre (\d+)/)[1], floor: +out[3].match(/A-total (-?[\d.]+)/)[1] }; };
const idleOrd = (wav, rpm, t0, t1) => { const o = {}; for (const l of node('orders.mjs', wav, rpm, t0, t1, '--max', 12, '--revs', 16, '--lock', 6, '--brief', 1).split('\n').slice(1)) { const m = l.match(/^\s*([\d.]+)\s+mono\s+(-?[\d.]+)/); if (m) o[+m[1]] = +m[2]; }
  return Object.fromEntries([1.5, 3, 4.5, 7.5, 9, 12].map(k => [k, +(o[k] - o[6]).toFixed(0)])); };
const BANDS = { coast: [[1500, 3000], [3000, 4500], [4500, 7000]], pull: [[3000, 5000], [5000, 7600]] };

const rows = [];
const run = (who, idle, coast, pull) => {
  rows.push({ who, cond: 'idle', ...bands(...idle.b), ...idleOrd(...idle.o) });
  for (const [lo, hi] of BANDS.coast) rows.push({ who, cond: `coast ${lo/1000}-${hi/1000}k`, ...bands(...coast, '--dir', 'down', '--rmin', lo, '--rmax', hi) });
  for (const [lo, hi] of BANDS.pull) rows.push({ who, cond: `pull ${lo/1000}-${hi/1000}k`, ...bands(...pull, '--dir', 'up', '--rmin', lo, '--rmax', hi) });
};
const tmp = join(dirname(recRpm), '_idle_rpm.txt'); writeFileSync(tmp, `0 ${seg.idle[1]}\n1e4 ${seg.idle[1]}\n`);
const [i0, i1] = seg.idle[0].split('-');
run('rec', { b: [recWav, tmp, seg.idle[0]], o: [recWav, tmp, i0, i1] }, [recWav, recRpm, seg.coast], [recWav, recRpm, seg.pull]);
for (const d of dirs) { const w = c => join(d, `${c}.wav`), r = c => join(d, `${c}.rpm.txt`);
  run(basename(d), { b: [w('idle'), r('idle'), '0.3-4'], o: [w('idle'), r('idle'), 0.3, 4] }, [w('revs'), r('revs'), '0-20'], [w('pull'), r('pull'), '0-12']); }
const cols = ['1.5', '4.5', '6', '7.5', '9', '12', '125', '250', '500', '1k', '2k', '4k', '8k', 'cen', 'rasp', 'floor', 'A'];
console.log('orders re order 3 at the same rpm (idle: re order 6) | A-weighted octaves re A-total | cen = A centroid Hz, rasp = noise-floor centre Hz, floor dB/Hz re A-total, A = level dBFS');
console.log(['condition'.padEnd(15), 'who'.padStart(5), ...cols.map(c => c.padStart(6))].join(''));
for (const cond of [...new Set(rows.map(r => r.cond))]) { for (const r of rows.filter(x => x.cond === cond))
  console.log([cond.padEnd(15), r.who.padStart(5), ...cols.map(c => String(r[c] === undefined || Number.isNaN(r[c]) ? '' : Math.round(r[c])).padStart(6))].join('')); console.log(''); }
