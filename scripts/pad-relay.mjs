// Phone pad relay: serves public/pad.html and passes messages between the phone and the drive page. A login agent
// keeps it running (npm run pad:install); npm run pad runs it in a terminal instead.
// It listens on this Mac only - the phone reaches it through `tailscale serve` (https, which iOS needs before it hands
// out tilt), the drive page at ws://localhost:8765
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';

const PORT = +process.env.PAD_PORT || 8765; // (PAD_PORT: a test copy beside the real one - tools/pad)
const plain = console.log;
console.log = (...a) => plain(new Date().toISOString(), ...a); // every line of storage/logs/pad-relay.log gets its time
const server = createServer(async (req, res) => {
  if (req.url !== '/') return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(await readFile(new URL('../public/pad.html', import.meta.url)));
});

const run = (cmd, args) => new Promise(ok => execFile(cmd, args, (err, out) => ok(err ? '' : out)));
const tailscale = () => run('tailscale', ['status', '--json']).then(JSON.parse).catch(() => ({})); // (nothing, or not JSON: off)
// the phone's address: makes sure tailscale serves this relay (a no-op once it does) and copies the link to the
// clipboard, which Universal Clipboard hands to the iPhone. Null while Tailscale is off
async function phoneLink() {
  const status = await tailscale();
  if (status.BackendState !== 'Running') return null;
  await run('tailscale', ['serve', '--bg', String(PORT)]);
  const url = `https://${status.Self.DNSName.replace(/\.$/, '')}/`;
  execFile('pbcopy').stdin.end(url);
  return url;
}

// websockets skip CORS, so any page open on this Mac could connect: only the app, the pad itself, and the pad as the
// phone opens it - at this Mac's own tailnet name, not any *.ts.net (anyone can put a page up there with Funnel)
const LOCAL = new RegExp(String.raw`^https?://(sim-app\.test|localhost:${PORT})$`);
let tailnetName = null;
async function allowed(origin) {
  if (LOCAL.test(origin)) return true;
  if (!/^https:\/\/[\w-]+\.[\w-]+\.ts\.net$/.test(origin)) return false;
  // (asked again on a miss: Tailscale may have come up, or the Mac been renamed, since the last time)
  if (origin !== `https://${tailnetName}`) tailnetName = (await tailscale()).Self?.DNSName?.replace(/\.$/, '');
  return origin === `https://${tailnetName}`;
}
const wss = new WebSocketServer({ server, verifyClient: ({ origin }, done) => allowed(origin).then(ok => { if (!ok) console.log(`refused ${origin}`); done(ok); }) });

// what became of each connection, for working out why the pad drops: a line each in the log, and the last 100 on the
// drive page's Settings › Pad - all of them when it connects ({ padEvents }), then each as it happens
const events = [];
function logEvent(ev, o = {}) {
  const e = { t: Date.now(), ev, ...o };
  console.log(ev, JSON.stringify(o));
  if (events.push(e) > 100) events.shift();
  for (const c of wss.clients) if (c.kind === 'drive' && c.readyState === c.OPEN) c.send(JSON.stringify({ padEvents: [e] }));
}
// the pad's own log ({ padLog: [{ t, ev, ... }] }, pad.html): a line per entry, the phone's time on it
const iso = t => { const d = new Date(t); return isNaN(d) ? t : d.toISOString(); };
function writePadLog(data) {
  let list;
  try { list = JSON.parse(data).padLog; } catch {}
  if (Array.isArray(list)) for (const e of list) if (e && typeof e === 'object') console.log('pad', JSON.stringify({ ...e, t: iso(e.t) }));
}
// a link can die without a word (Wi-Fi, the phone's screen locking): a ping every 2 s, and whoever goes 6 s without
// answering is let go; and the phones get a sign of life each second, so they can tell a dead link from a quiet one
setInterval(() => {
  for (const c of wss.clients) {
    if (c.readyState !== c.OPEN) continue;
    if (Date.now() - c.pongAt > 6000) logEvent('client-timeout', { origin: c.origin, kind: c.kind, idle: Date.now() - c.heardAt }), c.terminate();
    else c.ping();
  }
}, 2000);
setInterval(() => { for (const c of wss.clients) if (c.kind === 'phone' && c.readyState === c.OPEN) c.send(JSON.stringify({ hb: Date.now() })); }, 1000);

wss.on('connection', async (ws, req) => {
  const origin = req.headers.origin, kind = origin.includes('sim-app.test') ? 'drive' : 'phone', at = Date.now();
  Object.assign(ws, { origin, kind, pongAt: at, heardAt: at });
  if (kind === 'drive') ws.send(JSON.stringify({ padEvents: events })); // (before its own open, which comes live)
  logEvent('client-open', { origin, kind });
  ws.on('pong', () => ws.pongAt = Date.now());
  ws.on('error', e => console.log(`client error: ${origin}: ${e.message}`)); // (a bad frame; it closes next - unheard, it would take the relay down)
  ws.on('close', (code, reason) => {
    logEvent('client-close', { origin, kind, code, reason: String(reason), up: Date.now() - at, idle: Date.now() - ws.heardAt });
  });
  ws.on('message', (data, isBinary) => {
    ws.heardAt = Date.now();
    if (!isBinary && data.includes('"padLog"')) writePadLog(data); // (and on to the drive page, as it is)
    for (const c of wss.clients) if (c !== ws && c.readyState === c.OPEN) c.send(data, { binary: isBinary });
  });
  // every time the drive page opens: the link goes on the clipboard and the page says so
  if (kind === 'drive') ws.send(JSON.stringify({ phone: await phoneLink() }));
});
server.listen(PORT, '127.0.0.1', () => logEvent('relay-start'));
