# Lamp probes, group 4 (RS 6 C7, NSX-R, GT-R R35, GT3 RS 992, Iriz)

`harness.mjs` is the file:// car-page harness (copied from `tools/lamps/g2`, with `shot(name, selector)` clipping to an
element at 2x). Nothing reaches the DB: fetch POSTs land in `window.__posts`, the pad relay (ws :8765) is stubbed,
Chrome runs muted on a random debugging port.

`states.mjs` drives one car (env `CAR=<slug>`) through the four lamp states and logs the lit lamps for each:
`1-keyon` (bulb check), `2-idle` (warm idle), `3-tc` (a launch on `surfaceGrip = 0.35`, stability control
flashing), `4-bulbs` (`window.__bulbs = true`).

    CAR=audi-rs6-avant node tools/lamps/g4/harness.mjs storage/app/public/cars/audi-rs6-avant.html /tmp/out tools/lamps/g4/states.mjs

Every page also takes `?bulbs` in its URL to hold every lamp on.
