// Headless probe for a car page, nothing saved anywhere: builds a file:// copy of the page the way CarSimController@raw
// serves it (window.__CAR_STATE__ + the shared public/js scripts), with window.fetch stubbed so every POST lands in
// window.__posts instead of the database. Drives it over CDP with a steps module and records the audio if asked.
//
// usage: node tools/lamps/g4/harness.mjs <page.html> <out dir> <steps.mjs> [js dir (default public/js)]
//   window.__warm = true (from a step): the engine reads warm (car-tune's coolant pinned at 90 C)
//   steps.mjs: export default async ({ run, key, hold, wait, shot, shotEl, rec, until, log }) => { ... }
//     run(expr)            - evaluate in the page, returns the value
//     key(k, down = true)  - a keydown (or keyup) on document.body, as drive.html forwards them
//     hold(k, ms)          - down, wait, up
//     shot(name)           - PNG of the viewport into the out dir; shotEl(name, sel, scale) - PNG of one element
//     rec.start() / rec.stop(name) - capture everything going to the AudioContext's destination into <out>/<name>.wav
// The page gets a probe hook: window.__tap = { tick: last CarDyno.tick args } (CarDyno.tick wrapped).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [page, out, stepsFile, jsDir = `${root}/public/js`] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PORT = 20000 + Math.floor(Math.random()*20000); // several agents probe at once
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STATE = { slug: 'zz-probe', name: 'Probe', nickname: null, odometer: null, fuelLevel: null, wearPct: null, engineMap: 1, engineMix: null,
  service: {}, serviceWear: {}, faultCodes: [], layout: {}, tune: null, handling: null, csrfToken: 'x', page: 'probe' };
const PRE = `<script>window.__CAR_STATE__ = ${JSON.stringify(STATE)};
window.__posts = [];
{ const real = window.fetch.bind(window);
  window.fetch = (u, o = {}) => { if((o.method || 'GET') !== 'GET'){ window.__posts.push({ u: String(u), body: o.body }); return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    return real(u, o).catch(() => new Response('[]', { status: 200 })); }; }
// nor a beacon, nor the phone-pad relay (a live relay would hand the probe the user's pad)
navigator.sendBeacon = (u, body) => { window.__posts.push({ u: String(u), body, beacon: true }); return true; };
{ const WS = window.WebSocket; window.WebSocket = function (u, p) { if (/:8765/.test(String(u))) return { readyState: 3, send() {}, close() {}, addEventListener() {} }; return new WS(u, p); }; }
</script>
<script>
// audio tap: everything connected to a destination is also fed to one ScriptProcessor recorder
(() => {
  const conn = AudioNode.prototype.connect;
  let rec = null, chunks = null;
  AudioNode.prototype.connect = function (dest, ...a) {
    const r = conn.call(this, dest, ...a);
    if (dest instanceof AudioDestinationNode) {
      const ctx = dest.context;
      if (!rec || rec.context !== ctx) { rec = ctx.createScriptProcessor(4096, 2, 2); rec.onaudioprocess = e => { if (chunks) chunks.push([0, 1].map(c => new Float32Array(e.inputBuffer.getChannelData(c)))); }; conn.call(rec, ctx.destination); }
      conn.call(this, rec);
    }
    return r;
  };
  window.__rec = { start: () => { chunks = []; }, stop: () => { const c = chunks || []; chunks = null; const n = c.reduce((s, x) => s + x[0].length, 0);
    const pcm = new Int16Array(n*2); let i = 0; for (const [l, r] of c) for (let j = 0; j < l.length; j++) { pcm[i++] = Math.max(-1, Math.min(1, l[j]))*32767; pcm[i++] = Math.max(-1, Math.min(1, r[j]))*32767; }
    let s = ''; const b = new Uint8Array(pcm.buffer); for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000));
    return { sr: rec ? rec.context.sampleRate : 48000, b64: btoa(s) }; } };
})();
</script>`;
const scripts = ['car-api.js', 'car-service.js', 'car-diagnostics.js', 'car-dyno.js', 'car-perf.js', 'car-tune.js', 'car-handling.js', 'car-history.js', 'car-mixer.js', 'car-layout.js'];
const POST = `<script>window.__tap = {}; { const t = CarDyno.tick; CarDyno.tick = a => { window.__tap.tick = a; return t.call(CarDyno, a); }; }
// window.__warm = true: car-tune's cooling model reads 90 C, so a probe needn't warm the engine up for minutes
if (window.CarTune) { const t = CarTune.tick; CarTune.tick = i => { const r = t.call(CarTune, i); if (window.__warm) r.coolant = 90; return r; }; }</script>`;
let html = readFileSync(page, 'utf8');
html = html.replace('</head>', PRE + scripts.map(f => `<script src="${pathToFileURL(`${jsDir}/${f}`)}"></script>`).join('\n') + '</head>');
html = html.replace(/<\/body>/, POST + '</body>');
const tmp = `${out}/_page.html`;
writeFileSync(tmp, html);

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=' + PORT + '', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files',
    `--user-data-dir=${out}/_prof`, 'about:blank']);
process.on('exit', () => chrome.kill());
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) { await sleep(150); try { wsUrl = (await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()).find(x => x.type === 'page').webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(wsUrl);
await new Promise(r => sock.onopen = r);
let id = 0;
const pend = {}, errors = [];
sock.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) pend[d.id](d.result ?? { error: d.error }), delete pend[d.id];
  if (d.method === 'Runtime.consoleAPICalled' && /error|assert/.test(d.params.type)) errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
const key = (k, down = true) => run(`document.body.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { key: ${JSON.stringify(k)}, bubbles: true }))`);
const hold = async (k, ms) => { await key(k); await sleep(ms); await key(k, false); };
// shot(name, sel): only the element's box (the cluster), at 2x so the lamps are legible
const shot = async (name, sel) => { const clip = sel && await run(`(r => r && { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 })(document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect())`);
  writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })).data, 'base64')); };
// shotEl(name, sel, scale): PNG of one element (the cluster), scaled up for lamp detail
const shotEl = async (name, sel = '.cluster', scale = 2) => { const r = await run(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
  writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale } })).data, 'base64')); };
const until = async (expr, ms = 20000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(50)) if (await run(expr)) return true; throw new Error(`timed out: ${expr}`); };
const wav = (name, { sr, b64 }) => { const pcm = Buffer.from(b64, 'base64'), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr*4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(`${out}/${name}.wav`, Buffer.concat([h, pcm])); };
const rec = { start: () => run('window.__rec.start()'), stop: async name => wav(name, await run('window.__rec.stop()')) };

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(tmp).href });
await until('document.readyState === "complete" && !!window.__tap', 20000);
await run('document.fonts.ready.then(() => 1)');
await sleep(400);
const steps = (await import(pathToFileURL(resolve(stepsFile)).href)).default;
try { await steps({ run, key, hold, wait: sleep, shot, shotEl, rec, until, log: (...a) => console.log(...a) }); }
catch (e) { console.log('STEP FAILED:', e.message); }
const posts = await run('window.__posts.length');
console.log(`errors: ${errors.length ? '\n  ' + [...new Set(errors)].slice(0, 12).join('\n  ') : 'none'}; posts captured (not sent): ${posts}`);
sock.close(); chrome.kill(); process.exit(errors.length ? 1 : 0);
