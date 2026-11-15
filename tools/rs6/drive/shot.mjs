// node shot.mjs <car> <outPrefix> [replacements.json]  - in-car screenshots of drive.html, saves + pad relay stubbed
import os from 'node:os'; const require_os_tmp = os.tmpdir() + '/chrome-'; // (each run's own Chrome profile)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WebSocket = createRequire('/Users/zunnur/Development/projects/sim-app/')('ws');

const [car, out, repl, evalFile] = process.argv.slice(2);
const OVR = (process.env.OVR || '').split(';').filter(Boolean).map(x => x.split('='));
const swaps = repl ? JSON.parse(fs.readFileSync(repl, 'utf8')) : [];
const port = 9300 + Math.floor(Math.random() * 500);
const dir = fs.mkdtempSync(require_os_tmp);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--use-angle=metal', '--enable-gpu',
  '--window-size=1512,982', '--force-device-scale-factor=1', '--mute-audio', '--no-first-run',
  '--disable-features=LocalNetworkAccessChecks', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', async raw => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'log') console.log('console.' + m.params.type, m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Fetch.requestPaused') {
    const o = OVR.find(([u]) => m.params.request.url.includes(u));
    if (o) return send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: o[1].endsWith('.html') ? 'text/html' : 'model/gltf-binary' }], body: fs.readFileSync(o[1]).toString('base64') });
    if (!m.params.request.url.includes('drive.html')) return send('Fetch.continueRequest', { requestId: m.params.requestId });
    const b = await send('Fetch.getResponseBody', { requestId: m.params.requestId });
    let body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body;
    for (const [a, z] of swaps) { if (!body.includes(a)) console.log('SWAP MISSING:', a.slice(0, 80)); body = body.replace(a, z); }
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(body).toString('base64') });
  }
});
await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const f = window.fetch; window.fetch = (u, o) => (o && o.method && o.method !== 'GET') ? Promise.resolve(new Response('{}', { status: 200 })) : f(u, o);
  navigator.sendBeacon = () => true;
  const W = window.WebSocket; window.WebSocket = function (u, p) { if (String(u).includes(':8765')) return { readyState: 3, send() {}, close() {}, addEventListener() {} }; return new W(u, p); };
` });
if (swaps.length || OVR.length) await send('Fetch.enable', { patterns: [{ urlPattern: '*drive.html*', requestStage: 'Response' }, ...OVR.map(([u]) => ({ urlPattern: '*' + u + '*', requestStage: 'Request' }))] });
await send('Page.navigate', { url: `http://sim-app.test/drive.html?car=${car}&test_drive=1` });
await sleep(14000);
if (evalFile) { const r = await send('Runtime.evaluate', { expression: fs.readFileSync(evalFile, 'utf8'), returnByValue: true, awaitPromise: true }); const val = r.result?.value ?? r; for (const [k, d] of Object.entries(val.imgs || {})) fs.writeFileSync(`${out}-${k}.png`, Buffer.from(d.split(',')[1], 'base64')); delete val.imgs; console.log(JSON.stringify(val)); }
const key = async (code, type) => send('Input.dispatchKeyEvent', { type, code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(3) });
const shot = async name => fs.writeFileSync(`${out}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
await shot('chase');
await key('KeyC', 'keyDown'); await key('KeyC', 'keyUp');
await sleep(2500);
await shot('incar');
await key('KeyA', 'keyDown');
await sleep(1200);
await shot('turned');
await key('KeyA', 'keyUp');
if (process.env.DOWN) { await sleep(800); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 80 }); await sleep(600); await shot('down'); await key('KeyA', 'keyDown'); await sleep(1500); await shot('downturned'); }
chrome.kill();
await sleep(500); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
