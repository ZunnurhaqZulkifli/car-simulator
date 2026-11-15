// node probe.mjs <car> <outPrefix> <steps.mjs> [swaps.json] [query]
// drive.html in headless Chrome (Metal), saves + sendBeacon + the pad relay (ws :8765) stubbed, --mute-audio, test_drive=1.
// swaps.json: [[find, replace], ...] applied to the served drive.html (the live file is never touched);
// OVR="name=file;..." serves a local file for any URL containing name (a staged GLB). steps.mjs default-exports
// async ({ key, tap, shot, ev, sleep, orbit, mouse }) => result (printed as JSON). Console warnings/errors and exceptions
// are printed and counted.
import os from 'node:os';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [car, out, stepsFile, repl, extra = ''] = process.argv.slice(2);
const OVR = (process.env.OVR || '').split(';').filter(Boolean).map(x => x.split('='));
const swaps = repl ? JSON.parse(fs.readFileSync(repl, 'utf8')) : [];
const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync(os.tmpdir() + '/chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--use-angle=metal', '--enable-gpu',
  '--window-size=1512,982', '--force-device-scale-factor=1', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--disable-features=LocalNetworkAccessChecks', 'about:blank'], { stdio: 'ignore' });
const kill = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', kill);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = async ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'log' && m.params.type !== 'info' && m.params.type !== 'debug') { const s = 'console.' + m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' '); errors.push(s); console.log(s.slice(0, 300)); }
  if (m.method === 'Runtime.exceptionThrown') { const s = 'EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); errors.push(s); console.log(s.slice(0, 400)); }
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url, o = OVR.find(([u]) => url.includes(u));
    if (m.params.request.method !== 'GET') { console.log('BLOCKED', m.params.request.method, url); return send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); }
    if (o && m.params.responseStatusCode === undefined) return send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: o[1].endsWith('.html') ? 'text/html' : 'model/gltf-binary' }], body: fs.readFileSync(o[1]).toString('base64') });
    if (!url.includes('/drive.html') || m.params.responseStatusCode === undefined) return send('Fetch.continueRequest', { requestId: m.params.requestId });
    const b = await send('Fetch.getResponseBody', { requestId: m.params.requestId });
    let body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body;
    for (const [a, z] of swaps) { if (!body.includes(a)) console.log('SWAP MISSING:', a.slice(0, 80)); body = body.replace(a, z); }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(body).toString('base64') });
  }
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const f = window.fetch; window.fetch = (u, o) => (o && o.method && o.method !== 'GET') ? Promise.resolve(new Response('{}', { status: 200 })) : f(u, o);
  navigator.sendBeacon = () => true;
  const W = window.WebSocket; window.WebSocket = function (u, p) { if (String(u).includes(':8765')) return { readyState: 3, send() {}, close() {}, addEventListener() {}, removeEventListener() {} }; return new W(u, p); };
` });
// every request through Fetch: non-GETs fail outright (belt and braces over the stubs), drive.html gets the swaps
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*drive.html*', requestStage: 'Response' }] });
await send('Page.navigate', { url: `http://sim-app.test/drive.html?car=${car}&test_drive=1${extra}` });
await sleep(+(process.env.WAIT || 14000));

const key = (code, type) => send('Input.dispatchKeyEvent', { type, code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code, windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : code === 'Space' ? 32 : 0 });
const tap = async (code, ms = 80) => { await key(code, 'keyDown'); await sleep(ms); await key(code, 'keyUp'); };
const shot = async name => fs.writeFileSync(`${out}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result?.value; };
const orbit = (dx, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 300, deltaX: dx, deltaY: dy });
const mouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).then(() => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }));
const steps = (await import(pathToFileURL(fs.realpathSync(stepsFile)).href)).default;
try { console.log(JSON.stringify(await steps({ key, tap, shot, ev, sleep, orbit, mouse }), null, 1)); }
catch (e) { console.log('STEPS FAILED', e.message); }
console.log(`errors/warnings: ${errors.length}`);
kill();
process.exit(0);
