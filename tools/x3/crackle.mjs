// node crackle.mjs <wav>... - lift-off crackle count: 5 ms energy above 400 Hz (one-pole high-pass) that jumps JUMP (default 5) dB over
// its own 300 ms running median, events at least 25 ms apart; plus the clip's peak level re its A-free RMS
import { readWav, dB } from '../f80/sound/lib.mjs';
for (const f of process.argv.slice(2)) { const { sr, mono } = readWav(f), a = Math.exp(-2*Math.PI*400/sr);
  let y = 0, px = 0; const hp = mono.map(x => { y = a*(y + x - px); px = x; return y; });
  const W = Math.round(0.005*sr), E = []; for (let i = 0; i + W <= hp.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += hp[j]*hp[j]; E.push(dB(s/W)); }
  let n = 0, last = -1e9; const M = 60;
  for (let k = M; k < E.length; k++) { const med = E.slice(k - M, k).sort((p, q) => p - q)[M >> 1]; if (E[k] > med + (+process.env.JUMP || 5) && k - last >= 5) { n++; last = k; } }
  const rms = Math.sqrt(mono.reduce((s, x) => s + x*x, 0)/mono.length);
  console.log(f.split('/').pop().padEnd(26), 'crackles', String(n).padStart(3), ' rms', dB(rms*rms).toFixed(1), 'dBFS'); }
