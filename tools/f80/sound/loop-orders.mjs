// the F80 page's pre-rendered S55 loops, offline: renders renderS55Loop (pulled out of the page) for each kind and
// prints the mono crank-order balance after the two halves meet (rear-half delay), re order 3 - quick to iterate the
// S55_LOOPS table before a full headless run.
// usage: node loop-orders.mjs <page.html> [rpm,rpm,...] [delay ms, default the page's 0.6]
import { readFileSync } from 'node:fs';
const [pagePath, rpmArg = '2000,4000,6500', delayArg = '0.6'] = process.argv.slice(2);
const page = readFileSync(pagePath, 'utf8');
const grab = re => { const m = page.match(re); if (!m) throw new Error(`not in the page: ${re}`); return m[0]; };
const src = grab(/const LOOP_RPM[^\n]*\n/) + grab(/function seeded\(seed\)[^\n]*\n/) + grab(/const S55_LOOPS[^\n]*\n/) + grab(/function renderS55Loop[\s\S]*?\n  }\n/);
const actx = { sampleRate: 48000, createBuffer: (n, len) => { const ch = [...Array(n)].map(() => new Float32Array(len)); return { getChannelData: i => ch[i] }; } };
const { render, kinds, cycles } = new Function('actx', src + '; return { render: renderS55Loop, kinds: Object.keys(S55_LOOPS), cycles: LOOP_CYCLES };')(actx);
const ORD = [0.5, 1, 1.5, 2, 3, 4.5, 6, 7.5, 9, 10.5, 12], revs = cycles*2, d = +delayArg/1000;
// complex amplitude of order o over the loop (it holds exactly `revs` crank revolutions)
const amp = (x, o) => { const w = 2*Math.PI*o*revs/x.length; let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i]*Math.cos(w*i); im -= x[i]*Math.sin(w*i); } return [re, im]; };
for (const kind of kinds) {
  const b = render(kind), L = b.getChannelData(0), R = b.getChannelData(1), A = ORD.map(o => amp(L, o)), B = ORD.map(o => amp(R, o));
  for (const rpm of rpmArg.split(',').map(Number)) {
    const m = ORD.map((o, k) => { const ph = -2*Math.PI*o*rpm/60*d, c = Math.cos(ph), s = Math.sin(ph), [ar, ai] = A[k], [br, bi] = B[k];
      return 10*Math.log10((ar + br*c - bi*s) ** 2 + (ai + br*s + bi*c) ** 2); });
    const r3 = m[ORD.indexOf(3)];
    console.log(`${kind.padEnd(6)} ${String(rpm).padStart(5)} rpm  ` + ORD.map((o, k) => `${o}:${(m[k] - r3).toFixed(0)}`).join(' '));
  }
}
