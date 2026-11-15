# Pad connection log: checks

Both scripts start their own copy of `scripts/pad-relay.mjs` on a spare port (`PAD_PORT`). They put a fake `tailscale`
on PATH, so the copy never re-points `tailscale serve` and never touches the clipboard. Neither one goes near the real
relay on :8765, which the phone and the drive page use. Run them while you drive if you like.

```sh
node tools/pad/relay-test.mjs              # ~10 s, the relay's own checks
node tools/pad/page-probe.mjs <out dir>    # ~35 s, public/pad.html in headless Chrome, screenshots in <out dir>
node tools/pad/map-probe.mjs <out dir>     # ~5 s, Map tab drag / pinch / twist / double tap, the header's Settings button (WORLD=<json>: a real mapOverview() dump)
```

To test a staged copy before it goes live, pass its relay as the last argument. The relay serves the `public/pad.html`
next to it: `<stage>/scripts/pad-relay.mjs` serves `<stage>/public/pad.html`. Symlink `node_modules` into `<stage>` so
`ws` resolves.

**relay-test.mjs** fakes a phone and a drive page and checks:
- `{hb}` reaches phones only, once a second.
- A client that sends no pong is terminated after 6-8 s and logged as `client-timeout`, then `client-close` (code 1006).
- A drive page gets the `padEvents` backlog on connect (the last 100), then live one-item arrays.
- `padLog` entries are written to the log one line each, and still forwarded.
- Junk JSON doesn't take the relay down.
- Ping and pong pass straight through.
- Every log line starts with an ISO time.

**page-probe.mjs** loads the pad from the test relay at 852×393 and 667×375, with a fake drive page that answers pings
after a delay you set. It checks:
- The readout's text and colour: `-- ms`, green below 50, amber below 120, red above.
- The header fits.
- `rtt-spike` is logged.
- With the relay frozen (SIGSTOP), the pad calls the link `stale` after 3 s. The entry waits in localStorage until the
  reconnect flushes it.
- With the relay killed for 3.5 s, the pad logs `ws-close` (1006, how long it was up) and only the first failed retry.
- Hidden and visible, boot, pagehide and pageshow are logged.
- Junk messages don't throw.

## The protocol (frozen: drive.html's Settings › Pad reads it)

| | From → to | Message |
|---|---|---|
| P1 | phone → drive | `{ ping: <performance.now() ms>, rtt: <smoothed ms or null> }` once a second |
| P2 | drive → phone | `{ pong: <the same number> }`, so RTT = `performance.now()` - pong |
| P3 | phone → drive | `{ padLog: [{ t, ev, ...flat details }] }`: the queue right after each (re)connect, then live one-item arrays |
| P4 | relay → drive pages | `{ padEvents: [{ t, ev, ...details }] }`: the last 100 when the page connects, then live |
| P5 | relay → phones | `{ hb: <Date.now()> }` once a second |

- **Phone events:** `boot {ua}`, `ws-open`, `ws-close {code, reason, clean, up}`, `ws-error`, `stale {silent}`,
  `hidden`, `visible`, `pagehide {persisted}`, `pageshow {persisted}`, `offline`, `online`, `wakelock-lost`,
  `wakelock-fail {msg}`, `rtt-spike {ms}`.
- **Relay events:** `relay-start`, `client-open {origin, kind}`, `client-close {origin, kind, code, reason, up, idle}`,
  `client-timeout {origin, kind, idle}`.

The relay's log is `storage/logs/pad-relay.log`. Relay events are written as `<time> client-close {...}`, and the
phone's entries as `<time> pad {"t":"<phone time>","ev":...}`.
