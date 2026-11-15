// Loads public/pad.html in headless Chrome from a copy of the relay on a spare port (never the real :8765), with a
// fake drive page answering its pings after a set delay, and checks the round-trip readout, its fit in the landscape
// header, and the connection log end to end: the relay frozen (SIGSTOP) till the pad calls it stale, then killed and
// started again (ws-close, the queue flushed on reconnect), visibility, boot, and junk messages.
// usage: node tools/pad/page-probe.mjs <out dir> [relay.mjs]   (the relay serves the pad.html beside it: ../public)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import WS from 'ws';

const [out = 'pad-probe-out', relayArg] = process.argv.slice(2);
const RELAY = resolve(relayArg || new URL('../../scripts/pad-relay.mjs', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const port = await freePort(), dbg = await freePort();
assert.notEqual(port, 8765);

const bin = mkdtempSync(join(tmpdir(), 'pad-probe-'));
writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 }); // (Tailscale "off": no serve, no clipboard)
let relay, log = '';
const startRelay = () => {
  relay = spawn(process.execPath, [RELAY], { env: { ...process.env, PAD_PORT: port, PATH: `${bin}:${process.env.PATH}` } });
  relay.stdout.on('data', d => log += d);
  relay.stderr.on('data', d => log += d);
};
startRelay();
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${dbg}`, '--mute-audio',
  '--hide-scrollbars', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pad-probe-prof-'))}`, 'about:blank']);
process.on('exit', () => { relay.kill('SIGCONT'); relay.kill(); chrome.kill(); });
const until = async (what, cond, ms = 5000) => {
  for (const end = Date.now() + ms; !await cond();) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(50); }
};
await until('relay-start', () => /relay-start/.test(log));

