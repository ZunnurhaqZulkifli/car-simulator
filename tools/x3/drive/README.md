# tools/x3/drive - the X3 M40i in drive.html (CARS key `x3`, `public/models/bmw-x3-m40i.glb`)

Model: Ddiaz Design's "2024 BMW X3 M40i" (Sketchfab, CC BY-NC-SA 4.0 - drive.html's default credit), a game-derived
G01 LCI: nose-first, left-hand drive (kept), Alpine White under a black panoramic roof, 21" wheels (245/40 front,
275/35 rear) with blue M calipers. 4.716 m long as drive.html scales it; its wheelbase then comes out 2.8641 m (2,864),
the body 1.896 m wide without mirrors (1,891), 1.689 m tall (1,676), each tyre's PCA axle within 0.03 deg of x.

Rebuild (needs Chrome: the visibility pass renders in it, three.js from jsdelivr):

    node tools/x3/drive/prep-x3.mjs <copy of 2024_bmw_x3_m40i.glb> public/models/bmw-x3-m40i.glb <scratch dir>

What prep changes, and why, is at the top of `prep-x3.mjs`: role names; the lamp atlas's baked-lit glow map split by
role and colour (DRLs lit, projectors with the headlights, tail / brake, third brake light only braking, reversing
lights in R, amber signals dark); lenses cleared; the model's own cluster screen blacked; then every triangle no
drive.html camera can see is cut (`vis.html`: 1,870 views - the chase camera all round at every pitch and distance it
can take, the in-car eye looking every way - each candidate triangle drawn in its own id colour; kept: what any view
saw, plus its neighbours) and every primitive compacted (no spare UV sets, no tangents). It prints the steering
wheel's circle fit (= `steering.near`). Edit the GLB again -> bump `?v=N` on its CARS URL.

The car page also gained an empty `.warning-lights` overlay: drive.html puts its green turn arrows there (CARS
`arrows`, over the OS7 display's own arrow telltales); without one its load hook threw before wiring the keys.

## Files

- `prep-x3.mjs` - the build (above); `vis.html` + `run.mjs` - the model in car space in headless Chrome: `vis()` for the
  cut, `shot()` for contact sheets (`node run.mjs <glb> 4.716 <eval.js> <out prefix>`; serves the page and model on a
  throwaway local port)
- `entry.js` - the CARS entry; `swaps.mjs <entry.js> <out.json> [probe] [cam]` - drive.html find/replace pairs: the entry
  after the F80's plus the opt-in `CAR.lamps.reverse` hook (the reversing lamps' own material and a glow per side, lit
  in R with the engine running); `probe` adds `window.__dbg`, `cam` lets `&dist=` / `&pitch=` move the chase camera;
  `apply.mjs <drive.html> <swaps.json> <out>` writes a copy (each find must occur once) - the real edit was made that way
- probes run on `../../f80/drive/probe.mjs x3 <out prefix> <steps.mjs> <swaps.json> [query]` with
  `OVR="bmw-x3-m40i.glb=<staged glb>"` until the model is live, then `swaps.mjs ... probe cam live` (only the hooks)
  (saves, sendBeacon, the pad relay stubbed):
  - `steps-shots.mjs` - engine on, chase front / rear three-quarter, lights, braking, reverse, in-car, wheel turned
    (`&hour=22` for night; with the cam swap `&dist=6.5&pitch=0.14` frames the car closer)
  - `steps-rear.mjs` - close-ups of the rear lamps (running / braking / R) and the lit front (`&dist=3.4&pitch=0.1`)
  - `steps-score.mjs` + `score-x3.js` - seat height and, per look / inset, the biggest cluster that keeps the OS7
    brackets (sampled off the page's own polylines) and centre readouts clear, with and without the steering wheel
  - `steps-arrows.mjs` - where the OS7 turn telltales sit in drive.html's cluster box (`arrows`); `steps-signal.mjs` -
    the arrows flashing over them
  - `steps-wheels.mjs` - pivots' axles and hubs, what spins (not the calipers), tyres on the ground, a steered close-up
  - `steps-load.mjs` - a load test for any car: credit line, page title, chase shot (run with no swaps on the live file)
- `perf.mjs <car> [swaps.json] [query]` - uncapped frame cost (Metal, 2x, vsync off): engine on, 4 s chase, 4 s in-car;
  it stops if its stubs aren't in place. Run cars interleaved, twice

## Measured (2026-11-11)

- Model: 428,686 -> 325,129 triangles, 23.06 -> 12.05 MB (the cut: 216k of 346k candidate triangles seen; the engine
  bay, suspension and most of the underbody went; the cabin stays nearly whole - the panoramic roof and big windows show
  it). Rebuilds are byte-identical
- Seat (wheel raised 1.5 cm, RAISE in prep): hood - wheel 0.137, eye - hood 0.163 (as modelled 0.152 / 0.148). Cluster
  `look 0.1, inset 0.03, size 0.39`: on the model's own screen (0.86 m from the eye), as wide; the rim and hub hide one
  outline point per bracket
- Wheels: axles within 0.03 deg of x, tyres on the ground to 0.4 mm, wheelbase 2.8638 between the pivots; calipers stay
- Lamps (emissive): tail 0.25 idle / 1.5 lights / 6 braking; head 1 (DRLs) -> 2.25 lit; reverse 0 -> 2.5 in R
- Body (steps-drive, F80's): squat -1.9 deg, dive 3.3, ~5.0 deg steady roll at its 2.0 g limit (X1 4.9, M550d 2.5)
- Frame cost (perf.mjs, mean of 2 interleaved runs): chase 4.30 ms / in-car 6.54 ms; uncut 4.61 / 6.89; F80 3.97 /
  4.65; M5 CS 5.50 / 7.93; M3 CS Touring 4.55 / 9.88
- Turn arrows land within 0.2 px across and 1-2 px up/down of the OS7's own telltales (steps-signal)
