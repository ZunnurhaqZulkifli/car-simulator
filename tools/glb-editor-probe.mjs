// Runs public/glb-editor.html over every built-in car in headless Chrome: its checks by the car's own drive.html patterns
// (which drive today, so they should pass), then renamed to the template, then exported and opened again as an
// uploaded file - which must check exactly the same. On SPLIT's car it splits the biggest cabin_ or body_ part first, so the
// split pieces go through the export too. The rename, the split and the hand tools are undone and redone (⌘Z, ⇧⌘Z)
// on the way. Screenshots of each go to the out dir. Nothing is saved anywhere: the editor never posts, and its
// download is caught in the page.
// usage: node tools/glb-editor-probe.mjs [url] [out dir] [car keys, comma-separated]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [url = 'http://sim-app.test/glb-editor.html', out = `${process.env.TMPDIR}glb-editor-probe`, only] = process.argv.slice(2);
const SPLIT = 'e60', TOOLS = 'gtr'; // TOOLS goes last: the hand tools run on its round-trip copy (the RS 6's export doesn't round-trip)
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9335', '--hide-scrollbars', '--enable-unsafe-swiftshader', `--user-data-dir=${process.env.TMPDIR}glb-editor-probe-prof`, 'about:blank']);
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { await sleep(150); try { wsUrl = (await (await fetch('http://127.0.0.1:9335/json')).json()).find(x => x.type === 'page').webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(wsUrl);
await new Promise(r => sock.onopen = r);
let id = 0;
const pend = {}, errors = [];
sock.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) pend[d.id](d.result ?? { error: d.error }), delete pend[d.id];
  if (d.method === 'Runtime.consoleAPICalled' && /error|assert/.test(d.params.type)) errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(r => { pend[++id] = r; sock.send(JSON.stringify({ id, method, params })); });
const run = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expression, ms = 120000) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(200)) if (await run(expression)) return; throw new Error(`timed out: ${expression}`); };
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const loaded = name => waitFor(`/^${name.replace(/\W/g, '\\$&')}: \\d+ parts/.test(document.getElementById('status').textContent)`);
const checks = () => run(`[...document.querySelectorAll('#checks li')].map(li => li.className + ' ' + li.querySelector('span').textContent)`);
const bad = list => list.filter(c => c.startsWith('bad'));
const key = shift => run(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: ${shift}, bubbles: true }))`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await waitFor(`document.querySelectorAll('#builtin option').length > 1`, 30000);
// the export's download lands in __glb instead of a file
await run(`(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__glb = this.href; else click.call(this); }; })()`);
const keys = (await run(`[...document.querySelectorAll('#builtin option')].map(o => o.value).filter(Boolean)`)).filter(k => !only || only.split(',').includes(k));
keys.sort((a, b) => (a === TOOLS) - (b === TOOLS));

let failed = 0;
for (const k of keys) {
  const t0 = Date.now();
  await run(`(s => { s.value = ${JSON.stringify(k)}; s.dispatchEvent(new Event('change')); })(document.getElementById('builtin'))`);
  await waitFor(`/: \\d+ parts/.test(document.getElementById('status').textContent)`);
  const own = await checks(), tLoad = Date.now() - t0;
  await shot(`${k}-own`);

  await run(`document.getElementById('convert').click()`);
  let template = await checks();
  // ⌘Z takes the rename back to its own patterns, ⇧⌘Z does it again
  await key(false);
  const undone = await checks();
  await key(true);
  const history = same(undone, own) && same(await checks(), template);
  let split = '', splitOk = true;
  if (k === SPLIT) {
    split = await run(`(() => {
      const tris = li => +li.querySelector('small').textContent.match(/([\\d,]+) ▲/)[1].replace(/,/g, '');
      const big = [...document.querySelectorAll('#parts li')].filter(li => /^(cabin|body)_/.test(li.querySelector('input').value)).sort((a, b) => tris(b) - tris(a))[0];
      const before = document.querySelectorAll('#parts li').length;
      big.click();
      document.getElementById('split').click();
      const after = document.querySelectorAll('#parts li').length, text = document.getElementById('status').textContent;
      const key = shiftKey => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey, bubbles: true }));
      key(false);
      const undone = document.querySelectorAll('#parts li').length;
      key(true);
      const redone = document.querySelectorAll('#parts li').length;
      return { text: text + ' (' + before + ' → ' + after + ' parts; undo ' + undone + ', redo ' + redone + ')', ok: after > before && undone === before && redone === after };
    })()`);
    splitOk = split.ok;
    split = split.text;
    template = await checks();
  }
  await shot(`${k}-template`);

  const t1 = Date.now();
  await run(`window.__glb = null; document.getElementById('export').click()`);
  await waitFor('!!window.__glb', 300000);
  const exported = await run(`document.getElementById('status').textContent`), tExport = Date.now() - t1;
  await run(`(async () => {
    const dt = new DataTransfer(), f = document.getElementById('file');
    dt.items.add(new File([await (await fetch(window.__glb)).blob()], 'roundtrip-${k}.glb'));
    f.files = dt.files;
    f.dispatchEvent(new Event('change'));
  })()`);
  await loaded(`roundtrip-${k}.glb`);
  const again = await checks();
  await shot(`${k}-roundtrip`);

  const trip = same(again, template);
  if (!trip || bad(own).length || !history || !splitOk) failed++;
  console.log(`\n== ${k}  (load ${tLoad} ms, export ${tExport} ms)  ${exported}`);
  console.log(`  own patterns: ${bad(own).length ? bad(own).join('\n    ') : 'no ✕'}`);
  if (split) console.log(`  split: ${split}${splitOk ? '' : ' WRONG'}`);
  console.log(`  template: ${bad(template).length ? '\n    ' + bad(template).join('\n    ') : 'fits'}`);
  console.log(`  undo/redo rename all: ${history ? 'back to its own checks, then the template\'s again' : 'WRONG'}`);
  console.log(`  round trip: ${trip ? 'same checks' : 'DIFFERENT\n    ' + again.filter(c => !template.includes(c)).join('\n    ')}`);
}
// the hand tools, on the last car's (TOOLS') round-trip copy: turning it round, untagging and retagging a tyre, deleting a part
const tools = await run(`(() => {
  const $ = id => document.getElementById(id), rows = () => [...document.querySelectorAll('#parts li')];
  const state = t => [...document.querySelectorAll('#checks li')].find(li => li.querySelector('b').textContent === t)?.className;
  const tyre = rows().findIndex(li => li.querySelector('input').value.startsWith('wheel_tyre_'));
  const tag = role => { rows()[tyre].click(); document.querySelector('[data-role=' + role + ']').click(); };
  const key = shiftKey => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey, bubbles: true }));
  const r = { facing: state('Facing') };
  document.querySelector('[data-turn="2"]').click(); r.turned = state('Facing');
  document.querySelector('[data-turn="2"]').click(); r.back = state('Facing');
  key(false); r.turnUndone = state('Facing');
  key(true); r.turnRedone = state('Facing');
  r.tyres = state('Tyres');
  tag('body'); r.untagged = state('Tyres');
  tag('tyre'); r.retagged = state('Tyres');
  const n = rows().length;
  rows().at(-1).click(); $('delete').click(); r.deleted = n - rows().length;
  key(false); r.undeleted = rows().length - n;
  key(false); r.retagUndone = state('Tyres');
  $('redo').click(); r.retagRedone = state('Tyres');
  key(false); tag('tyre'); r.redoDropped = $('redo').disabled;
  $('guide-btn').click(); r.guideRoles = document.querySelectorAll('#guide-roles tr').length; r.guideOpen = $('guide').open; $('guide').close();
  return r;
})()`);
const want = { facing: 'ok', turned: 'bad', back: 'ok', turnUndone: 'bad', turnRedone: 'ok', tyres: 'ok', untagged: 'bad', retagged: 'ok', deleted: 1,
  undeleted: 0, retagUndone: 'bad', retagRedone: 'ok', redoDropped: true, guideRoles: 10, guideOpen: true };
const wrong = Object.keys(want).filter(k => tools[k] !== want[k]);
if (wrong.length) failed++;
console.log(`\ntools: ${wrong.length ? `WRONG ${wrong.map(k => `${k}=${tools[k]} (want ${want[k]})`).join(', ')}` : 'turn, tag, retag, delete, their undo and redo, and the guide all work as they should'}`);
console.log(errors.length ? `\npage errors:\n  ${errors.join('\n  ')}` : '\nno page errors');
chrome.kill();
process.exit(failed || errors.length ? 1 : 0);
