# tools/tune - self-checks for car-tune.js

Nothing here writes to the database or opens a real car's `/raw` page. The cars table is the owner's real progress.

```sh
# 1. the saved tunes, read-only (a SELECT), for the old-saves checks
php artisan tinker --execute="require 'tools/tune/dump-tunes.php';" > /tmp/tunes.json

# 2. the engine model in Node (no browser): parts, tiers, presets, smoke, the blow-up, old saves vs the old code
git show HEAD:public/js/car-tune.js > /tmp/car-tune.old.js
node tools/tune/check.mjs public/js /tmp/tunes.json /tmp/car-tune.old.js

# 3. every real car page, headless (fetch / beacon / pad relay stubbed, muted, random port): loads with its saved tune,
#    the Parts view at 1440 / 380 / 390 px (every card inside the viewport), every part on its top option -> <out>/<slug>-state.json; five cars driven
#    (B58, B57S diesel, NSX NA, E60, F80 DCT): stock pull, worn rings on the overrun, the blow-up
node tools/tune/probe.mjs /tmp/tune-probe /tmp/tunes.json        # SHOT=bmw-140i also saves Parts-view PNGs; PAGES=a,b runs just those

# 4. those real save bodies through the controller's saveState rules (in-memory SQLite, like every test)
TUNE_PROBE_DIR=/tmp/tune-probe php artisan test --filter=CarTunePayloadTest
```

What `check.mjs` asserts (exits 1 on a failure):
- every part option changes the model (fitted effects, brake hardware or the predicted curve), and each tier beats the
  one below it on what it's for: rod rating, gearbox rating, cooling, intercooler, fuel flow, turbo boost, knock margin
- the Pro gearbox holds every preset's torque (60% over Built); the new top fuel tiers (twin-rail port kit / twin-injector
  rails, race DI, twin HP pumps, triple feed pumps) flow 20%+ more than the old top; diesels offer no E85
- E85 as in the real world: ~1.3x the fuel use of 98; with the flex sensor (it adds timing) and enough fuel a turbo engine
  makes 6%+ more on its stock map, an NA one 2-6%; below 10 °C it misfires on a cold start (98 and a warm day don't)
- water-meth adds margin and cools the charge on boost; E85 without the flex-fuel sensor runs ~6% lean; bigger injectors
  on an untouched stock map run rich and warn; the light pulley adds ~1%; a flywheel only on clutch cars (DCT, SMG, PDK, manual)
- every preset predicts, and fitted on its own hardware raises nothing critical (the new presets: no rod, gearbox or rev warnings)
- blue smoke follows worn rings (overrun), gasket (steady), PCV (overrun), turbo (boost), faint at 60%, and burns oil;
  black on a petrol: a stock pull at most a haze, clear with leaking injectors, a rich map, big injectors on a stock map
  or misfires, never at idle or cruise
- `engineblow` fires once with `{ cause, cyl, rpm, speed }`, `ch.blown` / `blown()` hold until the rebuild, an engine that
  loads blown never fires it and vetoes the start
- every saved tune loads and predicts what the old code did (only an untouched stock map with bigger injectors may differ)

Worst cases against the controller's limits (`tune.parts` 60, `tune.wear` 80, `stats.mods` 80): the 530e saves 48 parts
(46 + two left over from older catalogues), the E60 37 wear rows, mods at most 45.
