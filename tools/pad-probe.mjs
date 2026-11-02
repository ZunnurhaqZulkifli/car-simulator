// Loads a copy of public/pad.html at phone size behind a fake relay - never the real one on :8765, which would take the
// pad's 30 Hz input to the car being driven - feeds it each car's hints and telemetry, screenshots every scene, and
// logs what its buttons send and where the paddles and pedals sit.
// usage: node tools/pad-probe.mjs <pad.html> <out dir> [width height]   (default an iPhone 15 Pro, landscape)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [file, out, W = 852, H = 393] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the hints, modes and maps drive.html sends, taken from the car pages' .keys and .mode-btn
const CARS = {
  m3: { name: 'BMW M3 Competition', redline: 7200, modes: [], maps: ['Stock', 'Stage 1'], hints: { 1: 'M1 / M2', 2: 'M1 / M2', i: 'ignition / start', w: 'accelerate', s: 'brake', space: 'brake', q: 'paddles', e: 'paddles', m: 'D / M gate', k: 'D', g: 'Drivelogic', n: 'neutral', r: 'reverse', x: 'engine', c: 'chassis', v: 'steering', u: 'brake', z: 'M xDrive', y: 'M Mode', t: 'DSC', j: 'MTC', b: 'bootmod3', f: 'cruise', ',': 'cruise', '.': 'cruise', l: 'lights', h: 'lights' } },
  '320d': { name: 'BMW 320d', redline: 5000, modes: [['comfort', 'Comfort'], ['sport', 'Sport'], ['eco', 'Eco Pro']], maps: ['Stock', 'Stage 1'], hints: { 1: 'map', 2: 'map', i: 'ignition / start', w: 'accelerate', s: 'brake', space: 'brake', q: 'shift', e: 'shift', m: 'manual', k: 'D', g: 'S gearbox', n: 'neutral', r: 'reverse', f: 'cruise', ',': 'cruise', '.': 'cruise', l: 'lights', h: 'lights' } },
  e60: { name: 'BMW M5 E60', redline: 8250, modes: [], maps: [null, null], hints: { 1: 'MDrive', i: 'ignition / start', w: 'accelerate', s: 'brake', space: 'brake', q: 'shift (D   S)', e: 'shift (D   S)', m: 'D / S', k: 'D', n: 'neutral', r: 'reverse', g: 'Drivelogic', shift: 'Drivelogic', p: 'POWER', t: 'DSC', c: 'EDC', b: 'Map 1 / 2', f: 'cruise', ',': 'cruise', '.': 'cruise', l: 'lights', h: 'lights' } },
  x1: { name: 'BMW X1 xDrive20d', redline: 4800, modes: [['comfort', 'Comfort'], ['sport', 'Sport'], ['eco', 'Eco Pro']], maps: ['Stock', 'Stage 1'], hints: { 1: 'map', 2: 'map', 3: 'map', i: 'ignition / start', w: 'accelerate', s: 'brake', space: 'brake', q: 'shift', e: 'shift', m: 'manual', k: 'D', g: 'DS', n: 'neutral', r: 'reverse', z: 'xDrive', t: 'DSC', f: 'cruise', ',': 'cruise', '.': 'cruise', l: 'lights', h: 'lights' } },
};
const tele = o => ({ g: 'D3', v: 124, r: 4200, on: true, tc: 'DSC', hl: 0, beam: 100, menu: false, drift: false, pos: [0, 0, 0], muted: false, slot: 1, ...o });
// each scene: the page from scratch, a car, its telemetry, then js run on the pad (tabs picked, keys pressed)
const SCENES = [
  ['m3-drive', 'm3', tele({ g: 'M4', r: 6100, tc: 'MDM', hl: 1 }), ''],
  ['m3-setup', 'm3', tele({ g: 'M4', r: 3000 }), "pick(document.querySelector('[data-tab=setup]'))"],
  ['320d-sport', '320d', tele({ g: 'S4', v: 168, r: 4900, dm: 'sport', hl: 2 }), ''],
  ['320d-comfort', '320d', tele({ g: 'D5', v: 92, r: 1900, dm: 'comfort', muted: true }), ''],
  ['x1-eco-assist', 'x1', tele({ g: 'D6', v: 110, r: 1700, dm: 'eco', tc: 'DTC' }), "pick(document.querySelector('[data-tab=assist]'))"],
  ['x1-lights', 'x1', tele({ g: 'D6', dm: 'comfort', hl: 2, beam: 130 }), "pick(document.querySelector('[data-tab=lights]'))"],
  ['e60-drift', 'e60', tele({ g: 'S3', v: 64, r: 7000, drift: true, tc: 'DSC OFF' }), ''],
  ['e60-off', 'e60', tele({ g: 'N', v: 0, r: 0, on: false }), ''],
  ['view', '320d', tele({ dm: 'comfort' }), "pick(document.querySelector('[data-tab=view]'))"],
  ['extras-sound', 'm3', tele({}), "$('extras-open').onpointerdown(); pick(document.querySelector('[data-tab=sound]')); __feed({ mix: [['eng', 'Engine', 80], ['exh', 'Exhaust', 65], ['turbo', 'Turbo', 40], ['tyre', 'Tyres', 30], ['wind', 'Wind', 20]] })"],
  ['intro', 'm3', null, 'INTRO'],
];
// the fake relay: the pad's socket, its sends kept in __sent, and __feed for what the drive page would say
const FAKE = `(() => {
  class FakeWS { constructor() { this.readyState = 1; window.__ws = this; } send(d) { (window.__sent ??= []).push(JSON.parse(d)); } close() {} }
  FakeWS.OPEN = 1;
  window.WebSocket = FakeWS;
  window.__feed = m => window.__ws.onmessage({ data: JSON.stringify(m) });
})();`;

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9334', '--hide-scrollbars', `--user-data-dir=${process.env.TMPDIR}pad-probe-prof`, 'about:blank']);
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(150); try { wsUrl = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(x => x.type === 'page').webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(wsUrl);
await new Promise(r => sock.onopen = r);
let id = 0;
const pend = {};
sock.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) pend[d.id](d.result ?? { error: d.error }), delete pend[d.id]; };
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
const errors = [];
sock.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.method === 'Runtime.consoleAPICalled' && /error|assert/.test(d.params.type)) errors.push(d.params.args.map(a => a.value ?? a.description).join(' ')); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); });

