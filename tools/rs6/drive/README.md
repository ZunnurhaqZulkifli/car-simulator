# RS 6 in drive.html - model prep and probes

- `node prep-rs6.mjs <2020_audi_rs6_avant.glb> public/models/audi-rs6-avant.glb` - Ddiaz Design's model: wheels and calipers
  merged per corner, the steering wheel (leather rim, spokes, badges, buttons, paddles) cut out of the interior into
  `cabin_steering_N`, its unused skin dropped (its stale joint indices break GLTFLoader after the compaction).
- `rimfit2.mjs <glb> 4.995` - the rim's plane and centre in car metres (for `steering.near` and prep's `C` / `N`);
  `swpieces.mjs` lists the interior's connected pieces round the wheel by depth and radius (what turns, what stays).
- `shot.mjs <car key> <out prefix> [swaps.json] [eval.js]` - drive.html chase / in-car / turned screenshots, saves and the
  pad relay stubbed; `OVR="drive.html=<file>;<model>.glb=<file>"` serves staged copies instead of the live ones.
- `score-rs6.js` - pasted into a staged drive.html right after `dashAnchor.scale.setScalar(...)`, it sets
  `window.__score`: for each look / inset, the biggest cluster size that keeps the tach, speedo and FIS clear.
- `ev_drive_rs6.js` - eval for shot.mjs: start, D, a pull, fps.
- `e60-unflop.mjs` - flops the E60's steering-wheel roundel back (it was stored flopped for the old mirrored cabin).
