// Headless probe of the real car pages with car-tune.js - nothing saved anywhere. Each page is built as a file:// copy the
// way CarSimController@raw serves it (window.__CAR_STATE__ + the shared public/js scripts), with fetch / sendBeacon
// stubbed (every POST lands in window.__posts) and the phone-pad relay (ws://localhost:8765) stubbed before any page
// script runs. Chrome runs headless, muted, on a random debugging port, and is killed on exit.
//
//   node tools/tune/probe.mjs <out dir> [tunes.json from dump-tunes.php] [js dir (default public/js)]
//   SHOT=<slug part> also saves PNGs of that car's Parts view at both widths
//
// Every car: loads with its saved tune (if a dump is given), renders the Tuning tab's Parts view at 1440, 380 and 390 px
// (every card's rect inside the viewport, one column on a phone, groups fold, the jump bar works), fits every part's top option and captures the page's own /state
// body (<out>/<slug>-state.json, for validate.php). The drive cars also: start, a full-throttle pull (black / blue smoke),
// worn rings on the overrun (blue), then the engine let go - 'engineblow' exactly once, the engine dead with the
// ignition still on, CarTune.blown() / ch.blown true. Exits 1 on a page error or a failed check.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [out, dumpFile, jsDir = `${root}/public/js`] = process.argv.slice(2);
if (!out) { console.log('usage: node tools/tune/probe.mjs <out dir> [tunes.json] [js dir]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saved = dumpFile ? Object.fromEntries(JSON.parse(readFileSync(dumpFile, 'utf8')).map((c) => [c.slug, c])) : {};
const DRIVE = ['bmw-140i', 'bmw-550d-mk2', 'honda-nsx-r', 'bmw-m5-e60', 'bmw-m3-f80']; // petrol turbo, diesel, NA, the E60, a DCT
const GEAR = { 'bmw-m3-f80': ['k'], 'bmw-m5-e60': ['k'], 'honda-nsx-r': ['e'] }; // into drive (the automatics go on the throttle)
const scripts = ['car-api.js', 'car-service.js', 'car-diagnostics.js', 'car-dyno.js', 'car-perf.js', 'car-tune.js', 'car-handling.js', 'car-history.js', 'car-mixer.js', 'car-layout.js'];

function build(slug, fresh) {
  const car = (!fresh && saved[slug]) || {};
  const STATE = { slug: 'zz-probe-' + slug, name: 'Probe', nickname: null, odometer: null, fuelLevel: 0.8, wearPct: 0, engineMap: car.engine_map || 1, engineMix: null,
    service: {}, serviceWear: {}, faultCodes: [], layout: {}, tune: car.tune || null, handling: null, csrfToken: 'x', page: 'probe' };
  const PRE = `<script>window.__CAR_STATE__ = ${JSON.stringify(STATE)};
window.__posts = []; window.__blows = [];
document.addEventListener('engineblow', (e) => window.__blows.push(e.detail));
{ const real = window.fetch.bind(window);
  window.fetch = (u, o = {}) => { if ((o.method || 'GET') !== 'GET') { window.__posts.push({ u: String(u), body: o.body }); return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    return real(u, o).catch(() => new Response('[]', { status: 200 })); }; }
navigator.sendBeacon = (u, body) => { window.__posts.push({ u: String(u), body, beacon: true }); return true; };
{ const WS = window.WebSocket; window.WebSocket = function (u, p) { if (/:8765/.test(String(u))) return { readyState: 3, send() {}, close() {}, addEventListener() {} }; return new WS(u, p); }; }
</script>`;
  const POST = `<script>window.__tap = {}; { const t = CarDyno.tick; CarDyno.tick = (a) => { window.__tap.tick = a; return t.call(CarDyno, a); }; }</script>`;
  let html = readFileSync(`${root}/storage/app/public/cars/${slug}.html`, 'utf8');
  html = html.replace('</head>', PRE + scripts.map((f) => `<script src="${pathToFileURL(`${jsDir}/${f}`)}"></script>`).join('\n') + '</head>').replace(/<\/body>/, POST + '</body>');
  writeFileSync(`${out}/_${slug}.html`, html);
  return pathToFileURL(`${out}/_${slug}.html`).href;
}

const port = 9400 + Math.floor(Math.random() * 500);
rmSync(`${out}/_prof`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files', `--user-data-dir=${out}/_prof`, 'about:blank']);
const kill = () => { try { chrome.kill('SIGKILL'); } catch {} };
process.on('exit', kill); ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => process.exit(1)));
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) { await sleep(150); try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page').webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(wsUrl);
await new Promise((r) => { sock.onopen = r; });
let id = 0, errors = [];
const pend = {};
sock.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d.result ?? { error: d.error }); delete pend[d.id]; }
  if (d.method === 'Runtime.consoleAPICalled' && /error|assert/.test(d.params.type)) errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { pend[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
const until = async (expr, ms = 15000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(60)) if (await run(expr)) return true; return false; };
const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
await send('Runtime.enable'); await send('Page.enable');

let fails = 0;
const ok = (c, what) => { if (!c) { fails++; console.log('    FAIL', what); } };
const pages = process.env.PAGES ? process.env.PAGES.split(',') // PAGES=slug,slug: just those (a full run takes minutes)
  : readdirSync(`${root}/storage/app/public/cars`).filter((f) => f.endsWith('.html')).map((f) => f.replace('.html', ''));
for (const slug of pages) {
  errors = [];
  await width(1440);
  await send('Page.navigate', { url: build(slug) });
  if (!(await until('document.readyState === "complete" && !!window.__tap', 20000))) { ok(false, `${slug}: never loaded`); continue; }
  await sleep(700);
  const tuned = await run('!!(window.CarTune && CarTune.on)');
  const line = [`${slug.padEnd(20)} ${tuned ? 'tuned' : 'no CarTune'}${saved[slug] && saved[slug].tune ? ', saved tune' : ''}`];
  if (tuned) {
    // the Parts view, wide and at phone width: no sideways scroll, groups fold, the jump bar scrolls to a group
    const parts = await run(`(() => { if (document.querySelector('.dyno-panel').classList.contains('dyno-collapsed')) document.getElementById('dyno-toggle-btn').click();
      CarService.selectTab('tune'); const r = CarService.sections.tune; r.querySelector('[data-view=parts]').click();
      return { cards: r.querySelectorAll('.ct-part').length, groups: r.querySelectorAll('[data-fold]').length, jump: r.querySelectorAll('[data-to]').length, shown: r.clientWidth }; })()`);
    ok(parts.cards > 30 && parts.groups >= 6 && parts.jump === parts.groups && parts.shown > 300, `${slug}: parts view ${JSON.stringify(parts)}`);
    const shot = async (name) => { if (process.env.SHOT && slug.includes(process.env.SHOT)) writeFileSync(`${out}/${slug}-${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
    // every shown card's rect inside the viewport (a panel pushed off the screen's edge passes an overflow check), one
    // column on a phone, several on a desktop; nothing clipped inside a card
    const fit = (w) => run(`(() => { const r = CarService.sections.tune, vw = document.documentElement.clientWidth;
      const cards = [...r.querySelectorAll('.ct-part')].filter((c) => c.offsetParent).map((c) => c.getBoundingClientRect());
      return { w: ${w}, vw, cols: getComputedStyle(r.querySelector('.ct-parts')).gridTemplateColumns.split(' ').length, cards: cards.length,
        out: cards.filter((b) => b.left < -0.5 || b.right > vw + 0.5).length, clipped: [...r.querySelectorAll('.ct-part, .ct-seg, .ct-ptop')].filter((e) => e.scrollWidth > e.clientWidth + 1).length }; })()`);
    const widths = [];
    for (const w of [1440, 380, 390]) {
      await width(w); await sleep(300); await run("CarService.sections.tune.querySelector('.ct-ptop').scrollIntoView()"); await sleep(300); await shot(`parts-${w}`);
      const f = await fit(w);
      ok(f.cards > 30 && f.out === 0 && f.clipped === 0 && (w < 600 ? f.cols === 1 : f.cols >= 2), `${slug}: parts view at ${w} px ${JSON.stringify(f)}`);
      widths.push(`${w}: ${f.cols} col${f.out ? `, ${f.out} cards off-screen` : ''}`);
    }
    await width(380);
    const narrow = await run(`(() => { const r = CarService.sections.tune;
      const h = r.querySelector('[data-fold]'); h.click(); const folded = r.querySelector('[data-g]').hidden; h.click();
      r.querySelectorAll('[data-to]')[2].click(); return { folded, unfold: !r.querySelector('[data-g]').hidden }; })()`);
    ok(narrow.folded && narrow.unfold, `${slug}: groups fold / the jump bar ${JSON.stringify(narrow)}`);
    await width(1440);
    line.push(`${parts.cards} parts in ${parts.groups} groups (${widths.join(', ')})`);
  }
  // the page's own save body, with every part on its top option (the most the controller has to take)
  await run(`(() => { if (window.CarTune && CarTune.on) { const r = CarService.sections.tune;
      r.querySelectorAll('.ct-part').forEach((c) => { const b = c.querySelectorAll('[data-o]'); b[b.length - 1].click(); }); } window.__posts = []; window.saveCarState && window.saveCarState(); })()`);
  await sleep(400);
  const body = await run('(window.__posts.filter((p) => /state/.test(p.u)).pop() || {}).body || null');
  ok(!!body, `${slug}: no /state body captured`);
  if (body) {
    writeFileSync(`${out}/${slug}-state.json`, body);
    const t = JSON.parse(body).tune;
    if (t) line.push(`state: ${Object.keys(t.parts).length} parts, ${Object.keys(t.wear).length} wear, mods ${t.stats.mods}`);
  }
  ok(!errors.length, `${slug}: page errors:\n      ${[...new Set(errors)].slice(0, 6).join('\n      ')}`);
  if (DRIVE.includes(slug) && tuned) {
    // a fresh car (stock maps and parts, nothing worn) for the drive: start, and a full-throttle pull
    errors = [];
    await send('Page.navigate', { url: build(slug, true) });
    ok(await until('document.readyState === "complete" && !!window.__tap', 20000), `${slug}: fresh copy never loaded`);
    await sleep(700);
    await run(`(() => { const b = document.getElementById('power-btn'); b.click(); b.click(); })()`);
    const started = await until('(window.__tap.tick || {}).rpm > 500', 12000);
    ok(started, `${slug}: engine didn't start`);
    for (const k of GEAR[slug] || []) { await run(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keyup', { key: '${k}', bubbles: true }))`); await sleep(400); }
    await run(`(() => { const s = document.getElementById('throttle'); s.value = 100; s.dispatchEvent(new Event('input')); window.__mx = { b: 0, o: 0 };
      window.__mxT = setInterval(() => { __mx.b = Math.max(__mx.b, CarTune.ch.smoke); __mx.o = Math.max(__mx.o, CarTune.ch.oilSmoke); }, 50); })()`);
    await sleep(6000);
    const pull = await run('({ ...__mx, rpm: __tap.tick.rpm, speed: __tap.tick.speed })');
    ok(pull.o < 2, `${slug}: blue smoke on a fresh engine ${pull.o}`);
    if (await run('CarTune.fuel === "petrol"')) ok(pull.b < 15, `${slug}: stock pull black smoke ${pull.b.toFixed(1)}% (want at most a haze)`);
    // worn rings: lift off for the overrun
    await run(`(() => { CarService.parts.find((p) => p.key === 'tune-rings').value = 100; __mx = { b: 0, o: 0 }; const s = document.getElementById('throttle'); s.value = 0; s.dispatchEvent(new Event('input')); })()`);
    await sleep(2500);
    const blue = await run('__mx.o');
    ok(blue > 30, `${slug}: worn rings on the overrun: blue ${blue.toFixed(1)}%`);
    // let it go: every cylinder nearly dead, floor it in a high gear
    await run(`(() => { CarTune.cylinders().forEach((k) => { k.damage = 99; }); const s = document.getElementById('throttle'); s.value = 100; s.dispatchEvent(new Event('input')); })()`);
    const blew = await until('__blows.length > 0', 90000); // a random hazard: ~20 s at the F80's revs in a tall gear
    ok(blew, `${slug}: never blew`);
    await until('__tap.tick.rpm < 400', 10000); await sleep(1500); // the revs winding down
    const after = await run(`({ blows: __blows.length, d: __blows[0], key: CarService.ignitionOn(), on: __tap.tick.ignition, rpm: __tap.tick.rpm, blown: CarTune.blown(), ch: CarTune.ch.blown })`);
    ok(after.blows === 1, `${slug}: engineblow fired ${after.blows}x`);
    ok(after.blown && after.ch, `${slug}: blown() ${after.blown}, ch.blown ${after.ch}`);
    ok(after.key && !after.on && after.rpm < 400, `${slug}: after the blow-up key ${after.key}, running ${after.on}, rpm ${Math.round(after.rpm)}`);
    // a start is vetoed (starter clunk), the page doesn't throw
    await run(`(() => { const b = document.getElementById('power-btn'); b.click(); })()`); await sleep(800);
    ok(!(await run('__tap.tick.ignition')), `${slug}: a blown engine started`);
    await run('clearInterval(__mxT)');
    line.push(`pull ${Math.round(pull.rpm)} rpm ${Math.round(pull.speed)} km/h black ${pull.b.toFixed(1)}% · rings blue ${blue.toFixed(0)}% · blew ${after.d && after.d.cause} cyl ${after.d && after.d.cyl} at ${after.d && Math.round(after.d.rpm)} rpm, key on ${after.key}`);
  }
  const posted = await run('window.__posts.length');
  ok(!errors.length, `${slug}: page errors (drive):\n      ${[...new Set(errors)].slice(0, 6).join('\n      ')}`);
  console.log(`  ${line.join(' · ')} · posts held: ${posted}`);
}
sock.close(); kill();
console.log(fails ? `\n${fails} failed` : '\nall pages ok');
process.exit(fails ? 1 : 0);