await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
const inset = +(process.env.INSETS ?? 59); // (an iPhone's Dynamic Island and home bar, landscape; INSETS=0 for an SE)
await send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset, bottom: inset && 21, top: 0 } });
await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
const url = 'file://' + resolve(file);
for (const [name, carKey, t, js] of SCENES) {
  await send('Page.navigate', { url });
  await sleep(900);
  if (js !== 'INTRO') {
    await run(`document.getElementById('intro').hidden = true; __feed({ car: ${JSON.stringify(CARS[carKey])}, tele: ${JSON.stringify(t)} }); ${js}`).catch(e => errors.push(`${name}: ${e.message.split('\n')[0]}`));
    await sleep(600); // (the accent's .4s fade)
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
}
// where the paddles and pedals sit, and what the keys send when pressed
await send('Page.navigate', { url });
await sleep(900);
const report = await run(`(() => {
  document.getElementById('intro').hidden = true;
  __feed({ car: ${JSON.stringify(CARS['320d'])}, tele: ${JSON.stringify(tele({ dm: 'comfort' }))} });
  const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); };
  const rects = Object.fromEntries(['#up', '#down', '[data-k=b]', '[data-k=t]'].map(s => [s, box(s)]));
  const press = el => { if (!el) return 'missing'; __sent = []; el.onpointerdown({ pointerId: 1 }); el.onpointerup?.({ pointerId: 1 }); return JSON.stringify(__sent.filter(m => !('t' in m))); };
  const q = s => document.querySelector(s);
  const sends = {
    D: press(q('#ds')), R: press(q('[data-gear=R]')), left: press(q('.sig')), sport: press(q('[data-mode=sport]')), map2: press(q('[data-map="2"]')),
    cruiseSlower: press(q('[aria-label="Cruise 5 km/h slower"]')), cruise: press(q('[aria-label="Cruise control"]')), dsc: press(q('#tc')), drift: press(q('#drift')),
    lights: press(q('#lights')), beamUp: press(q('[aria-label="Headlights brighter"]')), up: press(q('#up')), down: press(q('#down')),
  };
  const tabs = [...document.querySelectorAll('main [role=tab]')].map(t => t.textContent + (t.hidden ? ' (hidden)' : '')).join(' | ');
  // a car with no set-up keys after one on its Setup tab: back to Drive
  __feed({ car: ${JSON.stringify(CARS.m3)} }); pick(q('[data-tab=setup]')); __feed({ car: ${JSON.stringify({ ...CARS['320d'], hints: { ...CARS['320d'].hints, l: 'lights ' } })} });
  const afterSwitch = q('main [aria-selected=true]').dataset.tab + (q('#tab-drive').hidden ? ' (panel hidden!)' : '');
  return { rects, sends, tabs, afterSwitch };
})()`);
console.log(JSON.stringify(report, null, 1));
console.log('page errors:', errors.length ? errors : 'none');
sock.close();
chrome.kill();
