# tools/x3 - BMW X3 M40i OS7 cluster (resources/cars/bmw-x3-m40i.html)

The page is the M140i page (B58, ZF 8HP, xDrive, the 320d-style loop) with its analog cluster swapped for the OS7
12.3" display. The display is one SVG drawn in the reference photo's own pixels (`viewBox 322 372 940 340`), so a render
overlays the photo directly. Reference: `~/Downloads/2024_bmw_x3_4dr-suv_m40i_ip_izmo_1_1600x1067.avif` (convert to PNG,
then `magick ref.png ref.ppm`); Sport: an M340i photo (same OS7 cluster, shot at an angle).

## Measuring (`measure/`, photo px; reads PPM via `../f80/measure/lib.mjs`)

- `trace.mjs ppm cx cy a0 a1 [step]` - a bracket outline: the white component most rays from an interior point meet
  first, lum-weighted centre per ray (TH / R / MAXRUN env)
- `mirror.mjs left.json right.json` - best mirror axis between the two brackets (x 792, 0.55 px rms)
- `outline.mjs spd.json tach.json ppm` - one symmetric bracket (median per 1.5 deg round C) + the red line's inset
- `curve.mjs` - the bracket as an arc-length curve; `ticks2.mjs` - every tick along it + each numeral's nearest s;
  `normal.mjs` - brightness along the normal (tick lengths, stroke width)
- `blobs.mjs ppm x0 y0 x1 y1` - bright unsaturated blobs (numeral / label boxes)
- `sign.mjs` - ellipse fit to the round speed-limit sign (0.991: no vertical squash to undo)
- `fig-map.mjs` - BMW ST1855 "Displays and Controls 2018" fig. TE18-0859 (OS7 lamps, numbered) -> photo px (affine on
  the 14 dial numerals); its needles at ~90 km/h / 3,700 rpm fixed the needle pivot
- `textfit.mjs run region name:x0,y0,x1,y1 ...` - ink boxes of text in the photo crop vs the render: width / height
  ratios for fitting font stretch and size

## Probes (all on `tools/rs6/harness.mjs`: file:// copy, POSTs captured, pad relay stubbed)

- `s_look.mjs` - smoke: off, bulb check, Comfort / Sport / ECO PRO running
- `s_ov.mjs` (OUT, FACE=comfort|sport|bulbs, REGIONS=name:x,y,w,h;...) - the SVG alone with its viewBox cropped per region
  so it renders big; `blend.sh <run dir> <photo.png>` makes the 50/50 blends and side-by-sides
- `s_drive.mjs` (OUT) - start button + creep, 0-100 (D, launch), 100-0, 0-200, top speed; writes the last real `/state`
  body to `$OUT/state-body.json` (post it through `saveState` in a throwaway test before shipping)
- `s_final.mjs` - lamp counts (bulb check, after 6 s, running in P), the `?bulbs` URL hook, full-page shots
- `s_sound.mjs` (OUT, TAG) - idle / blips / full-throttle pull / lift-off in Comfort then Sport; run it on the M140i page
  too and compare with `../f80/sound/bands.mjs` (A-weighted level, centroid, orders, rasp floor); `crackle.mjs` counts
  pop transients but misses soft overrun burble - check a spectrogram (`../f80/sound/spec.mjs`)
