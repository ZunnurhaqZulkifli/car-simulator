# tools/pops - exhaust pop / bang audibility probe

Renders each car page's audio headless (file:// copy, fetch / beacon / pad relay stubbed, nothing saved, `--mute-audio`,
a random CDP port) through a lift-off + upshift + downshift scenario, logs every `CarDyno.pop` against the
AudioContext clock, and measures each pop's 5 ms peak over the engine bed just before it.

- `node tools/pops/run.mjs <out dir> [slug...]` - per-car modes (Comfort / Sport, Efficient / Sport Plus, P400 / P500 ...)
  live in `run.mjs`'s `MODES`; `DIR=resources/cars` probes the seed copies (a "before" while the live pages are edited).
- `harness.mjs` - tools/rs6/harness.mjs plus `window.__pops` and the recorder's start time (`<clip>.json`).
- `steps.mjs` - the scenario: 1st to `LIFT` rpm, up, 2nd to `LIFT`, lift + 2.5 s coast (`lift`), on again, up to 3rd,
  lift and two downshifts (`down`). Two gears of pull before each lift: the F80-style pages only crackle once hot.
- `analyze.mjs <wav>...` - per phase: pops logged, median / max dB over the bed (high-passed 400 Hz, where crackle sits
  and the engine bed doesn't), broadband max, the loudest pop and the bed in dBFS, and the clip's sample peak (pops go
  straight to the destination - nothing limits them, 0 dBFS clips).

Read with care: a page that never calls `CarDyno.pop` falls back to a transient detector (`detected`), which also
counts shift clunks; the scenario is random (pop chance, timing), so compare medians, not single maxima. Soft burble
under ~3 dB here is inaudible by ear too; check a spectrogram (`../f80/sound/spec.mjs`) if in doubt.