// the fake drive page: telemetry at 15 Hz, a pong after `delay` ms (null: none), what it hears kept; back after a drop
const CAR = { name: 'BMW M3 Competition', redline: 7200, modes: [], maps: ['Stock', 'Stage 1'], hints: { 1: 'M1 / M2', 2: 'M1 / M2', i: 'ignition / start', q: 'paddles', e: 'paddles', k: 'D', n: 'neutral', r: 'reverse', l: 'lights', h: 'lights' } };
let delay = 10, drive, heard = [];
(function driveConnect() {
  const d = drive = new WS(`ws://127.0.0.1:${port}`, { origin: 'http://sim-app.test' });
  let tick;
  d.on('open', () => tick = setInterval(() => d.send(JSON.stringify({ car: CAR, tele: { g: 'M4', v: 124, r: 6100, on: true, tc: 'DSC', hl: 1, beam: 100, pos: [0, 0, 0], slot: 1 } })), 66));
  d.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    heard.push(m);
    if ('ping' in m && delay != null) setTimeout(() => d.readyState === d.OPEN && d.send(JSON.stringify({ pong: m.ping })), delay);
  });
  d.on('error', () => {});
  d.on('close', () => { clearInterval(tick); setTimeout(driveConnect, 300); });
})();

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
const size = async (width, height, inset) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset, bottom: inset && 21, top: 0 } });
};
const ms = () => run(`[$('ms').textContent, $('ms').className]`);
const logged = ev => log.split('\n').filter(l => l.includes(` pad {`) && l.includes(`"ev":"${ev}"`));
let n = 0;
const ok = what => console.log(`ok ${++n} - ${what}`);

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await size(852, 393, 59); // an iPhone 15 Pro, landscape
  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(300);
  assert.deepEqual(await ms(), ['-- ms', ''], 'no pong yet');
  await run(`$('intro').hidden = true`);
  ok('-- ms before any pong');

  await until('boot logged', () => logged('boot').length && logged('ws-open').length);
  assert.match(logged('boot')[0], /"ua":"Mozilla/);
  ok('boot { ua } queued before the socket, flushed on open, ahead of ws-open');

  for (const [d, cls, wait] of [[10, 'good', 3500], [80, 'fair', 5000], [200, 'bad', 6000]]) {
    delay = d;
    await sleep(wait);
    const [text, c] = await ms();
    assert.match(text, /^\d+ ms$/);
    assert.equal(c, cls, `${d} ms delay: ${text}`);
    await shot(`ms-${cls}`);
    ok(`${d} ms answers read ${text}, ${cls}`);
  }
  assert.ok(heard.some(m => m.ping != null && typeof m.rtt === 'number'), 'P1 pings carry the rtt');
  await until('rtt-spike', () => logged('rtt-spike').length);
  ok(`rtt-spike logged: ${logged('rtt-spike')[0].split(' pad ')[1]}`);
  delay = null;
  await sleep(4000);
  assert.deepEqual(await ms(), ['-- ms', ''], 'no pongs for 3 s');
  ok('back to -- ms once the pongs stop');

  // the header at phone landscape sizes: the readout beside the dot, nothing overlapping or spilling out
  delay = 10;
  for (const [w, h, inset, name] of [[852, 393, 59, 'iphone-15-pro'], [667, 375, 0, 'iphone-se']]) {
    await size(w, h, inset);
    await sleep(2500);
    const fit = await run(`(() => {
      const hd = document.querySelector('main > header').getBoundingClientRect(), kids = [...document.querySelector('main > header').children].filter(e => e.offsetWidth);
      const r = kids.map(e => [e.id || e.className, e.getBoundingClientRect()]);
      return { overlaps: r.slice(1).filter(([, b], i) => b.left < r[i][1].right - 0.5).map(([k]) => k), outside: r.filter(([, b]) => b.left < hd.left - 0.5 || b.right > hd.right + 0.5).map(([k]) => k),
               msClipped: $('ms').scrollWidth > $('ms').clientWidth, ms: $('ms').textContent, car: $('car').textContent, carWidth: Math.round(r.find(([k]) => k === 'car')[1].width) };
    })()`);
    assert.deepEqual(fit.overlaps, [], `${name}: overlapping ${fit.overlaps}`);
    assert.deepEqual(fit.outside, [], `${name}: outside the header ${fit.outside}`);
    assert.equal(fit.msClipped, false);
    await shot(`header-${name}`);
    ok(`${name} ${w}x${h}: ${fit.ms} fits beside the dot, "${fit.car}" keeps ${fit.carWidth} px`);
  }
  await size(852, 393, 59);

  // hidden / visible (the event, as iOS sends it on leaving and coming back)
  await run(`(() => { const s = v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }; s('hidden'); s('visible'); })()`);
  await until('hidden + visible', () => logged('hidden').length && logged('visible').length);
  await sleep(500);
  const wl = logged('wakelock-fail')[0] ?? logged('wakelock-lost')[0];
  ok(`hidden and visible logged${wl ? `; wake lock: ${wl.split(' pad ')[1]}` : ''}`);

  // a dead link: the relay frozen, so the socket stays open with nothing on it. The pad calls it stale after 3 s and
  // starts again; the stale entry waits in localStorage till the relay's back
  relay.kill('SIGSTOP');
  await until('stale queued', async () => (await run(`localStorage.getItem('pad.log') || ''`)).includes('"stale"'), 6000);
  relay.kill('SIGCONT');
  await until('stale flushed', () => logged('stale').length, 6000);
  assert.match(logged('stale')[0], /"silent":[34]\d{3}\b/);
  await until('queue emptied', async () => !(await run(`localStorage.getItem('pad.log')`)));
  await until('open again', () => run(`ws.readyState === WebSocket.OPEN`));
  ok(`frozen relay: ${logged('stale')[0].split(' pad ')[1]}, flushed on reconnect, queue empty`);

  // the relay gone 3.5 s and back: ws-close (1006) and the time it was up, then the first failed try only (not one a
  // second), all flushed to the new one
  await sleep(1500); // (up a while, so its close says so)
  relay.kill('SIGKILL');
  await sleep(3500);
  log = '';
  startRelay();
  await until('ws-close at the new relay', () => logged('ws-close').length && logged('ws-open').length, 8000);
  const closes = logged('ws-close');
  assert.equal(closes.length, 2, `the drop and the first failed try: ${closes.join('\n')}`);
  assert.match(closes[0], /"code":1006,"reason":"","clean":false,"up":1\d{3}\b/);
  assert.match(closes[1], /"code":1006,"reason":"","clean":false,"up":0\b/);
  assert.ok(logged('ws-error').length <= 2, 'no ws-error per retry');
  ok(`relay gone 3.5 s: ${closes[0].split(' pad ')[1]}, then one failed try logged of ~3`);

  // junk from the drive page's side doesn't throw on the pad
  await until('drive back', () => drive.readyState === drive.OPEN, 3000);
  for (const junk of ['not json', 'null', '7', '{"pong": "x"}', '{"pong": 1}']) drive.send(junk);
  await sleep(500);
  assert.deepEqual(errors, [], `page errors: ${errors}`);
  ok('junk messages are dropped without an error');

  // a reload: pagehide on the way out, boot and pageshow on the new page
  log = '';
  await send('Page.reload');
  await until('reload logged', () => logged('boot').length && logged('pageshow').length, 6000);
  ok(`reload: pagehide ${logged('pagehide').length ? 'logged' : 'lost with the page (sent live, best effort)'}, boot and pageshow logged`);
  assert.deepEqual(errors, [], `page errors: ${errors}`);
  console.log(`all ${n} passed - screenshots in ${out}`);
  process.exit(0);
} catch (e) {
  console.log(`not ok - ${e.message}\n--- relay log ---\n${log}`);
  process.exit(1);
}
