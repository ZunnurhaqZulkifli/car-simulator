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
const answers = { trusted: [], at: [] }; // waiting for the helper's answer lines, by their first word
// a fresh helper each time the mouse is switched on: macOS settles a process's access to post input when it first
// tries, so one started before Accessibility was granted stays shut out
async function mouseHelper() {
  mouse?.kill();
  const [src, bin] = await Promise.all([stat(MOUSE_SRC), stat(MOUSE_BIN).catch(() => null)]);
  if (!bin || bin.mtimeMs < src.mtimeMs) await new Promise((ok, no) => execFile('swiftc', ['-O', MOUSE_SRC, '-o', MOUSE_BIN], e => e ? no(e) : ok()));
  const helper = mouse = spawn(MOUSE_BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: helper.stdout }).on('line', l => { const [word, ...rest] = l.split(' '); answers[word]?.splice(0).forEach(ok => ok(rest)); });
  helper.on('exit', () => { if (mouse === helper) mouse = null, Object.values(answers).forEach(w => w.splice(0).forEach(ok => ok(null))); });
}
const mouseSay = line => mouse?.stdin.write(line + '\n');
const ask = (word, line) => Promise.race([new Promise(ok => { answers[word].push(ok); mouseSay(line); }), new Promise(ok => setTimeout(ok, 2000, null))]);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
// whether macOS lets it post input (prompt: show the system's prompt to allow it, the first time)
const trusted = async prompt => (await ask('trusted', prompt ? 'a' : 't'))?.[0] === '1';
// whether its events really get through: a 1-point nudge (back the other way at a screen's edge), seen in where the
// pointer is, then put back
async function nudges() {
  for (const dx of [1, -1]) {
    const a = await ask('at', 'p');
    mouseSay(`m ${dx} 0`);
    for (let i = 0; i < 6; i++) { // (a new helper's first event can take a moment to land)
      await sleep(100);
      const b = await ask('at', 'p');
      if (a && b && a[0] !== b[0]) return mouseSay(`m ${-dx} 0`), true;
    }
  }
  return false;
}
const askMac = () => new Promise(ok => execFile('osascript', ['-e',
  'display dialog "Let the phone pad move and click this Mac\'s pointer, for as long as it stays connected?" with title "Drive pad" ' +
  'buttons {"Don\'t Allow", "Allow"} default button "Don\'t Allow" cancel button "Don\'t Allow" giving up after 30 with icon caution'],
  (err, out) => ok(!err && /button returned:Allow/.test(out) && !/gave up:true/.test(out))));
async function onMouse(ws, m) {
  const say = state => { console.log(`pad mouse: ${state}`); if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ mouseState: state })); };
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
    if (!await nudges()) {
      // allowed, yet nothing gets through: this relay started before Accessibility was granted. As the login agent
      // (launchd starts it again at once) it restarts to pick that up - the pad reconnects and asks again
      if (process.ppid !== 1) return say('no-access');
      say('restarting');
      return setTimeout(() => process.exit(0), 300);
    }
    ws.mouse = true;
    return say('on');
  }
  if (!ws.mouse) return;
  const n = v => Math.max(-500, Math.min(500, +v || 0)).toFixed(1);
  if (Array.isArray(m.move)) mouseSay(`m ${n(m.move[0])} ${n(m.move[1])}`);
  if (Array.isArray(m.scroll)) mouseSay(`s ${n(m.scroll[0])} ${n(m.scroll[1])}`);
  if (m.click) mouseSay(m.click === 'right' ? 'c r' : 'c l');
  if ('hold' in m) mouseSay(m.hold ? 'd' : 'u');
  if (GESTURES.has(m.key)) mouseSay(`k ${m.key}`); // a 3- or 4-finger gesture's shortcut
  // the pad's keyboard: a character typed, or a key by name with the modifiers held
  if (typeof m.type === 'string' && m.type.length && m.type.length <= 4 && !/[\u0000-\u001f\u007f]/.test(m.type)) mouseSay(`y ${m.type}`);
  if (Array.isArray(m.keys) && KEYNAMES.has(m.keys[0]) && m.keys.slice(1).every(k => KEYMODS.has(k))) mouseSay(`K ${m.keys.join(' ')}`);
}
const KEYNAMES = new Set([...'abcdefghijklmnopqrstuvwxyz0123456789,./;\'-', 'esc', 'delete', 'tab', 'return', 'space', 'left', 'right', 'up', 'down']);
const KEYMODS = new Set(['shift', 'ctrl', 'opt', 'cmd']);
const GESTURES = new Set(['space-left', 'space-right', 'mission', 'expose', 'desktop', 'lookup', 'apps']);
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
