// node tools/pops/analyze.mjs <clip.wav>... - pop transient peaks over the engine bed, per scenario phase.
// 5 ms energy, broadband and one-pole high-passed at 400 Hz (the crackle band; the engine bed is low-heavy). Each pop
// logged in <clip>.json (CarDyno.pop -> context time; t0 = the WAV's first sample) is looked for 0-200 ms after its
// logged time; the bed is the median of the 300 ms before it. With no logged pops (a page that never calls CarDyno.pop)
// it falls back to tools/x3/crackle.mjs's detector: frames jumping 5 dB over their running median.
// Prints per phase: pops logged, median / max peak-over-bed dB (HP400), max broadband dB, the share of pops 6+ dB up and
// the loudest pop's own 5 ms level; per clip the sample peak (the pops go straight to the destination: 0 dBFS clips).
import { readFileSync, existsSync } from 'node:fs';
import { readWav, dB } from '../f80/sound/lib.mjs';
const W = 0.005;
const frames = (x, sr) => { const n = Math.round(W*sr), E = []; for (let i = 0; i + n <= x.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += x[j]*x[j]; E.push(dB(s/n)); } return E; };
const med = a => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const q = (a, f) => a.length ? med(a).toFixed(1) : '  -';
for (const f of process.argv.slice(2)) {
  const { sr, mono } = readWav(f), a = Math.exp(-2*Math.PI*400/sr);
  let y = 0, px = 0; const hp = mono.map(x => { y = a*(y + x - px); px = x; return y; });
  const EH = frames(hp, sr), EB = frames(mono, sr), j = f.replace(/\.wav$/, '.json');
  const log = existsSync(j) ? JSON.parse(readFileSync(j, 'utf8')) : { pops: [] };
  const at = (E, k0, k1) => { let m = -200, mk = k0; for (let k = Math.max(0, k0); k < Math.min(E.length, k1); k++) if (E[k] > m) { m = E[k]; mk = k; } return [m, mk]; };
  const bed = (E, k) => med(E.slice(Math.max(0, k - 60), Math.max(1, k - 2)));
  const ev = log.pops.length ? log.pops.filter(([t]) => (t - log.t0)/W + 40 < EH.length).map(([t, size, ph]) => { const k = Math.round((t - log.t0)/W);
    const [h] = at(EH, k, k + 40), [b] = at(EB, k, k + 40); return { ph, size, h: h - bed(EH, k), b: b - bed(EB, k), abs: b, bed: bed(EB, k) }; })
    : (() => { const o = []; let last = -1e9; for (let k = 60; k < EH.length; k++) { const m = bed(EH, k + 2); if (EH[k] > m + 5 && k - last >= 5) { last = k; o.push({ ph: 'detected', h: EH[k] - m, b: EB[k] - bed(EB, k + 2), abs: EB[k], bed: bed(EB, k + 2) }); } } return o; })();
  const by = {}; for (const e of ev) (by[e.ph] ||= []).push(e);
  const bedDb = med(EB), peak = Math.max(...EB); let sp = 0; for (const x of mono) sp = Math.max(sp, Math.abs(x));
  console.log(`${f.split('/').pop()}  engine bed ${bedDb.toFixed(1)} dBFS (5 ms median), loudest 5 ms ${peak.toFixed(1)} dBFS, sample peak ${(20*Math.log10(sp)).toFixed(1)} dBFS`);
  for (const [ph, es] of Object.entries(by)) { const h = es.map(e => e.h), b = es.map(e => e.b);
    console.log(`  ${ph.padEnd(8)} pops ${String(es.length).padStart(3)}  HP400 med ${q(h).padStart(5)} max ${Math.max(...h).toFixed(1).padStart(5)} dB  broad max ${Math.max(...b).toFixed(1).padStart(5)} dB  6dB+ ${Math.round(100*h.filter(v => v >= 6).length/h.length)}%  loudest pop ${Math.max(...es.map(e => e.abs)).toFixed(1)} / bed ${med(es.map(e => e.bed)).toFixed(1)} dBFS`); }
  if (!ev.length) console.log('  no pops');
}
