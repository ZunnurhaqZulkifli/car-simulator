# tools/drive-settings - probes for drive.html's Settings menu, clear glass, wind, pad log and engine blow-up

All run on `probe.mjs` (headless Chrome on Metal, 2x, `--mute-audio`, a random debugging port, killed on exit):

    node probe.mjs <car key> <out prefix> <steps.mjs> [&extra=query]

- Stubbed before any page script (`Page.enable` + `addScriptToEvaluateOnNewDocument`), and checked in-page before a step
  runs (it refuses otherwise): non-GET `fetch` + `sendBeacon`, and `ws://localhost:8765` - the user's live phone-pad
  relay - replaced by a fake socket the steps drive (`__padSock.__open() / __msg(obj) / __close(code)`, what the page
  sent in `__padSent`). `PAD=1` makes it open by itself.
- `DRIVE=<file>` serves a staged drive.html instead of the live one (the live file is never touched). Either way the
  served copy gains `window.__ev(js)` (direct eval in the module's scope: `__ev("setGfx('fps', 30)")`) and `__dbg`
  (a proxy onto its bindings: `__dbg.camera`, `__dbg.carPage` ...).
- `PERF=1`: vsync and the frame-rate limit off (uncapped fps = frame cost). `AUDIO=1`: every AudioContext's output
  tapped by an analyser; `__lvl()` in each frame gives the A-weighted / flat level (dB re the analyser's full scale)
  since the last call - the car page's engine in the iframe, the wind in drive.html. `HEADED=1`: a visible window.
- A probe that seems to hang for many minutes is the Mac asleep, not the page: overnight it sits in 'Maintenance
  Sleep' with ~45 s DarkWakes every 15 min (`pmset -g log`), which stall Chrome and Node alike - a 40 s timer script
  took 16 min, the gfx steps sat at their first step for 15 min, the verifier's run 30+ min. `caffeinate -i -w <pid>`
  (probe.mjs starts one) only stops idle sleep, not maintenance sleep: run probes while the Mac is awake. Each CDP call also times out (`CDP_TIMEOUT` ms,
  90 s) naming itself, and the whole run (`TIMEOUT` s, 900), so a stall reports instead of hanging.

| steps | what |
|---|---|
| `steps-final.mjs` | load test for any car: model in, clear windows hidden in-car, the menu opens / Esc closes; `NARROW=1` shoots the tabs at 390 px |
| `steps-survey.mjs` | every see-through material on the car: in the window list or not, colour, opacity, triangles in the front / rear 60 cm, box |
| `steps-glass.mjs` | `OUT=<prefix>`: each view rendered twice in one go (as is / every glass mesh hidden), % of pixels changed and the luminance ratio; chase + in-car ahead / left / right; masks saved |
| `steps-glassshow.mjs` | the clear windows painted solid green, from behind and the front: shows which triangles count as window vs lens / mirror |
| `steps-glasszones.mjs` | heights of the window triangles near the car's ends (lens vs rear window) |
| `steps-wind.mjs` | `AUDIO=1`: autobahn, flat out to 100 / 160 / 250 km/h then held on cruise (F); wind vs engine dB(A), chase and in-car |
| `steps-wind160.mjs` | `AUDIO=1`: the same at 160 only - a quick sweep over all cars |
| `steps-pad.mjs` | `PAD=1`: pings answered, the phone's / relay's logs merged + de-duplicated, pad silent mid-input (inputs released, notice), back, relay drop + reconnect, a broken message, the Pad tab, Copy, Clear |
| `steps-gfx.mjs` | `PERF=1`: each Graphics option's real effect (renders a second, drawing buffer, uploaded texture size + GL anisotropy, fog / far / draw calls, antialias after a reload, the meter) and its frame cost |
| `steps-fpscap.mjs` | the FPS cap alone, with (`PERF=1`) and without vsync |
| `steps-cam.mjs` | the field of view (vertical / horizontal) and how far the CSS3D cluster lands off its hole after FOV / head changes |
| `steps-fx.mjs` | blue oil smoke, petrol black smoke and a fake `engineblow` (ch.* forced with defineProperty): shots, or frame cost with `PERF=1` |
| `steps-realblow.mjs` | the real thing: the timing chain (`tune-chain`) worn to 100 %, flat out until car-tune blows it |
| `steps-audio.mjs` | `PAD=1`: the pad's BracketRight tap opens Settings (telemetry `set`), Audio sliders scale the crash / tick / wind gains (100 / 50 / 200 / 0 %), kept over a reload, Reset; the pad map overview's size |
| `steps-arrows.mjs` | turn arrows: one per side, none injected over a page's own `[data-turn]`, the signal lighting it |

`glbmats.mjs <glb...>` lists each model's glass-like / blended materials and its texture sizes without a browser.

Measured 2026-11-12 (the numbers in the drive.html job report): in-car, every car's glass now changes 0 % of the
pixels (was 6-70 %, darkened to 0.49-0.78); wind at ~150 km/h cruise, in-car, -1.7 to +7 dB(A) against the engine
on every car measured; effects within frame-time noise (~5 ms chase on the M5 CS, uncapped).
