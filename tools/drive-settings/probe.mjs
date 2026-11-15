// node probe.mjs <car> <outPrefix> <steps.mjs> [query]
// drive.html in headless Chrome (Metal, 2x), test_drive=1, --mute-audio, a random debugging port, killed on exit.
// Stubbed BEFORE any page script (Page.enable + addScriptToEvaluateOnNewDocument, checked in-page before steps run):
// non-GET fetch + sendBeacon, and ws://localhost:8765 (the user's live phone pad relay) - a fake socket the steps drive:
// __padSock.__open() / __msg(obj) / __close(code), what the page sent in __padSent. PAD=1: it opens by itself.
// DRIVE=<file> serves that file as drive.html (the staged copy; the live file is never touched); otherwise the live one.
// The served drive.html gains window.__ev(js) (direct eval in its module scope) and __dbg (a proxy: __dbg.state ...).
// PERF=1: vsync and the frame-rate limit off (uncapped fps = frame cost). HEADED=1: a visible window.
// steps.mjs default-exports async ({ key, tap, shot, ev, sleep, orbit, mouse, send }) => result (printed as JSON).
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [car, out, stepsFile, extra = ''] = process.argv.slice(2);
const DRIVE = process.env.DRIVE, PERF = !!process.env.PERF;
const port = 9300 + Math.floor(Math.random() * 600), dir = fs.mkdtempSync(os.tmpdir() + '/chrome-ds-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  ...(process.env.HEADED ? [] : ['--headless=new']), `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--use-angle=metal', '--enable-gpu',
  '--window-size=1512,982', '--force-device-scale-factor=2', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--disable-features=LocalNetworkAccessChecks', ...(PERF ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []), 'about:blank'], { stdio: 'ignore' });
// the Mac idle-sleeps after a minute (pmset sleep 1): every timer and page stalls till it wakes, which looked like a hung
// probe (a 40 s timer script took 16 min). Held awake while this runs
spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }).unref();
const kill = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', kill);
process.on('SIGINT', () => process.exit(1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(), errors = [];
// every CDP call times out (CDP_TIMEOUT ms, 90 s) naming itself, and the whole run (TIMEOUT s, 900): a hang reports instead of waiting forever
const send = (method, params = {}) => new Promise((r, no) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => pending.delete(i) && no(new Error(`CDP ${method} timed out: ${JSON.stringify(params).slice(0, 160)}`)), +(process.env.CDP_TIMEOUT || 90000));
});
setTimeout(() => { console.log(`RUN TIMED OUT after ${process.env.TIMEOUT || 900} s`); process.exit(2); }, (process.env.TIMEOUT || 900) * 1000).unref();
process.on('SIGTERM', () => process.exit(1));
ws.onmessage = async ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && !['log', 'info', 'debug'].includes(m.params.type)) { const s = 'console.' + m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' '); errors.push(s); if (!process.env.QUIET) console.log(s.slice(0, 300)); }
  if (m.method === 'Runtime.exceptionThrown') { const s = 'EXC ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); errors.push(s); console.log(s.slice(0, 400)); }
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url;
    if (m.params.request.method !== 'GET') { console.log('BLOCKED', m.params.request.method, url); return send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); }
    if (!/\/drive\.html/.test(url) || m.params.responseStatusCode === undefined) return send('Fetch.continueRequest', { requestId: m.params.requestId });
    let body;
    if (DRIVE) body = fs.readFileSync(DRIVE, 'utf8');
    else { const b = await send('Fetch.getResponseBody', { requestId: m.params.requestId }); body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body; }
    const anchor = 'const clock = new THREE.Clock()';
    if (!body.includes(anchor)) console.log('PROBE HOOK ANCHOR MISSING');
    body = body.replace(anchor, `window.__ev = s => eval(s); window.__dbg = new Proxy({}, { get: (_, k) => eval(String(k)) });\n${anchor}`);
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(body).toString('base64') });
  }
};
await new Promise(r => ws.readyState === 1 ? r() : ws.onopen = r);
await send('Runtime.enable');
await send('Page.enable'); // (without it addScriptToEvaluateOnNewDocument silently does nothing)
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const f = window.fetch; window.fetch = (u, o) => (o && o.method && o.method !== 'GET') ? Promise.resolve(new Response('{}', { status: 200 })) : f(u, o);
  navigator.sendBeacon = () => true;
  const W = window.WebSocket, autoOpen = ${!!process.env.PAD};
  class FakePad {
    constructor(u) { this.url = u; this.readyState = 0; window.__padSock = this; (window.__padSocks ||= []).push(this); window.__padSent ||= []; if (autoOpen) setTimeout(() => this.__open(), 30); }
    __open() { this.readyState = 1; this.onopen?.({}); }
    __msg(o) { this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
    __close(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason: '', wasClean: code === 1000 }); }
    send(s) { window.__padSent.push(s); }
    close() { this.__close(1000); }
    addEventListener() {} removeEventListener() {}
  }
  window.WebSocket = function (u, p) { if (String(u).includes(':8765')) { window.__wsStub = (window.__wsStub || 0) + 1; return new FakePad(u); } return new W(u, p); };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  if (${!!process.env.AUDIO}) { // every AudioContext's output tapped by an analyser (__taps, in each frame), A-weighted level by __lvl()
    const C = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d, ...r) {
      const res = C.call(this, d, ...r);
      if (d instanceof AudioDestinationNode) { const x = d.context; if (!x.__tap) { x.__tap = x.createAnalyser(); x.__tap.fftSize = 8192; x.__tap.smoothingTimeConstant = 0; (window.__taps ||= []).push(x); } C.call(this, x.__tap); }
      return res;
    };
    const aw = f => { const f2 = f * f, r = 12194 ** 2 * f2 * f2 / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)); return r * r * 1.585; };
    window.__acc = { a: 0, f: 0, n: 0 };
    setInterval(() => { for (const x of window.__taps || []) { const an = x.__tap, d = new Float32Array(an.frequencyBinCount), df = x.sampleRate / an.fftSize; an.getFloatFrequencyData(d);
      for (let i = 1; i < d.length; i++) { if (!(d[i] > -200)) continue; const p = 10 ** (d[i] / 10); window.__acc.f += p; window.__acc.a += p * aw(i * df); } } window.__acc.n++; }, 50);
    window.__lvl = () => { const { a, f, n } = window.__acc; window.__acc = { a: 0, f: 0, n: 0 }; return n ? [+(10 * Math.log10(a / n + 1e-20)).toFixed(1), +(10 * Math.log10(f / n + 1e-20)).toFixed(1)] : null; };
  }
})();` });
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*drive.html*', requestStage: 'Response' }] });
await send('Page.navigate', { url: `http://sim-app.test/drive.html?car=${car}&test_drive=1${extra}` });
await sleep(+(process.env.WAIT || 14000));

