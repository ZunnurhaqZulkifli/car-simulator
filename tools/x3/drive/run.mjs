// headless Chrome (Metal) on vis.html: `node run.mjs <glb> <length> <eval.js> <out prefix>` runs the eval (an async
// function body; returns { imgs: { name: dataURL }, ... }), saves each image as <out prefix>-<name>.png and prints the
// rest as JSON. prep-x3.mjs imports runVis for its visibility pass.
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function runVis(glb, length, body) {
  // the page and the model over a throwaway local server (fetch can't read file:// URLs)
  const server = http.createServer((req, res) => {
    const file = req.url.startsWith('/model.glb') ? glb : req.url.startsWith('/vis.html') ? fileURLToPath(new URL('vis.html', import.meta.url)) : null;
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'model/gltf-binary' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = 9500 + Math.floor(Math.random() * 400), dir = fs.mkdtempSync(os.tmpdir() + '/chrome-');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--use-angle=metal', '--enable-gpu', '--window-size=1400,900', '--mute-audio', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const kill = () => { try { chrome.kill('SIGKILL'); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} server.close(); };
  try {
    const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws;
    for (let i = 0; i < 50 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
    await new Promise(r => ws.onopen = r); // (set before the event loop turns, or the open event is missed)
    let id = 0; const pend = new Map();
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(d.params.exceptionDetails).slice(0, 400));
      else if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) console.log('console.' + d.params.type, d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
      else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') console.log('log', d.params.entry.text.slice(0, 300), d.params.entry.url || ''); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/vis.html?glb=/model.glb&length=${length}` });
    let ok = false;
    for (let i = 0; i < 240 && !ok; i++) { ok = (await send('Runtime.evaluate', { expression: 'window.ready === true', returnByValue: true })).result?.result?.value; if (!ok) await sleep(500); }
    if (!ok) throw new Error('vis.html never got ready (three.js from the CDN?)');
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result.result.value || {};
  } finally { kill(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [glb, length, evalFile, out = 'shot'] = process.argv.slice(2);
  const val = await runVis(glb, length, fs.readFileSync(evalFile, 'utf8'));
  for (const [k, d] of Object.entries(val.imgs || {})) fs.writeFileSync(`${out}-${k}.png`, Buffer.from(d.split(',')[1], 'base64'));
  delete val.imgs;
  console.log(JSON.stringify(val).slice(0, 6000));
  process.exit(0);
}
