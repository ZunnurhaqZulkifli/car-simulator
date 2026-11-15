# tools/f80/drive - the M3 F80 in drive.html (CARS key `f80`, `public/models/bmw-m3-f80.glb`)

Model: GT Cars: Hyperspeed's "BMW M3 (F80)" (Sketchfab, CC BY 4.0,
https://sketchfab.com/3d-models/bmw-m3-f80-7be23191bef447f68133afbf63f1e669) - a Sketchfab "materialmerger" export of
an OBJ with the whole cabin: 84 meshes (Object_2..85, one per material and 65k-vertex chunk, materials named by colour in
French), 1.35M triangles, 50 MB. Left-hand drive (kept), bright metallic blue, carbon roof, 19" double-spokes with gold
calipers on drilled discs. It replaced Ddiaz Design's Asphalt 8 car (25k triangles, no real interior) on 2026-11-12.

Rebuild (needs Chrome: the visibility pass renders in it, three.js from jsdelivr; ~40 s, the same bytes every run):

    node tools/f80/drive/prep-f80.mjs <copy of bmw_m3_f80.glb> public/models/bmw-m3-f80.glb <scratch dir>

It prints the steering wheel's fit (`steering.near`, already raised), the tyres' cylinders and wheelbase, and the
triangle counts per stage. What prep changes, and why, is at the top of `prep-f80.mjs`. Edit the GLB again -> bump `?v=N`
on its CARS URL (now `?v=2`).

## Files

- `prep-f80.mjs` - the build; `simplify.mjs` - its mesh simplifier (quadric-error collapses onto existing vertices, along
  straight borders / hard-edge seams too; `node simplify.mjs` runs its self-check: grid, hard-edged cube, sphere). The
  visibility pass is `../../x3/drive/vis.html` + `run.mjs` (prep uses its opt-in `occlude` / `chaseOnly` to tell the
  outside from the cabin)
- `entry.js` - the CARS entry; `swaps.mjs <entry.js | -> <out.json> [probe] [cam]` - drive.html find/replace pairs: the
  f80 entry swapped for entry.js (`-`: the one in the file), `probe` adds `window.__dbg`, `cam` lets `&dist=` / `&pitch=`
  move the chase camera; `../../x3/drive/apply.mjs <drive.html> <swaps.json> <out>` writes a copy (the real edit)
- `probe.mjs <car> <out prefix> <steps.mjs> [swaps.json] [query]` - drive.html in headless Chrome (saves, sendBeacon and
  the pad relay stubbed, non-GET requests failed, `--mute-audio`, console warnings / errors counted);
  `OVR="bmw-m3-f80.glb=<staged.glb>"` serves a staged model. Steps:
  - `steps-shots.mjs` (`&dist=5.5&pitch=0.12`, `&hour=22` for night) - HUD hidden; behind, rear / front three-quarter,
    side, front; lights, braking, R; in-car at rest and turned; the lamp levels at each step
  - `steps-look.mjs` - chase round the car, in-car, held A (only the wheel turns)
  - `steps-wheels.mjs` (`&dist=3.6&pitch=0.06`) - each pivot's axle and hub, what spins (not the calipers), tyres on the
    ground, the wheelbase between the pivots, a steered close-up
  - `steps-score.mjs` + `score-f80.js` - seat height and, per look / inset, the biggest cluster that keeps the F80 page's
    dials clear of the model (rows nearer than ~0.7 m put the cluster in front of the rim)
  - `steps-drive.mjs` - D pull with the gear log, squat / dive / roll in degrees, fps
- frame cost: `../../x3/drive/perf.mjs f80 [swaps.json]` (run cars interleaved, more than once)

## Measured (2026-11-12)

- Model: 1,351,721 -> 1,236,444 triangles after the cut (640k of 914k candidates seen) -> 732,630 simplified; 50.0 ->
  24.3 MB; 38 nodes, 33 materials, 4 JPEGs (centre screen, console, roundel, M stripes). Biggest: paint 173k, rims 106k,
  outside black (honeycomb grilles, trims) 98k, tyres 81k (tread blocks), discs 77k (drilled) - hard-edged parts whose
  corners can't collapse without changing their shape. Rebuilds are byte-identical
- As drive.html scales it (4.671 long): 2.029 wide with mirrors, 1.444 tall; tyres R 0.3326 (front and rear alike), axles
  exactly x, on the ground; wheelbase 2.8052 between the pivots (the car's 2.812 - the model is 7 mm short); front track
  1.537, rear 1.526; exhaust tips at x +-0.331, y 0.27-0.35 (`exhaustX: 0.33`)
- Steering wheel: rim circle fit centre (0.3619, 0.8982, 0.4229), axis tilt 21.7 deg, r 0.164 (rms 0.015); raised 1.2 cm
  -> `near: [0.362, 0.91, 0.423]`. Seat: hood - wheel 0.138, eye - hood 0.162 (as modelled 0.150 / 0.150). Cluster
  (score-f80.js): look 0.1 fits up to size 0.432 at any inset (on the blacked dial faces, 0.81 m from the eye); 0.08 /
  0.12 only 0.27 / 0.28 (the rim / the binnacle hood); the entry has look 0.1, inset 0.03, size 0.42
- Lamps (emissive): tail 0.25 idle / 1.5 lights / 6 braking (red 0.5, 0.008, 0.004: no green or blue to wash it white);
  head 1 (corona-ring DRLs) -> 2.25 lit; reverse 0 -> 2.5 in R
- Body (steps-drive, stiff 2): squat -0.95 deg, dive 1.68, roll 2.66; 60 fps (vsync); no console warnings or errors
- Frame cost (perf.mjs, Metal 2x uncapped, mean of 3 interleaved runs): chase 4.26 ms / in-car 4.65 ms vs the X3's 4.24 /
  5.13. Unsimplified (1.24M triangles) it was ~1-2 ms dearer than the X3
