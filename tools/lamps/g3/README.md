# tools/lamps/g3 - warning lamps on the BMW M pages (F80, M3 Touring, M5 CS, E60 M5)

Probes run a file:// copy of a car page (fetch POSTs captured, the phone-pad relay stubbed, nothing saved, random
debug port, Chrome killed on exit):

    node tools/lamps/g3/harness.mjs storage/app/public/cars/<slug>.html <out dir> tools/lamps/g3/<steps>.mjs

- `states.mjs` - the cluster in five shots: `1-keyon` (bulb check), `1b-ignition-dead` (key on, engine not started),
  `2-idle`, `3-tc` (surfaceGrip 0.15, full throttle until CarDyno.tick reports tc), `4-bulbs` (`window.__bulbs`).
  `DRIVE=k` for pages that need K to select a forward gear (F80, E60).
- `turns.mjs` - replays drive.html's arrow hook (injects its arrows into `.warning-lights`, lights the first
  `[data-turn]` pair) and prints which element lit: it must be the page's own arrow, the injected ones invisible.
- `blown.mjs` - stubs `CarTune.blown()` true while running (car-tune's ignition-held-on blow-up): MIL, DSC/ABS and the
  oil-pressure / charge check-control must show.
- `te15.mjs` - BMW TE15-0720 (G12 6WB lamp figure) -> F90 photo -> M5 CS viewBox, a similarity on the side light and (P).

Sources: F80 = ST1113 "06_F30 Displays, Indicators and Controls" p.8 (TE11-1031) + ST1402 p.104; M3 Touring = ST1855
"Displays and Controls 2018" p.25 (TE18-0859) + the G81 reference photo; M5 CS = ST1501 "07_G12 Displays and Controls"
p.7 (TE15-0720) + the paultan F90 photo; E60 = ST505 "07_M Performance Controls" p.3/6, ST046 "12_E60 Driver
Information" p.7 + a lit E60 M5 photo. All on archive.org item BMWTechnicalTrainingDocuments (ST1855: st1926s58engine).
Render PDF pages with PDFKit (`swiftc`), no poppler here.
