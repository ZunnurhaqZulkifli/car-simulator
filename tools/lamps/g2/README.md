# Lamp probes, group 2: bmw-530e, bmw-550d (F10), bmw-550d-mk2 (G30), bmw-x3-m40i

Headless, nothing saved: `harness.mjs` builds a file:// copy of the page the way `/car/{slug}/raw` serves it, with fetch,
beacons and the phone-pad relay (ws://localhost:8765) stubbed, on a random CDP port. It is the tools/rs6 harness plus
`shotEl(name, sel, scale)` (cluster-only PNGs) and a CarTune guard for pages without `CarTune.init`.

    node tools/lamps/g2/harness.mjs storage/app/public/cars/<slug>.html <out dir> tools/lamps/g2/<steps>.mjs

| steps | shots |
|---|---|
| `states.mjs` | 1 key-on bulb check, 1b key on after it (engine off), 2 idle with lights + high beam, 3 full throttle on `surfaceGrip` 0.3 until DSC cuts in, 4 `window.__bulbs` |
| `extra.mjs` | 5 running, then `CarTune.ch.blown = true` with the ignition on (dead engine), 6 `__bulbs` on the Sport face |
| `arrows.mjs` | 7 drive.html's turn-arrow injection replayed (its code), arrows lit |
| `look.mjs` | the cluster as loaded, and with `__bulbs` |

`fit-g30.mjs` maps the TE15-0720 lamp positions onto the G30 pages' 1200x500 TFT viewBox (affine on the dial centres, clock and
side gauges; residuals up to 16 units, as the pages' proportions differ, so the top and bottom rows were pulled in by hand).

`pdfpage.swift` renders a PDF page to PNG, or dumps the text (no poppler or ghostscript on this Mac):
`swiftc -O tools/lamps/g2/pdfpage.swift -o /tmp/pdfpage && /tmp/pdfpage doc.pdf 13 8 out.png` (page 13 at 8x), or `/tmp/pdfpage doc.pdf text`.

## Sources (archive.org item BMWTechnicalTrainingDocuments)
- G30 (530e, M550d Mk2): `ST1501 G12 Complete Vehicle/07_G12 Displays and Controls.pdf` p.13, fig. TE15-0720. The 6WB 12.3"
  cluster with all 22 lamps numbered. The text says the TFT draws some lamps (turn, fog) and the rest are fixed LED chambers
  outside it (EML, parking brake).
- F10 (550d): `ST1002 F10 Complete Vehicle/06_F10 Displays, Indicators and Controls.pdf` p.2 (the black-panel cluster, the F07 one).
  The lamps come from `ST811 F01 Complete Vehicle/06.1_F01 Displays Indicators and Controls.pdf`: p.7 has the lit cluster
  figure and says symbols only show with the ignition on; p.29 covers the fuel pump pictogram and the pre-drive check.
- X3 (OS7): `ST1855` fig. TE18-0859, as already used by the page (memory reference_x3_cluster_build.md).
