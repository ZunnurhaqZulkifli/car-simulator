// Phone pad relay: serves public/pad.html and passes messages between the phone and the drive page. A login agent
// keeps it running (npm run pad:install); npm run pad runs it in a terminal instead.
// It listens on this Mac only - the phone reaches it through `tailscale serve` (https, which iOS needs before it hands
// out tilt), the drive page at ws://localhost:8765
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
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

// websockets skip CORS, so any page open on this Mac could connect: only the app, the pad itself and the tailnet may
const ALLOWED = /^https?:\/\/(sim-app\.test|localhost:8765|[\w-]+\.[\w-]+\.ts\.net)$/;
const wss = new WebSocketServer({ server, verifyClient: ({ origin }) => ALLOWED.test(origin) || console.log(`refused ${origin}`) });
wss.on('connection', async (ws, req) => {
  const origin = req.headers.origin;
  console.log(`connected: ${origin} (${wss.clients.size} in all - the phone and the drive page make 2)`);
  ws.on('close', () => console.log(`disconnected: ${origin}`));
  ws.on('message', (data, isBinary) => {
    for (const c of wss.clients) if (c !== ws && c.readyState === c.OPEN) c.send(data, { binary: isBinary });
  });
  // every time the drive page opens: the link goes on the clipboard and the page says so
  if (origin.includes('sim-app.test')) ws.send(JSON.stringify({ phone: await phoneLink() }));
});
server.listen(PORT, '127.0.0.1', () => console.log(`pad relay on http://localhost:${PORT}`));
