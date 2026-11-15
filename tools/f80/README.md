# tools/f80 - BMW M3 F80 cluster (resources/cars/bmw-m3-f80.html)

Measuring (photo -> design space). The reference photo looks down on the cluster: its dials are ellipses 0.963 as tall
as wide, so the page draws in the photo's x and `Y(y) = 660 + (y - 660)/0.963`. Convert the photo to PPM first
(`magick ref.png ref.ppm`).

- `measure/arc2.mjs ppm cx cy a0 a1 rOut rIn [step]` - ellipse + circle fit to a dial's scale line (walks in past the chrome)
- `measure/ticks.mjs ppm cx cy K r a0 a1` - bright runs round a circle (design space): tick / notch angles
- `measure/unwrapk.mjs in.ppm out.ppm cx cy K a0 a1 da r0 r1 dr` - polar unwrap in design space (flat scale line = right centre)
- `measure/radial.mjs`, `measure/needle.mjs` - profiles along a ray; needle cross-sections
- `measure/lamps.mjs` - BMW's F30 6WA cluster diagram -> design space (similarity on the two dial centres)

Probes (file:// copy, fetch POSTs captured, nothing saved) run through `tools/rs6/harness.mjs <page> <out> <steps>`:

- `s_ov.mjs` (set `OUT` to the out dir) - the cluster alone, big: unlit, bulb check (`window.__bulbs`), lit;
  `crop.sh <out> <shot>` cuts the SVG to 1500x620 design px for a 50/50 blend with the photo in design space
  (`magick ref.png -crop 1500x597+60+390 +repage -resize 1500x620! design_ref.png`)
- `s_drive.mjs` - D pull, Launch Control (S + Drivelogic 3 + DSC off), shift lights; `s_warm.mjs` - warm-up fields,
  shift-light sequence, M2 confirm, the night photo's state; `s_final.mjs` - smoke + WAV + the last /state body

## Sound (`sound/`) - fitting the S55 synth to a recording

The user's reference recording is NOT in the repo (never put it or audio cut from it here); `sound/rec-segments.json`
only holds its timestamps. Everything reads 16-bit / float WAV (`ffmpeg -i in.mov -c:a pcm_s16le rec.wav`).

- `track.mjs in.wav out.txt` - rpm track from the firing orders (harmonic comb + Viterbi). The comb can't tell order
  1.5 from 3 when one dominates: check with `orders.mjs --lock` (a real four-stroke has lines only on 0.5 multiples)
  and with the idle (line spacing at idle = order 1.5)
- `spec.mjs in.wav out.png [--rpm log --orders 1.5,3]` - spectrogram with the orders drawn over it
- `peaks.mjs in.wav t0 t1` - strongest lines in a steady stretch; `orders.mjs in.wav rpm t0 t1 --lock 3` - angle-domain
  order spectrum, phase-locked to one order
- `bands.mjs` - A-weighted octaves, centroid, orders at matched rpm, rasp (inter-harmonic) floor;
  `fitsf.mjs` - source / response split of a sweep; `table.mjs` - recording vs synth clips, one table
- `s_sound.mjs` (on `tools/rs6/harness.mjs`, warm page copy - see its header) - idle, free revs, D pull, lift-off:
  WAV + rpm log each; `loop-orders.mjs page.html` - the page's S55 loops rendered offline, mono order balance
- `selftest.mjs` - a synthetic six through track / orders (the tracker needs a harmonic-rich signal: three bare sines
  fool it)
