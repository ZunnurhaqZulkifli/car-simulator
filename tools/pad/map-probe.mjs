// The pad's Map tab gestures and its Settings button, in headless Chrome from a copy of the relay on a spare port (never
// the real :8765), with a fake drive page: a fake world (an SVG with a green ring round the car and a green line
// pointing its way, north), one finger dragging, two pinching and twisting, a double tap back to the fit; and the header's
// Settings button sending BracketRight (lit while the telemetry says Settings is open). Shots in <out dir>: the arrow
// must sit in the ring along the line, the names upright.
// usage: node tools/pad/map-probe.mjs <out dir> [relay.mjs]   (the relay serves the pad.html beside it: ../public)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import WS from 'ws';

const [out = 'pad-map-out', relayArg] = process.argv.slice(2);
const RELAY = resolve(relayArg || new URL('../../scripts/pad-relay.mjs', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const port = await freePort(), dbg = await freePort();
assert.notEqual(port, 8765);
const bin = mkdtempSync(join(tmpdir(), 'pad-map-'));
writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 }); // (Tailscale "off": no serve, no clipboard)
let log = '';
const relay = spawn(process.execPath, [RELAY], { env: { ...process.env, PAD_PORT: port, PATH: `${bin}:${process.env.PATH}` } });
relay.stdout.on('data', d => log += d); relay.stderr.on('data', d => log += d);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${dbg}`, '--mute-audio',
  '--hide-scrollbars', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pad-map-prof-'))}`, 'about:blank']);
process.on('exit', () => { relay.kill(); chrome.kill(); });
const until = async (what, cond, ms = 5000) => { for (const end = Date.now() + ms; !await cond();) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(50); } };
await until('relay-start', () => /relay-start/.test(log));

// the fake world: 400 x 300 px at 0.1 px/m round (0, 0); the car at x -1000, z 500 = image (300, 100), heading 0 (north)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#234"/><path d="M0 150H400M200 0V300" stroke="#888" stroke-width="2"/>
  <circle cx="300" cy="100" r="14" fill="none" stroke="#0f0" stroke-width="2"/><path d="M300 100V60" stroke="#0f0" stroke-width="2"/><text x="6" y="20" fill="#fff" font-size="18">N-W corner</text></svg>`;
const WORLD = { img: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), x: 0, z: 0, s: 0.1, w: 400, h: 300,
  places: [['Northtown', 0, 400], ['Eastville', -600, 0], ['Southgate', 0, -400]], to: [['Home', 'the car park']], legend: [['Fuel', '#2ecc71']] };
if (process.env.WORLD) Object.assign(WORLD, JSON.parse(readFileSync(process.env.WORLD, 'utf8'))); // (a real overview: dumped from the drive page's mapOverview())
const CAR = { name: 'BMW M3 Competition', redline: 7200, modes: [], maps: ['Stock'], hints: {} };
let setOpen = false, heard = [];
const drive = new WS(`ws://127.0.0.1:${port}`, { origin: 'http://sim-app.test' });
drive.on('open', () => setInterval(() => drive.send(JSON.stringify({ car: CAR, tele: { g: 'D1', v: 0, r: 800, on: true, tc: 'DSC', hl: 0, beam: 100, pos: WORLD.pos ? [...WORLD.pos, 0] : [-1000, 500, 0], slot: 0, set: setOpen } })), 66));
drive.on('message', raw => {
  let m; try { m = JSON.parse(raw); } catch { return; }
  heard.push(m);
  if ('ping' in m) drive.send(JSON.stringify({ pong: m.ping }));
  if (m.mapReq) drive.send(JSON.stringify({ map: WORLD }));
});

