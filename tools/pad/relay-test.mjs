// Self-check for the pad relay's connection log (scripts/pad-relay.mjs): runs a copy on a spare port - never the real
// :8765, which the phone and the drive page are on - with a fake tailscale on PATH (so it leaves `tailscale serve` and
// the clipboard alone), a fake phone and drive page, and asserts the protocol in tools/pad/README.md.
// usage: node tools/pad/relay-test.mjs [relay.mjs]   (about 10 s: the relay's 6 s ping timeout is waited out for real)
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const RELAY = resolve(process.argv[2] || new URL('../../scripts/pad-relay.mjs', import.meta.url).pathname);
const PHONE = 'https://test-mac.tail0000.ts.net', DRIVE = 'http://sim-app.test';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = await new Promise(ok => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
assert.notEqual(port, 8765);

const bin = mkdtempSync(join(tmpdir(), 'pad-test-'));
writeFileSync(join(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 }); // (Tailscale "off": no link, no clipboard)
const relay = spawn(process.execPath, [RELAY], { env: { ...process.env, PAD_PORT: port, PATH: `${bin}:${process.env.PATH}` } });
let log = '';
relay.stdout.on('data', d => log += d);
relay.stderr.on('data', d => log += d);
process.on('exit', () => relay.kill());
const until = async (what, cond, ms = 3000) => {
  for (const end = Date.now() + ms; !cond();) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(20); }
};
// a client keeping every message it gets, by when
function client(origin, opts) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin, ...opts });
  ws.got = [];
  ws.on('message', d => { let m; try { m = JSON.parse(d); } catch { m = { raw: String(d) }; } ws.got.push({ at: Date.now(), m: m ?? {} }); }); // (junk is forwarded too)
  ws.opened = new Promise((ok, no) => { ws.once('open', ok); ws.once('error', no); });
  ws.closed = new Promise(ok => ws.once('close', (code, reason) => ok({ code, reason: String(reason), at: Date.now() })));
  return ws;
}
const evs = ws => ws.got.flatMap(g => g.m.padEvents ?? []);
let n = 0;
const ok = what => console.log(`ok ${++n} - ${what}`);

