// Phone pad relay: serves public/pad.html and passes messages between the phone and the drive page. A login agent
// keeps it running (npm run pad:install); npm run pad runs it in a terminal instead.
// It listens on this Mac only - the phone reaches it through `tailscale serve` (https, which iOS needs before it hands
// out tilt), the drive page at ws://localhost:8765
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = 8765;
const server = createServer(async (req, res) => {
  if (req.url !== '/') return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(await readFile(new URL('../public/pad.html', import.meta.url)));
});

const run = (cmd, args) => new Promise(ok => execFile(cmd, args, (err, out) => ok(err ? '' : out)));
// the phone's address: makes sure tailscale serves this relay (a no-op once it does) and copies the link to the
// clipboard, which Universal Clipboard hands to the iPhone. Null while Tailscale is off
async function phoneLink() {
  const status = JSON.parse(await run('tailscale', ['status', '--json']) || '{}');
  if (status.BackendState !== 'Running') return null;
  await run('tailscale', ['serve', '--bg', String(PORT)]);
  const url = `https://${status.Self.DNSName.replace(/\.$/, '')}/`;
  execFile('pbcopy').stdin.end(url);
  return url;
}

// The pad's mouse (Extras > Mouse): its touchpad moving and clicking this Mac's pointer. A phone gets it only after a
// yes in a dialog on this Mac, for as long as that connection lasts, and macOS only lets the events through once
// whatever runs this relay (node as the login agent, or Terminal) has Accessibility access. scripts/pad-mouse.swift
// posts them, built here on first use (swiftc, into storage/app, which git ignores)
const MOUSE_SRC = fileURLToPath(new URL('./pad-mouse.swift', import.meta.url)), MOUSE_BIN = fileURLToPath(new URL('../storage/app/pad-mouse', import.meta.url));
let mouse = null;
const trustWait = [];
async function mouseHelper() {
  if (mouse) return;
  const [src, bin] = await Promise.all([stat(MOUSE_SRC), stat(MOUSE_BIN).catch(() => null)]);
  if (!bin || bin.mtimeMs < src.mtimeMs) await new Promise((ok, no) => execFile('swiftc', ['-O', MOUSE_SRC, '-o', MOUSE_BIN], e => e ? no(e) : ok()));
  mouse = spawn(MOUSE_BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: mouse.stdout }).on('line', l => /^trusted [01]$/.test(l) && trustWait.splice(0).forEach(ok => ok(l.endsWith('1'))));
  mouse.on('exit', () => { mouse = null; trustWait.splice(0).forEach(ok => ok(false)); });
}
const mouseSay = line => mouse?.stdin.write(line + '\n');
// whether macOS lets it post input (prompt: show the system's prompt to allow it, the first time)
const trusted = prompt => Promise.race([new Promise(ok => { trustWait.push(ok); mouseSay(prompt ? 'a' : 't'); }), new Promise(ok => setTimeout(ok, 3000, false))]);
const askMac = () => new Promise(ok => execFile('osascript', ['-e',
  'display dialog "Let the phone pad move and click this Mac\'s pointer, for as long as it stays connected?" with title "Drive pad" ' +
  'buttons {"Don\'t Allow", "Allow"} default button "Don\'t Allow" cancel button "Don\'t Allow" giving up after 30 with icon caution'],
  (err, out) => ok(!err && /button returned:Allow/.test(out) && !/gave up:true/.test(out))));
async function onMouse(ws, m) {
  const say = state => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ mouseState: state }));
  if ('on' in m) {
    if (!m.on) { if (ws.mouse) mouseSay('u'); ws.mouse = false; return say('off'); }
    if (ws.mouse) return say('on');
    if (ws.asking) return;
    ws.asking = true;
    say('asking');
    if (!ws.allowed) ws.allowed = await askMac(); // (once per connection: a second try after granting Accessibility doesn't ask again)
    ws.asking = false;
    if (!ws.allowed) return say('denied');
    try { await mouseHelper(); } catch (e) { console.log(`pad mouse: ${e.message}`); return say('error'); }
    if (!await trusted(!ws.prompted)) { ws.prompted = true; return say('no-access'); }
    ws.mouse = true;
    return say('on');
  }
  if (!ws.mouse) return;
  const n = v => Math.max(-500, Math.min(500, +v || 0)).toFixed(1);
  if (Array.isArray(m.move)) mouseSay(`m ${n(m.move[0])} ${n(m.move[1])}`);
  if (Array.isArray(m.scroll)) mouseSay(`s ${n(m.scroll[0])} ${n(m.scroll[1])}`);
  if (m.click) mouseSay(m.click === 'right' ? 'c r' : 'c l');
  if ('hold' in m) mouseSay(m.hold ? 'd' : 'u');
}
const PHONE = /^(https:\/\/[\w-]+\.[\w-]+\.ts\.net|http:\/\/localhost:8765)$/; // the pad: over the tailnet, or opened on this Mac

// websockets skip CORS, so any page open on this Mac could connect: only the app, the pad itself and the tailnet may
const ALLOWED = /^https?:\/\/(sim-app\.test|localhost:8765|[\w-]+\.[\w-]+\.ts\.net)$/;
const wss = new WebSocketServer({ server, verifyClient: ({ origin }) => ALLOWED.test(origin) || console.log(`refused ${origin}`) });
wss.on('connection', async (ws, req) => {
  const origin = req.headers.origin;
  console.log(`connected: ${origin} (${wss.clients.size} in all - the phone and the drive page make 2)`);
  ws.on('close', () => { console.log(`disconnected: ${origin}`); if (ws.mouse) mouseSay('u'); });
  ws.on('message', (data, isBinary) => {
    if (!isBinary && data.includes('"mouse"')) { // the pad's mouse is this Mac's, not the drive page's
      let m;
      try { m = JSON.parse(data).mouse; } catch {}
      if (m && typeof m === 'object') return void (PHONE.test(origin) && onMouse(ws, m));
    }
    for (const c of wss.clients) if (c !== ws && c.readyState === c.OPEN) c.send(data, { binary: isBinary });
  });
  // every time the drive page opens: the link goes on the clipboard and the page says so
  if (origin.includes('sim-app.test')) ws.send(JSON.stringify({ phone: await phoneLink() }));
});
server.listen(PORT, '127.0.0.1', () => console.log(`pad relay on http://localhost:${PORT}`));