const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result?.value; };
// the stubs must be in before anything is measured: the page's pad socket is the fake one, and this Chrome holds no :8765 connection
const stub = await ev(`({ n: window.__wsStub || 0, fake: window.__padSock?.constructor?.name, hook: typeof window.__ev })`);
let real = '';
try { real = execSync(`lsof -nP -a -p ${chrome.pid} -iTCP:8765 2>/dev/null || true`).toString().trim(); } catch {}
if (stub.n < 1 || stub.fake !== 'FakePad' || real) { console.log('STUB CHECK FAILED - not probing', stub, real); process.exit(1); }
const key = (code, type, extraKey) => send('Input.dispatchKeyEvent', { type, code, key: extraKey ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code), windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : code === 'Space' ? 32 : 0 });
const tap = async (code, ms = 80, k) => { await key(code, 'keyDown', k); await sleep(ms); await key(code, 'keyUp', k); };
const shot = async name => fs.writeFileSync(`${out}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const orbit = (dx, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 300, deltaX: dx, deltaY: dy });
const mouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).then(() => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }));
const steps = (await import(pathToFileURL(fs.realpathSync(stepsFile)).href)).default;
try { console.log(JSON.stringify(await steps({ key, tap, shot, ev, sleep, orbit, mouse, send, car }), null, 1)); }
catch (e) { console.log('STEPS FAILED', e.message); }
console.log(`errors/warnings: ${errors.length}`);
kill();
process.exit(0);