try {
  await until('relay-start', () => /relay-start/.test(log));
  // a phone that never answers pings, from the start: its 6 s timeout runs alongside the rest
  const mute = client(PHONE, { autoPong: false });
  await mute.opened;
  const muteAt = Date.now();

  const drive = client(DRIVE);
  await drive.opened;
  await until('drive backlog', () => drive.got.length);
  const backlog = drive.got[0].m.padEvents;
  assert.ok(Array.isArray(backlog), 'first message to a drive page is its padEvents backlog');
  assert.equal(backlog[0].ev, 'relay-start');
  assert.deepEqual(backlog.map(e => e.ev), ['relay-start', 'client-open'], 'the backlog: the start and the mute phone, not itself');
  assert.equal(backlog[1].kind, 'phone');
  await until('own client-open live', () => evs(drive).some(e => e.ev === 'client-open' && e.kind === 'drive'));
  assert.ok(drive.got.slice(1).every(g => !g.m.padEvents || g.m.padEvents.length === 1), 'live events come one at a time');
  ok('drive page gets the backlog on connect, then live events');

  const phone = client(PHONE);
  await phone.opened;
  await until('phone client-open live', () => evs(drive).some(e => e.ev === 'client-open' && e.kind === 'phone' && e.origin === PHONE && Number.isFinite(e.t)));
  ok('client-open { origin, kind } goes live to the drive page');

  // ping / pong straight through
  phone.send(JSON.stringify({ ping: 1234.5, rtt: null }));
  await until('ping at drive', () => drive.got.some(g => g.m.ping === 1234.5 && g.m.rtt === null));
  drive.send(JSON.stringify({ pong: 1234.5 }));
  await until('pong at phone', () => phone.got.some(g => g.m.pong === 1234.5));
  ok('ping and pong pass through the relay');

  // padLog: a line per entry with the phone's time, and still forwarded; junk doesn't take the relay down
  const t = Date.UTC(2026, 10, 11, 9, 59, 58, 123);
  const padLog = { padLog: [{ t, ev: 'stale', silent: 3100 }, { t: t + 5, ev: 'ws-open' }] };
  for (const junk of ['{"padLog": [nope', '{"mouse": nope', 'null', '{"padLog": "x"}', '{"padLog": [null, 5, {"t": "soon", "ev": "x\\ny"}]}']) phone.send(junk);
  phone.send(JSON.stringify(padLog));
  await until('padLog lines', () => /"ev":"ws-open"/.test(log));
  assert.match(log, /^\S+Z pad \{"t":"2026-11-11T09:59:58\.123Z","ev":"stale","silent":3100\}$/m);
  assert.match(log, /^\S+Z pad \{"t":"2026-11-11T09:59:58\.128Z","ev":"ws-open"\}$/m);
  assert.match(log, /^\S+Z pad \{"t":"soon","ev":"x\\ny"\}$/m, 'an entry with no time keeps what it had, and its newline stays escaped');
  await until('padLog forwarded', () => drive.got.some(g => JSON.stringify(g.m) === JSON.stringify(padLog)));
  assert.equal(relay.exitCode, null, 'the relay is still up after the junk');
  ok('padLog entries are written to the log, forwarded unchanged, and junk is survived');

  // the heartbeat: phones only, once a second
  const from = Date.now();
  await sleep(3300);
  const hbs = phone.got.filter(g => 'hb' in g.m && g.at >= from);
  assert.ok(hbs.length >= 3 && hbs.length <= 4, `3 or 4 hb in 3.3 s, got ${hbs.length}`);
  for (let i = 1; i < hbs.length; i++) { const gap = hbs[i].at - hbs[i - 1].at; assert.ok(gap > 850 && gap < 1150, `hb gap ${gap} ms`); }
  assert.ok(hbs.every(g => Math.abs(g.m.hb - g.at) < 200), 'hb carries the relay\'s Date.now()');
  assert.ok(!drive.got.some(g => 'hb' in g.m), 'no hb to the drive page');
  assert.ok(!phone.got.some(g => g.m.padEvents), 'no padEvents to a phone');
  ok(`hb once a second to phones only (${hbs.length} in 3.3 s)`);

  // the phone that never answered: let go after 6 s without a pong (checked every 2 s, so 6-8 s)
  const gone = await Promise.race([mute.closed, sleep(10000).then(() => null)]);
  assert.ok(gone, 'the mute phone was let go');
  const took = gone.at - muteAt;
  assert.equal(gone.code, 1006, 'terminated, not closed');
  assert.ok(took > 5900 && took < 8600, `let go after ${took} ms`);
  await until('timeout events', () => evs(drive).some(e => e.ev === 'client-close' && e.code === 1006));
  const to = evs(drive).find(e => e.ev === 'client-timeout'), cl = evs(drive).find(e => e.ev === 'client-close' && e.code === 1006);
  assert.equal(to.kind, 'phone');
  assert.equal(to.origin, PHONE);
  assert.ok(to.idle > 5900, `client-timeout idle ${to.idle}`);
  assert.ok(cl.up > 5900 && cl.idle > 5900, 'client-close carries up and idle');
  assert.match(log, /^\S+Z client-timeout \{"origin":"https:\/\/test-mac\.tail0000\.ts\.net","kind":"phone","idle":\d+\}$/m);
  ok(`a client with no pong is terminated (${took} ms) and logged as client-timeout, then client-close`);

  // a clean close: its code and reason, and how long it was up
  phone.close(4001, 'bye');
  await until('clean close', () => evs(drive).some(e => e.ev === 'client-close' && e.code === 4001));
  const bye = evs(drive).find(e => e.code === 4001);
  assert.equal(bye.reason, 'bye');
  assert.ok(bye.up > 3000 && bye.idle >= 0 && bye.idle < bye.up, 'up and idle in ms');
  assert.match(log, /^\S+Z client-close \{"origin":"https:\/\/test-mac\.tail0000\.ts\.net","kind":"phone","code":4001,"reason":"bye","up":\d+,"idle":\d+\}$/m);
  ok('client-close { origin, kind, code, reason, up, idle }');

  // the backlog keeps the last 100: 55 phones in and out make 110 more
  for (let i = 0; i < 55; i++) { const c = client(PHONE); await c.opened; c.close(); await c.closed; }
  await until('110 more events', () => evs(drive).filter(e => e.ev === 'client-close').length >= 57);
  const late = client(DRIVE);
  await late.opened;
  await until('late backlog', () => late.got.length);
  const last = late.got[0].m.padEvents;
  assert.equal(last.length, 100);
  assert.ok(!last.some(e => e.ev === 'relay-start'), 'the oldest have gone');
  assert.equal(last.at(-1).ev, 'client-close');
  ok('the backlog is the last 100 events');

  assert.ok(log.trim().split('\n').every(l => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /.test(l)), 'every log line starts with its time');
  ok('every log line starts with an ISO time');
  console.log(`all ${n} passed`);
  process.exit(0);
} catch (e) {
  console.log(`not ok - ${e.message}\n--- relay log ---\n${log}`);
  process.exit(1);
}