let cdpUrl;
await until('chrome', async () => { try { cdpUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page').webSocketDebuggerUrl; } catch {} return cdpUrl; });
const cdp = new WebSocket(cdpUrl);
await new Promise(r => cdp.onopen = r);
let id = 0;
const pend = {}, errors = [];
cdp.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) pend[d.id](d.result ?? { error: d.error }), delete pend[d.id];
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; cdp.send(JSON.stringify({ id, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
const shot = async name => writeFileSync(join(out, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
// fingers: [[x, y], ...] in viewport px, moved from `from` to `to` in `steps`
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
async function gesture(from, to, steps = 10) {
  await touch('touchStart', from.slice(0, 1)); if (from.length > 1) await touch('touchStart', from);
  for (let s = 1; s <= steps; s++) await touch('touchMove', from.map(([x, y], i) => [x + (to[i][0] - x) * s / steps, y + (to[i][1] - y) * s / steps]));
  await touch('touchEnd', []);
  await sleep(100);
}
const view = () => run(`({ ...mapView })`);
let n = 0;
const ok = what => console.log(`ok ${++n} - ${what}`);

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 852, height: 393, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1200);
  await run(`$('intro').hidden = true`);

  // the Settings button: BracketRight to the drive page, lit while Settings is open there
  const b = await run(`(() => { const r = $('set-open').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.right <= innerWidth, $('car').getBoundingClientRect().width]; })()`);
  assert.ok(b[2], 'the Settings button fits the header');
  heard = [];
  await touch('touchStart', [b.slice(0, 2)]); await touch('touchEnd', []); await sleep(300);
  assert.ok(heard.some(m => m.tap?.code === 'BracketRight' && m.drive === 1), 'BracketRight sent to the drive page');
  setOpen = true; await sleep(300);
  assert.equal(await run(`$('set-open').classList.contains('on')`), true);
  await shot('header');
  setOpen = false;
  ok(`Settings button sends BracketRight and lights (car name keeps ${Math.round(b[3])} px)`);

  await run(`$('extras-open').onpointerdown(); $('extras-open').onpointerup(); pick(document.querySelector('[data-tab=map]'))`); await sleep(800);
  assert.ok(await run(`!!world && worldImg.complete`), 'the fake world came');
  assert.equal(await run(`getComputedStyle($('mapc')).touchAction`), 'none');
  const r = await run(`(() => { const r = $('mapc').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`), cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
  await shot('map-fit');

  await gesture([[cx - 40, cy], [cx + 40, cy]], [[cx - 80, cy], [cx + 80, cy]]); // spread to twice
  let v = await view();
  assert.ok(Math.abs(v.z - 2) < 0.05 && Math.abs(v.r) < 0.01, `pinch: ${JSON.stringify(v)}`);
  ok(`pinch zooms x${v.z.toFixed(2)} about the fingers' middle`);
  const a = Math.PI / 6; // a 30° twist, clockwise on screen
  await gesture([[cx - 80, cy], [cx + 80, cy]], [[cx - 80 * Math.cos(a), cy - 80 * Math.sin(a)], [cx + 80 * Math.cos(a), cy + 80 * Math.sin(a)]]);
  v = await view();
  assert.ok(Math.abs(v.r - a) < 0.02 && Math.abs(v.z - 2) < 0.05, `twist: ${JSON.stringify(v)}`);
  ok(`twist turns it ${(v.r * 180 / Math.PI).toFixed(1)}°`);
  await shot('map-turned'); // (the names upright)
  await gesture([[cx, cy]], [[cx - 60, cy + 30]]);
  const v2 = await view();
  assert.ok(Math.abs(v2.x - v.x + 60) < 1 && Math.abs(v2.y - v.y - 30) < 1, `drag: ${JSON.stringify(v2)}`);
  ok('one finger drags it');
  await shot('map-zoomed-turned');
  for (let i = 0; i < 2; i++) { await touch('touchStart', [[cx, cy]]); await touch('touchEnd', []); await sleep(120); }
  assert.deepEqual(await view(), { x: 0, y: 0, z: 1, r: 0 });
  ok('double tap: back to the whole of it, north up');
  await shot('map-reset');
  assert.deepEqual(errors, []);
  ok('no page errors');
} catch (e) { console.log('FAIL', e.message, errors); process.exitCode = 1; }
process.exit();
