// Real-route smoke test of a car page: opens <url> (use /car/<slug>/raw?test_drive=1 - saves held, no page token taken),
// starts the engine, screenshots it and lists every POST the page tried plus any errors. Exits 1 on an error or a POST.
// usage: node tools/rs6/live.mjs http://sim-app.test/car/audi-rs6-avant/raw?test_drive=1 out.png
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [url, png] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9337', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${mkdtempSync(`${tmpdir()}/live-`)}`, 'about:blank']);
process.on('exit', () => chrome.kill());
let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) { await sleep(150); try { wsUrl = (await (await fetch('http://127.0.0.1:9337/json')).json()).find(x => x.type === 'page').webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(wsUrl);
await new Promise(r => sock.onopen = r);
let id = 0;
const pend = {}, errors = [], posts = [];
sock.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) pend[d.id](d.result ?? { error: d.error }), delete pend[d.id];
  if (d.method === 'Network.requestWillBeSent' && d.params.request.method !== 'GET') posts.push(`${d.params.request.method} ${d.params.request.url}`);
  if (d.method === 'Runtime.consoleAPICalled' && /error|assert/.test(d.params.type)) errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === 'Network.loadingFailed' && !d.params.canceled) errors.push(`load failed: ${d.params.errorText}`);
};
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
const run = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const key = (k, down = true) => run(`document.body.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', { key: ${JSON.stringify(k)}, bubbles: true }))`);

await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(3500);
await key('s'); await key('i'); await key('i', false); await sleep(200); await key('s', false);
await sleep(4000);
console.log('title:', await run('document.title'), '| power-btn active:', await run(`document.getElementById('power-btn').classList.contains('active')`));
writeFileSync(png, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
console.log(`POSTs: ${posts.length ? posts.join(', ') : 'none'}; errors: ${errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none'}`);
sock.close(); chrome.kill(); process.exit(errors.length || posts.length ? 1 : 0);
