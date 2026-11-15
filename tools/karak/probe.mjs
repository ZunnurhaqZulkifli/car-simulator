// node probe.mjs <drive.html (staged) | live> <out dir> [place names, comma-separated] - drive.html in headless Chrome
// (Metal, saves and the phone pad relay stubbed): every teleport place on the Genting / Kuantan run (or those named),
// a chase and an in-car shot of each, whether the car stands on a road, frame cost (uncapped fps over 1.5 s) and the
// draws and triangles of a frame; console errors and failed asserts printed as they come. ENV: CAR (x1), WAIT (ms after
// a teleport, 2500), HOUR (time of day), SKY
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WebSocket = createRequire('/Users/zunnur/Development/projects/sim-app/')('ws');

const [page, out, only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync('/Users/zunnur/Development/projects/sim-app/storage/framework/testing/probe-chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--use-angle=metal', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1512,982', '--force-device-scale-factor=1',
  '--mute-audio', '--no-first-run', '--disable-features=LocalNetworkAccessChecks', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 0;
const pending = new Map(), send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
// the page: the staged copy (or the live one), with a hook for the probe
const hook = ['renderer.setAnimationLoop(() => {', 'window.__dbg = { THREE, state, onRoad, surfaceAt, terrainAt, teleport, TELEPORTS, renderer, camera, scene, keys, solids, kBuilt: typeof kBuilt === \'object\' ? kBuilt : new Map(), run: typeof KK === \'object\' ? { KK, LP, GB, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, JR, RR, GRR, KU, KP, X5, Z5, kTo, HOMES } : {} }; renderer.setAnimationLoop(() => {'];
ws.on('message', async raw => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && /error|assert|warn/.test(m.params.type)) console.log('console.' + m.params.type, m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Fetch.requestPaused' && /karak/.test(m.params.request.url)) { // DATA=<dir>: karak.js and karak-terrain.bin from there (gen.mjs's OUT)
    const f = fs.readFileSync(`${process.env.DATA}/${/terrain/.test(m.params.request.url) ? 'karak-terrain.bin' : 'karak.js'}`);
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: /terrain/.test(m.params.request.url) ? 'application/octet-stream' : 'text/javascript' }], body: f.toString('base64') });
    return;
  }
  if (m.method === 'Fetch.requestPaused') {
    let body;
    if (page !== 'live') body = fs.readFileSync(page, 'utf8');
    else { const b = await send('Fetch.getResponseBody', { requestId: m.params.requestId }); body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body; }
    if (!body.includes(hook[0])) console.log('HOOK MISSING');
    body = body.replace(hook[0], hook[1]);
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
await send('Fetch.enable', { patterns: [{ urlPattern: '*drive.html*', requestStage: 'Response' }, ...(process.env.DATA ? [{ urlPattern: '*karak*', requestStage: 'Request' }] : [])] });
const t0 = Date.now();
await send('Page.navigate', { url: `http://sim-app.test/drive.html?car=${process.env.CAR || 'x1'}&test_drive=1${process.env.HOUR ? '&hour=' + process.env.HOUR : ''}${process.env.SKY ? '&sky=' + process.env.SKY : ''}` });
const ev = async (expr, wait = true) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: wait }); return r.result?.value ?? r.exceptionDetails?.exception?.description ?? r; };
for (let i = 0; i < 60 && !(await ev('!!window.__dbg')); i++) await sleep(500);
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await sleep(6000);
const shot = async name => fs.writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const key = async code => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(3) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.replace('Key', '').toLowerCase(), windowsVirtualKeyCode: code.charCodeAt(3) }); };
if (process.env.EVAL) console.log('eval', JSON.stringify(await ev(`(() => { const { ${'KK, LP, GB, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, JR, RR, GRR, KU, KP, X5, Z5, kTo, HOMES'} } = __dbg.run, THREE = __dbg.THREE; return ${process.env.EVAL}; })()`)));
const names = await ev(`__dbg.TELEPORTS.map(t => t[0])`);
// SPOTS: a JSON file of [name, spot expression] - evaluated in the page, with the run's roads in scope (KK, GA, kTo...)
const spots = process.env.SPOTS ? JSON.parse(fs.readFileSync(process.env.SPOTS, 'utf8')) : null;
const want = spots ? spots.map(s => s[0]) : only ? only.split(',') : names.slice(names.indexOf('Gombak toll'));
const fps = `new Promise(r => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < (+'${process.env.FPSMS || 1500}')) requestAnimationFrame(f); else r(Math.round(n / (performance.now() - t) * 1000)); }; requestAnimationFrame(f); })`;
for (const name of want) {
  const n = names.indexOf(name), at = spots?.find(s => s[0] === name)?.[1];
  if (at) { const r = await ev(`(() => { const { ${'KK, LP, GB, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, JR, RR, GRR, KU, KP, X5, Z5, kTo, HOMES'} } = __dbg.run; __dbg.teleport(${at}); return 0; })()`); if (r) console.log(name, r); }
  else if (n < 0) { console.log('no place', name); continue; }
  else await ev(`__dbg.teleport(__dbg.TELEPORTS[${n}][2]), 0`);
  await sleep(+(process.env.WAIT || 2500));
  const info = await ev(`(async () => { const s = __dbg.state, r = __dbg.onRoad(s.x, s.z, s.y), i = __dbg.renderer.info.render; const f = await ${fps};
    return { x: Math.round(s.x), y: +s.y.toFixed(1), z: Math.round(s.z), on: r.on, land: +(__dbg.terrainAt(s.x, s.z)).toFixed(1), fps: f, calls: i.calls, tris: i.triangles, tiles: __dbg.kBuilt.size,
      open: ['garage', 'shop', 'pit'].filter(id => document.getElementById(id) && !document.getElementById(id).hidden) }; })()`);
  console.log(name.padEnd(24), JSON.stringify(info));
  if (process.env.PERFSPLIT) { // the frame rate with the run's tiles hidden, then each kind of thing in them on its own
    const r = await ev(`(async () => { const out = {}, f = () => ${fps}, set = v => { for (const g of __dbg.kBuilt.values()) g.visible = v; };
      const parts = kind => { const list = []; for (const g of __dbg.kBuilt.values()) for (const c of g.children) if (kind(c)) list.push(c); return list; };
      out.all = await f(); set(false); out.noTiles = await f(); set(true);
      for (const [k, test] of Object.entries({ land: c => c.material?.vertexColors && !c.isInstancedMesh, trees: c => c.isInstancedMesh, stripes: c => !c.isInstancedMesh && !c.material?.vertexColors })) {
        const l = parts(test); l.forEach(c => c.visible = false); out['no ' + k] = await f(); out[k + ' tris'] = l.reduce((a, c) => a + (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3 * (c.count || 1), 0); l.forEach(c => c.visible = true); }
      return out; })()`);
    console.log('   split', JSON.stringify(r));
  }
  const file = name.toLowerCase().replace(/\W+/g, '-');
  if (process.env.DRIVE) { // start up, Drive, full throttle for DRIVE s (steering to hold the lane: KEEP m left of the centre line), logging
    await ev(`(async () => { const k = (code, type) => dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true })), sleep = ms => new Promise(r => setTimeout(r, ms));
      const tap = async c => { k(c, 'keydown'); await sleep(80); k(c, 'keyup'); };
      await tap('KeyI'); await sleep(600); k('KeyS', 'keydown'); await sleep(100); await tap('KeyI'); await sleep(300); k('KeyS', 'keyup'); await sleep(2500); await tap('KeyK'); await sleep(400); k('KeyW', 'keydown'); return 0; })()`);
    const t1 = Date.now();
    for (let t = 0; t < +process.env.DRIVE; t++) {
      await sleep(1000);
      const st = await ev(`(() => { const s = __dbg.state, r = __dbg.onRoad(s.x, s.z, s.y); return [Math.round(s.x), Math.round(s.y), Math.round(s.z), Math.round(s.speed * 3.6), r.on, +(s.hit || 0).toFixed(2)]; })()`);
      console.log('  ', ((Date.now() - t1) / 1000).toFixed(0) + 's', JSON.stringify(st));
      if (t === Math.floor(+process.env.DRIVE / 2)) await shot(file + '-driving');
    }
    await ev(`dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })), 0`);
  }
  await shot(file);
  await key('KeyC'); await sleep(1200); await shot(file + '-incar'); await key('KeyC'); await sleep(400);
}
if (process.env.VIEWS) { // VIEWS=<json> of [name, x, z, span m, pitch deg (90 straight down), yaw deg (0 looking +z)]: still shots
  // from above, the land round each built first (a teleport to the run's nearest sample, the car parked out of sight)
  for (const [name, x, z, span, pitch = 90, yaw = 0] of JSON.parse(fs.readFileSync(process.env.VIEWS, 'utf8'))) {
    await ev(`(() => { const { KK, LP, GB, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, JR, RR, GRR, KU, kTo } = __dbg.run; let best = [Infinity];
      for (const r of [KK, LP, GB, GH, GU, GA, TL, GD, EX1, EN1, EC, EX2, EN2, KU]) for (let i = 0; i < r.N; i += 5) { const d = Math.hypot(r.P[i].x - ${x}, r.P[i].z - ${z}); if (d < best[0]) best = [d, r, i]; }
      __dbg.teleport(kTo(best[1], Math.max(best[2], 2), 0)); return 0; })()`);
    await sleep(+(process.env.WAIT || 2500));
    const png = await ev(`(() => { const THREE = __dbg.THREE, y = __dbg.terrainAt(${x}, ${z}), p = ${pitch} * Math.PI / 180, w = ${yaw} * Math.PI / 180, cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 20000);
      const d = ${span} / 2 / Math.tan(25 * Math.PI / 180); cam.position.set(${x} - Math.sin(w) * Math.cos(p) * d, y + Math.sin(p) * d, ${z} - Math.cos(w) * Math.cos(p) * d);
      if (${pitch} >= 89) cam.up.set(Math.sin(w), 0, Math.cos(w)); cam.lookAt(${x}, y, ${z}); cam.updateMatrixWorld();
      __dbg.renderer.render(__dbg.scene, cam); return __dbg.renderer.domElement.toDataURL('image/png'); })()`);
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
    console.log('view', name);
  }
}
if (process.env.OVERVIEW) { // the overview map (and the teleport list), as they open
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Quote', key: "'" }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Quote', key: "'" });
  await sleep(1200); await shot('overview');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Quote', key: "'" }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Quote', key: "'" });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Backquote', key: '`' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Backquote', key: '`' });
  await sleep(800); await shot('teleports');
}
chrome.kill();
await sleep(500);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
