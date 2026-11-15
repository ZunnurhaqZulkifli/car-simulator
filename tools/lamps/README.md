# tools/lamps - warning lamps on the 140i, 320d, 335i E90 and X1 E84 clusters

Sources (archive.org item `BMWTechnicalTrainingDocuments`; no poppler here, so render PDFs with a small Swift PDFKit
script built with `swiftc`):

- F20 / F30 6WA cluster: ST1113 "06_F30 Displays, Indicators and Controls" p.8 (the high-version 6WA with every lamp drawn
  unlit); p.7 says the lamps sit "centrally at the top between the two large round instruments and below the speedometer"
- E90 / E84 cluster: ST502 "07_E90 Driver Information Systems" p.11 (lamp field, US), p.16 (no fuel lamp: a pump symbol in
  the LCD), p.26-30 (check-control "variable indicator lamps": battery, oil can, overheat, pre-glow); ST1205 "E84 Complete
  Vehicle" p.63 (the same field with ECE symbols). The 2011 E90 owner's manual cockpit page lists the upper LCD as "clock,
  outside temperature, indicator and warning lamps"

Scripts (all on `harness.mjs`, a copy of tools/rs6/harness.mjs with a random debugging port and `W=` viewport width;
file:// page copy, fetch / beacon / pad relay stubbed, nothing saved):

- `maps.mjs` - diagram lamp centres -> page coordinates (cqw of `.dials` for the 6WA pages, % of the 1310x590 SVG for E9x)
- `s_states.mjs` - key-on bulb check (0.5 s and 4.5 s), idle, traction control cutting in (`window.surfaceGrip = 0.25`,
  full throttle in D), `window.__bulbs`; prints the lit lamp ids per state
- `s_extra.mjs` - drive.html's arrow injection (its load hook copied; `ARROWS=l,r,top` for CAR.arrows), then a dead engine
  with the ignition on (`CarTune.ch.blown = true`)
- `s_bulbs.mjs` - only `?bulbs`, for layout checks (`W=390` phone)
- `s_rects.mjs` - the boxes the lamp maps hang off

    node tools/lamps/harness.mjs storage/app/public/cars/bmw-140i.html /tmp/out tools/lamps/s_states.mjs
