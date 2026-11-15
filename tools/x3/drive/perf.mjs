// node perf.mjs <car> [swaps.json] [query]  - frame cost of one car in drive.html as the user's MBP draws it (Metal, 2x,
// 1512x982) with vsync and the frame cap off: the engine started, then 4 s in the chase view and 4 s in-car at the start,
// each a mean ms per frame with the draws and triangles WebGL drew per frame. Saves, sendBeacon and the pad relay
// (ws :8765) stubbed, non-GET requests failed, --mute-audio; OVR="name=file;..." serves a local file for any URL
// containing name (a staged GLB). Prints one JSON line. Run cars interleaved and more than once: the GPU drifts.
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [car, repl, extra = ''] = process.argv.slice(2);
const OVR = (process.env.OVR || '').split(';').filter(Boolean).map(x => x.split('='));
const swaps = repl ? JSON.parse(fs.readFileSync(repl, 'utf8')) : [];
const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync(os.tmpdir() + '/chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--use-angle=metal', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1512,982', '--force-device-scale-factor=2',
  '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-features=LocalNetworkAccessChecks', 'about:blank'], { stdio: 'ignore' });
const kill = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', kill);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = async ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) errors.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url, o = OVR.find(([u]) => url.includes(u));
    if (m.params.request.method !== 'GET') return send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
    if (o && m.params.responseStatusCode === undefined) return send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'model/gltf-binary' }], body: fs.readFileSync(o[1]).toString('base64') });
    if (!url.includes('/drive.html') || m.params.responseStatusCode === undefined) return send('Fetch.continueRequest', { requestId: m.params.requestId });
    const b = await send('Fetch.getResponseBody', { requestId: m.params.requestId });
    let body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body;
    for (const [a, z] of swaps) { if (!body.includes(a)) errors.push('SWAP MISSING ' + a.slice(0, 60)); body = body.replace(a, () => z); }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(body).toString('base64') });
  }
};
await send('Runtime.enable');
await send('Page.enable'); // (or the new-document script below never runs: no stubs)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const f = window.fetch; window.fetch = (u, o) => (o && o.method && o.method !== 'GET') ? Promise.resolve(new Response('{}', { status: 200 })) : f(u, o);
  navigator.sendBeacon = () => true;
  const W = window.WebSocket; window.WebSocket = function (u, p) { if (String(u).includes(':8765')) return { readyState: 3, send() {}, close() {}, addEventListener() {}, removeEventListener() {} }; return new W(u, p); };
  if (window === window.top) { window.__draws = { calls: 0, tris: 0 }; const P = WebGL2RenderingContext.prototype;
    for (const [name, ci, ii] of [['drawElements', 1, -1], ['drawArrays', 2, -1], ['drawElementsInstanced', 1, 4], ['drawArraysInstanced', 2, 3]]) {
      const o = P[name]; P[name] = function (...a) { __draws.calls++; if (a[0] === 4) __draws.tris += a[ci] / 3 * (ii >= 0 ? a[ii] : 1); return o.apply(this, a); }; } }
` });
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*drive.html*', requestStage: 'Response' }] });
await send('Page.navigate', { url: `http://sim-app.test/drive.html?car=${car}&test_drive=1${extra}` });
await sleep(16000);
const key = (code, type) => send('Input.dispatchKeyEvent', { type, code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code, windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 });
const tap = async code => { await key(code, 'keyDown'); await sleep(80); await key(code, 'keyUp'); };
const stubbed = await send('Runtime.evaluate', { expression: "!!window.__draws && String(window.WebSocket).includes('8765')", returnByValue: true });
if (stubbed.result?.value !== true) { console.log(JSON.stringify({ car, error: 'stubs missing - stopped' })); kill(); process.exit(1); }
const measure = ms => send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `new Promise(r => { const t0 = performance.now(), c0 = __draws.calls, k0 = __draws.tris; let n = 0, last = t0, worst = 0;
  const f = now => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < ${ms}) requestAnimationFrame(f); else r({ ms: +((now - t0) / n).toFixed(2), fps: +(n * 1000 / (now - t0)).toFixed(1), worst: Math.round(worst), draws: Math.round((__draws.calls - c0) / n), ktris: Math.round((__draws.tris - k0) / n / 1000) }); };
  requestAnimationFrame(f); })` }).then(r => r.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result?.value);
await tap('KeyI'); await sleep(600); await key('KeyS', 'keyDown'); await sleep(100); await tap('KeyI'); await sleep(400); await key('KeyS', 'keyUp'); await sleep(2500);
await measure(1000); // (warm-up)
const chase = await measure(4000);
await tap('KeyC'); await sleep(2500);
const incar = await measure(4000);
console.log(JSON.stringify({ car, chase, incar, errors: errors.length ? errors : undefined }));
kill();
process.exit(0);
