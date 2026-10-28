// Tuning, injected after car-perf.js. A car opts in while its own script runs (before the page is built):
//
//   CarTune.init({ engine, torque, rev, shift, launch, vmax, finalDrive, setMap, onChange, slot, slots })
//        engine     - a key of ENGINES below (its stock maps, turbos, limits, presets and part catalogue)
//        torque     - the car's stock full-load torque table [[rpm, Nm], ...]
//        rev / shift / launch (rpm), vmax (km/h, 0 = none), finalDrive - the car's stock figures
//        setMap(n)  - the car's own map switch (Map 1 / Map 2 = calibration slots 1 and 2)
//        slot       - the slot to start on (default: engine_map 2 = Map 2)
//        slots      - [preset, preset] for Map 1 / Map 2 on a car with no saved tune yet (default stock / stage1); the
//                     parts the starting slot's preset needs are fitted with it, so a car's old map carries over as it was
//        onChange(T) - called with the live settings whenever they change (slot, edit, part, limp mode):
//          T.rev / T.shift / T.launch (krpm), T.vmax, T.finalDrive, T.grip, T.shiftCut [s, depth], T.burble
//   CarTune.setSlot(n)       - from the car's setMap: which calibration drives the engine
//   CarTune.boostAt(rpmK)    - full-pedal boost target (bar) at this rpm: the map, capped by the turbo, limp mode
//   CarTune.tick({ dt, ignition, rpm, pedal, boost, speed, gear, coolant, fuelCut }) -> { tqMul, cut, egt, fuelMul }
//        once per frame, after the car's boost: tqMul scales its stock torque curve, cut scales the pedal's torque
//        (speed limiter, misfires), egt is the exhaust temperature target, fuelMul scales its fuel flow
//   CarTune.label(n)         - "Stage 1 · 236 hp" for the car's map readout
//
// Everything else is owned here: the engine model (air, fuel, ignition / injection), per-cylinder knock and
// detonation, wear of the tuning-sensitive parts (registered as CarService parts), fault codes and limp mode,
// knock / misfire sounds, the Tuning tab (maps, parts, datalog, guide) and the live data + service functions
// car-diagnostics.js shows. Saved with every CarAPI.save() as { tune }.
(function () {
  const S = window.__CAR_STATE__ || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clamp01 = (v) => clamp(v, 0, 1);
  const ease = (cur, target, tau, dt) => cur + (target - cur) * Math.min(1, dt / tau);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const interp = (axis, vals, x) => {
    if (x <= axis[0]) return vals[0];
    for (let i = 1; i < axis.length; i++) if (x <= axis[i]) return vals[i - 1] + (vals[i] - vals[i - 1]) * (x - axis[i - 1]) / (axis[i] - axis[i - 1]);
    return vals[vals.length - 1];
  };
  const tableAt = (t, x) => interp(t.map((p) => p[0]), t.map((p) => p[1]), x);
  const PS = (tq, rpm) => tq * rpm * Math.PI / 30 / 735.5; // the cars' own hp figure (metric)

  // ================= engines: stock calibration, turbos, hardware limits =================
  const ENGINES = {
    B58: {
      fuel: 'petrol', name: 'B58B30 3.0 turbo I6', cyl: 6, maxRpm: 7400, tstat: 92,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
      boost: [0.25, 0.75, 1.0, 1.05, 1.05, 1.05, 1.05, 1.0, 0.98, 0.95, 0.9, 0.85, 0.8],
      afr: [13.0, 12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 11.9, 11.8, 11.8, 11.7],
      // knock margin over the stock timing on RON 95 at stock boost / 45 °C intake: lugging low down is the worst
      margin: [1.6, 1.0, 1.0, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.2, 3.4, 3.5],
      cylMargin: [0, 0.2, 0, -0.3, -0.2, -0.6], // cylinder 6 runs hottest (coolant flows front to back)
      turbos: {
        stock: [0.35, 0.95, 1.3, 1.45, 1.5, 1.5, 1.5, 1.45, 1.4, 1.3, 1.2, 1.1, 1.0],
        hybrid: [0.25, 0.75, 1.2, 1.65, 1.85, 1.95, 1.95, 1.9, 1.85, 1.8, 1.7, 1.6, 1.5],
        big: [0.1, 0.35, 0.8, 1.3, 1.75, 2.15, 2.4, 2.45, 2.45, 2.4, 2.35, 2.25, 2.15],
      },
      krpm: { stock: 220, hybrid: 200, big: 165 }, // each turbo's rated shaft speed (x1000 rpm): bigger wheels spin slower
      tq: 500, rod: 720, trans: { name: 'ZF 8HP45', cap: 660, uprated: 850, built: 1000 }, // rod: what the stock con-rods take (Nm)
    },
    B47: {
      fuel: 'diesel', name: 'B47D20 2.0 diesel I4', cyl: 4, maxRpm: 6400, pcpLimit: 210, tstat: 88,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000],
      boost: [0.25, 0.85, 1.45, 1.55, 1.55, 1.5, 1.4, 1.25, 1.05],
      rail: [700, 1200, 1700, 1900, 2000, 2000, 2000, 1950, 1900],
      lambda: [1.45, 1.3, 1.22, 1.2, 1.2, 1.22, 1.25, 1.28, 1.32], // stock full-load lambda
      turbos: {
        stock: [0.35, 1.05, 1.75, 1.9, 1.95, 1.9, 1.8, 1.65, 1.45],
        hybrid: [0.3, 0.9, 1.7, 2.2, 2.45, 2.45, 2.35, 2.2, 2.0],
      },
      krpm: { stock: 230, hybrid: 210 },
      tq: 400, rod: 560, trans: { name: 'ZF 8HP50', cap: 560, uprated: 800, built: 950 },
    },
    // M3 Competition Touring: twin mono-scroll turbos. The stock map holds ~1.7 bar flat (the car spools it); its
    // bootmod3 Stage 1 + TCU flash is the preset
    S58: {
      fuel: 'petrol', name: 'S58B30 3.0 twin-turbo I6', cyl: 6, maxRpm: 7600, tstat: 92,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
      boost: [1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7],
      afr: [12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 11.9, 11.8, 11.7, 11.7, 11.6],
      margin: [1.8, 1.3, 1.3, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.2, 3.4, 3.6, 3.7], // forged internals, good cooling: safe on RON 95 stock
      cylMargin: [0, 0.2, 0, -0.3, -0.2, -0.6],
      turboLabel: 'Turbochargers',
      turboOpts: [['stock', 'Stock twins', 'Two mono-scroll turbos, one per three cylinders: ~2.2 bar before they run out of breath.'],
        ['hybrid', 'Hybrid twins', 'Bigger compressor wheels in the stock housings: ~2.6 bar, a touch more lag.', { sound: { turbo: 1.25 } }],
        ['big', 'Big twins', 'Big-turbo upgrade: ~3 bar and a huge top end, softer below 3,000 rpm.', { sound: { turbo: 1.45 } }]],
      turbos: {
        stock: [1.85, 2.0, 2.15, 2.25, 2.3, 2.3, 2.3, 2.25, 2.2, 2.15, 2.1, 2.0, 1.9],
        hybrid: [1.5, 1.9, 2.2, 2.45, 2.6, 2.65, 2.65, 2.6, 2.55, 2.5, 2.45, 2.35, 2.25],
        big: [0.8, 1.2, 1.7, 2.2, 2.6, 2.9, 3.0, 3.0, 2.95, 2.9, 2.85, 2.75, 2.6],
      },
      krpm: { stock: 200, hybrid: 185, big: 160 },
      tq: 650, rod: 950, trans: { name: 'ZF 8HP76', cap: 850, uprated: 1050, built: 1250 },
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory Competition calibration: 530 hp / 650 Nm, 280 km/h limiter.', needs: {}, make: (e, s) => s },
        { id: 'bm3', name: 'BM3 Stage 1', desc: 'bootmod3 Stage 1 + TCU flash: ~1.95 bar, more timing, quicker and later shifts. ~590 hp / 730 Nm on RON 98.',
          needs: { fuel: ['98', '102', 'e85'] },
          make: (e, s) => ({ ...s, boost: [1.95, 1.95, 1.95, 1.95, 1.95, 1.95, 1.95, 1.95, 1.95, 1.9, 1.85, 1.8, 1.75],
            timing: e.axis.map((r) => (r < 3000 ? 0.5 : 1.5)), afr: add(s.afr, -0.2), tq: 730, shiftSpeed: 1 }) },
      ],
    },
    // M5 CS: a twin-scroll pair in the vee. Stock holds ~1.7 bar flat (the car spools it); its bootmod3 maps are the presets
    S63: {
      fuel: 'petrol', name: 'S63B44T4 4.4 twin-turbo V8', cyl: 8, maxRpm: 7600, tstat: 92,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
      boost: [1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7],
      afr: [12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 11.9, 11.8, 11.7, 11.7, 11.6],
      margin: [2.6, 2.4, 2.6, 2.9, 3.3, 3.7, 4.0, 4.3, 4.5, 4.7, 4.9, 5.0, 5.0], // forged, closed-deck, hot-vee cooling: a lot of margin
      cylMargin: [0, 0.1, -0.2, -0.4, 0, 0.2, -0.3, -0.5],
      turboLabel: 'Turbochargers',
      turboOpts: [['stock', 'Stock twins', 'Twin-scroll pair in the hot vee: good for ~2.5 bar on a Stage 2 map.'],
        ['hybrid', 'Hybrid twins', 'Bigger compressor wheels in the stock housings: ~2.9 bar, a little more lag.', { sound: { turbo: 1.25 } }],
        ['big', 'Big twins', 'Big-turbo kit: ~3.3 bar and an enormous top end, soft below 3,000 rpm.', { sound: { turbo: 1.45 } }]],
      turbos: {
        stock: [1.9, 2.15, 2.45, 2.65, 2.8, 2.85, 2.85, 2.85, 2.8, 2.75, 2.65, 2.55, 2.45],
        hybrid: [1.5, 1.9, 2.35, 2.75, 3.0, 3.15, 3.2, 3.2, 3.15, 3.1, 3.05, 2.95, 2.85],
        big: [0.8, 1.2, 1.8, 2.4, 2.9, 3.25, 3.45, 3.5, 3.5, 3.45, 3.4, 3.3, 3.15],
      },
      krpm: { stock: 185, hybrid: 170, big: 150 },
      tq: 750, rod: 1150, trans: { name: 'ZF 8HP75', cap: 950, uprated: 1150, built: 1350 },
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory CS calibration: 635 hp / 750 Nm.', needs: {}, make: (e, s) => s },
        { id: 'bm3s1', name: 'BM3 Stage 1', desc: 'bootmod3 Stage 1 + TCU flash: a touch more boost and timing, quicker and later shifts. ~686 hp / 810 Nm.', needs: {},
          make: (e, s) => ({ ...s, boost: e.axis.map((r) => (r < 6000 ? 1.85 : 1.8)), timing: e.axis.map((r) => (r < 2500 ? 0.5 : 1)),
            afr: add(s.afr, -0.1), tq: 810, shiftSpeed: 1 }) },
        { id: 'bm3s2', name: 'BM3 Stage 2', desc: 'Downpipes, intake and ~2.5 bar on the stock turbos: ~830 hp / 1,000 Nm. Needs RON 98, a bigger radiator and uprated gearbox packs.',
          needs: { downpipe: ['sport', 'catless'], intake: ['open'], chargepipe: ['alu'], diverter: ['piston'], radiator: ['alu', 'race'], fuel: ['98', '102', 'e85'], trans: ['uprated', 'built'] },
          make: (e, s) => ({ ...s, boost: [1.9, 2.1, 2.25, 2.4, 2.55, 2.55, 2.55, 2.55, 2.5, 2.45, 2.35, 2.25, 2.15],
            timing: e.axis.map((r) => (r < 2500 ? 0 : r < 4500 ? 0.5 : 1.5)), afr: add(s.afr, -0.2), tq: 1050, shiftSpeed: 1 }) },
      ],
    },
    // 550d Mk2 (M550d): two high-pressure + two low-pressure turbos. Its old maps are the presets: stock, the bootmod3
    // flash, and the big-turbo build with and without it - those need the turbos, internals and gearbox to take it
    B57S: {
      fuel: 'diesel', name: 'B57D30S0 3.0 quad-turbo diesel I6', cyl: 6, maxRpm: 6800, pcpLimit: 260, tstat: 88,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000],
      boost: [0.5, 1.3, 1.9, 2.0, 2.0, 2.0, 1.95, 1.85, 1.75, 1.6, 1.45],
      rail: [900, 1500, 2000, 2300, 2500, 2500, 2500, 2500, 2450, 2400, 2350],
      lambda: [1.5, 1.4, 1.35, 1.35, 1.35, 1.35, 1.37, 1.4, 1.42, 1.45, 1.48],
      turboLabel: 'Turbochargers',
      turboOpts: [['stock', 'Stock quad-turbo', 'Two small high-pressure and two large low-pressure turbos: boost from just off idle, ~2.4 bar.'],
        ['big', 'Big turbos', 'Much larger turbos: ~4 bar and a huge top end - but they wake up late and build slowly.']],
      turbos: {
        stock: [0.7, 1.6, 2.2, 2.35, 2.4, 2.4, 2.35, 2.3, 2.2, 2.05, 1.9],
        big: [0.3, 0.8, 1.7, 2.7, 3.5, 3.95, 4.2, 4.2, 4.1, 3.9, 3.7],
      },
      krpm: { stock: 240, big: 175 },
      tq: 760, rod: 1000, trans: { name: 'ZF 8HP76', cap: 950, uprated: 1250, built: 1600 },
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory M550d calibration: 400 hp / 760 Nm.', needs: {}, make: (e, s) => s },
        { id: 'bm3', name: 'BM3 Stage 1', desc: 'bootmod3 flash on the stock turbos: more fuel, boost and advance. ~460 hp / 875 Nm.', needs: {},
          make: (e, s) => ({ ...s, iq: [108, 117, 117, 117, 117, 115, 112, 110, 108, 106, 104], boost: e.boost.map((b) => +(b * 1.15).toFixed(2)),
            soi: e.axis.map((r) => (r < 1500 ? 0.5 : 1.5)), rail: s.rail.map((r) => Math.min(2600, r + 100)), smoke: 1.1, tq: 875 }) },
        { id: 'big', name: 'Big turbos', desc: 'The big-turbo build: ~3.3 bar, forged internals, a built gearbox. ~580 hp / 1,300 Nm.',
          needs: { turbo: ['big'], internals: ['forged', 'built'], gasket: ['mls', 'oring'], trans: ['built'], intercooler: ['big'], chargepipe: ['alu'], radiator: ['race'], injectors: ['race'], pump: ['race'], lpfp: ['uprated'] },
          make: (e, s) => ({ ...s, iq: [140, 150, 165, 180, 182, 152, 134, 131, 131, 131, 131], boost: [0.3, 0.8, 1.7, 2.6, 3.3, 3.3, 3.3, 3.25, 3.15, 3.0, 2.85],
            soi: e.axis.map((r) => (r < 2000 ? 1 : 2)), rail: s.rail.map((r) => Math.min(2700, r + 200)), smoke: 1.04, tq: 1300, egr: false }) },
        { id: 'bigbm3', name: 'Big turbos + BM3', desc: 'The big-turbo build flashed with bootmod3: ~3.7 bar, fully built engine. ~660 hp / 1,400 Nm - cylinder pressure is the limit.',
          needs: { turbo: ['big'], internals: ['built'], gasket: ['oring'], trans: ['built'], intercooler: ['big'], chargepipe: ['alu'], radiator: ['race'], injectors: ['race'], pump: ['race'], lpfp: ['uprated'] },
          make: (e, s) => ({ ...s, iq: [150, 165, 185, 205, 210, 178, 155, 151, 151, 151, 151], boost: [0.3, 0.8, 1.7, 2.7, 3.4, 3.6, 3.7, 3.7, 3.6, 3.45, 3.25],
            soi: e.axis.map((r) => (r < 2000 ? 1 : 1.5)), rail: s.rail.map((r) => Math.min(2700, r + 200)), smoke: 1.02, tq: 1500, egr: false }) },
      ],
    },
    // 530e: the B48 in its gentle 184 PS tune, paired with the eDrive motor. The tune is the engine's; the hybrid
    // system's caps (252 PS / 420 Nm stock) follow what the engine makes. Its old maps are the presets
    B48: {
      fuel: 'petrol', name: 'B48B20 2.0 turbo I4', cyl: 4, maxRpm: 7400, tstat: 92,
      fuelHead: 1.35, // the 530i's injectors and pump, run at 184 PS
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
      boost: [0.3, 0.95, 1.25, 1.3, 1.3, 1.3, 1.3, 1.25, 1.15, 1.05, 0.95, 0.85, 0.8],
      afr: [13.0, 12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 11.9, 11.8, 11.8, 11.7],
      margin: [2.0, 1.4, 1.4, 1.6, 1.9, 2.2, 2.5, 2.8, 3.1, 3.4, 3.6, 3.8, 3.9],
      cylMargin: [0, 0.2, -0.2, -0.4],
      turboOpts: [['stock', 'Stock', 'Twin-scroll single turbo - the 530e runs it gently, it has ~2 bar in it.'],
        ['hybrid', 'Hybrid', 'Bigger compressor wheel: ~2.4 bar up top, a little more lag.', { sound: { turbo: 1.25 } }]],
      turbos: {
        stock: [0.45, 1.25, 1.75, 1.95, 2.05, 2.05, 2.05, 2.05, 2.0, 1.95, 1.9, 1.85, 1.8],
        hybrid: [0.3, 1.0, 1.6, 2.1, 2.35, 2.45, 2.5, 2.5, 2.45, 2.4, 2.35, 2.3, 2.2],
      },
      krpm: { stock: 230, hybrid: 210 },
      tq: 290, rod: 520, trans: { name: 'ZF 8HP eDrive', cap: 520, uprated: 700, built: 850 },
      // the eDrive side: the car reads these off T.hw. The motor makes min(its torque, the inverter's kW, what the
      // battery can deliver through the inverter); upgrades past stock add to the system's 252 PS / 420 Nm caps
      parts: [
        { k: 'motor', group: 'Hybrid', label: 'Electric motor', opts: [
          ['stock', '250 Nm', 'Factory permanent-magnet motor in the gearbox: 250 Nm from standstill, 140 km/h on electric.', { motorTq: 250, evMax: 140 }],
          ['rewound', 'Rewound', 'Rewound stator with more copper and stronger magnets: 300 Nm off the line.', { motorTq: 300, evMax: 140 }],
          ['hairpin', 'Hairpin', 'Hairpin-wound stator and a new rotor: 350 Nm and it spins to 160 km/h on electric. All of it goes through the gearbox clutch packs.', { motorTq: 350, evMax: 160 }]] },
        { k: 'inverter', group: 'Hybrid', label: 'Power electronics', opts: [
          ['stock', '83 kW', 'Factory IGBT inverter: 83 kW to the motor, ~92% efficient.', { motorKw: 83, invEff: 0.92 }],
          ['uprated', '110 kW', 'Uprated IGBT modules and busbars: 110 kW to the motor - the XtraBoost overboost, held flat out.', { motorKw: 110, invEff: 0.92 }],
          ['sic', '140 kW SiC', 'Silicon-carbide inverter: 140 kW and ~97% efficient - more range per kWh. The stock pack can\'t feed all of it.', { motorKw: 140, invEff: 0.97 }]] },
        { k: 'battery', group: 'Hybrid', label: 'HV battery', opts: [
          ['stock', '12 kWh', 'Factory pack under the rear seat: 12 kWh usable, ~125 kW out, 60 kW of regen in.', { battKwh: 12, battKw: 125, regenKw: 60, mass: 0 }],
          ['hd', 'High-discharge', 'Power cells in the same case: still 12 kWh, but ~180 kW out and 90 kW of regen in.', { battKwh: 12, battKw: 180, regenKw: 90, mass: 0 }],
          ['ext', '18 kWh', 'Denser cells: 18 kWh (~50% more electric range), ~150 kW out, 75 kW regen - and 35 kg heavier.', { battKwh: 18, battKw: 150, regenKw: 75, mass: 35 }]] },
        { k: 'charger', group: 'Hybrid', label: 'On-board charger', opts: [
          ['stock', '3.7 kW', 'Factory single-phase charger.', { chargeKw: 3.7 }],
          ['7kw', '7.4 kW', 'Bigger single-phase charger: twice as fast on the plug.', { chargeKw: 7.4 }],
          ['11kw', '11 kW', 'Three-phase charger: three times as fast on the plug.', { chargeKw: 11 }]] },
      ],
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory 530e calibration: 184 PS / 290 Nm from the engine - 252 PS / 420 Nm with the motor.', needs: {}, make: (e, s) => s },
        { id: 'xtraboost', name: 'XtraBoost', desc: 'The LCI calibration: boost held higher up, revs to 7,300. 292 PS with the motor, the same 420 Nm.', needs: {},
          make: (e, s) => ({ ...s, boost: [0.3, 0.95, 1.25, 1.3, 1.3, 1.3, 1.3, 1.35, 1.4, 1.4, 1.35, 1.3, 1.25], timing: e.axis.map((r) => (r < 4000 ? 0 : 0.5)),
            rev: 7300, shift: 7000 }) },
        { id: 'stage1', name: 'Stage 1', desc: '~1.85 bar held to the redline and more timing, on RON 98 with a bigger radiator: ~245 PS / 370 Nm from the engine, ~335 PS / 535 Nm with the motor.',
          needs: { fuel: ['98', '102', 'e85'], radiator: ['alu', 'race'] },
          make: (e, s) => ({ ...s, boost: [0.3, 1.1, 1.55, 1.75, 1.85, 1.85, 1.85, 1.85, 1.8, 1.75, 1.7, 1.65, 1.6], timing: e.axis.map((r) => (r < 3500 ? 0.5 : 1.5)),
            afr: add(s.afr, -0.2), tq: 400, rev: 7300, shift: 7000 }) },
      ],
    },
    // X1 xDrive20d (E84): the X1's own maps are the presets - Stage 1 is the remap it was dyno'd on (190 hp / 400 Nm)
    N47: {
      fuel: 'diesel', name: 'N47D20 2.0 diesel I4', cyl: 4, maxRpm: 5200, pcpLimit: 205, tstat: 88,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000],
      boost: [0.2, 0.75, 1.3, 1.45, 1.5, 1.5, 1.4, 1.25, 1.1],
      rail: [600, 1100, 1500, 1700, 1800, 1800, 1800, 1750, 1700],
      lambda: [1.5, 1.38, 1.32, 1.3, 1.3, 1.3, 1.32, 1.35, 1.38], // the stock N47 runs lean at full load - why a remap finds so much
      turboOpts: [['stock', 'Stock VGT', 'Small variable-geometry turbo: strong low down, chokes past ~2.2 bar.'],
        ['hybrid', 'Hybrid VGT', 'Bigger compressor and turbine in the stock housing: ~2.5 bar, a touch more lag.', { sound: { turbo: 1.25 } }],
        ['big', 'Big VGT', 'A 3.0-diesel-sized VGT on an adapter: ~2.95 bar and a big top end, lazy below 2,000 rpm.', { sound: { turbo: 1.45 } }],
        ['race', 'Race single', 'Ball-bearing race turbo on a tubular manifold: ~3.6 bar and a savage top end, almost nothing below 2,500 rpm.', { sound: { turbo: 1.7 } }]],
      turbos: {
        stock: [0.3, 1.0, 1.75, 2.15, 2.2, 2.2, 2.1, 1.95, 1.75],
        hybrid: [0.25, 0.8, 1.6, 2.2, 2.45, 2.5, 2.4, 2.25, 2.05],
        big: [0.15, 0.45, 1.1, 1.85, 2.5, 2.85, 2.95, 2.9, 2.8],
        race: [0.1, 0.3, 0.7, 1.3, 2.1, 2.9, 3.4, 3.6, 3.6],
      },
      krpm: { stock: 225, hybrid: 205, big: 180, race: 150 },
      bigIc: { ic: 0.89, soak: 2 }, // the X1's big core is a size up on the other diesels' (0.86 / 3)
      // steps past twin pumps; each brings its own lift pump (lp), replacing whatever the Lift pump part feeds
      pumpOpts: [['railkit', 'Race rail kit', 'Twin pumps, a bigger-bore rail and lines, and its own high-flow lift pump: holds rail pressure at ~2.7x the stock fuelling.', { pump: 2.7, lp: 2.9 }],
        ['billet', 'Billet 3,000 bar', 'Billet race pump and rail rated to 3,000 bar, with its own lift pump: holds rail pressure at ~3.2x the stock fuelling.', { pump: 3.2, lp: 3.4 }]],
      curveMax: { iq: 260, rail: 3000 }, // the editor reaches what the billet pump can feed
      tq: 311, rod: 480, trans: { name: 'ZF 6HP21', cap: 480, uprated: 650, built: 800 },
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory calibration: 152 hp / 311 Nm on the dyno, fuel cut at 4,200 rpm.', needs: {}, make: (e, s) => s },
        { id: 'stage1', name: 'Stage 1', desc: 'The remap it was dyno\'d on: 190 hp / 400 Nm on factory hardware.', needs: {},
          make: (e, s) => ({ ...s, iq: [100, 112, 125, 132, 132, 129, 124, 120, 116], boost: [0.2, 0.85, 1.55, 1.75, 1.75, 1.75, 1.65, 1.5, 1.35],
            soi: [0, 0.5, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], rail: s.rail.map((r) => Math.min(1900, r + 100)), smoke: 1.08, tq: 400, rev: 4850, shift: 4450 }) },
        { id: 'stage2', name: 'Stage 2', desc: 'Downpipe, open intake, bigger intercooler and radiator, EGR + DPF delete, uprated injectors and pump, ~2 bar: ~220 hp / 460 Nm.',
          needs: { downpipe: ['delete'], intake: ['open'], intercooler: ['big'], chargepipe: ['alu'], radiator: ['alu', 'race'], egr: ['blank'], injectors: ['uprated'], pump: ['uprated'] },
          make: (e, s) => ({ ...s, iq: [100, 122, 142, 152, 154, 154, 152, 148, 142], boost: [0.2, 0.95, 1.8, 2.0, 2.0, 2.0, 1.9, 1.75, 1.55],
            soi: [0, 1, 1.5, 2, 2, 2, 2, 2, 2], rail: s.rail.map((r) => Math.min(2000, r + 200)), smoke: 1.04, tq: 462, rev: 4900, shift: 4500, egr: false, dpf: false }) },
        // also stretches the fuel editor past 180%, which the big turbo's air needs
        { id: 'stage3', name: 'Stage 3', desc: 'Big VGT, race injectors and twin pumps, a built engine and gearbox: ~2.7 bar and ~200% fuel. ~305 hp / 535 Nm.',
          needs: { turbo: ['big'], internals: ['built'], gasket: ['mls', 'oring'], trans: ['built'], intercooler: ['big'], chargepipe: ['alu'], radiator: ['race'],
            downpipe: ['delete'], intake: ['open'], egr: ['blank'], injectors: ['race'], pump: ['race', 'railkit', 'billet'], lpfp: ['uprated'] },
          make: (e, s) => ({ ...s, iq: [100, 115, 135, 170, 200, 195, 195, 195, 205], boost: [0.2, 0.5, 1.1, 1.8, 2.3, 2.6, 2.7, 2.65, 2.55],
            soi: [0, 1, 1.5, 2, 2, 2, 2, 2, 2], rail: s.rail.map((r) => Math.min(2050, r + 250)), smoke: 1.08, tq: 560, rev: 5200, shift: 4800, egr: false, dpf: false }) },
      ],
    },
    // 911 GT3 RS (992): the 4.0 naturally aspirated flat-six, 13.3:1 and 9,000 rpm. Its "stock" turbo is none - no
    // boost, so the boost map does nothing - and a twin-turbo kit goes on like any turbo upgrade; it only lives with
    // low-compression internals, intercoolers and a lot more fuel. na: knock comes with load, not boost
    GT3: {
      fuel: 'petrol', name: '4.0 NA flat-six', cyl: 6, maxRpm: 9400, tstat: 92, na: true,
      axis: [1000, 2000, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000],
      boost: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      afr: [13.0, 12.9, 12.8, 12.8, 12.7, 12.7, 12.7, 12.6, 12.6, 12.6, 12.6, 12.5, 12.5, 12.5, 12.5],
      // written for RON 98 (Porsche's spec): on 95 it's knock-limited around peak torque - a little less power
      margin: [0.6, 0.4, 0, -0.2, -0.3, -0.3, -0.2, 0, 0.3, 0.6, 0.9, 1.1, 1.3, 1.4, 1.5],
      cylMargin: [0, 0.2, -0.2, 0, -0.3, -0.4],
      turboOpts: [['stock', 'None (NA)', 'Naturally aspirated through six throttle bodies: no turbo, so the boost map does nothing.', { sound: { turbo: 0 } }],
        ['twin', 'Twin-turbo kit', 'A turbo per bank on new headers: ~1.2 bar from 5,000 rpm. Needs low-compression internals, intercoolers and far more fuel.'],
        ['big', 'Big twin kit', 'Larger twins: ~1.65 bar and an enormous top end, but little below 4,500 rpm.', { sound: { turbo: 1.3 } }]],
      turbos: {
        stock: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        twin: [0.05, 0.25, 0.6, 0.85, 1.05, 1.15, 1.2, 1.2, 1.2, 1.15, 1.1, 1.05, 1.0, 0.95, 0.9],
        big: [0, 0.1, 0.3, 0.5, 0.75, 1.0, 1.25, 1.45, 1.6, 1.65, 1.65, 1.6, 1.55, 1.5, 1.45],
      },
      krpm: { stock: 0, twin: 190, big: 160 },
      tq: 465, rod: 700, trans: { name: 'PDK 7-speed', cap: 700, uprated: 900, built: 1100 },
      // the parts that read wrong on an NA engine: a turbo build's plumbing isn't there until a kit is, and the tank
      // holds Super Plus as delivered
      swap: {
        intercooler: { opts: [['stock', 'None', 'Nothing to cool on the NA engine. With a turbo kit the charge goes in straight off the compressors - hot.', { ic: 0, soak: 0 }],
          ['kit', 'Kit cores', 'Air-to-air cores behind the rear intakes, as on a 911 Turbo: what a turbo build needs.', { ic: 0.8, soak: 6 }],
          ['big', 'Big cores', 'Larger cores: cooler, steadier intake temps over repeated pulls.', { ic: 0.88, soak: 3 }]] },
        chargepipe: { opts: [['stock', 'Kit pipes', 'The turbo kit\'s own silicone and plastic pipes (nothing on the NA engine): hard pulls on high boost fatigue them until one splits.'],
          ['alu', 'Aluminium', 'Aluminium pipes and silicone couplers: hold any boost and barely age.', { cpWear: 0.08 }]] },
        diverter: { opts: [['stock', 'Kit diaphragm', 'The turbo kit\'s diaphragm valves (nothing on the NA engine): high boost tears them and they bleed boost.'],
          ['piston', 'Uprated piston', 'Billet piston valves: hold any boost, a crisper whoosh, practically never wear.', { dvWear: 0.1, sound: { turbo: 1.05 } }]] },
        intake: { opts: [['stock', 'Stock', 'Carbon airbox feeding the six throttle bodies.'],
          ['open', 'Race intake', 'Freer filter and a bigger plenum: +1.5% flow up top and a louder induction howl.', { flow: 0.015, iat: 1, sound: { intake: 1.3, turbo: 1.15 } }]] },
        downpipe: { label: 'Headers & cats', opts: [['stock', 'Stock', 'Factory stainless headers with their catalysts.'],
          ['sport', 'Sport cats', '200-cell cats: +2.5% flow and cooler exhaust - a turbo kit spools sooner.', { flow: 0.025, egt: -15, spool: -100, sound: { ex: 1.15, turbo: 1.1 } }],
          ['catless', 'Race headers', 'Equal-length race headers, no cats: +4% flow, the loudest. Off-road only - the cat monitor flags P0420.', { flow: 0.04, egt: -25, spool: -150, sound: { ex: 1.3, turbo: 1.2 }, catless: true }]] },
        fuel: { opts: [['98', 'RON 98', 'Super Plus: what Porsche specifies for the GT3, and what the stock map is written for.', { octane: 2, k: 1 }],
          ['95', 'RON 95', 'Regular premium: allowed, but the stock map is knock-limited on it around peak torque - a little less power.', { octane: 0, k: 1 }],
          ['102', 'RON 102', 'Race fuel: ~5° more margin than RON 95 - what a turbo build on the stock fuel system runs.', { octane: 5, k: 1 }],
          ['e85', 'E85', 'Ethanol: ~9° more margin and a cooler charge, but ~40% more fuel flow than a turbo build\'s pumps can give.', { octane: 9, k: 1.4, iat: -6 }]] },
      },
      presets: [
        { id: 'stock', name: 'Stock', desc: 'Factory GT3 RS calibration: 525 hp / 465 Nm, 9,000 rpm, no speed limiter.', needs: {}, make: (e, s) => s },
        { id: 'stage1', name: 'Stage 1', desc: 'ECU flash with sport cats on RON 98: more timing up top and 9,200 rpm. ~545 hp / 480 Nm.', needs: { downpipe: ['sport', 'catless'], fuel: ['98', '102', 'e85'] },
          make: (e, s) => ({ ...s, timing: e.axis.map((r) => (r < 4000 ? 0.5 : 1.5)), rev: 9200, shift: 9050, tq: 490 }) },
        { id: 'stage2', name: 'Stage 2', desc: 'Race headers and intake, fast-road cams on uprated springs and an alloy radiator, 9,400 rpm: ~585 hp / 515 Nm.',
          needs: { downpipe: ['catless'], intake: ['open'], cams: ['fast', 'race'], springs: ['uprated', 'titanium'], radiator: ['alu', 'race'], fuel: ['98', '102', 'e85'] },
          make: (e, s) => ({ ...s, timing: e.axis.map((r) => (r < 4000 ? 0.5 : 1.5)), afr: add(s.afr, -0.1), rev: 9400, shift: 9250, tq: 540, dpf: false }) }, // cat monitor off for the race headers
        { id: 'twin', name: 'Twin-turbo', desc: 'The twin-turbo kit at ~0.7 bar on RON 102: built low-compression engine, intercoolers, port injection, uprated pumps, gearbox packs and a race radiator. ~850 hp / 750 Nm.',
          needs: { turbo: ['twin', 'big'], internals: ['built'], gasket: ['mls', 'oring'], intercooler: ['kit', 'big'], chargepipe: ['alu'], diverter: ['piston'],
            injection: ['port'], hpfp: ['uprated'], lpfp: ['uprated'], fuel: ['102'], trans: ['uprated', 'built'], radiator: ['race'] },
          make: (e, s) => ({ ...s, boost: e.turbos.twin.map((c) => +Math.min(0.7, c * 0.95).toFixed(2)), afr: e.axis.map((r) => (r < 3000 ? 12.6 : 11.7)),
            tq: 850, rev: 8600, shift: 8400, shiftSpeed: 1 }) },
        { id: 'bigtwin', name: 'Big twins', desc: 'The big twin kit at ~0.9 bar on RON 102 with everything built: ~960 hp / 850 Nm. Runs hot flat out even on the race radiator.',
          needs: { turbo: ['big'], internals: ['built'], gasket: ['oring'], intercooler: ['big'], chargepipe: ['alu'], diverter: ['piston'],
            injection: ['port'], hpfp: ['uprated'], lpfp: ['uprated'], fuel: ['102'], trans: ['built'], radiator: ['race'] },
          make: (e, s) => ({ ...s, boost: e.turbos.big.map((c) => +Math.min(0.9, c * 0.95).toFixed(2)), afr: e.axis.map((r) => (r < 3000 ? 12.6 : 11.8)),
            tq: 1050, rev: 8600, shift: 8400, shiftSpeed: 1 }) },
      ],
    },
    // 335i (E90 LCI): the N55 3.0 straight-six on one twin-scroll turbo, Valvetronic and direct injection - the stock
    // map runs ~0.85 bar and tapers up top; the petrol presets (stage 1-3) build on it
    N55: {
      fuel: 'petrol', name: 'N55B30 3.0 turbo I6', cyl: 6, maxRpm: 7200, tstat: 92,
      axis: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
      boost: [0.35, 0.8, 0.85, 0.85, 0.85, 0.85, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55],
      afr: [13.0, 12.8, 12.6, 12.5, 12.4, 12.3, 12.2, 12.1, 12.0, 11.9, 11.8, 11.8, 11.7],
      margin: [1.4, 0.8, 0.8, 1.0, 1.3, 1.6, 1.9, 2.2, 2.5, 2.8, 3.0, 3.2, 3.3],
      cylMargin: [0, 0.2, 0, -0.3, -0.2, -0.6], // cylinder 6 runs hottest
      turbos: {
        stock: [0.45, 1.0, 1.15, 1.2, 1.2, 1.2, 1.15, 1.1, 1.05, 1.0, 0.95, 0.9, 0.85],
        hybrid: [0.3, 0.8, 1.2, 1.5, 1.65, 1.7, 1.7, 1.65, 1.6, 1.55, 1.45, 1.35, 1.25],
        big: [0.1, 0.35, 0.75, 1.2, 1.6, 1.95, 2.15, 2.2, 2.2, 2.15, 2.1, 2.0, 1.9],
      },
      krpm: { stock: 220, hybrid: 200, big: 165 },
      tq: 400, rod: 600, trans: { name: 'ZF 6HP21', cap: 500, uprated: 650, built: 800 },
      swap: { // the E9x has an air-to-air front-mount, not the B58's water-to-air
        intercooler: { opts: [['stock', 'Stock', 'Front-mounted air-to-air: heat-soaks over repeated pulls.', { ic: 0.8, soak: 10 }],
          ['big', 'Big front-mount', 'Larger stepped core: cooler, steadier intake temps.', { ic: 0.9, soak: 4 }]] },
      },
    },
  };

  // ================= part catalogue: what fits, and what each option changes =================
  const opt = (id, label, desc, fx = {}) => ({ id, label, desc, fx });
  // the bottom end, valvetrain and lubrication, the cooling system, the brakes and the suspension - on both engines
  const VALVETRAIN = (fuel) => [
    { k: 'cams', group: 'Engine', label: 'Camshafts', opts: fuel === 'petrol' ? [
      opt('stock', 'Stock', 'Factory cams: strong low down, smooth idle.'),
      opt('fast', 'Fast road', 'More lift and duration: ~5% more up top, ~3% less below 3,000 rpm.', { cam: [3000, 0.97, 5000, 1.05], springLoad: 1.2 }),
      opt('race', 'Race', 'Aggressive profile: ~10% more past 5,500 rpm, soft below 3,500, lumpy idle. Needs uprated springs or the valves float early.',
        { cam: [3500, 0.92, 5500, 1.1], springLoad: 1.6, float: 400 })] : [
      opt('stock', 'Stock', 'Factory cams tuned for low-down torque.'),
      opt('perf', 'Performance', 'A touch more lift: ~4% more past 3,000 rpm, ~2% less at the bottom.', { cam: [2000, 0.98, 3200, 1.04], springLoad: 1.15 })] },
    { k: 'springs', group: 'Engine', label: 'Valve springs', opts: [
      opt('stock', 'Stock', 'Factory springs. They fatigue with high-rev use and let the valves float earlier.'),
      opt('uprated', 'Uprated', 'Stiffer springs: +300 rpm before float, fatigue more slowly.', { rev: 300, springWear: 0.6, float: -400 }),
      opt('titanium', 'Ti retainers', 'Dual springs with titanium retainers: +500 rpm, barely fatigue.', { rev: 500, springWear: 0.35, float: -400 })] },
    { k: 'chain', group: 'Engine', label: 'Timing chain', opts: [
      opt('stock', 'Stock', 'Factory chain and guides. It stretches with miles, revs and old oil.'),
      opt('uprated', 'Uprated kit', 'Heavy-duty chain, tensioner and guides: stretches at a third of the rate.', { chainWear: 0.35 })] },
    { k: 'oilpump', group: 'Engine', label: 'Oil pump', opts: [
      opt('stock', 'Stock', 'Variable-flow pump: enough for a stock engine.'),
      opt('hv', 'High volume', '~15% more oil pressure: the bearings stay fed when the oil is hot and thin.', { oilPump: 1.15 })] },
  ];
  const COOLING = (fuel) => [
    { k: 'radiator', group: 'Cooling', label: 'Radiator', opts: [
      opt('stock', 'Stock', 'Sized for the stock engine with a little margin.'),
      opt('alu', 'Aluminium', 'Thicker all-alloy core: ~25% more cooling.', { radUA: 1.25 }),
      opt('race', 'Race', 'Big twin-pass race radiator: ~50% more cooling.', { radUA: 1.5 })] },
    { k: 'waterpump', group: 'Cooling', label: 'Water pump', opts: [
      opt('stock', 'Stock', 'Electric coolant pump.'),
      opt('hf', 'High flow', '~30% more flow through the engine and radiator.', { wpFlow: 1.3 })] },
    { k: 'thermostat', group: 'Cooling', label: 'Thermostat', opts: [
      opt('stock', fuel === 'petrol' ? '92 °C' : '88 °C', 'Factory map thermostat.'),
      opt('low', fuel === 'petrol' ? '82 °C' : '80 °C', 'Opens ~10 °C earlier: cooler running, a little more knock margin, slower warm-up.', { tstat: fuel === 'petrol' ? -10 : -8 })] },
    { k: 'oilcooler', group: 'Cooling', label: 'Oil cooler', opts: [
      opt('stock', 'Stock', 'Oil-to-coolant heat exchanger.'),
      opt('big', 'Big oil cooler', 'Extra air-cooled oil cooler: much cooler oil on long hard runs.', { oilCool: 1.9 })] },
  ];
  // the rest of the engine's bolt-ons: each one wears in the Servicing tab, and the upgrade lasts longer and takes more
  const ENGINE_MORE = (fuel) => [
    { k: 'gasket', group: 'Engine', label: 'Head gasket', carry: () => (part('internals') === 'built' ? 'oring' : part('internals') === 'forged' ? 'mls' : null), opts: [
      opt('stock', 'Stock', 'Factory multi-layer steel gasket. Cylinder pressure past what the engine was built for, and overheating, wear it out - then it leaks coolant.'),
      opt('mls', 'Uprated MLS', 'Thicker multi-layer gasket with stiffer fire rings: takes 15 bar more cylinder pressure, wears at half the rate.', { pcp: 15, gasketWear: 0.5 }),
      opt('oring', 'O-ringed head', 'Copper gasket on an o-ringed block: 30 bar more and it barely notices boost - for big-turbo builds.', { pcp: 30, gasketWear: 0.2 })] },
    { k: 'chargepipe', group: 'Turbo & intake', label: 'Charge pipes', carry: (sv) => (part('turbo') !== 'stock' || overBoost(sv) > 0.4 ? 'alu' : null), opts: [
      opt('stock', 'Stock plastic', 'Factory plastic charge pipe: fine at stock boost, but every hard pull well above it fatigues it until it splits.'),
      opt('alu', 'Aluminium', 'Cast aluminium charge pipe and silicone couplers: holds any boost and barely ages.', { cpWear: 0.08 })] },
    { k: 'lpfp', group: 'Fuel', label: fuel === 'petrol' ? 'Low-pressure fuel pump' : 'Lift pump',
      carry: () => (['hpfp', 'pump', 'injection', 'injectors'].some((k) => P.some((x) => x.k === k) && part(k) !== 'stock') || part('fuel') === 'e85' ? 'uprated' : null), opts: [
      opt('stock', 'Stock', fuel === 'petrol' ? 'In-tank pump feeding the HP pump: ~40% headroom. E85 and big power outrun it - the engine leans out.'
        : 'Electric lift pump feeding the HP pump: ~60% headroom. A big fuelling map outruns it.', { lp: fuel === 'petrol' ? 1.4 : 1.6 }),
      opt('uprated', 'Uprated', 'Higher-flow pump and heavier wiring: feeds the HP side at well over twice the stock flow, and wears slower.', { lp: 2.4, lpWear: 0.7 })] },
    { k: 'hoses', group: 'Cooling', label: 'Coolant hoses', opts: [
      opt('stock', 'Stock rubber', 'Factory rubber hoses: heat cycles perish them until they weep coolant - and one can burst.'),
      opt('silicone', 'Silicone', 'Reinforced silicone hoses: shrug off heat, last about four times as long.', { hoseWear: 0.25 })] },
    { k: 'fan', group: 'Cooling', label: 'Cooling fan', opts: [
      opt('stock', 'Stock', 'Electric fan for standing still and slow traffic. Its motor wears with use - a weak fan overheats it in traffic.'),
      opt('hf', 'High-flow', 'Bigger, faster fan: ~60% more air through the radiator when the car isn\'t moving - traffic and the dyno.', { fanFlow: 1.6, fanWear: 0.8 })] },
  ];
  const PETROL_MORE = [
    { k: 'coils', group: 'Ignition', label: 'Ignition coils', opts: [
      opt('stock', 'Stock', 'Factory pencil coils. They weaken with miles (faster on worn plugs) and misfire under boost.'),
      opt('ho', 'High-output', 'Stronger spark: half the boost misfires of a tired set, and they last twice as long.', { coilWear: 0.5, coilSpark: 0.5 })] },
    { k: 'diverter', group: 'Turbo & intake', label: 'Diverter valve', carry: (sv) => (part('turbo') !== 'stock' || overBoost(sv) > 0.4 ? 'piston' : null), opts: [
      opt('stock', 'Stock diaphragm', 'Factory diaphragm valve: vents the boost on a lift. Well above stock boost the diaphragm tears and it bleeds boost.'),
      opt('piston', 'Uprated piston', 'Billet piston valve: holds any boost, a crisper whoosh, practically never wears.', { dvWear: 0.1, sound: { turbo: 1.05 } })] },
    { k: 'catchcan', group: 'Engine', label: 'Oil catch can', opts: [
      opt('none', 'None', 'Crankcase vapour goes straight back into the intake: oil mist bakes onto the direct-injected intake valves.'),
      opt('can', 'Catch can', 'Traps the oil mist first: the intake valves carbon up at a third of the rate, and fewer pre-ignition events.', { carbon: 0.35, lspi: 0.6 })] },
  ];
  const DIESEL_MORE = [
    { k: 'glow', group: 'Ignition', label: 'Glow plugs', opts: [
      opt('stock', 'Stock', 'Factory metal glow plugs: they wear with every cold start - worn ones make cold starts rough and smoky.'),
      opt('ceramic', 'Ceramic', 'Ceramic glow plugs: hotter, faster, and they last about two and a half times as long.', { glowWear: 0.4 })] },
    { k: 'vgt', group: 'Turbo & intake', label: 'VGT actuator', opts: [
      opt('stock', 'Stock', 'Vane actuator of the variable-geometry turbo. Soot builds on the vanes until they stick - boost lags low down.'),
      opt('uprated', 'Uprated electronic', 'Stronger electronic actuator: sharper vane control (boost ~100 rpm sooner), shrugs off soot far longer.', { vgtWear: 0.4, spool: -100 })] },
    { k: 'swirl', group: 'Engine', label: 'Swirl flaps', opts: [
      opt('stock', 'Stock', 'Intake swirl flaps for a clean burn low down. Their spindles wear loose with miles and soot - a flap breaking off goes through a cylinder.'),
      opt('blank', 'Blanked', 'Flaps out, ports blanked: nothing to break off, a touch less torque below 2,000 rpm.', { swirlBlank: true })] },
  ];
  const BRAKES = [
    { k: 'pads', group: 'Brakes', label: 'Brake pads', opts: [
      opt('stock', 'Stock', 'Quiet road pads: fade from ~450 °C.'),
      opt('sport', 'Sport', 'More bite and fade-resistant to ~600 °C. Wear faster, more dust.', { brake: { bite: 1.06, fadeSet: 600, padWear: 1.3 } }),
      opt('race', 'Race', 'Huge bite and good to ~780 °C - but grabby when cold, and they eat discs.', { brake: { bite: 1.12, fadeSet: 780, padWear: 2.2, discWear: 1.4, coldBite: 0.8 } })] },
    { k: 'discs', group: 'Brakes', label: 'Brake discs', opts: [
      opt('stock', 'Stock', 'Vented iron discs.'),
      opt('slotted', 'Slotted', 'Slots clear gas and pad dust: a little cooler, a little more fade margin.', { brake: { cool: 1.15, fadeAdd: 30, padWear: 1.1 } }),
      opt('float', '2-piece floating', 'Bigger floating discs on alloy bells: heat up slower, shed it faster.', { brake: { cool: 1.3, mass: 1.1, fadeAdd: 60, discWear: 0.8 } })] },
    { k: 'calipers', group: 'Brakes', label: 'Calipers', opts: [
      opt('stock', 'Stock', 'Factory calipers.'),
      opt('bbk', 'Big brake kit', '6-piston calipers on bigger discs: ~12% more stopping power, more heat capacity.', { brake: { bite: 1.12, mass: 1.25, cool: 1.2, fadeAdd: 40 } })] },
    { k: 'fluid', group: 'Brakes', label: 'Brake fluid', opts: [
      opt('dot4', 'DOT 4', 'Road fluid: boils at ~230 °C fresh, far lower once it\'s soaked up moisture.'),
      opt('race', 'Racing', 'High-temp racing fluid: boils at ~310 °C.', { brake: { boil: 310 } })] },
  ];
  const SUSPENSION = { k: 'suspension', group: 'Chassis', label: 'Suspension', opts: [
    opt('stock', 'Stock', 'Factory springs and dampers.'),
    opt('sport', 'Sport', 'Lower, stiffer springs and sport dampers: ~3% more grip, steadier under braking.', { grip: 1.03, brake: { stab: 1.03, damperWear: 0.8 } }),
    opt('coilovers', 'Coilovers', 'Adjustable track coilovers: ~6% more grip, flat under braking - but they wear faster on the road.', { grip: 1.06, brake: { stab: 1.05, damperWear: 1.3 } })] };
  const COMMON = () => [
    { k: 'trans', group: 'Drivetrain', label: 'Transmission', opts: [
      opt('stock', 'Stock', 'Factory clutch packs. Slips once the torque passes their rating.'),
      opt('uprated', 'Uprated packs', 'Extra clutch plates and a TCU flash with more line pressure: holds far more torque.', { trans: 'uprated' }),
      opt('built', 'Built', 'Fully built box: more and thicker plates, billet drums, a race TCU flash. Holds the most torque, but the stiff packs wear ~50% faster on the road.', { trans: 'built', transWear: 1.5 })] },
    { k: 'diff', group: 'Drivetrain', label: 'Final drive', opts: [[1, 'Stock ratio: relaxed cruising, highest top speed per rpm.'],
      [3.077 / 2.813, 'Shorter: ~9% more pull in every gear, top speed per gear drops.'], [3.385 / 2.813, 'Much shorter: strongest acceleration, busy at motorway speed.']]
      .map(([k, d]) => { const fd = +(cfg.finalDrive * k).toFixed(3); return opt(String(fd), fd.toFixed(2), d, { fd }); }) },
    SUSPENSION,
    { k: 'tyres', group: 'Chassis', label: 'Tyres', opts: [
      opt('stock', 'Road', 'Stock performance road tyres.'),
      opt('cup', 'Cup', 'Semi-slick cup tyres: ~12% more grip for launches and corner exits.', { grip: 1.12 })] },
  ];
  // building the engine: forged / fully built internals take far less damage, rev higher and hold more torque
  const INTERNALS = (fuel) => ({ k: 'internals', group: 'Engine', label: 'Engine internals', opts: [
    opt('stock', 'Stock', fuel === 'petrol' ? `Cast pistons and factory rods: good to ~${fmt(E.rod)} Nm, fragile once it detonates.`
      : `Factory pistons and rods: good to ~${fmt(E.rod)} Nm and ${E.pcpLimit} bar of cylinder pressure.`),
    opt('forged', 'Forged', 'Forged pistons and rods, head studs: a third of the damage from knock and pressure, rods good for 50% more torque, +400 rpm.',
      { dmg: 0.3, rod: 1.5, rev: 400, pcp: 25, margin: 0.4 }),
    opt('built', 'Fully built', 'Forged plus a billet crank, race bearings and lower compression: barely notices abuse, twice the rod rating, +800 rpm.',
      { dmg: 0.12, rod: 2, rev: 800, pcp: 45, margin: 1 })] });
  // an engine can describe its own turbos (twin / quad): [id, label, desc, fx] per E.turbos key
  const turboOpts = (dflt) => (E.turboOpts ? E.turboOpts.map((o) => opt(...o)) : dflt);
  const PARTS = {
    petrol: () => [
      INTERNALS('petrol'), ...VALVETRAIN('petrol'), ...ENGINE_MORE('petrol'), ...PETROL_MORE, ...COOLING('petrol'), ...BRAKES,
      { k: 'turbo', group: 'Turbo & intake', label: E.turboLabel || 'Turbocharger', opts: turboOpts([
        opt('stock', 'Stock', 'Twin-scroll single turbo. Early spool, runs out of breath past 6,000 rpm.'),
        opt('hybrid', 'Hybrid', 'Bigger compressor wheel in the stock housing: ~1.9 bar up top, a little more lag.', { sound: { turbo: 1.25 } }),
        opt('big', 'Big single', 'Big-turbo kit: 2.4 bar and a huge top end, very little below 3,000 rpm.', { sound: { turbo: 1.45 } })]) },
      { k: 'intercooler', group: 'Turbo & intake', label: 'Intercooler', opts: [
        opt('stock', 'Stock', 'Water-to-air, efficient but heat-soaks over repeated pulls.', { ic: 0.85, soak: 15 }),
        opt('big', 'Big core', 'Larger core and heat exchanger: cooler, steadier intake temps.', { ic: 0.92, soak: 6 })] },
      { k: 'intake', group: 'Turbo & intake', label: 'Intake', opts: [
        opt('stock', 'Stock', 'Airbox with a paper filter.'),
        opt('open', 'Open cone', 'Free-flowing cone filter: +1.5% flow up top, louder turbo, a few °C warmer air.', { flow: 0.015, iat: 3, sound: { intake: 1.3, turbo: 1.15 } })] },
      { k: 'downpipe', group: 'Exhaust', label: 'Downpipe', opts: [
        opt('stock', 'Stock', 'Factory downpipe with the close-coupled catalyst.'),
        opt('sport', 'Sport cat', '200-cell cat: +2.5% flow, faster spool, cooler exhaust.', { flow: 0.025, egt: -15, spool: -100, sound: { ex: 1.15, turbo: 1.1 } }),
        opt('catless', 'Catless', 'No catalyst: +4% flow, coolest exhaust, loudest. Off-road only - the cat monitor flags P0420.', { flow: 0.04, egt: -25, spool: -150, sound: { ex: 1.3, turbo: 1.2 }, catless: true })] },
      { k: 'injection', group: 'Fuel', label: 'Fuel injection', opts: [
        opt('stock', 'Direct', 'Factory direct injection.', { fuelCap: 1.4 }),
        opt('port', 'Port kit', 'Adds port injectors on top of DI: ~70% more fuel - what E85 needs.', { fuelCap: 1.4, port: 0.7 })] },
      { k: 'hpfp', group: 'Fuel', label: 'HP fuel pump', opts: [
        opt('stock', 'Stock', '350 bar pump: ~25% headroom over stock fuelling.', { pump: 1.25 }),
        opt('uprated', 'Uprated', 'Bigger stroke pump: holds rail pressure at ~60% more flow.', { pump: 1.6 })] },
      { k: 'plugs', group: 'Ignition', label: 'Spark plugs', opts: [
        opt('stock', 'Stock heat range', 'Factory plugs.'),
        opt('colder', 'One step colder', 'Sheds heat faster: ~0.8° more knock margin under boost.', { margin: 0.8 })] },
      ...COMMON(),
      { k: 'fuel', group: 'Fuel', label: 'Fuel in the tank', opts: [
        opt('95', 'RON 95', 'Regular premium. The stock tune is knock-limited on it in hot weather.', { octane: 0, k: 1 }),
        opt('98', 'RON 98', 'Super plus: ~2° more knock margin. What most stage 1 maps are written for.', { octane: 2, k: 1 }),
        opt('102', 'RON 102', 'Race fuel: ~5° more margin.', { octane: 5, k: 1 }),
        opt('e85', 'E85', 'Ethanol: ~9° more margin and a cooler charge, but needs ~40% more fuel flow.', { octane: 9, k: 1.4, iat: -6 })] },
    ],
    diesel: () => [
      INTERNALS('diesel'), ...VALVETRAIN('diesel'), ...ENGINE_MORE('diesel'), ...DIESEL_MORE, ...COOLING('diesel'), ...BRAKES,
      { k: 'turbo', group: 'Turbo & intake', label: E.turboLabel || 'Turbocharger', opts: turboOpts([
        opt('stock', 'Stock VGT', 'Variable-geometry turbo: strong low down, chokes past ~1.9 bar.'),
        opt('hybrid', 'Hybrid VGT', 'Bigger compressor and turbine: ~2.4 bar, a touch more lag.', { sound: { turbo: 1.25 } })]) },
      { k: 'intercooler', group: 'Turbo & intake', label: 'Intercooler', opts: [
        opt('stock', 'Stock', 'Front-mounted air-to-air.', { ic: 0.75, soak: 8 }),
        opt('big', 'Big core', 'Larger front-mount: cooler, denser air - more fuel can burn cleanly.', { ic: 0.86, soak: 3, ...E.bigIc })] },
      { k: 'intake', group: 'Turbo & intake', label: 'Intake', opts: [
        opt('stock', 'Stock', 'Airbox with a paper filter.'),
        opt('open', 'Open cone', '+1.5% flow up top and more turbo whistle.', { flow: 0.015, iat: 2, sound: { intake: 1.3, turbo: 1.15 } })] },
      { k: 'downpipe', group: 'Exhaust', label: 'DPF / downpipe', opts: [
        opt('stock', 'Stock DPF', 'Diesel particulate filter: traps soot, regenerates by burning it off.', { dpf: 1 }),
        opt('sport', 'High-flow DPF', 'Lower-restriction filter: +2% flow, -15 °C exhaust, still a DPF.', { dpf: 0.7, flow: 0.02, egt: -15 }),
        opt('delete', 'DPF delete', 'Straight pipe: +4% flow, -30 °C exhaust, no soot load. Off-road only - turn the DPF function off in the ECU or it flags P2002.', { dpf: 0, flow: 0.04, egt: -30, spool: -100, sound: { ex: 1.25, turbo: 1.15 } })] },
      { k: 'egr', group: 'Exhaust', label: 'EGR valve', opts: [
        opt('stock', 'Active', 'Recirculates exhaust at part load to cut NOx. Clogs with soot over time.'),
        opt('blank', 'Blanked', 'Blanking plate: no soot build-up, cleaner intake. Turn EGR off in the ECU or it flags P0401.', { egrBlank: true })] },
      { k: 'injectors', group: 'Fuel', label: 'Injectors', opts: [
        opt('stock', 'Stock', 'Piezo injectors: ~30% headroom over stock fuelling.', { inj: 1.3 }),
        opt('uprated', 'Uprated', 'Bigger nozzles: ~60% more fuel per stroke than stock.', { inj: 1.6 }),
        opt('race', 'Race', 'Big-nozzle race injectors: twice the stock fuel per stroke - for big-turbo builds.', { inj: 2 })] },
      { k: 'pump', group: 'Fuel', label: 'HP pump', opts: [
        opt('stock', 'Stock', 'Common-rail pump: holds rail pressure with ~35% flow headroom.', { pump: 1.35 }),
        opt('uprated', 'Uprated', 'Higher-flow pump: holds rail pressure at ~75% more fuelling.', { pump: 1.75 }),
        opt('race', 'Twin pumps', 'A second high-pressure pump: holds rail pressure at ~2.2x the stock fuelling.', { pump: 2.2 }), ...(E.pumpOpts || []).map((o) => opt(...o))] },
      ...COMMON(),
    ],
  };

  // ================= wearable parts: CarService rows, saved in tune.wear =================
  // group: the Servicing section it shows in. The shared ones (both engines) come first
  const W = (key, code, label, group, title, msg, more = {}) => ({ key, code, label, group, title, msg, ...more });
  const WEAR_COMMON = [
    W('pistons', 'P1C00', 'Pistons', 'Engine', 'Engine internals damaged', 'Low compression from piston damage. The engine needs rebuilding.'),
    W('chain', 'P0016', 'Timing chain', 'Engine', 'Timing chain stretched', 'Cam timing out of position - the chain has stretched. Replace it before it jumps.'),
    W('springs', 'P1C20', 'Valve springs', 'Engine', 'Valve springs fatigued', 'Weak valve springs: the valves float at high revs. Replace the springs.'),
    W('oilpump', 'P0521', 'Oil pump', 'Lubrication', 'Oil pressure low', 'Oil pump worn - pressure low. Replace the pump to save the bearings.'),
    W('waterpump', 'P261A', 'Water pump', 'Cooling', 'Coolant pump failure', 'Electric coolant pump failed. Engine overheating - stop safely.'),
    W('radiator', 'P2181', 'Radiator', 'Cooling', 'Cooling system performance', 'Radiator clogged - it can\'t shed the heat. Have it cleaned or replaced.'),
    W('thermostat', 'P0128', 'Thermostat', 'Cooling', 'Thermostat stuck', 'Thermostat sticking closed - risk of overheating. Replace it.'),
    W('airfilter', 'P0101', 'Air filter', 'Fuel & air', 'Air filter clogged', 'Air filter blocked - less air, less power. Replace the filter.'),
    W('fuelfilter', 'P1F00', 'Fuel filter', 'Fuel & air', 'Fuel filter clogged', 'Fuel filter restricted - fuel delivery drops at full load. Replace it.'),
    W('turbo', 'P0299', 'Turbo', 'Turbo & exhaust', 'Turbocharger failed', 'Turbo not building boost. Reduced power - have the turbo replaced.'),
    W('trans', 'P0730', 'Clutch packs', 'Drivetrain', 'Transmission slipping', 'Transmission clutch packs worn. Drive moderately - have it rebuilt.', { module: 'TCM' }),
    W('gasket', 'P1C30', 'Head gasket', 'Engine', 'Head gasket leaking', 'Combustion gas is getting into the coolant - it loses coolant and overheats. Replace the head gasket.'),
    W('chargepipe', 'P1C40', 'Charge pipe', 'Turbo & exhaust', 'Boost leak', 'The charge pipe has split - the boost is escaping. Reduced power: replace the pipe.'),
    W('intercooler', 'P026A', 'Intercooler', 'Turbo & exhaust', 'Charge air cooler efficiency low', 'Intercooler fouled with oil and road dirt - hot intake air. Clean or replace it.'),
    W('lpfp', 'P0627', 'Feed pump', 'Fuel & air', 'Fuel feed pump weak', 'The low-pressure fuel pump is worn - it starves the HP pump at full load. Replace it.'),
    W('hoses', 'P1C50', 'Coolant hoses', 'Cooling', 'Coolant hose leaking', 'A perished hose is weeping coolant. Replace the hoses before one bursts.'),
    W('fan', 'P0480', 'Cooling fan', 'Cooling', 'Cooling fan fault', 'The electric fan motor is failing - it overheats in traffic. Replace the fan.'),
  ];
  const WEAR = {
    petrol: [...WEAR_COMMON,
      W('plugs', 'P0350', 'Spark plugs', 'Ignition', 'Spark plugs worn', 'Ignition misfires under boost. Replace the spark plugs.'),
      W('coils', 'P0351', 'Ign. coils', 'Ignition', 'Ignition coil weak', 'Coil output low - misfires under load. Replace the coils.'),
      W('hpfp', 'P0087', 'Fuel pump', 'Fuel & air', 'Fuel pump worn', 'Rail pressure drops under load. Replace the high-pressure fuel pump.'),
      W('cat', 'P0420', 'Catalyst', 'Turbo & exhaust', 'Catalyst efficiency low', 'Catalytic converter worn out. Have it replaced.', { removable: true }),
      W('diverter', 'P0033', 'Diverter valve', 'Turbo & exhaust', 'Diverter valve leaking', 'Torn diaphragm - the valve bleeds boost under load. Replace it.'),
      W('valves', 'P1C60', 'Intake valves', 'Fuel & air', 'Intake valves carboned up', 'Carbon on the intake valves is choking the airflow and causing misfires. Have them walnut-blasted.')],
    diesel: [...WEAR_COMMON,
      W('injectors', 'P0263', 'Injectors', 'Fuel & air', 'Injector balance out of limit', 'Uneven injection - rough running and smoke. Replace the injectors.'),
      W('pump', 'P0087', 'HP pump', 'Fuel & air', 'High-pressure pump worn', 'Rail pressure drops under load. Replace the HP pump.'),
      W('glow', 'P0380', 'Glow plugs', 'Ignition', 'Glow plugs worn', 'Cold starts rough and smoky. Replace the glow plugs.'),
      W('dpf', 'P2463', 'DPF soot', 'Turbo & exhaust', 'Particulate filter full', 'Diesel particulate filter blocked. Reduced power - run a regeneration.', { removable: true, soot: true }),
      W('egr', 'P0401', 'EGR valve', 'Turbo & exhaust', 'EGR valve clogged', 'EGR valve sooted up. Have it cleaned.', { removable: true }),
      W('vgt', 'P0045', 'VGT vanes', 'Turbo & exhaust', 'Turbo vanes sticking', 'Sooted vanes are sticking - boost lags low down. Clean the vanes and actuator.'),
      W('swirl', 'P2015', 'Swirl flaps', 'Fuel & air', 'Swirl flap spindles worn', 'The swirl flaps are worn loose - one could break off into the engine. Replace or blank them.', { removable: true })],
  };


  // live faults (not tied to a worn part)
  const FAULTS = {
    P0234: { title: 'Turbo overspeed', msg: 'Boost beyond the turbo\'s safe range. Reduce the boost map.' },
    P0299: { title: 'Underboost', msg: 'Turbo not reaching target boost.' },
    P0324: { fuel: 'petrol', title: 'Engine knocking', msg: 'Detonation beyond what knock control can pull out. Use higher octane fuel, or take boost and timing out.' },
    P1345: { fuel: 'petrol', title: 'Pre-ignition detected', msg: 'Severe pre-ignition. Engine damage likely - reduce load at low rpm.', color: '#ff5f3d' },
    P0171: { fuel: 'petrol', title: 'System too lean', msg: 'Fuel system can\'t keep up at full load - running lean.' },
    P0087: { title: 'Fuel rail pressure too low', msg: 'Rail pressure collapsing under load. Fuel system at its limit.' },
    P2428: { title: 'Exhaust temperature too high', msg: 'Exhaust gas temperature critical. Reduce load.', color: '#ff5f3d' },
    P0219: { title: 'Engine overspeed', msg: 'Engine speed above its safe limit.' },
    P0730: { title: 'Transmission slipping', msg: 'Torque above the clutch packs\' rating. Drive moderately.', module: 'TCM' },
    P0700: { title: 'Transmission malfunction', msg: 'Transmission in emergency mode. Drive moderately.', module: 'TCM', color: '#ff5f3d' },
    P0420: { title: 'Catalyst efficiency low', msg: 'Emissions fault. Have the vehicle checked.' },
    P2002: { fuel: 'diesel', title: 'Particulate filter missing', msg: 'DPF efficiency below threshold. Reduced power.', color: '#ff5f3d' },
    P0401: { fuel: 'diesel', title: 'EGR flow insufficient', msg: 'EGR not flowing. Emissions fault.' },
    P2463: { fuel: 'diesel', title: 'Particulate filter full', msg: 'Diesel particulate filter: drive at a steady speed to regenerate.' },
    P1C10: { fuel: 'diesel', title: 'Cylinder pressure too high', msg: 'Peak cylinder pressure over the design limit. Reduce fuel, boost or injection timing.', color: '#ff5f3d' },
    P1C02: { title: 'Engine noise', msg: 'Knocking from the bottom end. Have the engine checked before it gets worse.', color: '#ff5f3d' },
    P1C03: { title: 'Engine failure', msg: 'Catastrophic engine failure. The engine has seized - it needs a rebuild.', color: '#ff5f3d' },
    P0217: { title: 'Engine overheating', msg: 'Coolant temperature too high. Reduce speed - power is being limited.', color: '#ff5f3d' },
    P0524: { title: 'Engine oil pressure low', msg: 'Oil pressure too low. Stop the engine and top up the oil.', color: '#ff5f3d' },
    LIMP: { title: 'Drivetrain malfunction', msg: 'Reduced power. Drive moderately - have the vehicle checked.', color: '#ff5f3d' },
  };
  for (let c = 1; c <= 8; c++) FAULTS['P030' + c] = { title: `Misfire cylinder ${c}`, msg: 'Engine misfiring. Reduced power - have the vehicle checked.' };

  // ================= presets (per fuel; built from the engine's stock maps) - an engine can bring its own (E.presets) =================
  const add = (base, d) => base.map((v, i) => +(v + (Array.isArray(d) ? d[i] : d)).toFixed(3));
  const PRESETS = {
    petrol: [
      { id: 'stock', name: 'Stock', desc: 'Factory calibration. Safe on RON 95.', needs: {}, make: (e, s) => s },
      { id: 'stage1', name: 'Stage 1', desc: 'More boost and timing on stock hardware. Written for RON 98.', needs: { fuel: ['98', '102', 'e85'] },
        make: (e, s) => ({ ...s, boost: e.boost.map((b, i) => Math.min(b + 0.3, e.turbos.stock[i] * 0.9)), timing: e.axis.map((r) => (r < 2500 ? 0.5 : 1.5)),
          afr: add(s.afr, -0.1), tq: 600, shift: s.shift + 100 }) },
      { id: 'stage2', name: 'Stage 2', desc: 'Needs a downpipe, a bigger intercooler and RON 98+.', needs: { downpipe: ['sport', 'catless'], intercooler: ['big'], chargepipe: ['alu'], fuel: ['98', '102', 'e85'] },
        make: (e, s) => ({ ...s, boost: e.boost.map((b, i) => Math.min(b + 0.5, e.turbos.stock[i] * 0.9)), timing: e.axis.map((r) => (r < 2500 ? 0.5 : r < 4500 ? 1.5 : 2.5)),
          afr: add(s.afr, -0.3), tq: 660, shift: s.shift + 200, vmax: 0 }) },
      { id: 'stage3', name: 'Stage 3 E85', desc: 'Hybrid turbo on E85: port kit, uprated pump and gearbox.', needs: { turbo: ['hybrid', 'big'], injection: ['port'], hpfp: ['uprated'], lpfp: ['uprated'], chargepipe: ['alu'], diverter: ['piston'], fuel: ['e85'], trans: ['uprated'], intercooler: ['big'] },
        make: (e, s) => ({ ...s, boost: e.turbos.hybrid.map((c, i) => Math.max(e.boost[i], c * 0.9)), timing: e.axis.map((r) => (r < 2500 ? 2 : 5)),
          afr: s.afr.map((a) => Math.min(a, 11.9)), tq: 800, shift: s.shift + 300, vmax: 0, shiftSpeed: 1 }) },
    ],
    diesel: [
      { id: 'stock', name: 'Stock', desc: 'Factory calibration.', needs: {}, make: (e, s) => s },
      { id: 'stage1', name: 'Stage 1', desc: 'More fuel, a little more boost and advance, on stock hardware.', needs: {},
        make: (e, s) => ({ ...s, iq: [100, 108, 116, 118, 118, 118, 117, 115, 112], boost: e.boost.map((b, i) => Math.min(b + 0.2, e.turbos.stock[i] * 0.9)),
          soi: [0, 0.5, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], rail: s.rail.map((r) => Math.min(2000, r + 100)), smoke: 1.1, tq: 480 }) },
      { id: 'stage2', name: 'Stage 2', desc: 'Needs a bigger intercooler and a freer DPF. EGR off.', needs: { intercooler: ['big'], downpipe: ['sport', 'delete'] },
        make: (e, s) => ({ ...s, iq: [100, 112, 124, 128, 128, 128, 127, 124, 120], boost: e.boost.map((b, i) => Math.min(b + 0.3, e.turbos.stock[i] * 0.92)),
          soi: [0, 1, 1.5, 2, 2, 2, 2, 2, 2], rail: s.rail.map((r) => Math.min(2100, r + 150)), smoke: 1.06, tq: 520, egr: false, shift: s.shift + 100 }) },
      { id: 'stage3', name: 'Stage 3', desc: 'Hybrid turbo, injectors and pump - and a gearbox that can take it.', needs: { turbo: ['hybrid'], injectors: ['uprated'], pump: ['uprated'], intercooler: ['big'], chargepipe: ['alu'], trans: ['uprated'] },
        make: (e, s) => ({ ...s, iq: [100, 118, 140, 148, 150, 150, 148, 144, 138], boost: e.turbos.hybrid.map((c, i) => Math.max(e.boost[i], c * 0.9)),
          soi: [0, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5], rail: s.rail.map((r) => Math.min(2400, r + 400)), smoke: 1.04, tq: 620, egr: false, shift: s.shift + 200, vmax: 0 }) },
    ],
  };

  // ================= state =================
  const api = { on: false };
  let E = null, cfg = null, P = null; // engine, the car's init config, the part catalogue
  let tune = null, slot = 1, stockCal = null;
  const fx = {}; // merged effects of the fitted parts
  let T = {}; // live settings handed to the car
  let wearParts = {}; // key -> CarService part
  const cyl = []; // per cylinder: { retard, damage, knocks, misfires, balance, dead }

  function stockFor(c) {
    const base = { name: 'Stock', boost: [...E.boost], rev: c.rev, shift: c.shift, launch: c.launch, vmax: c.vmax || 0, tq: E.tq,
      shiftSpeed: 0, protect: true, dpf: true,
      gears: [...c.gears], gearShift: c.gears.map(() => 0), gearTq: c.gears.map(() => 0) }; // per gear: 0 = the global shift point / no limit
    return E.fuel === 'petrol'
      ? { ...base, timing: E.axis.map(() => 0), afr: [...E.afr], burble: 1, knock: true }
      : { ...base, iq: E.axis.map(() => 100), soi: E.axis.map(() => 0), rail: [...E.rail], smoke: 1.15, pilot: true, egr: true };
  }
  const CURVES = () => (E.fuel === 'petrol' ? ['boost', 'timing', 'afr'] : ['iq', 'boost', 'soi', 'rail']);
  // a saved slot only counts if it still fits this engine's map axis
  function validCal(c) {
    return c && CURVES().every((k) => Array.isArray(c[k]) && c[k].length === E.axis.length && c[k].every(Number.isFinite));
  }
  const presetsOf = () => E.presets || PRESETS[E.fuel];
  const presetCal = (id) => {
    const p = presetsOf().find((x) => x.id === id) || presetsOf()[0];
    return { ...JSON.parse(JSON.stringify(p.make(E, stockCal))), name: p.name };
  };
  const cal = () => tune.slots[slot];
  function fitGearbox(c) {
    ['gears', 'gearShift', 'gearTq'].forEach((k) => { if (!Array.isArray(c[k]) || c[k].length !== cfg.gears.length) c[k] = [...stockCal[k]]; });
    return c;
  }
  const part = (k) => tune.parts[k] || P.find((p) => p.k === k).opts[0].id;
  // how far a saved setup's maps push boost over stock - a car built for that had its boost plumbing done too
  const overBoost = (sv) => Math.max(0, ...[1, 2].map((n) => {
    const b = sv && sv.slots && sv.slots[n] && sv.slots[n].boost;
    return Array.isArray(b) ? Math.max(...b.map((v, i) => v - (E.boost[i] ?? v))) : 0;
  }));
  function mergeFx() {
    Object.keys(fx).forEach((k) => delete fx[k]);
    Object.assign(fx, { flow: 0, egt: 0, iat: 0, spool: 0, margin: 0, sound: { ex: 1, intake: 1, turbo: 1 }, grip: 1, octane: 0, k: 1, port: 0,
      dmg: 1, rod: 1, rev: 0, pcp: 0, cam: null, springLoad: 1, springWear: 1, float: 0, chainWear: 1, oilPump: 1,
      radUA: 1, wpFlow: 1, tstat: 0, oilCool: 1, transWear: 1,
      gasketWear: 1, cpWear: 1, lp: 9, lpWear: 1, hoseWear: 1, fanFlow: 1, fanWear: 1, coilWear: 1, coilSpark: 1, dvWear: 1, carbon: 1, lspi: 1,
      glowWear: 1, vgtWear: 1, swirlBlank: false });
    const brake = { bite: 1, fadeSet: 450, fadeAdd: 0, boil: 230, mass: 1, cool: 1, padWear: 1, discWear: 1, coldBite: 1, stab: 1, damperWear: 1 };
    P.forEach((p) => {
      const o = p.opts.find((x) => x.id === part(p.k)) || p.opts[0];
      Object.entries(o.fx).forEach(([k, v]) => {
        if (['flow', 'egt', 'iat', 'spool', 'margin', 'port', 'rev', 'pcp'].includes(k)) fx[k] += v;
        else if (k === 'sound') Object.entries(v).forEach(([layer, mul]) => { fx.sound[layer] *= mul; });
        else if (['grip', 'springLoad', 'springWear', 'float'].includes(k)) fx[k] = k === 'float' ? fx[k] + v : fx[k] * v;
        else if (k === 'tstat') fx.tstat += v;
        else if (k === 'brake') Object.entries(v).forEach(([bk, bv]) => { // set the pads' fade point, add to it, take the lowest cold bite, multiply the rest
          if (bk === 'fadeSet' || bk === 'boil') brake[bk] = bv;
          else if (bk === 'fadeAdd') brake.fadeAdd += bv;
          else if (bk === 'coldBite') brake.coldBite = Math.min(brake.coldBite, bv);
          else brake[bk] *= bv;
        });
        else fx[k] = v;
      });
    });
    fx.turbo = E.turbos[part('turbo')] || E.turbos.stock;
    const top = Math.max(...fx.turbo);
    fx.spoolRpm = E.axis[fx.turbo.findIndex((b) => b >= top * 0.9)] + fx.spool;
    fx.transCap = E.trans[fx.trans] || E.trans.cap;
    fx.float = Math.max(0, fx.float); // race cams only float early on stock springs
    const { fadeSet, fadeAdd, ...hw } = brake;
    if (window.CarService && CarService.setHardware) CarService.setHardware({ ...hw, fade: fadeSet + fadeAdd });
  }
  // the fitted internals' limits
  const maxRpm = () => E.maxRpm + fx.rev - fx.float - wearOf('springs') * 4; // tired springs float the valves sooner
  const pcpLimit = () => E.pcpLimit + fx.pcp;
  const rodLimit = () => E.rod * fx.rod;

  // ================= the engine model =================
  // full-load engine at this rpm for a calibration. o: { b (actual boost, else the target), iat, retard (avg
  // timing pulled, petrol), protect: EGT enrichment } - torque comes back as a multiplier on the car's stock curve
  const wearOf = (k) => (wearParts[k] ? wearParts[k].value : 0);
  const timingEff = (d) => (d >= 0 ? 1 - 0.0022 * d * d : 1 - 0.004 * d * d); // degrees retarded from best torque
  const lamEffP = (l) => 1 - 1.6 * (l - 0.86) * (l - 0.86);
  const lamEffD = (l) => (l >= 1.2 ? 1 : 1 - 1.2 * Math.pow(1.2 - l, 1.5) - (l < 1 ? (1 - l) * 0.8 : 0));
  let limp = null, adapt = 1; // limp mode code, knock / lean boost adaptation (1 = none)
  // what the fitted turbo can make at this rpm; a worn one loses its top end, a dead one makes next to nothing
  function turboCap(rpm) {
    const w = wearOf('turbo');
    if (w >= 100) return 0.2;
    // sooted VGT vanes can't close: no boost low down; a split charge pipe dumps it all
    const cap = interp(E.axis, fx.turbo, rpm - fx.spool) * (1 - 0.4 * clamp01((w - 70) / 30)) * (1 - 0.5 * wearOf('vgt') / 100 * clamp01((3000 - rpm) / 2000));
    return wearOf('chargepipe') >= 100 ? Math.min(cap, 0.35) : cap;
  }
  // a torn diverter or a tired charge pipe bleeds boost whatever the map asks for
  const leakMul = () => (1 - 0.12 * clamp01((wearOf('diverter') - 50) / 50)) * (1 - 0.1 * clamp01((wearOf('chargepipe') - 70) / 30));
  function boostTarget(c, rpm) {
    let b = Math.min(interp(E.axis, c.boost, rpm), turboCap(rpm)) * adapt * leakMul();
    if (limp) b = Math.min(b, 0.3);
    return b;
  }
  function airRatio(rpm, b, iat) {
    const bS = interp(E.axis, E.boost, rpm);
    const flow = 1 + fx.flow * clamp01((rpm - 2500) / 3500); // breathing mods help up top
    const dens = (273 + iatStock(rpm)) / (273 + iat); // relative to the stock engine on a stock intercooler
    const soot = E.fuel === 'diesel' && fx.dpf ? 1 - 0.15 * clamp01((wearOf('dpf') - 80) / 20) : 1; // a loaded DPF chokes it
    const filter = 1 - wearOf('airfilter') * 0.04 / 100;
    // carbon on the intake valves (direct injection) and a clogging catalyst choke it too
    const carbon = 1 - wearOf('valves') * 0.07 / 100, cat = fx.catless ? 1 : 1 - 0.06 * clamp01((wearOf('cat') - 60) / 40);
    return (1 + Math.max(-0.6, b)) / (1 + bS) * dens * flow * soot * filter * carbon * cat;
  }
  // camshafts trade bottom end for top end: [rpm where the loss tops out, its factor, rpm where the gain is full, its factor]
  function camMul(rpm) {
    const c = fx.cam;
    if (!c) return 1;
    return rpm <= c[0] ? c[1] : rpm >= c[2] ? c[3] : c[1] + (c[3] - c[1]) * (rpm - c[0]) / (c[2] - c[0]);
  }
  // a stretched chain lets the cams lag the crank: a few % of torque by the time it's worn out
  const chainMul = () => 1 - clamp01((wearOf('chain') - 50) / 50) * 0.06;
  // compressor outlet heat over ambient; past its efficient range the compressor mostly heats the air
  function compHeat(b, over) {
    const amb = ambient(), pr = (1.013 + Math.max(0, b)) / 1.013;
    return (amb + 273) * (Math.pow(pr, 0.286) - 1) / (0.72 - 0.22 * over);
  }
  // how far past its efficient range the turbo is pushed - only once it has spooled (below that it simply can't
  // reach the target yet, which is lag, not overspeed)
  function overspeed(b, rpm) {
    return rpm >= fx.spoolRpm ? clamp01((b - turboCap(rpm) * 0.92) / 0.3) : 0;
  }
  // turbo shaft speed (krpm): the compressor's work (pressure ratio) plus the air it moves, scaled so the fitted turbo
  // reads its rated speed at its peak boost at the redline - pushed past its efficient range it spins beyond that
  const head = (b) => Math.pow((1.013 + Math.max(0, b)) / 1.013, 0.286) - 1;
  function turboKrpm(b, rpm) {
    const top = Math.max(...fx.turbo), flow = 0.33 * rpm / E.maxRpm * (1 + Math.max(0, b)) / (1 + top);
    return E.krpm[part('turbo')] * Math.sqrt((head(b) + flow) / (head(top) + 0.33)) * (1 + 0.12 * overspeed(b, rpm));
  }
  const iatSteady = (b, rpm, soak = 0) => ambient() + compHeat(b, overspeed(b, rpm)) * (1 - fx.ic * (1 - wearOf('intercooler') * 0.25 / 100)) + fx.iat + soak; // a fouled core cools less
  const iatStock = (rpm) => ambient() + compHeat(interp(E.axis, E.boost, rpm), 0) * (1 - P.find((p) => p.k === 'intercooler').opts[0].fx.ic);
  const feedCap = () => fx.lp * (1 - 0.45 * wearOf('lpfp') / 100); // the low-pressure pump feeds everything downstream
  function fuelCapP() {
    const pump = fx.pump * (1 - 0.4 * wearOf('hpfp') / 100);
    return Math.min(Math.min(fx.fuelCap, pump) + fx.port, feedCap()) * (E.fuelHead || 1) * (1 - wearOf('fuelfilter') * 0.15 / 100);
  }
  let fuelRef = 1, powerRef = 1;
  function model(c, rpm, o = {}) {
    const bT = boostTarget(c, rpm), b = o.b ?? bT;
    const iat = o.iat ?? iatSteady(bT, rpm);
    const air = airRatio(rpm, b, iat), airT = airRatio(rpm, bT, iat);
    const r = { rpm, bT, b, iat };
    if (E.fuel === 'petrol') {
      const afrS = interp(E.axis, E.afr, rpm);
      const afrT = interp(E.axis, c.afr, rpm) - (o.enrich || 0);
      // fuel flow this asks for, against what the injectors + pump can deliver (1 = stock at its peak)
      const need = rpm * (1 + Math.max(0, interp(E.axis, E.boost, rpm))) * airT / afrT / fuelRef * fx.k;
      const cap = fuelCapP();
      const afr = afrT * Math.max(1, need / cap);
      const bS = interp(E.axis, E.boost, rpm);
      const margin = interp(E.axis, E.margin, rpm) + fx.octane + fx.margin - 4.5 * Math.max(0, b - bS) - 0.12 * (iat - iatStock(rpm)) -
        1.8 * (afr - afrS) - 0.15 * Math.max(0, (o.coolant ?? 95) - 105) - wearOf('pistons') * 0.01;
      const off = interp(E.axis, c.timing, rpm);
      const retard = o.retard ?? (c.knock ? Math.max(0, off - margin) : 0);
      const dS = 2 + 4 * clamp01(bS / 1.0); // stock timing sits this far behind best torque (knock-limited)
      const tq = airT * timingEff(dS - (off - retard)) / timingEff(dS) * lamEffP(afr / 14.7) / lamEffP(afrS / 14.7) * camMul(rpm) * chainMul();
      return Object.assign(r, { afrT, afr, need, cap, margin, off, retard, detonation: Math.max(0, off - retard - margin), tqRaw: tq,
        rail: 350 * clamp01(1 - Math.max(0, need - cap) * 2), duty: clamp(need / cap * 85, 0, 100) });
    }
    // diesel
    const lamS = interp(E.axis, E.lambda, rpm), railS = interp(E.axis, E.rail, rpm);
    const iq = interp(E.axis, c.iq, rpm) / 100, railT = interp(E.axis, c.rail, rpm);
    // fuel flow against the pump (1 = stock at peak power), fuel per stroke against the injectors (1 = stock here)
    const flowRel = iq * PS(tableAt(cfg.torque, rpm), rpm) / powerRef;
    const pumpCap = Math.min(fx.pump * (1 - 0.4 * wearOf('pump') / 100), feedCap()) * (1 - wearOf('fuelfilter') * 0.15 / 100) * Math.sqrt(railS / Math.max(300, railT));
    const rail = flowRel > pumpCap ? railT * Math.pow(pumpCap / flowRel, 2) : railT;
    const injCap = fx.inj * Math.sqrt(rail / railS) * (1 - 0.15 * wearOf('injectors') / 100);
    const fuelT = Math.min(iq, injCap, airT * lamS / c.smoke); // smoke limiter: only as much fuel as the air can burn
    const fuel = Math.min(iq, injCap, air * lamS / c.smoke);
    const railBonus = 0.06 * (rail / railS - 1);
    const lamT = airT * lamS / fuelT + railBonus, lam = air * lamS / Math.max(0.05, fuel) + railBonus;
    const soi = interp(E.axis, c.soi, rpm);
    const eta = (l) => lamEffD(l) * (1 + 0.012 * soi - 0.0022 * soi * soi) * (1 + 0.025 * (rail / railS - 1));
    const tq = fuelT * eta(lamT) / lamEffD(lamS) * camMul(rpm) * chainMul() * (fx.swirlBlank && rpm < 2000 ? 0.98 : 1); // blanked flaps: less swirl low down
    const pcp = (60 + 40 * (1 + Math.max(0, b))) * (1 + 0.02 * soi) * (0.85 + 0.15 * fuel) * (c.pilot ? 1 : 1.04); // peak cylinder pressure, bar
    return Object.assign(r, { iq, fuel, fuelT, lam, lamT, rail, railT, soi, pcp, injCap, tqRaw: tq,
      mg: fuel * 42, duty: clamp(fuel / injCap * 90, 0, 100) });
  }
  // the whole tuned figure: the torque limiter, and what the gearbox can hold
  function torqueAt(c, rpm, m) {
    const stock = tableAt(cfg.torque, rpm);
    return Math.min(stock * m.tqRaw, Math.max(stock, c.tq));
  }
  function egtSteady(m, load, rpm) {
    if (E.fuel === 'petrol') {
      return 200 + load * clamp01(rpm / E.maxRpm) * 650 + Math.max(0, m.b) * 60 + 70 * (m.afr - interp(E.axis, E.afr, rpm)) * load +
        12 * (m.retard || 0) * load + fx.egt;
    }
    return 170 + clamp01(rpm / (E.maxRpm * 0.78)) * 100 + 430 * (1.22 / m.lam) * load - 4 * m.soi * load + fx.egt;
  }

  // ================= prediction: the full-load curve a calibration should make =================
  const peakFor = (pts) => pts.reduce((a, p) => (p.hp > a.hp ? p : a), pts[0]);
  function predict(c) {
    const pts = [], warn = [];
    const flag = (sev, key, text) => { if (!warn.some((w) => w.key === key)) warn.push({ sev, key, text }); };
    const rpmTop = Math.min(c.rev, E.axis[E.axis.length - 1] + 500);
    const spans = {};
    const span = (k, rpm) => { const s = spans[k] = spans[k] || [rpm, rpm]; s[0] = Math.min(s[0], rpm); s[1] = Math.max(s[1], rpm); };
    for (let rpm = E.axis[0]; rpm <= rpmTop; rpm += 250) {
      const m = model(c, rpm);
      const tq = torqueAt(c, rpm, m);
      const stock = tableAt(cfg.torque, rpm);
      pts.push({ rpm, tq, hp: PS(tq, rpm), stockTq: stock, stockHp: PS(stock, rpm), m });
      const want = interp(E.axis, c.boost, rpm);
      if (want > m.bT + 0.05 && !limp) span('cap', rpm);
      if (overspeed(m.bT, rpm) > 0.07) span('overspeed', rpm);
      if (stock * m.tqRaw > c.tq + 1) span('limiter', rpm);
      if (tq > fx.transCap) span('trans', rpm);
      if (tq > rodLimit()) span('rod', rpm);
      const egt = egtSteady(m, 1, rpm);
      if (egt > (E.fuel === 'petrol' ? 960 : 800)) span('egt', rpm);
      if (E.fuel === 'petrol') {
        if (m.need > m.cap) span('lean', rpm);
        if (m.off > m.margin + 0.05) span(c.knock ? 'knock' : 'det', rpm);
      } else {
        if (m.lamT < 1.08) span('smoke', rpm);
        if (m.rail < m.railT - 30) span('rail', rpm);
        if (m.pcp > pcpLimit()) span('pcp', rpm);
        if (m.fuelT < m.iq - 0.01) span('fuelLim', rpm);
      }
    }
    const r = (k) => `${fmt(spans[k][0])}–${fmt(spans[k][1])} rpm`;
    if (spans.det) flag('crit', 'det', `Detonation at ${r('det')} with knock control off - pistons will be damaged.`);
    if (spans.lean) flag('crit', 'lean', `Fuel system maxed at ${r('lean')}: it runs lean there. Needs ${E.fuel === 'petrol' && part('injection') === 'stock' ? 'a port injection kit or ' : ''}more fuel pump.`);
    if (spans.pcp) flag('crit', 'pcp', `Cylinder pressure over the ${pcpLimit()} bar limit at ${r('pcp')} - head gasket and pistons at risk.`);
    if (spans.overspeed) flag('high', 'overspeed', `Turbo past its efficient range at ${r('overspeed')}: hot intake air and turbo wear.`);
    if (spans.egt) flag('high', 'egt', `Exhaust temperature over the limit at ${r('egt')}.`);
    if (spans.rod) flag('high', 'rod', `Torque over what the ${part('internals') === 'stock' ? 'stock' : 'fitted'} rods take (~${fmt(rodLimit())} Nm) at ${r('rod')}: they fatigue and can let go. Build the engine (Parts → Engine internals).`);
    if (spans.trans) flag('high', 'trans', `Torque above the ${E.trans.name}'s ${fmt(fx.transCap)} Nm rating at ${r('trans')} - clutch packs will slip.`);
    if (spans.rail) flag('high', 'rail', `HP pump can't hold rail pressure at ${r('rail')} - fuel delivery drops.`);
    if (spans.knock) flag('med', 'knock', `Knock-limited at ${r('knock')} on ${part('fuel') === 'e85' ? 'E85' : 'RON ' + part('fuel')}: the ECU will pull timing there.`);
    if (spans.smoke) flag('med', 'smoke', `Visible smoke at ${r('smoke')} (lambda under 1.08).`);
    if (spans.fuelLim) flag('info', 'fuelLim', `Fuel held back by the ${fx.inj && part('injectors') === 'stock' ? 'injectors / ' : ''}smoke limiter at ${r('fuelLim')}.`);
    if (spans.cap) flag('info', 'cap', E.na && part('turbo') === 'stock' ? 'The boost map does nothing without a turbo kit (Parts → Turbocharger).'
      : `Boost map above what the ${part('turbo')} turbo can make at ${r('cap')}.`);
    if (spans.limiter) flag('info', 'limiter', `Torque limiter caps output at ${fmt(c.tq)} Nm (${r('limiter')}).`);
    const coolMax = ambient() + (peakFor(pts).hp * 0.7355 / TH.eta * TH.share + TH.idle) / (TH.ua * fx.radUA * Math.min(1, fx.wpFlow) * 1.6);
    if (coolMax > 108) flag('high', 'cool', `Cooling can't hold it flat out: ~${Math.round(coolMax)} °C at full power and speed - fit a bigger radiator (Parts → Cooling).`);
    else if (coolMax > 100) flag('med', 'cool', `Runs hot flat out: ~${Math.round(coolMax)} °C at full power and speed.`);
    if (c.rev > maxRpm()) flag('high', 'rev', `Rev limit above the engine's safe ${fmt(maxRpm())} rpm - expect wear near the limiter.`);
    if (!c.protect) flag('med', 'protect', 'ECU protections off: no limp mode or EGT enrichment to save the engine.');
    if (E.fuel === 'diesel') {
      if (!fx.dpf && c.dpf) flag('crit', 'dpf', 'DPF removed but the DPF function is on: P2002 and limp mode.');
      if (fx.egrBlank && c.egr) flag('crit', 'egr', 'EGR blanked but the EGR function is on: P0401 and limp mode.');
    } else if (fx.catless && c.dpf) flag('med', 'cat', 'Catless downpipe with the cat monitor on: P0420 stays lit.');
    const peak = pts.reduce((a, p) => (p.hp > a.hp ? p : a), pts[0]);
    const peakTq = pts.reduce((a, p) => (p.tq > a.tq ? p : a), pts[0]);
    const order = { crit: 0, high: 1, med: 2, info: 3 };
    warn.sort((a, b) => order[a.sev] - order[b.sev]);
    return { pts, warn, hp: peak.hp, hpRpm: peak.rpm, tq: peakTq.tq, tqRpm: peakTq.rpm };
  }

  // ================= live simulation =================
  const ch = { boost: 0, boostT: 0, afr: null, afrT: null, lambda: null, timing: 0, retard: 0, iat: 30, egt: 30, rail: 0, railT: 0,
    duty: 0, iq: 0, soi: 0, smoke: 0, pcp: 0, noise: 0, knock: 0, load: 0, rpm: 0, speed: 0, knockHit: false, fuelCut: false, doom: 0,
    coolT: 30, oilT: 30, oilP: 1, turbo: 0, over: 0 };
  let soak = 0, iatNow = 30, egtNow = 30, smokeNow = 0, misfireDip = 0, slipT = 0, leanT = 0, underT = 0, egtHotT = 0, overT = 0, pcpT = 0, revT = 0;
  const running = { rpm: 0, load: 0 }; // what the engine is doing when a cylinder gives up
  let pistonHits = 0; // piston damage dealt this frame - a share of it wears the engine as a whole
  let wasOn = false, startCold = false, regen = 0, forcedRegen = 0, knockLevel = 0, gripT = 0;
  const pending = {}; // wear accrued this frame, handed to CarService by each part's rate()
  const addWear = (k, v) => { if (wearParts[k] && v > 0) pending[k] = (pending[k] || 0) + v; };
  const ambient = () => (window.CarDyno && CarDyno.ch && CarDyno.ch.ambient) || 30;
  const fault = (code, state = 'event') => {
    if (!window.CarService || !CarService.fault) return;
    const f = FAULTS[code] || WEAR[E.fuel].find((d) => d.code === code); // a worn part's warning uses its own entry
    CarService.fault(code, { module: f.module || 'ECM', title: f.title, msg: f.msg, color: f.color }, state);
  };

  // limp mode: the fault that caused it stays active; boost, torque and revs are capped until an ignition cycle
  function setLimp(code) {
    if (limp || !cal().protect) return;
    limp = code;
    fault(code, 'active');
    if (window.CarService) CarService.announce(FAULTS.LIMP.title, FAULTS.LIMP.msg, FAULTS.LIMP.color);
    log('damage', `Limp mode: ${code} ${FAULTS[code].title}`);
    apply();
  }

  function tick(i) {
    const c = cal();
    // the key cycles the ECU (limp clears, faults re-judged); the engine only runs while it turns - a hybrid's sleeps
    // with the key on
    const dt = i.dt, rpm = Math.max(0, i.rpm), key = !!i.ignition, on = key && rpm > 0;
    const pedal = clamp01(i.pedal);
    if (key && !wasOn) ignitionOn(i);
    if (!key && wasOn && limp) { fault(limp, 'clear'); limp = null; apply(); } // clears with an ignition cycle (re-trips if still faulty)
    wasOn = key;
    const out = { tqMul: 1, cut: 1, egt: egtNow, fuelMul: 1, wear: 0, derate: 1, coolant: coolT, oilPress: 1 };
    ch.rpm = rpm; ch.speed = i.speed; ch.knockHit = false;
    if (!on) {
      Object.assign(ch, { afr: null, lambda: null, boost: i.boost, load: 0, rail: 0, duty: 0, smoke: 0, pcp: 0, noise: 0, retard: 0,
        knock: 0, iq: 0, timing: 0, soi: 0, over: 0, turbo: ease(ch.turbo, 0, 1.5, dt) }); // the turbo spins down
      egtNow = ease(egtNow, ambient(), 25, dt); iatNow = ease(iatNow, ambient(), 30, dt); soak = ease(soak, 0, 120, dt);
      cyl.forEach((k) => { k.retard = 0; });
      out.egt = egtNow;
      thermal(i, dt, 0, 0);
      out.coolant = coolT; out.oilPress = 1;
      ch.coolT = coolT; ch.oilT = oilT;
      return out;
    }
    const load = pedal * clamp01(rpm / 1200);
    const fuelCut = !!i.fuelCut || (pedal < 0.02 && rpm > 1300 && i.speed > 8);
    ch.fuelCut = fuelCut;
    // intake air: compressor heat less the intercooler, plus heat soak from sustained load
    const soakMax = (fx.soak ?? 10) * (E.fuel === 'diesel' ? clamp01(1 - i.speed / 120) + 0.3 : 1);
    soak = ease(soak, load > 0.5 && i.boost > 0.4 ? soakMax : 0, load > 0.5 ? 40 : 90, dt);
    iatNow = ease(iatNow, iatSteady(Math.max(0, i.boost), rpm, soak), 2.5, dt);
    const retardAvg = cyl.reduce((a, k) => a + k.retard, 0) / E.cyl;
    const enrich = E.fuel === 'petrol' && c.protect ? clamp((egtNow - 950) / 50, 0, 1.2) : 0; // component protection
    const m = model(c, rpm, { b: i.boost, iat: iatNow, retard: retardAvg, coolant: i.coolant, enrich });
    const steady = model(c, rpm, { iat: iatNow, retard: retardAvg, coolant: i.coolant, enrich });
    let tqMul = torqueAt(c, rpm, steady) / Math.max(1, tableAt(cfg.torque, rpm));

    // cylinders: compression loss from damage, dead cylinders, misfires
    let health = 0;
    cyl.forEach((k) => { health += k.dead ? 0 : 1 - 0.35 * Math.pow(k.damage / 100, 2); });
    tqMul *= health / E.cyl * (wearOf('gasket') >= 100 ? 0.96 : 1); // a blown head gasket leaks compression
    const firing = rpm / 120 * dt; // firings per cylinder this frame
    running.rpm = rpm; running.load = fuelCut ? 0 : load;
    if (E.fuel === 'petrol') petrolTick(c, m, i, dt, firing, load, fuelCut);
    else dieselTick(c, m, i, dt, firing, load, fuelCut);
    misfires(c, m, i, dt, firing, load, fuelCut);
    misfireDip = Math.max(0, misfireDip - dt);
    if (misfireDip > 0) out.cut *= 1 - 0.6 / E.cyl;

    // exhaust temperature
    const regenHeat = forcedRegen > 0 ? 420 : regen > 0 ? 160 : 0; // post-injection: a parked regeneration needs it all
    const burbleHeat = E.fuel === 'petrol' && fuelCut && c.burble >= 2 && rpm > 2000 ? 90 * (c.burble - 1) : 0;
    egtNow = ease(egtNow, egtSteady(m, fuelCut ? 0 : load, rpm) * (fuelCut ? 0.6 : 1) + regenHeat + burbleHeat, 1.1, dt);
    out.egt = egtNow;

    // transmission: torque past the clutch packs' rating slips (and wears them) - a hybrid's motor (i.motorTq) drives
    // through them too, so the engine's share is what slips
    const engineTq = tableAt(cfg.torque, rpm) * tqMul * load, motorTq = i.motorTq || 0;
    const cap = fx.transCap * (1 - 0.4 * wearOf('trans') / 100);
    if (i.gear >= 0 && engineTq > 0 && engineTq + motorTq > cap && !fuelCut) {
      tqMul *= Math.max(0, cap - motorTq) / engineTq;
      addWear('trans', ((engineTq + motorTq) / cap - 1) * 0.8 * dt);
      if ((slipT += dt) > 0.6) { fault('P0730'); slipT = -5; }
    } else slipT = Math.max(0, slipT - dt);
    if (wearOf('trans') >= 100) setLimp('P0700');
    addWear('trans', (i.speed * dt / 3600) * 0.004 * (1 + c.shiftSpeed * 0.6) * fx.transWear);
    goingBad(c, i, dt, rpm, load, fuelCut, engineTq);
    // engine wear (the car's Engine row, %/s): torque past the stock rating, hot exhaust, running lean, and a share of
    // every bit of piston damage - a hard-pushed tune wears the whole engine, not just one part
    const egtLimit = E.fuel === 'petrol' ? 950 : 780;
    const lean = E.fuel === 'petrol' && m.afr - m.afrT > 0.5 && load > 0.8;
    out.wear = pistonHits * 0.3 / Math.max(dt, 1e-3) + (fuelCut ? 0 :
      0.02 * Math.max(0, engineTq / E.tq - 1) + Math.max(0, egtNow - egtLimit) * 0.0006 + (lean ? 0.01 : 0));
    pistonHits = 0;
    cooling(c, i, dt, rpm, load, fuelCut, engineTq, m, retardAvg, out);
    tqMul *= out.derate;
    // the gearbox map: a torque limit per gear (traction off the line, or to spare the clutch packs)
    const gearCap = i.gear >= 0 ? c.gearTq[i.gear] : 0;
    if (gearCap > 0) tqMul = Math.min(tqMul, gearCap / Math.max(1, tableAt(cfg.torque, rpm)));

    // the limiters: speed (cuts fuel only between vmax and vmax + 1, so it holds the set speed), limp mode
    if (c.vmax > 0) out.cut *= clamp01(c.vmax + 1 - i.speed);
    if (limp) tqMul = Math.min(tqMul, 0.55);
    if (rpm > maxRpm() && !fuelCut) { // valve float: pistons start kissing valves
      damage(Math.floor(Math.random() * E.cyl), (rpm - maxRpm()) / 1000 * 1.5 * dt);
      if ((revT += dt) > 0.5) { fault('P0219'); revT = -20; }
    }

    // turbo: overspeed past its efficient range, hot exhaust, plain mileage (old oil makes all of it worse)
    const over = overspeed(i.boost, rpm);
    const oil = window.CarService ? CarService.oilMul() : 1;
    addWear('turbo', (over * over * 0.08 * dt + Math.max(0, egtNow - (E.fuel === 'petrol' ? 980 : 800)) * 0.0015 * dt + i.speed * dt / 3600 * 0.003) * oil);
    if (over > 0.3 && load > 0.6) { if ((overT += dt) > 1.5) { fault('P0234'); overT = -30; } }
    if (load > 0.9 && rpm > 2500 && m.bT - i.boost > 0.35 && wearOf('turbo') < 100) { if ((underT += dt) > 3) { fault('P0299'); underT = -30; } } else underT = Math.max(0, underT - dt);
    if (wearOf('turbo') >= 100) { fault('P0299', 'active'); setLimp('P0299'); }
    if (egtNow > (E.fuel === 'petrol' ? 980 : 850)) {
      damage(Math.floor(Math.random() * E.cyl), (egtNow - (E.fuel === 'petrol' ? 980 : 850)) * 0.004 * dt); // piston crowns melt
      if ((egtHotT += dt) > 3) { fault('P2428'); egtHotT = -30; if (egtNow > (E.fuel === 'petrol' ? 1020 : 900)) setLimp('P2428'); }
    } else egtHotT = Math.max(0, egtHotT - dt);

    // channels
    const afrLive = m.afr;
    const wotMix = clamp01((pedal - 0.55) / 0.35);
    Object.assign(ch, { boost: i.boost, boostT: -0.3 + pedal * (m.bT + 0.3), iat: iatNow, egt: egtNow, load: pedal, turbo: turboKrpm(i.boost, rpm), over });
    if (E.fuel === 'petrol') {
      const closed = 14.7 + Math.sin(performance.now() / 140) * 0.12;
      ch.afrT = fuelCut ? null : closed + (m.afrT - closed) * wotMix;
      ch.afr = fuelCut ? null : closed + (afrLive - closed) * wotMix;
      ch.lambda = ch.afr && ch.afr / 14.7;
      ch.timing = m.off * wotMix - retardAvg;
      ch.retard = Math.max(...cyl.map((k) => k.retard));
      ch.rail = fuelCut ? 50 : 50 + (m.rail - 50) * clamp01(0.3 + load);
      ch.railT = fuelCut ? 50 : 50 + 300 * clamp01(0.3 + load);
      ch.duty = fuelCut ? 0 : m.duty * Math.max(0.08, load) * clamp01(rpm / (E.maxRpm * 0.95) + 0.2);
    } else {
      const f = Math.max(0.05, load);
      ch.iq = fuelCut ? 0 : m.mg * f; ch.soi = m.soi * wotMix;
      ch.railT = 350 + (m.railT - 350) * clamp01(0.2 + load); ch.rail = 350 + (m.rail - 350) * clamp01(0.2 + load);
      ch.duty = fuelCut ? 0 : m.duty * f;
      ch.pcp = fuelCut ? 40 : 40 + (m.pcp - 40) * Math.pow(load, 0.8);
      ch.smoke = smokeNow;
    }
    out.tqMul = tqMul;
    // the tyres wear as it drives: hand the car its new grip once it has moved enough to matter
    if ((gripT += dt) > 2) { gripT = 0; if (Math.abs(fx.grip * tyreGrip() - T.grip) > 0.004) apply(); }
    out.fuelMul = E.fuel === 'petrol' ? (interp(E.axis, E.afr, rpm) / Math.max(10, m.afrT)) * fx.k : 1;
    ch.knock = knockLevel;
    return out;
  }

  // ---- the engine going bad, then letting go ----
  // Rods fatigue under torque past their rating, a starved bottom end wears every cylinder, and as the worst of the
  // damage (or the car's own engine wear) climbs a rod knock comes through, louder with load. Past ~85% every hard
  // pull at high revs risks the rod letting go - more so with a cylinder already dead.
  let noiseShown = false, starveT = 0;
  function goingBad(c, i, dt, rpm, load, fuelCut, engineTq) {
    const weakest = cyl.reduce((w, k, n) => (!k.dead && (w < 0 || k.damage > cyl[w].damage) ? n : w), -1);
    if (engineTq > rodLimit() && weakest >= 0) damage(weakest, Math.pow(engineTq / rodLimit() - 1, 2) * 4 * dt);
    const CS = window.CarService;
    const val = (key) => (CS ? (CS.parts.find((p) => p.key === key) || { value: 0 }).value : 0);
    const starved = clamp01((val('oilLevel') - 80) / 20);
    if (starved > 0 && load > 0.3) {
      cyl.forEach((k, n) => damage(n, starved * 0.05 * load * dt));
      if ((starveT += dt) > 2) { fault('P0524'); starveT = -60; }
    }
    const doom = Math.max(...cyl.map((k) => k.damage), val('engine')) / 100;
    ch.doom = doom;
    if (doom > 0.55) rodKnock(rpm, clamp01((doom - 0.55) / 0.45) * (0.35 + 0.65 * load));
    if (doom > 0.7 && !noiseShown) { noiseShown = true; fault('P1C02'); log('damage', `Rod knock: engine at ${Math.round(doom * 100)}% damage`); }
    if (fuelCut || load < 0.4 || rpm < 2500 || weakest < 0) return;
    const dead = cyl.filter((k) => k.dead).length;
    const hazard = 10 * Math.pow(Math.max(0, doom - 0.85), 2) * Math.min(1.5, Math.pow(rpm / c.shift, 3)) * load * (1 + dead); // near the redline it's worst
    if (Math.random() < hazard * dt) blowUp(weakest, rpm, dead ? 'dead' : 'rod');
  }
  let blown = false;
  function blowUp(n, rpm, why) {
    if (blown) return;
    blown = true;
    cyl[n].damage = 100; cyl[n].dead = true;
    if (wearParts.pistons) wearParts.pistons.value = 100;
    const what = { rod: `con-rod through the block, cylinder ${n + 1}`, dead: `cylinder ${n + 1} came apart`, chain: `timing chain jumped - valves into the pistons`,
      lspi: `pre-ignition split the piston in cylinder ${n + 1}`, pressure: `cylinder ${n + 1} burst - head gasket and piston gone`,
      swirl: `a swirl flap broke off into cylinder ${n + 1}` }[why];
    fault('P1C03', 'active');
    log('damage', `ENGINE BLOWN at ${fmt(rpm)} rpm: ${what}`);
    sound('boom');
    effects.explode(what.charAt(0).toUpperCase() + what.slice(1));
    // the engine dies on the spot - the car's own switch-off, a beat later so it isn't mid-frame
    setTimeout(() => { const b = document.getElementById('power-btn'); if (b && window.CarService && CarService.ignitionOn()) b.click(); }, 0);
    apply();
  }
  // a new short block: the pistons service, the car's engine repair, or fitting new internals
  function rebuild(note) {
    const was = blown;
    cyl.forEach((k) => { k.damage = 0; k.dead = false; k.knocks = 0; k.misfires = 0; });
    if (wearParts.pistons) wearParts.pistons.value = 0;
    noiseShown = false;
    if (blown) { blown = false; fault('P1C03', 'clear'); effects.clear(); }
    if (was && note) log('repair', note);
    apply();
  }
  // a seized engine won't turn over: the start button only gets a starter clunk
  function crank() {
    if (audioReady()) { if (actx.state === 'suspended') actx.resume(); sound('crank'); }
    effects.seizedNudge();
  }

  // ---- cooling and oil: heat goes into the coolant with the fuel burned, out through the radiator ----
  // The constants are sized off the stock engine (TH, at init): flat out at top speed a stock engine sits around its
  // thermostat with a little margin - a tune that makes more power puts in more heat than the stock radiator sheds.
  let coolT = null, oilT = null, fanOn = false, hotT = 0, oilLowT = 0, chainShown = false, swirlShown = false;
  const TH = {};
  function thermal(i, dt, powerKw, extra) {
    const amb = ambient(), on = !!i.ignition && i.rpm > 0; // a sleeping hybrid engine puts no heat in
    if (coolT == null) { coolT = i.coolant ?? amb; oilT = coolT; }
    const tstat = E.tstat + fx.tstat;
    const tw = wearOf('thermostat');
    // the thermostat opens over the 8 °C past its rating; a sticking one only partly, a seized one barely at all
    const open = clamp01((coolT - tstat) / 8) * (tw > 70 ? 1 - (tw - 70) / 30 * 0.85 : 1);
    const pump = wearOf('waterpump') >= 100 ? 0.15 : (1 - wearOf('waterpump') * 0.6 / 100) * fx.wpFlow;
    const lowCoolant = clamp01(((window.CarService && (CarService.parts.find((p) => p.key === 'coolant') || {}).value) || 0) - 40) / 60;
    const ua = TH.ua * fx.radUA * (1 - wearOf('radiator') * 0.4 / 100) * (1 - lowCoolant * 0.8);
    fanOn = on && coolT > tstat + (fanOn ? 5 : 9);
    const fan = wearOf('fan') >= 100 ? 0 : fx.fanFlow * (1 - 0.6 * wearOf('fan') / 100); // a tired motor spins slower, a dead one not at all
    const air = Math.min(1.6, 0.1 + i.speed / 110 + (fanOn ? 0.45 * fan : 0));
    const qIn = on ? Math.max(0, powerKw) / TH.eta * TH.share * (1 + extra) + TH.idle : 0;
    const qOut = ua * Math.max(0, coolT - amb) * (air * Math.min(1, open * (on ? pump : 0.15) + 0.03) + 0.04);
    coolT += (qIn - qOut) / (TH.c * (0.3 + 0.7 * open)) * dt; // a closed thermostat only heats the small circuit - a quick warm-up
    // oil: friction and the piston-cooling jets heat it, the oil-to-coolant cooler holds it near the coolant
    const qOil = on ? Math.max(0, powerKw) / TH.eta * 0.025 + i.rpm / 1000 * 1.2 : 0;
    oilT = ease(oilT, coolT + qOil / (TH.uaOil * fx.oilCool), on ? 30 : 300, dt);
  }
  function cooling(c, i, dt, rpm, load, fuelCut, engineTq, m, retard, out) {
    const powerKw = fuelCut ? 0 : engineTq * rpm * Math.PI / 30 / 1000;
    // a retarded or lean burn dumps more of its heat into the block
    const extra = E.fuel === 'petrol' ? retard * 0.02 + Math.max(0, m.afr - m.afrT) * 0.03 : Math.max(0, -m.soi) * 0.02 + (m.lam < 1.1 ? 0.05 : 0);
    thermal(i, dt, powerKw, extra);
    out.coolant = coolT;
    ch.coolT = coolT; ch.oilT = oilT;
    // overheating: the ECU pulls power past 108 °C, past 120 °C the head gasket and pistons start to suffer
    out.derate = coolT > 108 && c.protect ? 1 - clamp01((coolT - 108) / 15) * 0.5 : 1;
    if (coolT > 110) { if ((hotT += dt) > 2) { fault('P0217'); hotT = -60; } } else hotT = Math.max(0, hotT - dt);
    if (coolT > 120 && !fuelCut) damage(Math.floor(Math.random() * E.cyl), (coolT - 120) * 0.04 * dt, 'pressure');
    // hot, thin oil: it breaks down fast and the pressure sags; a worn pump makes it worse
    const CS = window.CarService;
    if (oilT > 130 && CS) { const o = CS.parts.find((p) => p.key === 'oil'); if (o) o.value = Math.min(100, o.value + (oilT - 130) * 0.002 * dt); out.wear += (oilT - 130) * 0.002; }
    const press = fx.oilPump * (1 - wearOf('oilpump') * 0.45 / 100) * (oilT > 110 ? Math.max(0.4, 1 - (oilT - 110) / 90) : 1);
    out.oilPress = press;
    ch.oilP = press;
    if (press < 0.7 && rpm > 1500 && load > 0.3) {
      out.wear += (0.7 - press) * 0.05 * load; // the bearings run short of oil
      if ((oilLowT += dt) > 2) { fault('P0524'); oilLowT = -60; }
    } else oilLowT = Math.max(0, oilLowT - dt);
    // the new parts' wear: mileage, revs, heat, and old oil for the chain and pump
    const km = i.speed * dt / 3600, oil = CS ? CS.oilMul() : 1;
    addWear('chain', km * 0.005 * fx.chainWear * oil * (1 + Math.max(0, rpm - 5000) / 2000));
    addWear('springs', (km * 0.002 + Math.pow(clamp01(rpm / maxRpm()), 6) * 0.02 * dt) * fx.springLoad * fx.springWear);
    addWear('oilpump', km * 0.004 * oil);
    addWear('waterpump', km * 0.006 + dt * 0.0004);
    addWear('radiator', km * 0.004);
    addWear('thermostat', dt * 0.0005);
    addWear('airfilter', km * (E.fuel === 'diesel' ? 0.035 : 0.03));
    addWear('fuelfilter', km * 0.015);
    // the bolt-ons: boost well over stock fatigues the plastic charge pipe and the diverter's diaphragm; cylinder
    // pressure past the design (boost on a petrol, peak pressure on a diesel) and overheating work the head gasket
    const bS = interp(E.axis, E.boost, rpm), over = fuelCut ? 0 : Math.max(0, i.boost - bS) * load;
    const cylP = E.fuel === 'diesel' ? (fuelCut ? 0 : Math.max(0, ch.pcp / pcpLimit() - 0.9) * 10) : Math.max(0, over - 0.5);
    addWear('gasket', (km * 0.0015 + cylP * cylP * 0.2 * dt + Math.max(0, coolT - 112) * 0.02 * dt) * fx.gasketWear);
    addWear('chargepipe', (km * 0.002 + Math.pow(Math.max(0, over - 0.25), 1.5) * 0.3 * dt) * fx.cpWear);
    addWear('diverter', (km * 0.002 + Math.max(0, over - 0.4) * 0.15 * dt) * fx.dvWear);
    addWear('intercooler', km * 0.002 * (1 + wearOf('turbo') / 50)); // a tired turbo mists oil into it
    addWear('lpfp', km * 0.003 * (1 + load) * fx.lpWear);
    addWear('hoses', (km * 0.002 + dt * 0.0002 * (1 + Math.max(0, coolT - 100) / 5)) * fx.hoseWear);
    addWear('fan', (km * 0.001 + (fanOn ? dt * 0.003 : 0)) * fx.fanWear);
    addWear('valves', km * 0.01 * fx.carbon * oil); // old oil, more blow-by, more carbon
    const sooty = c.egr && !fx.egrBlank ? 1.3 : 1; // an open EGR feeds soot to the vanes and flaps
    addWear('vgt', km * 0.005 * (1 + smokeNow / 25) * sooty * fx.vgtWear);
    addWear('swirl', km * 0.004 * sooty);
    // a weeping hose or head gasket takes coolant (the Coolant row); a burst hose or a blown gasket a lot of it
    const leak = clamp01((wearOf('hoses') - 70) / 30) * 0.01 + (wearOf('hoses') >= 100 ? 0.25 : 0) +
      clamp01((wearOf('gasket') - 60) / 40) * 0.015 + (wearOf('gasket') >= 100 ? 0.08 : 0);
    const coolant = leak > 0 && CS && CS.parts.find((p) => p.key === 'coolant');
    if (coolant) coolant.value = Math.min(100, coolant.value + leak * dt);
    // worn swirl flaps: past 80% the ECU logs it; past 90% a flap can let go into a cylinder under load
    const swirlW = fx.swirlBlank ? 0 : wearOf('swirl');
    if (swirlW > 80 && !swirlShown) { swirlShown = true; fault('P2015'); }
    if (swirlW > 90 && !fuelCut && load > 0.3 && Math.random() < km * (swirlW - 90) * 0.01) blowUp(Math.floor(Math.random() * E.cyl), rpm, 'swirl');
    // a stretched chain rattles at idle, and once it's done it can jump a tooth - valves meet pistons
    const chainW = wearOf('chain');
    if (chainW > 60 && rpm < 1600 && Math.random() < dt * 4) sound('rattle', (chainW - 60) / 40);
    if (chainW > 75 && !chainShown) { chainShown = true; fault('P0016'); }
    if (chainW >= 100 && !fuelCut && rpm > 3000 && load > 0.3 && Math.random() < 0.3 * dt) blowUp(Math.floor(Math.random() * E.cyl), rpm, 'chain');
  }

  function ignitionOn(i) {
    startCold = i.coolant != null && i.coolant < 40;
    addWear('thermostat', 0.15); // every warm-up cycle
    chainShown = false; swirlShown = false;
    if (E.fuel === 'diesel') addWear('glow', (startCold ? 0.6 : 0.05) * fx.glowWear);
    // emissions mismatches are there as soon as the ECU wakes up
    const c = cal();
    if (E.fuel === 'diesel') {
      if (!fx.dpf && c.dpf) { fault('P2002', 'active'); setLimp('P2002'); } else fault('P2002', 'clear');
      if (fx.egrBlank && c.egr) { fault('P0401', 'active'); setLimp('P0401'); } else if (!(wearParts.egr && wearParts.egr.value >= 100)) fault('P0401', 'clear');
    } else if (fx.catless && c.dpf) fault('P0420', 'active');
    else if (!(wearParts.cat && wearParts.cat.value >= 100)) fault('P0420', 'clear');
    cyl.forEach((k, n) => { if (k.dead) { fault('P030' + (n + 1), 'active'); setLimp('P030' + (n + 1)); } });
    if (wearOf('dpf') >= 100 && fx.dpf) setLimp('P2463');
  }

  // ---- petrol: knock per cylinder, the ECU's knock control, detonation and pre-ignition damage ----
  let lspiCool = 0, knockLimT = 0, leanCool = 0;
  function petrolTick(c, m, i, dt, firing, load, fuelCut) {
    const pedal = clamp01(i.pedal);
    knockLevel = ease(knockLevel, 6 + clamp01(i.rpm / (E.maxRpm * 0.95)) * 9 + Math.random() * 3, 0.25, dt);
    const boosted = !fuelCut && pedal > 0.45 && (i.boost > 0.2 || E.na); // an NA engine knocks on load alone
    let any = false;
    cyl.forEach((k, n) => {
      if (k.dead) return;
      const marginC = m.margin + E.cylMargin[n % E.cylMargin.length];
      const excess = (m.off - k.retard) * clamp01((pedal - 0.45) / 0.4) - marginC;
      let p = excess > 0 ? clamp(0.02 * excess + 0.015 * excess * excess, 0, 0.6) : 0;
      p *= clamp01((load - 0.3) / 0.6);
      const events = boosted && p > 0 ? poisson(firing * p) : 0;
      if (events) {
        any = true;
        const k2 = clamp(0.3 + 0.25 * excess, 0.3, 3);
        k.knocks += events;
        knockLevel = Math.max(knockLevel, 30 + k2 * 22);
        ch.knockHit = true;
        if (c.knock) k.retard = Math.min(10, k.retard + 1.5 * k2 * events);
        damage(n, events * 0.01 * Math.pow(k2, 2.5) * (c.knock ? 0.08 : 1));
        sound('ping', k2);
      }
      k.retard = Math.max(0, k.retard - 0.8 * dt);
    });
    // knock control out of road (retard maxed and still knocking: the ECU drops boost too), or switched off
    if (any && (!c.knock || cyl.some((k) => k.retard >= 9.5))) {
      if (c.knock) adapt = Math.max(0.75, adapt - 0.02);
      if ((knockLimT += dt) > 0.6) { fault('P0324'); knockLimT = -20; }
    } else if (!any) adapt = Math.min(1, adapt + 0.004 * dt);
    // low-speed pre-ignition: rare, violent, worse on old oil and low octane
    lspiCool = Math.max(0, lspiCool - dt);
    if (boosted && i.rpm < 3200 && i.boost > 0.85 && lspiCool <= 0) {
      const rate = 0.0025 * (i.boost - 0.8) * (3200 - i.rpm) / 1000 * (window.CarService ? CarService.oilMul() : 1) *
        ({ 0: 1, 2: 0.7, 5: 0.4, 9: 0.15 }[fx.octane] ?? 1) * fx.lspi * (1 + wearOf('valves') / 100); // oil mist + carbon deposits set it off
      if (Math.random() < rate * dt * 60) {
        const n = Math.floor(Math.random() * E.cyl);
        damage(n, 8 + Math.random() * 14, 'lspi');
        lspiCool = 4;
        knockLevel = 100; ch.knockHit = true;
        sound('lspi');
        fault('P1345');
        log('damage', `Pre-ignition in cylinder ${n + 1} at ${fmt(i.rpm)} rpm`);
      }
    }
    // fuel system out of road: the mixture leans out (protections pull boost)
    if (pedal > 0.85 && m.need > m.cap * 1.02) {
      if (c.protect) adapt = Math.max(0.7, adapt - 0.03 * dt * 10);
      addWear('hpfp', (m.need / m.cap - 1) * 0.3 * dt);
      if ((leanT += dt) > 0.6 && leanCool <= 0) { fault('P0171'); fault('P0087'); leanCool = 30; }
    } else leanT = 0;
    leanCool = Math.max(0, leanCool - dt);
    addWear('hpfp', i.speed * dt / 3600 * 0.002);
    // plugs and coils: mileage, harder under boost; worn plugs strain the coils
    const km = i.speed * dt / 3600;
    addWear('plugs', km * 0.04 * (1 + 1.5 * Math.max(0, i.boost - 1)));
    addWear('coils', km * 0.008 * (1 + wearOf('plugs') / 50) * fx.coilWear);
    // the catalyst cooks on hot exhaust and burbles
    if (!fx.catless) addWear('cat', Math.max(0, egtNow - 900) * 0.0004 * dt + (fuelCut && c.burble >= 2 && i.rpm > 2000 ? 0.004 * (c.burble - 1) * dt : 0) + km * 0.002);
  }

  // ---- diesel: smoke, cylinder pressure, rail pressure, DPF soot + regeneration, EGR, glow plugs ----
  let railLowT = 0, regenMsg = false;
  function dieselTick(c, m, i, dt, firing, load, fuelCut) {
    const pedal = clamp01(i.pedal);
    // smoke: lambda at this pedal with the boost that's actually there - a stab of throttle before the turbo
    // catches up puffs unless the smoke limiter holds the fuel back
    // part load: an open EGR valve displaces air; worn injectors dribble; worn glow plugs make cold starts smoky
    const egrStuck = !fx.egrBlank && c.egr ? 0.06 * clamp01((wearOf('egr') - 40) / 60) : 0; // a sooted valve sticks open - more smoke
    const lamLive = fuelCut ? 9 : m.lam / Math.max(0.05, pedal) + (pedal < 0.6 ? (fx.egrBlank || !c.egr ? 0.03 : -0.04 - egrStuck) : 0) -
      wearOf('injectors') * 0.002 - (startCold && i.coolant < 50 ? 0.02 + 0.12 * clamp01((wearOf('glow') - 50) / 50) : 0);
    ch.lambda = fuelCut ? null : clamp(lamLive, 0.9, 6);
    ch.afr = ch.lambda && ch.lambda * 14.5; ch.afrT = null;
    const smokeT = clamp01((1.15 - lamLive) / 0.25) ** 1.5 * 100 * clamp01(pedal * 1.5);
    smokeNow = ease(smokeNow, smokeT, smokeT > smokeNow ? 0.08 : 0.6, dt);
    if (i.coolant > 60) startCold = false;
    // combustion noise: injection advance and no pilot make it clatter
    ch.noise = ease(ch.noise, clamp(20 + (m.soi + (c.pilot ? 0 : 4)) * 8 * Math.max(0.3, pedal) + pedal * 20, 0, 100), 0.3, dt);
    knockLevel = ch.noise * 0.6 + Math.random() * 3;
    // over the design pressure the head gasket and pistons take it; heavy over-pressure cracks a cylinder
    const pcpNow = 40 + (m.pcp - 40) * Math.pow(pedal, 0.8);
    if (pcpNow > pcpLimit() && !fuelCut) {
      const over = (pcpNow - pcpLimit()) / pcpLimit();
      cyl.forEach((k, n) => {
        const ev = poisson(firing * clamp(over * 3, 0, 0.5));
        if (ev) { damage(n, ev * 0.02 * (1 + over * 20) * (1 + k.balance * 0.5), 'pressure'); k.knocks += ev; ch.knockHit = true; sound('clack', 0.6 + over * 4); }
      });
      if ((pcpT += dt) > 1) { fault('P1C10'); pcpT = -30; }
    } else pcpT = Math.max(0, pcpT - dt);
    // rail pressure the pump can't hold
    if (pedal > 0.8 && m.rail < m.railT - 60) {
      addWear('pump', (m.railT / Math.max(500, m.rail) - 1) * 0.3 * dt);
      if ((railLowT += dt) > 1) { fault('P0087'); railLowT = -30; }
    } else railLowT = Math.max(0, railLowT - dt);
    const km = i.speed * dt / 3600;
    addWear('pump', km * 0.002 * (m.railT / 2000));
    addWear('injectors', km * 0.004 * Math.pow(m.railT / 2000, 2) * (1 + pedal) + (m.duty > 95 ? 0.01 * dt : 0));
    addWear('glow', km * 0.003 * fx.glowWear);
    // EGR: soots up while it's open (part load), faster when it's smoky
    if (c.egr && !fx.egrBlank) addWear('egr', km * 0.02 * (pedal < 0.6 ? 1 : 0.3) * (1 + smokeNow / 20));
    if (wearParts.egr && wearParts.egr.value >= 100 && c.egr && !fx.egrBlank) fault('P0401', 'active');
    // DPF soot: loads with smoke and miles, burns off when the exhaust is hot, or in a regeneration
    if (fx.dpf) {
      const burn = Math.max(0, egtNow - 550) * 0.0015 * dt;
      addWear('dpf', (smokeNow * 0.004 * dt + km * 0.25) * fx.dpf);
      const soot = wearOf('dpf');
      if (regen <= 0 && soot >= 60 && i.speed > 60 && pedal > 0.1 && pedal < 0.8) { regen = 1; if (!regenMsg) { regenMsg = true; log('regen', `DPF regeneration started at ${Math.round(soot)}% soot`); } }
      if (regen > 0 || forcedRegen > 0) {
        burnSoot(0.35 * dt + burn);
        if (wearOf('dpf') < 8) { if (regen > 0) log('regen', 'DPF regeneration complete'); regen = 0; regenMsg = false; }
        if (regen > 0 && i.speed < 30) regen = 0; // interrupted: it'll start again on the next fast run
      } else burnSoot(burn);
      if (soot >= 85 && soot < 100) fault('P2463');
      if (soot >= 100) { fault('P2463', 'active'); setLimp('P2463'); } else fault('P2463', 'clear');
    }
  }
  function burnSoot(v) { if (wearParts.dpf) wearParts.dpf.value = Math.max(0, wearParts.dpf.value - v); }

  // ---- misfires: worn plugs / coils under boost, worn injectors, dead cylinders ----
  let missCool = 0;
  function misfires(c, m, i, dt, firing, load, fuelCut) {
    if (fuelCut) return;
    missCool = Math.max(0, missCool - dt);
    const ign = E.fuel === 'petrol' ? Math.pow(clamp01((wearOf('plugs') - 55) / 45), 2) * clamp01(E.na ? load : i.boost / 1.2) * 0.05 +
      Math.pow(clamp01((wearOf('coils') - 60) / 40), 2) * 0.03 * load * fx.coilSpark + Math.pow(clamp01((wearOf('valves') - 80) / 20), 2) * 0.02 : 0;
    const inj = E.fuel === 'diesel' ? Math.pow(clamp01((wearOf('injectors') - 60) / 40), 2) * 0.03 : 0;
    const cold = E.fuel === 'diesel' && startCold && wearOf('glow') > 70 ? 0.04 : 0;
    cyl.forEach((k, n) => {
      if (k.dead) { nextDead(k, i.rpm); return; }
      const p = (ign + inj + cold) * (n === weakCyl ? 2 : 1) + (n === weakCyl && wearOf('gasket') >= 100 ? 0.05 : 0); // a blown gasket floods one cylinder
      if (p > 0 && poisson(firing * p)) {
        k.misfires++;
        misfireDip = 0.06;
        sound('miss');
        addWear('cat', 0.15);
        if (missCool <= 0) { fault('P030' + (n + 1)); missCool = 20; }
      }
    });
  }
  let weakCyl = 0;
  // a dead cylinder: a misfire thump every time it should have fired
  function nextDead(k, rpm) {
    if (!actx || rpm < 300) return;
    const t = actx.currentTime;
    if (!(k.nextMiss > t)) k.nextMiss = t + 0.02;
    while (k.nextMiss < t + 0.1) { sound('miss', 0.7, k.nextMiss); k.nextMiss += 120 / rpm; }
  }
  function damage(n, v, why = 'rod') {
    const k = cyl[n];
    if (!k || k.dead || v <= 0 || blown) return;
    pistonHits += Math.min(100 - k.damage, v * fx.dmg);
    k.damage = Math.min(100, k.damage + v * fx.dmg);
    if (k.damage >= 100) {
      // under real load and revs a failing cylinder doesn't just stop firing - it takes the engine with it
      if (running.load > 0.5 && running.rpm > 3500 && Math.random() < 0.6) return blowUp(n, running.rpm, why);
      k.dead = true;
      fault('P030' + (n + 1), 'active');
      if (window.CarService) CarService.announce('Engine damaged', `Cylinder ${n + 1} has lost compression. Stop the engine - it needs a rebuild.`, '#ff5f3d');
      log('damage', `Cylinder ${n + 1} destroyed (${E.fuel === 'petrol' ? 'detonation' : 'overload'})`);
      setLimp('P030' + (n + 1));
    }
    if (wearParts.pistons) wearParts.pistons.value = Math.max(...cyl.map((x) => x.damage));
  }
  function poisson(lam) {
    if (lam <= 0) return 0;
    if (lam < 0.3) return Math.random() < lam ? 1 : 0;
    let n = 0, p = Math.exp(-lam), s = p;
    const u = Math.random();
    while (u > s && n < 20) { n++; p *= lam / n; s += p; }
    return n;
  }

  // ================= sounds: knock pings, pre-ignition, misfires (into the car's master gain) =================
  let actx = null, out = null, noiseBuf = null, vol = 0.8, ownCtx = null;
  function attachAudio(ctx, dest) {
    if (actx && actx !== ownCtx) return; // a context of our own (a seized-engine crank before any start) gives way to the car's
    actx = ctx; out = dest;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (window.EngineMixer && ctx !== ownCtx) EngineMixer.addLayer({ id: 'tuneFx', label: 'Knock & Misfire', value: vol, set: (f) => { vol = f; } });
  }
  // a bottom end on its way out: one knock per crank revolution (every other one past 4,000 rpm - it blurs anyway)
  let nextKnock = 0;
  function rodKnock(rpm, amt) {
    if (!actx || rpm < 300 || amt <= 0.02) return;
    const t = actx.currentTime;
    if (nextKnock < t) nextKnock = t + 0.01;
    while (nextKnock < t + 0.08) { sound('tock', amt, nextKnock); nextKnock += 60 / rpm * (rpm > 4000 ? 2 : 1); }
  }
  let lastPing = 0;
  function sound(kind, amt = 1, at) {
    if (!actx || vol <= 0.01 || !out) return;
    const t = at ?? actx.currentTime + Math.random() * 0.02;
    if (kind === 'ping' || kind === 'clack') { if (t - lastPing < 0.022) return; lastPing = t; } // heavy detonation: a rattle, not a node flood
    const hit = (at, dur, type, freq, q, peak, decay) => {
      const src = actx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
      src.loop = dur > 0.4;
      const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = actx.createGain(); g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      src.connect(f).connect(g).connect(out);
      src.start(at, Math.random() * 0.3, dur); src.stop(at + dur + 0.05);
      return f;
    };
    const burst = (dur, type, freq, q, peak, decay) => hit(t, dur, type, freq, q, peak, decay);
    const tone = (at, type, f0, f1, peak, dur) => { // a pitched thump or whine, sweeping f0 -> f1
      const o = actx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      const g = actx.createGain(); g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak * vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
      return g;
    };
    if (kind === 'ping') { // metallic rattle: two narrow resonances, a harsher triple on heavy detonation
      const a = clamp(amt, 0.3, 3);
      burst(0.03, 'bandpass', 6200 + Math.random() * 600, 14, 0.06 * a, 0.03);
      burst(0.03, 'bandpass', 9100 + Math.random() * 700, 16, 0.035 * a, 0.022);
      if (a > 1.4) burst(0.05, 'bandpass', 4300, 6, 0.05 * a, 0.045);
    } else if (kind === 'clack') { // diesel over-pressure: a hard knock lower down
      burst(0.05, 'bandpass', 2400 + Math.random() * 500, 5, 0.09 * clamp(amt, 0.5, 3), 0.05);
    } else if (kind === 'lspi') { // pre-ignition: a deep thud with a crack on top
      burst(0.2, 'lowpass', 180, 1, 0.55, 0.18);
      burst(0.08, 'bandpass', 3800, 3, 0.3, 0.07);
    } else if (kind === 'miss') { // a cylinder that didn't fire: a dull chuff in the exhaust
      burst(0.08, 'lowpass', 420, 1.2, 0.22 * amt, 0.07);
    } else if (kind === 'rattle') { // a slack timing chain slapping its guides
      for (let n = 0; n < 5; n++) hit(t + n * 0.025, 0.02, 'bandpass', 2600 + Math.random() * 900, 7, 0.06 * clamp(amt, 0.2, 1), 0.015);
    } else if (kind === 'tock') { // rod knock: a hollow metallic tock with a dull thud under it
      burst(0.03, 'bandpass', 1050 + Math.random() * 250, 4, 0.16 * amt, 0.028);
      burst(0.04, 'lowpass', 320, 1, 0.12 * amt, 0.035);
    } else if (kind === 'boom') { // the engine letting go: the blast, a crack, shrapnel rattling out, grinding, then oil on the exhaust
      burst(1.4, 'lowpass', 150, 0.8, 1, 1.3);
      burst(0.25, 'bandpass', 2600, 1.2, 0.55, 0.22);
      tone(t, 'sine', 95, 28, 0.8, 0.8);
      for (let n = 0; n < 28; n++) {
        const at = t + 0.04 + Math.pow(Math.random(), 1.6) * 1.9;
        hit(at, 0.06, 'bandpass', 1400 + Math.random() * 4800, 8 + Math.random() * 12, (0.1 + Math.random() * 0.18) * (1 - (at - t) / 2.2), 0.03 + Math.random() * 0.06);
      }
      const grind = hit(t + 0.15, 1.8, 'bandpass', 1200, 3, 0.18, 1.7);
      grind.frequency.setValueAtTime(1500, t + 0.15); grind.frequency.exponentialRampToValueAtTime(350, t + 1.9); // spinning down
      hit(t + 0.4, 3.6, 'highpass', 2600, 0.7, 0.07, 3.4);
    } else if (kind === 'clicks') { // a flat battery: the starter solenoid chattering
      for (let n = 0; n < 7; n++) hit(t + n * 0.06, 0.012, 'bandpass', 2400 + Math.random() * 400, 5, 0.14, 0.012);
    } else if (kind === 'crank') { // the starter strains against a seized engine and gives up with a clunk
      const g = tone(t, 'sawtooth', 150, 120, 0.12, 0.55);
      g.gain.setValueAtTime(0.12 * vol, t + 0.1); g.gain.linearRampToValueAtTime(0.05 * vol, t + 0.3); g.gain.linearRampToValueAtTime(0.1 * vol, t + 0.45);
      hit(t + 0.55, 0.15, 'lowpass', 240, 1, 0.5, 0.13);
      hit(t + 0.56, 0.05, 'bandpass', 1800, 6, 0.12, 0.04);
    }
  }
  // the crank happens with the engine off - maybe before the car ever made its audio graph
  function audioReady() {
    if (actx) return true;
    try {
      ownCtx = new (window.AudioContext || window.webkitAudioContext)();
      attachAudio(ownCtx, ownCtx.destination);
      return true;
    } catch (e) { return false; }
  }

  // ================= the blow-up, on the cluster: flash, shake, smoke, and a failure badge until it's rebuilt =================
  const effects = (() => {
    let cv = null, g = null, badge = null, raf = 0, parts = [], emitUntil = 0, fireUntil = 0, trickle = false, last = 0;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const CSS2 = `
      .ct-smoke{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;border-radius:inherit;}
      .ct-blown{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:7;display:none;flex-direction:column;align-items:center;
        gap:5px;padding:14px 22px;border-radius:12px;background:rgba(12,5,4,.86);border:1px solid #ff5a3c;
        box-shadow:0 0 44px -6px rgba(255,90,60,.65);font-family:"Segoe UI",system-ui,Arial,sans-serif;text-align:center;
        width:max-content;max-width:min(440px,80%);pointer-events:none;}
      .ct-blown.on{display:flex;}
      .ct-blown b{font-size:1.05rem;letter-spacing:.24em;color:#ff5a3c;}
      .ct-blown span{font-size:.74rem;color:#f4f6f8;}
      .ct-blown small{font-size:.62rem;color:#c9a59c;line-height:1.4;}
      .ct-blown.nudge{animation:ctNudge .5s;}
      @keyframes ctNudge{20%{transform:translate(calc(-50% - 9px),-50%)}40%{transform:translate(calc(-50% + 9px),-50%)}60%{transform:translate(calc(-50% - 5px),-50%)}80%{transform:translate(calc(-50% + 4px),-50%)}}
      .ct-flash{position:fixed;inset:0;pointer-events:none;z-index:2147483600;
        background:radial-gradient(circle at 50% 42%,rgba(255,244,214,.95),rgba(255,130,50,.6) 32%,rgba(255,60,20,0) 72%);animation:ctFlash .8s ease-out forwards;}
      @keyframes ctFlash{from{opacity:1}to{opacity:0}}`;
    function ensure() {
      const cl = document.querySelector('.cluster');
      if (!cl) return false;
      if (cv && cv.isConnected) return true;
      const st = document.createElement('style');
      st.textContent = CSS2;
      document.head.appendChild(st);
      cv = document.createElement('canvas');
      cv.className = 'ct-smoke';
      cv.setAttribute('aria-hidden', 'true');
      badge = document.createElement('div');
      badge.className = 'ct-blown';
      badge.setAttribute('role', 'alert');
      badge.innerHTML = '<b>ENGINE FAILURE</b><span></span><small></small>';
      cl.append(cv, badge);
      g = cv.getContext('2d');
      return true;
    }
    const REPAIR = 'Rebuild it in Servicing: repair the Engine or service the Pistons.';
    function show(what, note) {
      badge.querySelector('span').textContent = what;
      badge.querySelector('small').textContent = note;
      badge.classList.add('on');
    }
    // smoke: soft puffs rising off the bottom of the cluster - blue-grey burnt oil from a petrol, black from a diesel
    function spawn(n, heavy) {
      const w = cv.width, h = cv.height, d = devicePixelRatio || 1;
      for (let k = 0; k < n; k++) {
        parts.push({ x: w * (0.3 + Math.random() * 0.4), y: h * (0.9 + Math.random() * 0.08), vx: (Math.random() - 0.5) * 40 * d,
          vy: -(45 + Math.random() * 70) * d * (heavy ? 1.5 : 1), r: (10 + Math.random() * 16) * d, grow: (16 + Math.random() * 22) * d,
          t: 0, life: 2.5 + Math.random() * 3, a: heavy ? 0.5 + Math.random() * 0.2 : 0.18 + Math.random() * 0.12 });
      }
    }
    function frame(now) {
      raf = 0;
      if (!cv || !cv.isConnected) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      const d = devicePixelRatio || 1, W = Math.round(cv.clientWidth * d), H = Math.round(cv.clientHeight * d);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      if (now < emitUntil) spawn(Math.ceil(70 * dt + Math.random()), true);
      else if (trickle && Math.random() < 6 * dt) spawn(1, false);
      g.clearRect(0, 0, W, H);
      if (now < fireUntil) { // a flicker of fire under the bonnet for the first moments
        const k = (fireUntil - now) / 1800, fl = 0.6 + Math.random() * 0.4;
        const gr = g.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.55);
        gr.addColorStop(0, `rgba(255,150,50,${0.55 * k * fl})`); gr.addColorStop(0.5, `rgba(255,70,20,${0.25 * k * fl})`); gr.addColorStop(1, 'rgba(255,40,10,0)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      const rgb = E && E.fuel === 'diesel' ? '78,76,74' : '128,134,146'; // diesel soot as charcoal - true black vanishes on the cluster
      parts = parts.filter((p) => (p.t += dt) < p.life);
      parts.forEach((p) => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; p.r += p.grow * dt;
        const a = p.a * Math.sin(Math.PI * Math.min(1, p.t / p.life)) ** 0.7;
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
      });
      if (parts.length || trickle || now < emitUntil) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, W, H);
    }
    const run = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    return {
      explode(what) {
        if (!ensure()) return;
        show(what, 'The engine has seized. ' + REPAIR);
        const now = performance.now();
        emitUntil = now + 4500; fireUntil = now + 1800; trickle = true;
        const flash = document.createElement('div');
        flash.className = 'ct-flash';
        if (reduced()) flash.style.opacity = '.35';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 900);
        if (!reduced()) {
          document.querySelector('.cluster').animate([{ translate: '0 0' }, { translate: '14px -8px' }, { translate: '-12px 7px' }, { translate: '9px 5px' },
            { translate: '-7px -4px' }, { translate: '4px 2px' }, { translate: '-2px 0' }, { translate: '0 0' }], { duration: 900, easing: 'ease-out' });
        }
        run();
      },
      seized() { if (!ensure()) return; show('Engine seized', REPAIR); trickle = true; run(); },
      seizedNudge() {
        if (!ensure()) return;
        show(badge.querySelector('span').textContent || 'Engine seized', 'It won\'t turn over. ' + REPAIR);
        badge.classList.remove('nudge'); void badge.offsetWidth; badge.classList.add('nudge');
      },
      clear() { trickle = false; emitUntil = 0; fireUntil = 0; if (badge) badge.classList.remove('on'); },
    };
  })();

  // ================= persistence + activity log =================
  const log = (type, summary) => { if (window.CarAPI && CarAPI.log) CarAPI.log(type, summary); };
  function saveData() {
    const wear = {};
    Object.entries(wearParts).forEach(([k, p]) => { wear[k] = +p.value.toFixed(3); });
    cyl.forEach((k, n) => { wear['cyl' + (n + 1)] = +k.damage.toFixed(3); });
    wear.blown = blown ? 100 : 0;
    // the garage's stats card: both maps' predicted peaks, the stock engine's and how many parts are upgraded
    const peak = (n) => ({ hp: Math.round(predicted(n).hp), tq: Math.round(predicted(n).tq) });
    const stats = { 1: peak(1), 2: peak(2), stock: { hp: Math.round(powerRef), tq: Math.round(Math.max(...cfg.torque.map((p) => p[1]))) },
      mods: P.filter((p) => tune.parts[p.k] !== p.opts[0].id).length };
    return { tune: { v: 1, slots: tune.slots, parts: tune.parts, wear, library: tune.library, stats } };
  }
  // edits are logged once they settle: "Map 1 (Custom): boost map, rev limit 7,600 rpm"
  let editTimer = null, edited = new Set(), editSlot = 1, editName = '';
  function noteEdit(what) {
    edited.add(what);
    editSlot = slot;
    editName = tune.slots[slot].name;
    clearTimeout(editTimer);
    editTimer = setTimeout(flushEdits, 1500);
  }
  // pending edits go into the history before anything else happens to the map (a save, a load, a switch)
  function flushEdits() {
    clearTimeout(editTimer);
    if (edited.size) log('tune', `Map ${editSlot} (${editName}): ${[...edited].join(', ')}`);
    edited = new Set();
  }

  // ================= settings handed to the car =================
  // the Servicing tab's tyres and dampers: worn tread, low pressure and tired dampers all cost traction
  const sharedWear = (k) => (window.CarService && (CarService.parts.find((p) => p.key === k) || {}).value) || 0;
  const tyreGrip = () => (1 - sharedWear('tyre') * 0.2 / 100) * (1 - sharedWear('pressure') * 0.12 / 100) * (1 - sharedWear('dampers') * 0.05 / 100);
  function apply() {
    invalidate();
    const c = cal();
    const fd = fx.fd || cfg.finalDrive;
    T = {
      rev: (limp ? Math.min(c.rev, E.fuel === 'petrol' ? 4500 : 3500) : c.rev) / 1000,
      shift: Math.min(c.shift, c.rev - 100) / 1000,
      launch: c.launch / 1000,
      vmax: c.vmax,
      finalDrive: fd,
      grip: fx.grip * tyreGrip(),
      shiftCut: [[0.22, 0.3], [0.15, 0.2], [0.08, 0.1]][c.shiftSpeed || 0],
      burble: E.fuel === 'petrol' ? [0, 1, 1.6, 2.4][c.burble ?? 1] : 1,
      sound: { ...fx.sound, exLp: 1 + (fx.sound.ex - 1) * 0.6 }, // layer volumes for the louder hardware
      powerRatio: predicted(slot).hp / powerRef, // tuned peak power over stock - how much more heat the cooling has to shed
      gears: [...c.gears],
      hw: fx, // the fitted parts' merged effects - a hybrid reads its motor, inverter and battery here
      shiftK: c.gears.map((_, g) => Math.min(c.gearShift[g] || c.shift, c.rev - 100) / 1000), // full-throttle upshift, per gear
    };
    api.T = T;
    if (cfg.onChange) cfg.onChange(T);
    schedule();
  }

  // ================= init =================
  api.init = (c) => {
    cfg = c;
    E = ENGINES[c.engine];
    if (!E) return;
    api.on = true;
    api.fuel = E.fuel;
    P = [...PARTS[E.fuel](), ...(E.parts || []).map((p) => ({ ...p, opts: p.opts.map((o) => opt(...o)) }))]; // plus the engine's own (a hybrid's eDrive)
    if (E.swap) P = P.map((p) => (E.swap[p.k] ? { ...p, label: E.swap[p.k].label || p.label, opts: E.swap[p.k].opts.map((o) => opt(...o)) } : p)); // its own wording of a part
    CURVE_DEF.boost.max = Math.max(2.8, Math.ceil(Math.max(...Object.values(E.turbos).flat()) * 2 + 0.6) / 2);
    Object.entries(E.curveMax || {}).forEach(([k, v]) => { CURVE_DEF[k].max = Math.max(CURVE_DEF[k].max, v); });
    stockCal = stockFor(c);
    // the editor's scales reach past every preset this engine carries (a big-turbo diesel runs ~210% fuel at 2,700 bar) -
    // never past 3,000, the most a saved map value may be
    presetsOf().forEach((p) => CURVES().forEach((k) => {
      const d = CURVE_DEF[k], top = Math.max(...presetCal(p.id)[k]) * 1.1;
      if (top > d.max) d.max = Math.min(3000, Math.ceil(top / d.step) * d.step);
    }));
    const saved = S.tune && S.tune.v === 1 ? S.tune : null;
    tune = { slots: {}, parts: { ...(saved && saved.parts) }, library: [] };
    P.forEach((p) => { if (!p.opts.some((o) => o.id === tune.parts[p.k])) tune.parts[p.k] = p.opts[0].id; });
    // a setup saved before a part existed: a car built for big boost or fuel gets the matching upgrade, the rest stock
    if (saved) P.forEach((p) => { if (p.carry && !(saved.parts && p.k in saved.parts)) tune.parts[p.k] = p.carry(saved) || p.opts[0].id; });
    mergeFx();
    if (E.afr) fuelRef = Math.max(...E.axis.map((r, n) => (1 + Math.max(0, E.boost[n])) * r / E.afr[n]));
    powerRef = Math.max(...E.axis.map((r) => PS(tableAt(c.torque, r), r)));
    const kw = powerRef * 0.7355;
    Object.assign(TH, E.fuel === 'petrol' ? { eta: 0.33, share: 0.3 } : { eta: 0.38, share: 0.27 });
    TH.ua = kw / TH.eta * TH.share / (60 * 1.6); // stock power flat out at speed: ~60 °C over ambient, fully open
    TH.c = 35 * TH.ua * 1.6;                     // ~35 s to settle once hot
    TH.idle = 4 + 0.035 * kw;                    // kW into the coolant at idle
    TH.uaOil = (kw / TH.eta * 0.025 + E.maxRpm / 1000 * 1.2) / 25; // stock: oil ~25 °C over the coolant flat out
    const first = c.slots || ['stock', 'stage1'];
    // a car's first tune: the preset standing in for the old map it was on comes with the hardware it needs
    if (!saved) Object.entries((presetsOf().find((x) => x.id === first[(c.slot || (S.engineMap === 2 ? 2 : 1)) - 1]) || {}).needs || {})
      .forEach(([k, ok]) => { if (!ok.includes(part(k))) tune.parts[k] = ok[0]; });
    mergeFx();
    [1, 2].forEach((n) => {
      const s = saved && saved.slots && saved.slots[n];
      tune.slots[n] = validCal(s) ? { ...stockCal, ...s } : presetCal(first[n - 1]);
      // a gearbox map for a different number of gears (or none yet) starts from the factory one
      fitGearbox(tune.slots[n]);
    });
    // the owner's saved setups (a map that no longer fits this engine's axis is dropped)
    tune.library = ((saved && saved.library) || []).filter((m) => m && m.name && validCal(m.cal))
      .map((m) => ({ ...m, cal: fitGearbox({ ...stockCal, ...m.cal }) })).slice(0, MAX_MAPS);
    libByName();
    const w = (saved && saved.wear) || {};
    for (let n = 0; n < E.cyl; n++) {
      const d = w['cyl' + (n + 1)] || 0;
      cyl.push({ retard: 0, damage: d, dead: d >= 100, knocks: 0, misfires: 0, balance: (Math.random() - 0.5) * 0.6 });
    }
    weakCyl = Math.floor(Math.random() * E.cyl);
    blown = (w.blown || 0) >= 100;
    // a seized engine: the start button gets a starter clunk instead; a flat 12V battery (the Servicing tab's) only
    // clicks the solenoid (switching off still goes through)
    document.addEventListener('click', (e) => {
      const flat = sharedWear('battery') >= 100;
      if (!(blown || flat) || !e.target.closest || !e.target.closest('#power-btn') || (window.CarService && CarService.ignitionOn())) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (blown) crank();
      else if (audioReady()) { if (actx.state === 'suspended') actx.resume(); sound('clicks'); CarService.announce('Battery flat', 'The starter only clicks - replace the 12V battery in Servicing.', '#ff9d2e'); }
    }, true);
    // the car's own engine repair rebuilds it
    const repair = document.getElementById('repair-btn');
    if (repair) repair.addEventListener('click', () => rebuild(blown ? 'Blown engine rebuilt (repair)' : null));
    if (blown) effects.seized();
    // wearable parts join the Servicing tab and Diagnostics
    if (window.CarService && CarService.addPart) {
      WEAR[E.fuel].forEach((d) => {
        // a turbo build's plumbing on an NA engine: not there until the kit (or its intercoolers) is
        const kit = E.na && ['turbo', 'chargepipe', 'diverter', 'intercooler'].includes(d.key);
        const unfitted = () => kit && (part('turbo') === 'stock' || (d.key === 'intercooler' && part('intercooler') === 'stock'));
        const removed = () => unfitted() || (d.key === 'cat' && fx.catless) || (d.key === 'dpf' && !fx.dpf) || (d.key === 'egr' && fx.egrBlank) || (d.key === 'swirl' && fx.swirlBlank);
        const gone = () => (unfitted() ? 'Not fitted' : 'Removed');
        const p = CarService.addPart({
          key: 'tune-' + d.key, code: d.code, module: d.module || 'ECM', label: d.label, group: d.group, title: d.title, msg: d.msg,
          value: clamp(w[d.key] || 0, 0, 100),
          // Servicing shows wear, Diagnostics health (like the other parts); a removed part says so in both
          read: d.removable || kit ? (v) => (removed() ? gone() : d.soot ? Math.round(v) + '% soot' : Math.round(v) + '%') : null,
          diag: d.removable || kit ? (v) => (removed() ? gone() : d.soot ? Math.round(v) + '% soot' : Math.round(100 - v) + '%') : null,
          rate: () => { const v = removed() ? 0 : pending[d.key] || 0; pending[d.key] = 0; return v; },
          onService: d.key === 'pistons' ? () => rebuild('Blown engine rebuilt: new pistons, rods and bearings') :
            d.key === 'turbo' ? () => { if (limp === 'P0299') { limp = null; apply(); } } : null,
        });
        wearParts[d.key] = p;
      });
    }
    // codes this module raises are re-judged live, not carried over as active from the last session
    if (window.CarService) Object.keys(FAULTS).forEach((code) => {
      const own = WEAR[E.fuel].some((d) => d.code === code);
      if (!own) CarService.fault(code, { title: FAULTS[code].title }, 'clear');
    });
    slot = c.slot || (S.engineMap === 2 ? 2 : 1);
    undoBase = snap();
    apply();
  };
  api.setSlot = (n) => {
    if (!tune || (n !== 1 && n !== 2)) return;
    if (n !== slot) flushEdits();
    const was = slot;
    slot = n;
    // the slot holds one of my maps: its parts go back on (not an undo step - the switch itself isn't one)
    const m = was !== n && openMap(), fitted = m ? fitMapParts(m, false) : [];
    if (fitted.length) { if (wasOn) ignitionOn({ coolant: 90 }); undoBase = snap(); }
    apply();
    if (was !== n && booted) log('tune', `Switched to Map ${n} (${cal().name} · ${fmt(predicted(n).hp)} hp)` + (fitted.length ? ` - fitted ${fitted.join(', ')}` : ''));
    render(true);
  };
  api.boostAt = (rpmK) => boostTarget(cal(), rpmK * 1000);
  api.tick = (i) => { const r = tick(i); sample(i.dt); return r; }; // the datalog samples ride on the car's tick
  api.label = (n) => { const p = predicted(n || slot); return `${tune.slots[n || slot].name} · ${fmt(p.hp)} hp · ${fmt(p.tq)} Nm`; };
  api.saveData = saveData;
  api.attachAudio = attachAudio;
  api.ch = ch;
  api.model = (n, rpm) => model(tune.slots[n], rpm);
  api.predict = (n) => predicted(n || slot);
  api.presets = () => presetsOf().map((p) => ({ id: p.id, name: p.name, cal: presetCal(p.id) }));
  api.loadPreset = (n, id) => loadPreset(n, id);
  api.setPart = (k, id) => setPart(k, id);
  api.cylinders = () => cyl;
  api.warnLight = () => !!limp || blown || cyl.some((k) => k.dead) || misfireDip > 0; // the car's engine light
  api.blown = () => blown;
  api.tstat = () => E.tstat + fx.tstat;
  api.part = (k) => part(k); // the fitted option of a part, for a car whose own sound follows it
  api.mods = () => P.filter((p) => p.k !== 'fuel' && part(p.k) !== p.opts[0].id).map((p) => `${p.label}: ${p.opts.find((o) => o.id === part(p.k)).label}`).join(' · ') || 'Factory hardware'; // the fitted thermostat's rating: the car's operating temp

  // predictions are cached per slot and refreshed when anything changes
  const cache = {};
  function predicted(n) { return cache[n] || (cache[n] = predict(tune.slots[n])); }
  const invalidate = () => { delete cache[1]; delete cache[2]; };
  let booted = false, raf = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render());
  }

  function loadPreset(n, id) {
    flushEdits();
    tune.slots[n] = presetCal(id);
    fromLib[n] = null;
    invalidate();
    log('tune', `Map ${n}: loaded ${tune.slots[n].name} (${fmt(predicted(n).hp)} hp · ${fmt(predicted(n).tq)} Nm)`);
    if (n === slot) apply(); else schedule();
    record(`Map ${n}: loaded ${tune.slots[n].name}`);
  }
  function setPart(k, id) {
    const p = P.find((x) => x.k === k), o = p && p.opts.find((x) => x.id === id);
    if (!o || tune.parts[k] === id) return;
    const was = p.opts.find((x) => x.id === part(k));
    fitPart(k, id);
    mergeFx();
    log('parts', k === 'fuel' ? `Filled up with ${o.label}` : `${p.label}: ${was ? was.label : '?'} → ${o.label}`);
    if (wasOn) ignitionOn({ coolant: 90 });
    apply();
    keepParts();
    record(`${p.label}: ${was ? was.label : '?'} → ${o.label}`);
  }
  // a different part goes on: a new turbo, pump, injectors, clutch packs or engine start fresh
  function fitPart(k, id) {
    tune.parts[k] = id;
    const fresh = { turbo: 'turbo', hpfp: 'hpfp', pump: 'pump', injectors: 'injectors', trans: 'trans', chain: 'chain', springs: 'springs',
      oilpump: 'oilpump', radiator: 'radiator', waterpump: 'waterpump', thermostat: 'thermostat', intercooler: 'intercooler', gasket: 'gasket',
      chargepipe: 'chargepipe', lpfp: 'lpfp', hoses: 'hoses', fan: 'fan', coils: 'coils', diverter: 'diverter', glow: 'glow', vgt: 'vgt', swirl: 'swirl' }[k];
    if (fresh && wearParts[fresh]) { if (!(fresh in swapWear)) swapWear[fresh] = wearParts[fresh].value; wearParts[fresh].value = 0; }
    if (k === 'internals') { if (wearParts.pistons && !('pistons' in swapWear)) swapWear.pistons = wearParts.pistons.value; rebuild(null); } // a built engine goes in as a fresh short block
  }

  // ---- My maps: whole setups the owner names and saves - the parts, the calibration (maps, limiters, gearbox, ECU
  // functions) - to load back into Map 1 or 2 later. Saved with the car like everything else ----
  const MAX_MAPS = 20;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const bare = (name) => String(name).replace(/ \*$/, '').trim().slice(0, 40);
  // which of my maps each slot holds (its name, or null for a preset / Custom): loading or saving one sets it, a preset
  // clears it. The map's parts go with it - a part changed while it's open is saved into it, and switching to its slot
  // puts them back on. Not saved: a reloaded page goes by the slots' names
  const fromLib = { 1: null, 2: null };
  const libByName = () => [1, 2].forEach((n) => { const nm = bare(tune.slots[n].name); fromLib[n] = tune.library.some((m) => m.name === nm) ? nm : null; });
  const openMap = () => tune.library.find((m) => m.name === fromLib[slot]);
  // a new name only - an existing map is overwritten only by its own Update (at), once it's loaded
  function saveMap(name, at) {
    name = bare(name);
    if (!name || (at == null && tune.library.some((m) => m.name === name))) return;
    flushEdits();
    const p = predicted(slot);
    const entry = { name, at: new Date().toISOString(), hp: Math.round(p.hp), tq: Math.round(p.tq), parts: { ...tune.parts }, cal: { ...copy(cal()), name } };
    const i = at ?? -1;
    if (i >= 0) tune.library[i] = entry;
    else if (tune.library.length < MAX_MAPS) tune.library.push(entry);
    else return;
    cal().name = name; // the slot is that map now
    fromLib[slot] = name;
    log('tune', `${i >= 0 ? 'Updated' : 'Saved'} my map "${name}" (${entry.hp} hp · ${entry.tq} Nm)`);
    apply();
    record(`${i >= 0 ? 'updated' : 'saved'} my map "${name}"`);
  }
  // fit a saved map's parts - every one: what it lists, and for a part it predates (or an option that's gone) what a
  // setup like it would have had, else stock. The fuel in the tank stays unless it names one. fresh: new parts start
  // unworn (loading it is a trip to the garage); a map switch puts them back on as worn as they were
  function fitMapParts(m, fresh) {
    const fitted = [];
    const listed = (p) => (p.opts.some((o) => o.id === m.parts[p.k]) ? m.parts[p.k] : null);
    const put = (p, id) => {
      if (id === part(p.k)) return;
      if (fresh) fitPart(p.k, id); else tune.parts[p.k] = id;
      fitted.push(p.label.toLowerCase());
    };
    P.forEach((p) => { if (listed(p)) put(p, listed(p)); });
    P.forEach((p) => { if (!listed(p) && p.k !== 'fuel') put(p, (p.carry && p.carry({ slots: { 1: m.cal } })) || p.opts[0].id); }); // after the turbo is on
    mergeFx();
    return fitted;
  }
  function loadMap(i) {
    const m = tune.library[i];
    if (!m) return;
    flushEdits();
    const changedParts = fitMapParts(m, true);
    tune.slots[slot] = fitGearbox({ ...stockCal, ...copy(m.cal), name: m.name });
    fromLib[slot] = m.name;
    if (wasOn) ignitionOn({ coolant: 90 });
    apply();
    log('tune', `Map ${slot}: loaded my map "${m.name}" (${fmt(predicted(slot).hp)} hp)` + (changedParts.length ? ` - fitted ${changedParts.join(', ')}` : ''));
    record(`Map ${slot}: loaded my map "${m.name}"`);
  }
  // a part changed with one of my maps open goes into it straight away (its calibration still waits for Update)
  function keepParts() {
    const m = openMap();
    if (!m) return;
    const p = predict(fitGearbox({ ...stockCal, ...copy(m.cal) }));
    Object.assign(m, { parts: { ...tune.parts }, hp: Math.round(p.hp), tq: Math.round(p.tq), at: new Date().toISOString() });
  }
  function deleteMap(i) {
    const m = tune.library.splice(i, 1)[0];
    if (!m) return;
    [1, 2].forEach((n) => { if (fromLib[n] === m.name) fromLib[n] = null; });
    log('tune', `Deleted my map "${m.name}"`); render(true); record(`deleted my map "${m.name}"`);
  }

  // ---- undo / redo (Cmd+Z, Cmd+Shift+Z on the Tuning tab): each step holds the whole setup before and after it -
  // both maps, the parts, my maps. Fuel is left out: a fill-up isn't a tuning change and must never be undone ----
  const snap = () => JSON.stringify({ slots: tune.slots, parts: { ...tune.parts, fuel: undefined }, library: tune.library });
  let undoBase = null, swapWear = {};
  const undos = [], redos = [];
  function record(what) {
    const now = snap();
    if (now === undoBase) return;
    undos.push({ what, before: undoBase, after: now, wear: swapWear }); // wear: what the parts that came off had on them
    if (undos.length > 100) undos.shift();
    redos.length = 0;
    undoBase = now;
    swapWear = {};
  }
  function undo(back) {
    const e = (back ? undos : redos).pop();
    if (!e) return;
    flushEdits();
    const s = JSON.parse(back ? e.before : e.after);
    const off = {}; // the parts coming off keep their wear for the step back
    Object.keys(e.wear).forEach((k) => { off[k] = wearParts[k].value; });
    tune.slots = s.slots;
    tune.library = s.library;
    libByName();
    const refit = Object.keys(s.parts).filter((k) => tune.parts[k] !== s.parts[k]);
    refit.forEach((k) => fitPart(k, s.parts[k]));
    Object.entries(e.wear).forEach(([k, v]) => { wearParts[k].value = v; });
    e.wear = off;
    swapWear = {};
    if (refit.length) { mergeFx(); if (wasOn) ignitionOn({ coolant: 90 }); }
    undoBase = snap();
    (back ? redos : undos).push(e);
    log('tune', `${back ? 'Undo' : 'Redo'}: ${e.what}`);
    apply();
    render(true);
  }

  // ======================================================================================================
  // ================= UI: the Tuning tab =================
  // ======================================================================================================
  let root = null, view = 'ecu', mapKey = null, built = false;
  const CSS = `
    .ct{--ok:#33d17a;--warn:#ffb020;--bad:#ff5a3c;--info:#4fa8ff;--dim:#7d838b;--line:#1f2125;--card:#0a0b0d;
      font:.72rem/1.4 "Segoe UI",system-ui,Arial,sans-serif;color:#c7cbd0;}
    .ct-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:12px;}
    .ct-head .cs-section-title{margin:0;}
    .ct-eng{font:.62rem/1.3 "Courier New",monospace;color:var(--dim);letter-spacing:.04em;}
    .ct-slots{display:inline-flex;border:1px solid #2a2d33;border-radius:999px;overflow:hidden;}
    .ct-slots button{font:700 .58rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:8px 12px;
      background:#121418;color:#8a8f96;border:0;cursor:pointer;}
    .ct-slots button[aria-pressed=true]{background:rgba(232,64,42,.16);color:#fff;}
    .ct-peak{margin-left:auto;display:flex;gap:14px;align-items:baseline;font:700 .95rem/1 "Courier New",monospace;color:#f4f6f8;}
    .ct-peak small{font:.55rem/1 "Segoe UI",sans-serif;color:var(--dim);letter-spacing:.12em;text-transform:uppercase;margin-left:4px;}
    .ct-peak .hp{color:#ff5a3c;} .ct-peak .tq{color:#4fa8ff;}
    .ct-nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px;}
    .ct-nav button{font:700 .6rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:8px 12px;border-radius:8px;
      border:1px solid transparent;background:none;color:#8a8f96;cursor:pointer;}
    .ct-nav button:hover{color:#fff;}
    .ct-nav button[aria-selected=true]{color:#fff;background:#16181c;border-color:#2a2d33;}
    .ct-nav .ct-badge{display:inline-block;min-width:14px;padding:1px 4px;margin-left:6px;border-radius:7px;background:var(--bad);color:#fff;font-size:.52rem;letter-spacing:0;}
    .ct-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;}
    .cs-narrow .ct-grid{grid-template-columns:1fr;}
    .ct-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0;}
    .ct-label{font:700 .55rem/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:8px;
      display:flex;align-items:center;gap:8px;justify-content:space-between;}
    .ct-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
    .ct-preset{flex:1 1 140px;text-align:left;padding:9px 11px;border-radius:9px;border:1px solid #2a2d33;background:#101215;color:#c7cbd0;cursor:pointer;
      font:inherit;transition:border-color .15s,background .15s;}
    .ct-preset:hover{border-color:#4a4f57;}
    .ct-preset b{display:block;font-size:.72rem;color:#f4f6f8;}
    .ct-preset span{display:block;font-size:.6rem;color:var(--dim);margin-top:2px;}
    .ct-preset i{font-style:normal;font-size:.56rem;}
    .ct-preset[aria-current=true]{border-color:#e8402a;background:rgba(232,64,42,.08);}
    .ct-maptabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}
    .ct-maptabs button{font:700 .56rem/1 "Segoe UI",sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:6px 9px;border-radius:6px;
      border:1px solid #2a2d33;background:#121418;color:#8a8f96;cursor:pointer;}
    .ct-maptabs button[aria-selected=true]{color:#fff;border-color:#e8402a;}
    .ct-editor{display:block;width:100%;height:auto;touch-action:none;user-select:none;}
    .ct-editor .pt{cursor:ns-resize;outline:none;}
    .ct-editor .pt:focus circle.dot{stroke:#fff;stroke-width:2;}
    .ct-cells{display:grid;gap:3px;margin-top:6px;overflow-x:auto;}
    .ct-cells label{display:flex;flex-direction:column;align-items:center;gap:2px;font:.52rem/1 "Courier New",monospace;color:var(--dim);}
    .ct-cells input{width:100%;min-width:38px;box-sizing:border-box;background:#121418;border:1px solid #23262b;border-radius:5px;color:#f4f6f8;
      font:.62rem/1 "Courier New",monospace;padding:5px 2px;text-align:center;-moz-appearance:textfield;}
    .ct-cells input::-webkit-inner-spin-button{display:none;}
    .ct-cells input:focus{outline:none;border-color:#e8402a;}
    .ct-cells input.ct-chg{color:#ffb020;}
    .ct-tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;}
    .ct-btn{font:700 .56rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;border-radius:7px;
      border:1px solid #2a2d33;background:#16181c;color:#c9ccd1;cursor:pointer;}
    .ct-btn:hover:not(:disabled){color:#fff;border-color:#4a4f57;}
    .ct-btn:disabled{opacity:.4;cursor:default;}
    .ct-btn.ct-rec{border-color:#5a1e14;color:#ff8a70;}
    .ct-btn.ct-rec[aria-pressed=true]{background:rgba(255,90,60,.15);color:#fff;}
    .ct-hint{font-size:.6rem;color:var(--dim);margin-top:6px;line-height:1.45;}
    .ct-warn{display:flex;flex-direction:column;gap:6px;margin-top:10px;}
    .ct-w{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;font-size:.64rem;line-height:1.4;padding:7px 9px;border-radius:7px;
      background:#0f1012;border:1px solid #1c1f24;}
    .ct-w i{font-style:normal;font:700 .5rem/1 "Segoe UI",sans-serif;letter-spacing:.1em;padding:3px 5px;border-radius:4px;border:1px solid currentColor;margin-top:1px;}
    .ct-w[data-s=crit]{border-color:#5a1e14;} .ct-w[data-s=crit] i{color:var(--bad);}
    .ct-w[data-s=high] i{color:#ff7a45;} .ct-w[data-s=med] i{color:var(--warn);} .ct-w[data-s=info] i{color:var(--info);}
    .ct-ok{color:var(--ok);font-size:.64rem;}
    .ct-set{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px 18px;margin-top:12px;}
    .ct-row{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;}
    .ct-row > span{font-size:.62rem;color:#aab0b8;}
    .ct-row > b{font:700 .66rem/1 "Courier New",monospace;color:#f4f6f8;text-align:right;}
    .ct-row input[type=range]{grid-column:1/-1;width:100%;accent-color:#e8402a;margin:0;}
    .ct-seg{grid-column:1/-1;display:flex;border:1px solid #2a2d33;border-radius:7px;overflow:hidden;}
    .ct-seg button{flex:1;font:700 .55rem/1 "Segoe UI",sans-serif;letter-spacing:.06em;padding:7px 4px;background:#121418;color:#8a8f96;border:0;
      border-right:1px solid #2a2d33;cursor:pointer;}
    .ct-seg button:last-child{border-right:0;}
    .ct-seg button[aria-pressed=true]{background:rgba(232,64,42,.16);color:#fff;}
    .ct-parts{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}
    .ct [hidden]{display:none !important;}
    .ct-search{display:flex;align-items:center;gap:10px;}
    .ct-search input{flex:1;min-width:0;box-sizing:border-box;background:#121418;border:1px solid #2a2d33;border-radius:7px;color:#f4f6f8;padding:7px 10px;font:inherit;font-size:.68rem;}
    .ct-search input:focus{outline:none;border-color:#e8402a;}
    .ct-search span{font:.58rem/1 "Courier New",monospace;color:var(--dim);white-space:nowrap;}
    .ct-part h4{margin:0 0 6px;font-size:.72rem;color:#f4f6f8;display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
    .ct-part h4 small{font:.52rem/1 "Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
    .ct-part p{margin:6px 0 0;font-size:.62rem;color:#9aa0a8;line-height:1.45;min-height:2.9em;}
    .ct-cond{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;margin-top:8px;font-size:.58rem;color:var(--dim);}
    .ct-cond span:nth-child(2){height:4px;border-radius:2px;background:#1f2125;overflow:hidden;}
    .ct-cond i{display:block;height:100%;border-radius:2px;}
    .ct-cond b{font:700 .6rem/1 "Courier New",monospace;color:#f4f6f8;}
    .ct-log{display:block;width:100%;height:auto;}
    .ct-log text{font-family:"Courier New",monospace;}
    .ct-cyls{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:8px;}
    .ct-cyl{background:#0f1012;border:1px solid #1c1f24;border-radius:8px;padding:8px;text-align:center;}
    .ct-cyl b{display:block;font:700 .62rem/1 "Segoe UI",sans-serif;letter-spacing:.1em;color:#aab0b8;margin-bottom:6px;}
    .ct-cyl .bar{height:46px;width:12px;margin:0 auto 6px;background:#1a1c20;border-radius:3px;position:relative;overflow:hidden;}
    .ct-cyl .bar i{position:absolute;left:0;right:0;bottom:0;background:#c48cff;}
    .ct-cyl small{display:block;font:.56rem/1.4 "Courier New",monospace;color:var(--dim);}
    .ct-cyl[data-dead=true]{border-color:#5a1e14;} .ct-cyl[data-dead=true] b{color:var(--bad);}
    .ct-logs{display:flex;flex-direction:column;gap:4px;margin-top:8px;max-height:150px;overflow:auto;}
    .ct-logs button{display:flex;justify-content:space-between;gap:8px;text-align:left;font:.62rem/1.3 "Courier New",monospace;color:#c7cbd0;
      background:#0f1012;border:1px solid #1c1f24;border-radius:6px;padding:6px 8px;cursor:pointer;}
    .ct-logs button[aria-current=true]{border-color:#e8402a;}
    .ct-guide{max-width:880px;font-size:.7rem;line-height:1.6;color:#b9bec5;}
    .ct-guide h3{font-size:.8rem;color:#f4f6f8;margin:18px 0 6px;}
    .ct-guide h3:first-child{margin-top:0;}
    .ct-guide p{margin:0 0 8px;}
    .ct-guide ol,.ct-guide ul{margin:0 0 8px;padding-left:20px;}
    .ct-guide li{margin-bottom:4px;}
    .ct-guide b{color:#e6e8eb;}
    .ct-guide table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:.64rem;}
    .ct-guide th{text-align:left;font:700 .52rem/1.2 "Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);
      padding:6px 8px;border-bottom:1px solid #2a2d33;}
    .ct-guide td{padding:6px 8px;border-bottom:1px solid #16181b;vertical-align:top;}
    .ct-guide code{font:.64rem "Courier New",monospace;color:#ffb020;}
    .ct-note{border-left:2px solid #ffb020;padding:6px 10px;background:#121008;margin:8px 0;font-size:.64rem;}
    .ct-gears{width:100%;border-collapse:collapse;font-size:.64rem;}
    .ct-gears th{font:700 .5rem/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);text-align:left;
      padding:5px 6px;border-bottom:1px solid #2a2d33;white-space:nowrap;}
    .ct-gears td{padding:4px 6px;border-bottom:1px solid #16181b;font:.64rem "Courier New",monospace;color:#c7cbd0;white-space:nowrap;}
    .ct-gears td:first-child{font-weight:700;color:#f4f6f8;}
    .ct-gears input{width:76px;box-sizing:border-box;background:#121418;border:1px solid #23262b;border-radius:5px;color:#f4f6f8;
      font:.64rem/1 "Courier New",monospace;padding:5px 6px;-moz-appearance:textfield;}
    .ct-gears input::-webkit-inner-spin-button{display:none;}
    .ct-gears input:focus{outline:none;border-color:#e8402a;}
    .ct-mymaps{margin-bottom:12px;}
    .ct-name{width:170px;box-sizing:border-box;background:#121418;border:1px solid #2a2d33;border-radius:7px;color:#f4f6f8;
      font:.66rem/1 "Segoe UI",system-ui,sans-serif;padding:7px 9px;}
    .ct-name:focus{outline:none;border-color:#e8402a;}
    .ct-maplist{display:flex;flex-direction:column;gap:6px;}
    .ct-mapitem{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 14px;padding:8px 10px;border-radius:8px;
      background:#0f1012;border:1px solid #1c1f24;}
    .ct-mapitem[aria-current=true]{border-color:#e8402a;}
    .ct-mapitem b{display:block;font-size:.72rem;color:#f4f6f8;}
    .ct-mapitem span{font-size:.6rem;color:#8a8f96;}
    .ct-limp{display:none;margin-bottom:10px;padding:8px 12px;border-radius:8px;border:1px solid #5a1e14;background:rgba(255,90,60,.08);color:#ff8a70;font-size:.66rem;}
    .led-multi-panel .lm-val[data-w=warn]{color:#ffb020;text-shadow:0 0 8px rgba(255,176,32,.5);}
    .led-multi-panel .lm-val[data-w=bad]{color:#ff5a3c;text-shadow:0 0 8px rgba(255,90,60,.6);animation:ctBlink 1s steps(1) infinite;}
    @keyframes ctBlink{50%{opacity:.35}}
    @media (prefers-reduced-motion:reduce){.led-multi-panel .lm-val[data-w=bad]{animation:none;}}
  `;

  function build() {
    if (!api.on || !window.CarService || !CarService.sections || !CarService.sections.tune) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = CarService.sections.tune;
    root.classList.add('ct');
    mapKey = E.na ? 'timing' : CURVES()[0]; // an NA engine's boost map is flat at zero until a kit goes on
    root.innerHTML = `
      <div class="ct-head">
        <div><div class="cs-section-title">Tuning</div><div class="ct-eng">${esc(E.name)} · ${esc(E.trans.name)}</div></div>
        <div class="ct-slots" role="group" aria-label="Calibration slot">
          <button data-slot="1" title="Edit and drive Map 1 (key 1)">Map 1</button><button data-slot="2" title="Edit and drive Map 2 (key 2)">Map 2</button>
        </div>
        <div class="ct-peak" aria-live="polite"><span class="hp" data-hp>--</span><span class="tq" data-tq>--</span></div>
      </div>
      <div class="ct-limp" data-limp></div>
      <div class="ct-nav" role="tablist">
        <button data-view="ecu">ECU maps</button><button data-view="gearbox">Gearbox</button><button data-view="parts">Parts</button>
        <button data-view="log">Datalog</button><button data-view="guide">Guide</button>
      </div>
      <div data-body></div>`;
    root.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => { if (cfg.setMap) cfg.setMap(+b.dataset.slot); else api.setSlot(+b.dataset.slot); b.blur(); }));
    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; b.blur(); render(true); }));
    // typing a value mustn't drive the car (1/2 switch maps, W throttles...)
    ['keydown', 'keyup'].forEach((t) => root.addEventListener(t, (e) => {
      if (e.target.matches('input, select, textarea, .pt')) e.stopPropagation();
    }));
    // Cmd/Ctrl+Z undoes, +Shift redoes - caught before the car sees the Z (xDrive mode); text fields keep their own undo
    window.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== 'KeyZ' || !root.getClientRects().length || e.target.matches('input:not([type=range]), textarea')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      undo(!e.shiftKey);
    }, true);
    built = true;
    booted = true;
    render(true);
    buildReadout();
    setInterval(() => { if (!root.hidden && view === 'log') drawLog(); }, 100);
    setInterval(() => { if (!root.hidden && view === 'parts') renderWear(); }, 1000);
  }

  // the car's digital readout gets the channels a tuner watches, under its own rows, at 10 Hz - flagged at the same
  // limits as the Diagnostics live data (amber: near the limit, blinking red: past it)
  function buildReadout() {
    const panel = document.querySelector('.led-multi-panel');
    if (!panel) return;
    const c = ch, deg = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°';
    const egtW = (hot, max) => (c.egt > max ? 'bad' : c.egt > hot ? 'warn' : '');
    const common = () => [
      ['TURBO', E.na && part('turbo') === 'stock' ? 'NA' : fmt(c.turbo) + 'k rpm', c.over > 0.3 ? 'bad' : c.over > 0.07 ? 'warn' : ''],
      ['IAT', Math.round(c.iat) + '°C', c.iat > 65 ? 'bad' : c.iat > 50 ? 'warn' : ''],
    ];
    const rows = E.fuel === 'petrol' ? () => [...common(),
      ['KNOCK', Math.round(c.knock) + ' %', c.knock >= 60 ? 'bad' : c.knock >= 30 ? 'warn' : ''],
      ['RETARD', (c.retard >= 0.05 ? '-' : '') + c.retard.toFixed(1) + '°', c.retard > 5 ? 'bad' : c.retard > 2.5 ? 'warn' : ''],
      ['TIMING', deg(c.timing), ''],
      ['AFR', c.afr == null ? '--' : `${c.afr.toFixed(1)}/${(c.afrT ?? c.afr).toFixed(1)}`,
        c.afr && c.afrT && c.afr - c.afrT > 0.6 ? 'bad' : c.afr && c.afrT && c.afr - c.afrT > 0.3 ? 'warn' : ''],
      ['EGT', fmt(c.egt) + '°C', egtW(900, 950)],
      ['RAIL', fmt(c.rail) + ' bar', c.rail < c.railT - 40 ? 'bad' : ''],
      ['INJ DC', Math.round(c.duty) + ' %', c.duty > 95 ? 'bad' : c.duty > 90 ? 'warn' : ''],
    ] : () => [...common(),
      ['KNOCK', Math.round(c.knock) + ' %', c.knock >= 45 ? 'warn' : ''], // combustion knock: advance and no pilot make it clatter
      ['PCP', fmt(c.pcp) + ' bar', c.pcp > pcpLimit() ? 'bad' : c.pcp > pcpLimit() - 15 ? 'warn' : ''],
      ['LAMBDA', c.lambda == null ? '--' : c.lambda.toFixed(2), c.lambda && c.lambda < 1.1 ? 'bad' : c.lambda && c.lambda < 1.18 ? 'warn' : ''],
      ['IQ', c.iq.toFixed(1) + ' mg', ''],
      ['SOI', deg(c.soi), ''],
      ['RAIL', fmt(c.rail) + ' bar', c.rail < c.railT - 60 ? 'bad' : ''],
      ['EGT', fmt(c.egt) + '°C', egtW(720, 800)],
      ['SMOKE', Math.round(c.smoke) + ' %', c.smoke > 40 ? 'warn' : ''],
      ['DPF', fx.dpf ? Math.round(wearOf('dpf')) + ' %' + (regen > 0 || forcedRegen > 0 ? ' RGN' : '') : 'OFF',
        fx.dpf && wearOf('dpf') > 80 ? 'bad' : fx.dpf && wearOf('dpf') > 60 ? 'warn' : ''],
      ['INJ DC', Math.round(c.duty) + ' %', c.duty > 95 ? 'bad' : c.duty > 90 ? 'warn' : ''],
    ];
    const vals = rows().map(([label]) => {
      panel.insertAdjacentHTML('beforeend', `<span class="lm-label">${label}</span><span class="lm-val"></span>`);
      return panel.lastElementChild;
    });
    const draw = () => rows().forEach(([, v, w], n) => { vals[n].textContent = v; vals[n].dataset.w = w; });
    draw();
    setInterval(draw, 100);
  }

  // full rebuild of the open view (on tab / slot / part changes); value edits only refresh the affected bits
  function render(full) {
    if (!built) return;
    const c = cal(), p = predicted(slot);
    root.querySelectorAll('[data-slot]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.slot === slot)));
    root.querySelectorAll('[data-view]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.view === view));
      if (b.dataset.view === 'ecu') b.innerHTML = 'ECU maps' + (p.warn.some((w) => w.sev === 'crit' || w.sev === 'high') ? `<span class="ct-badge">${p.warn.filter((w) => w.sev === 'crit' || w.sev === 'high').length}</span>` : '');
    });
    root.querySelector('[data-hp]').innerHTML = `${fmt(p.hp)}<small>hp</small>`;
    root.querySelector('[data-tq]').innerHTML = `${fmt(p.tq)}<small>Nm</small>`;
    const lb = root.querySelector('[data-limp]');
    lb.style.display = limp ? 'block' : 'none';
    lb.textContent = limp ? `Limp mode (${limp}): boost and revs are capped until the fault is fixed and the ignition is cycled.` : '';
    const body = root.querySelector('[data-body]');
    if (full || body.dataset.shown !== view) {
      body.dataset.shown = view;
      body.innerHTML = '';
      ({ ecu: buildEcu, gearbox: buildGearbox, parts: buildParts, log: buildLog, guide: buildGuide })[view](body);
    } else if (view === 'ecu') refreshEcu();
    else if (view === 'gearbox') refreshGearbox();
  }

  // ---- Gearbox view: a ratio, a full-throttle shift point and a torque limit for every gear, and the gearing chart ----
  const GEARSETS = [
    { id: 'stock', name: 'Stock ratios', make: () => [...cfg.gears] },
    { id: 'close', name: 'Close ratio', desc: 'Tighter steps: the revs stay high in the power band, lower top speed per gear.',
      make: () => cfg.gears.map((r) => +(Math.pow(r, 0.85) * 1.12).toFixed(3)) },
    { id: 'tall', name: 'Tall top gears', desc: 'Stock lower gears with taller top two: more top speed, calmer cruising.',
      make: () => cfg.gears.map((r, g, a) => (g === a.length - 2 ? +(r * 0.925).toFixed(3) : g === a.length - 1 ? +(r * 0.906).toFixed(3) : r)) },
  ];
  const kmhPerKrpm = (g) => 2 * Math.PI * cfg.wheelR * 60 / (cal().gears[g] * (fx.fd || cfg.finalDrive));
  const shiftAt = (g) => Math.min(cal().gearShift[g] || cal().shift, cal().rev - 100);
  function buildGearbox(body) {
    body.innerHTML = `
      <div class="ct-presets" data-gearsets></div>
      <div class="ct-grid">
        <div class="ct-card">
          <div class="ct-label"><span>Gear ratios, shift points &amp; torque limits · Map ${slot}</span></div>
          <div style="overflow-x:auto"><table class="ct-gears"><thead><tr><th>Gear</th><th>Ratio</th><th>Shift at (rpm)</th><th>Torque limit (Nm)</th>
            <th>Tops out</th><th>Drops to</th></tr></thead><tbody data-gearrows></tbody></table></div>
          <div class="ct-tools">
            <button class="ct-btn" data-gclear="gearShift" title="Every gear back to the global shift point">Reset shift points</button>
            <button class="ct-btn" data-gclear="gearTq" title="Remove every per-gear torque limit">Clear torque limits</button>
          </div>
          <div class="ct-hint">Blank shift point = the global one (${fmt(cal().shift)} rpm, ECU maps → Limiters). Blank torque limit = none. A low limit in 1st and 2nd tames wheelspin; one under the gearbox's ${fmt(fx.transCap)} Nm rating spares the clutch packs. Final drive (${(fx.fd || cfg.finalDrive).toFixed(2)}) is in Parts.</div>
        </div>
        <div class="ct-card">
          <div class="ct-label"><span>Gearing chart · full throttle</span><span style="text-transform:none;letter-spacing:0" data-gsub></span></div>
          <svg class="ct-editor" data-gearchart viewBox="0 0 440 250"></svg>
          <div class="ct-hint">Each line is a gear from where it picks up to its shift point; the drop is where the next gear lands. Keep the drops inside the shaded band, where the engine makes 90% of its peak torque.</div>
          <div class="ct-warn" data-gwarn></div>
        </div>
      </div>`;
    const sets = body.querySelector('[data-gearsets]');
    GEARSETS.forEach((gs) => {
      const b = document.createElement('button');
      b.className = 'ct-preset';
      b.innerHTML = `<b>${esc(gs.name)}</b><span>${esc(gs.desc || `The factory ${E.trans.name} ratios.`)}</span>`;
      b.addEventListener('click', () => { cal().gears = gs.make(); changed(`gear ratios: ${gs.name.toLowerCase()}`); b.blur(); });
      sets.appendChild(b);
    });
    body.querySelectorAll('[data-gclear]').forEach((b) => b.addEventListener('click', () => {
      cal()[b.dataset.gclear] = cal().gears.map(() => 0);
      changed(b.dataset.gclear === 'gearShift' ? 'shift points back to global' : 'per-gear torque limits cleared');
      b.blur();
    }));
    const rows = body.querySelector('[data-gearrows]');
    rows.innerHTML = cal().gears.map((_, g) => `<tr><td>${g + 1}</td>
      <td><input type="number" step="0.01" min="0.3" max="8" data-gk="gears" data-g="${g}" aria-label="Gear ${g + 1} ratio"></td>
      <td><input type="number" step="50" min="1000" max="12000" data-gk="gearShift" data-g="${g}" aria-label="Gear ${g + 1} shift point"></td>
      <td><input type="number" step="10" min="0" max="3000" data-gk="gearTq" data-g="${g}" aria-label="Gear ${g + 1} torque limit"></td>
      <td data-top="${g}"></td><td data-drop="${g}"></td></tr>`).join('');
    rows.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.gk, g = +inp.dataset.g, v = parseFloat(inp.value);
      const [lo, hi] = { gears: [0.3, 8], gearShift: [1000, maxRpm() + 600], gearTq: [0, 3000] }[k];
      // a blank (or zero) shift point / torque limit means "use the global one / none"; a blank ratio keeps the old one
      if (k === 'gears') cal()[k][g] = Number.isFinite(v) ? clamp(v, lo, hi) : cal()[k][g];
      else cal()[k][g] = Number.isFinite(v) && v > 0 ? clamp(v, lo, hi) : 0;
      changed(`gear ${g + 1} ${{ gears: 'ratio', gearShift: 'shift point', gearTq: 'torque limit' }[k]}`);
    }));
    refreshGearbox();
  }
  function refreshGearbox() {
    const body = root.querySelector('[data-body]');
    if (!body || !body.querySelector('[data-gearrows]')) return;
    const c = cal(), n = c.gears.length, p = predicted(slot);
    const peak = p.tq, band = p.pts.filter((x) => x.tq >= peak * 0.9).map((x) => x.rpm);
    const bandLo = Math.min(...band), bandHi = Math.max(...band);
    const warn = [];
    body.querySelectorAll('[data-gk]').forEach((inp) => {
      const k = inp.dataset.gk, g = +inp.dataset.g;
      if (document.activeElement === inp) return;
      inp.value = k === 'gears' ? c.gears[g].toFixed(3) : c[k][g] ? c[k][g] : '';
      inp.placeholder = k === 'gearShift' ? `${fmt(c.shift)}` : k === 'gearTq' ? 'none' : '';
    });
    for (let g = 0; g < n; g++) {
      const top = shiftAt(g) / 1000 * kmhPerKrpm(g);
      const drop = g < n - 1 ? shiftAt(g) * c.gears[g + 1] / c.gears[g] : null;
      body.querySelector(`[data-top="${g}"]`).textContent = `${fmt(g < n - 1 ? top : c.rev / 1000 * kmhPerKrpm(g))} km/h`;
      const d = body.querySelector(`[data-drop="${g}"]`);
      d.textContent = drop ? `${fmt(drop)} rpm` : '–';
      d.style.color = drop && drop < bandLo ? '#ffb020' : '';
      if (g && c.gears[g] >= c.gears[g - 1]) warn.push(`Gear ${g + 1} isn't taller than gear ${g} - the box would shift into the same or a shorter gear.`);
      if (drop && drop < bandLo - 300) warn.push(`Shifting ${g + 1}→${g + 2} drops to ${fmt(drop)} rpm, below the torque band (${fmt(bandLo)}+).`);
    }
    body.querySelector('[data-gsub]').textContent = `final drive ${(fx.fd || cfg.finalDrive).toFixed(2)} · torque band ${fmt(bandLo)}–${fmt(bandHi)} rpm`;
    body.querySelector('[data-gwarn]').innerHTML = warn.length ? warn.map((w) => `<div class="ct-w" data-s="med"><i>WATCH</i><span>${esc(w)}</span></div>`).join('')
      : '<div class="ct-ok">Every shift lands in the torque band.</div>';
    // the chart: rpm against road speed, a sawtooth up through the gears
    const L = 44, R = 428, Tp = 14, B = 218, rpmTop = Math.ceil((c.rev + 300) / 1000) * 1000;
    const vTop = Math.ceil(Math.min(400, c.rev / 1000 * kmhPerKrpm(n - 1)) / 50) * 50;
    const X = (v) => L + v / vTop * (R - L), Y = (r) => B - r / rpmTop * (B - Tp);
    let h = `<rect x="${L}" y="${Y(bandHi).toFixed(1)}" width="${R - L}" height="${(Y(bandLo) - Y(bandHi)).toFixed(1)}" fill="#33d17a" opacity=".08"/>`;
    for (let r = 0; r <= rpmTop; r += 1000) h += `<line x1="${L}" x2="${R}" y1="${Y(r).toFixed(1)}" y2="${Y(r).toFixed(1)}" stroke="#1a1d22"/><text x="${L - 5}" y="${(Y(r) + 3).toFixed(1)}" text-anchor="end" fill="#6f757d" font-size="9">${r / 1000}k</text>`;
    for (let v = 0; v <= vTop; v += 50) h += `<text x="${X(v).toFixed(1)}" y="${B + 13}" text-anchor="middle" fill="#6f757d" font-size="9">${v}</text>`;
    h += `<text x="${R}" y="${B + 26}" text-anchor="end" fill="#6f757d" font-size="9">km/h</text>`;
    h += `<line x1="${L}" x2="${R}" y1="${Y(c.rev).toFixed(1)}" y2="${Y(c.rev).toFixed(1)}" stroke="#ff5a3c" stroke-dasharray="4,3" opacity=".7"/>`;
    let from = 0;
    const COL = ['#ff5a3c', '#ff7a45', '#ffb020', '#e8c34a', '#33d17a', '#2ec4b6', '#4fa8ff', '#c48cff', '#e6e8eb', '#8a8f96'];
    for (let g = 0; g < n; g++) {
      const k = kmhPerKrpm(g), endR = g < n - 1 ? shiftAt(g) : c.rev, v1 = Math.min(vTop, endR / 1000 * k);
      const v0 = g === 0 ? 0 : from, r0 = g === 0 ? c.launch : v0 / k * 1000;
      h += `<line x1="${X(v0).toFixed(1)}" y1="${Y(r0).toFixed(1)}" x2="${X(v1).toFixed(1)}" y2="${Y(v1 / k * 1000).toFixed(1)}" stroke="${COL[g]}" stroke-width="2"/>` +
        `<text x="${(X(v1) - 4).toFixed(1)}" y="${(Y(v1 / k * 1000) - 5).toFixed(1)}" text-anchor="end" fill="${COL[g]}" font-size="9" font-weight="700">${g + 1}</text>`;
      if (g < n - 1) h += `<line x1="${X(v1).toFixed(1)}" y1="${Y(endR).toFixed(1)}" x2="${X(v1).toFixed(1)}" y2="${Y(endR * c.gears[g + 1] / c.gears[g]).toFixed(1)}" stroke="#6f757d" stroke-dasharray="2,2"/>`;
      from = v1;
    }
    body.querySelector('[data-gearchart]').innerHTML = h;
  }

  // ---- ECU view ----
  const CURVE_DEF = {
    boost: { label: 'Boost', unit: 'bar', min: -0.2, max: 2.8, step: 0.05, dp: 2, color: '#ff5a3c',
      hint: () => 'Target boost (gauge bar) at full throttle. The turbo can only make so much - its limit shows as the red dashed line. More boost = more air = more torque, but hotter intake air and more knock (petrol) or more cylinder pressure (diesel).' },
    timing: { label: 'Ignition timing', unit: '°', min: -6, max: 10, step: 0.5, dp: 1, color: '#c48cff',
      hint: () => 'Degrees of spark advance added to stock at full load. Each degree nearer best-torque timing is free power - until the engine knocks. The dashed line is the knock limit for your fuel, boost and intake temperature.' },
    afr: { label: 'Target AFR', unit: ':1', min: 10, max: 14.7, step: 0.1, dp: 1, color: '#33d17a',
      hint: () => 'Full-load air/fuel target (petrol scale). Richer (lower) runs cooler and resists knock; leaner (higher) makes a touch more power but heat and knock climb fast. Most turbo petrols live at 11.5-12.5 under boost.' },
    iq: { label: 'Fuel (IQ)', unit: '%', min: 60, max: 180, step: 1, dp: 0, color: '#33d17a',
      hint: () => 'Injection quantity at full load, as % of stock. Fuel is what makes a diesel\'s torque - but only as much as the air can burn. Past that it turns into smoke and exhaust heat. The dashed line is what the injectors can deliver.' },
    soi: { label: 'Injection timing', unit: '°', min: -4, max: 8, step: 0.5, dp: 1, color: '#c48cff',
      hint: () => 'Start of injection, degrees of advance over stock. A few degrees more burns the fuel earlier: more torque, cooler exhaust - but higher cylinder pressure and a louder clatter. Stock is retarded for emissions.' },
    rail: { label: 'Rail pressure', unit: 'bar', min: 300, max: 2600, step: 25, dp: 0, color: '#4fa8ff',
      hint: () => 'Common-rail pressure. Higher pressure atomises the fuel finer (cleaner burn, more fuel through the same injector) but the pump has to keep up and the injectors wear faster.' },
  };
  function buildEcu(body) {
    const c = cal();
    body.innerHTML = `
      <div class="ct-presets" data-presets></div>
      <div class="ct-card ct-mymaps">
        <div class="ct-label"><span>My maps · the whole setup: parts, maps, limiters, gearbox &amp; ECU functions</span>
          <span class="ct-tools" style="margin:0"><input class="ct-name" data-mapname maxlength="40" placeholder="Name this setup" aria-label="Map name">
          <button class="ct-btn" data-savemap>Save current setup</button></span></div>
        <div class="ct-maplist" data-maplist></div>
      </div>
      <div class="ct-grid">
        <div class="ct-card">
          <div class="ct-label"><span>Map editor · Map ${slot} <span data-calname style="color:#c7cbd0;letter-spacing:.02em;text-transform:none"></span></span></div>
          <div class="ct-maptabs" role="tablist" data-maptabs></div>
          <svg class="ct-editor" data-editor viewBox="0 0 560 230"></svg>
          <div class="ct-cells" data-cells></div>
          <div class="ct-tools">
            <button class="ct-btn" data-shift="-1" title="Lower the whole map one step">− All</button>
            <button class="ct-btn" data-shift="1" title="Raise the whole map one step">+ All</button>
            <button class="ct-btn" data-smooth title="Even out bumps between neighbouring cells">Smooth</button>
            <button class="ct-btn" data-reset title="Put this map back to stock">Stock map</button>
          </div>
          <div class="ct-hint" data-hint></div>
        </div>
        <div class="ct-card">
          <div class="ct-label"><span>Predicted dyno · full load</span><span style="text-transform:none;letter-spacing:0" data-predsub></span></div>
          <svg class="ct-editor" data-pred viewBox="0 0 440 230"></svg>
          <div class="ct-label" style="margin-top:10px"><span>Needs attention</span></div>
          <div class="ct-warn" data-warn></div>
        </div>
      </div>
      <div class="ct-card" style="margin-top:12px">
        <div class="ct-label"><span>Limiters, gearbox &amp; ECU functions</span></div>
        <div class="ct-set" data-set></div>
      </div>`;
    // presets
    const pre = body.querySelector('[data-presets]');
    presetsOf().forEach((p) => {
      const miss = Object.entries(p.needs).filter(([k, ok]) => !ok.includes(part(k))).map(([k]) => P.find((x) => x.k === k).label);
      const b = document.createElement('button');
      b.className = 'ct-preset';
      b.dataset.preset = p.id;
      const pr = predict({ ...presetCal(p.id) });
      b.innerHTML = `<b>${esc(p.name)} <i style="color:#8a8f96">≈ ${fmt(pr.hp)} hp · ${fmt(pr.tq)} Nm</i></b><span>${esc(p.desc)}</span>` +
        (miss.length ? `<i style="color:#ffb020">Missing: ${esc(miss.join(', '))}</i>` : (Object.keys(p.needs).length ? '<i style="color:#33d17a">Hardware ready</i>' : ''));
      b.addEventListener('click', () => { loadPreset(slot, p.id); b.blur(); render(true); });
      pre.appendChild(b);
    });
    // map tabs
    const tabs = body.querySelector('[data-maptabs]');
    CURVES().forEach((k) => {
      const b = document.createElement('button');
      b.textContent = CURVE_DEF[k].label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { mapKey = k; b.blur(); buildEditor(body); });
      b.dataset.k = k;
      tabs.appendChild(b);
    });
    body.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
      const d = CURVE_DEF[mapKey];
      cal()[mapKey] = cal()[mapKey].map((v) => clamp(+(v + d.step * b.dataset.shift).toFixed(3), d.min, d.max));
      changed(d.label.toLowerCase() + ' map');
      b.blur();
    }));
    body.querySelector('[data-smooth]').addEventListener('click', (e) => {
      const v = cal()[mapKey], d = CURVE_DEF[mapKey];
      cal()[mapKey] = v.map((x, i) => (i === 0 || i === v.length - 1 ? x : +(Math.round(((v[i - 1] + 2 * x + v[i + 1]) / 4) / d.step) * d.step).toFixed(3)));
      changed(d.label.toLowerCase() + ' map');
      e.currentTarget.blur();
    });
    body.querySelector('[data-reset]').addEventListener('click', (e) => {
      cal()[mapKey] = [...stockCal[mapKey]];
      changed(CURVE_DEF[mapKey].label.toLowerCase() + ' map back to stock');
      e.currentTarget.blur();
    });
    buildSettings(body.querySelector('[data-set]'));
    const nameIn = body.querySelector('[data-mapname]');
    const save = () => { if (body.querySelector('[data-savemap]').disabled) return; saveMap(nameIn.value || bare(cal().name)); nameIn.value = ''; render(true); }; // Enter too: a taken name keeps what was typed
    body.querySelector('[data-savemap]').addEventListener('click', (e) => { e.currentTarget.blur(); save(); });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    nameIn.addEventListener('input', () => renderMyMaps(body)); // a taken name disables Save as it's typed
    buildEditor(body);
    refreshEcu();
  }
  let deleting = -1; // a delete waits for a second click
  function renderMyMaps(body) {
    const list = body.querySelector('[data-maplist]');
    if (!list) return;
    const nameIn = body.querySelector('[data-mapname]');
    const current = bare(cal().name);
    if (document.activeElement !== nameIn) nameIn.placeholder = current && current !== 'Custom' && !presetsOf().some((p) => p.name === current) ? current : 'Name this setup';
    // Save only makes a new map: a name that's taken is changed by that map's own Update, once it's loaded
    const saveName = bare(nameIn.value || current), taken = tune.library.some((m) => m.name === saveName), saveBtn = body.querySelector('[data-savemap]');
    saveBtn.disabled = taken || tune.library.length >= MAX_MAPS;
    saveBtn.title = taken ? `"${saveName}" is already saved - give it a new name, or load it and use Update` : '';
    const upgraded = (m) => Object.entries(m.parts).filter(([k, id]) => { const p = P.find((x) => x.k === k); return p && id !== p.opts[0].id; }).length;
    list.innerHTML = tune.library.length ? tune.library.map((m, i) => `
      <div class="ct-mapitem" aria-current="${fromLib[slot] === m.name}">
        <div><b>${esc(m.name)}</b><span>${fmt(m.hp)} hp · ${fmt(m.tq)} Nm · ${upgraded(m)} upgraded part${upgraded(m) === 1 ? '' : 's'} · ${esc(new Date(m.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</span></div>
        <span class="ct-tools" style="margin:0">
          <button class="ct-btn" data-load="${i}" title="Fit its parts and load its calibration into Map ${slot}">Load into Map ${slot}</button>
          ${fromLib[slot] === m.name ? `<button class="ct-btn" data-update="${i}" title="Save Map ${slot}'s calibration over it (its parts save themselves)">Update</button>` : ''}
          <button class="ct-btn" data-del="${i}">${deleting === i ? 'Confirm delete' : 'Delete'}</button>
        </span>
      </div>`).join('') : '<div class="ct-hint" style="margin:0">No saved maps yet. Set the car up - parts, maps, gearbox, limiters - then name it and save it here. Load it back any time.</div>';
    list.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => { deleting = -1; loadMap(+b.dataset.load); render(true); }));
    list.querySelectorAll('[data-update]').forEach((b) => b.addEventListener('click', () => { deleting = -1; saveMap(tune.library[+b.dataset.update].name, +b.dataset.update); render(true); }));
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.del;
      if (deleting === i) { deleting = -1; deleteMap(i); } else { deleting = i; renderMyMaps(body); }
    }));
  }
  // something in the open slot changed: name it Custom, re-predict, hand it to the car
  function changed(what) {
    markEdited();
    noteEdit(what);
    apply();
    record(`Map ${slot}: ${what}`);
  }
  function markEdited() {
    cal().name = fromLib[slot] ? `${fromLib[slot]} *` : 'Custom'; // one of my maps, changed since it was saved - or a preset, now Custom
  }
  function refreshEcu() {
    const body = root.querySelector('[data-body]');
    if (!body || !body.querySelector('[data-editor]')) return;
    const c = cal(), p = predicted(slot);
    body.querySelector('[data-calname]').textContent = '· ' + c.name;
    renderMyMaps(body);
    body.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-current', String(c.name === presetsOf().find((x) => x.id === b.dataset.preset).name)));
    body.querySelectorAll('[data-maptabs] button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === mapKey)));
    drawEditor(body);
    drawPred(body.querySelector('[data-pred]'), p);
    body.querySelector('[data-predsub]').innerHTML = `<span style="color:#ff5a3c">${fmt(p.hp)} hp @ ${fmt(p.hpRpm)}</span> · <span style="color:#4fa8ff">${fmt(p.tq)} Nm @ ${fmt(p.tqRpm)}</span>`;
    const SEV = { crit: 'CRITICAL', high: 'HIGH', med: 'WATCH', info: 'INFO' };
    body.querySelector('[data-warn]').innerHTML = p.warn.length
      ? p.warn.map((w) => `<div class="ct-w" data-s="${w.sev}"><i>${SEV[w.sev]}</i><span>${esc(w.text)}</span></div>`).join('')
      : '<div class="ct-ok">Nothing over the limits. Verify it on the dyno and watch the datalog.</div>';
    syncSettings(body.querySelector('[data-set]'));
  }

  // the curve editor: drag a point up or down, or focus it and use the arrow keys (Shift = 5 steps)
  const EX = { l: 44, r: 548, t: 14, b: 196 };
  function buildEditor(body) {
    const d = CURVE_DEF[mapKey];
    body.querySelector('[data-hint]').textContent = d.hint();
    const cells = body.querySelector('[data-cells]');
    cells.style.gridTemplateColumns = `repeat(${E.axis.length}, minmax(38px, 1fr))`;
    cells.innerHTML = E.axis.map((r, i) => `<label>${r >= 1000 ? r / 1000 + 'k' : r}<input type="number" step="${d.step}" min="${d.min}" max="${d.max}" data-i="${i}" aria-label="${d.label} at ${r} rpm"></label>`).join('');
    cells.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) return drawEditor(body);
      cal()[mapKey][+inp.dataset.i] = clamp(v, d.min, d.max);
      changed(d.label.toLowerCase() + ' map');
    }));
    const svg = body.querySelector('[data-editor]');
    svg.innerHTML = '';
    svg.onpointerdown = (e) => {
      const g = e.target.closest('.pt');
      if (!g) return;
      e.preventDefault();
      g.focus();
      const i = +g.dataset.i;
      svg.setPointerCapture(e.pointerId);
      lockRange = range(d); // the scale holds still under the pointer while it drags
      const move = (ev) => {
        const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
        const y = pt.matrixTransform(svg.getScreenCTM().inverse()).y;
        const [lo, hi] = lockRange;
        const v = hi - (y - EX.t) / (EX.b - EX.t) * (hi - lo);
        cal()[mapKey][i] = clamp(+(Math.round(v / d.step) * d.step).toFixed(3), d.min, d.max);
        markEdited();
        drawEditor(body);
      };
      const up = () => { lockRange = null; svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); changed(d.label.toLowerCase() + ' map'); };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    };
    svg.onkeydown = (e) => {
      const g = e.target.closest('.pt');
      if (!g) return;
      const i = +g.dataset.i, dir = { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = svg.querySelector(`.pt[data-i="${clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, E.axis.length - 1)}"]`);
        if (next) next.focus();
        return;
      }
      if (!dir) return;
      e.preventDefault();
      cal()[mapKey][i] = clamp(+(cal()[mapKey][i] + dir * d.step * (e.shiftKey ? 5 : 1)).toFixed(3), d.min, d.max);
      changed(d.label.toLowerCase() + ' map');
    };
    refreshEcu();
  }
  // y range: the map's own span with some room, so small edits are visible
  let lockRange = null;
  // the open map's limit (turbo, knock, injectors), drawn as a dashed line
  function limitLine() {
    if (mapKey === 'boost') return E.axis.map((r) => turboCap(r));
    if (mapKey === 'timing') return E.axis.map((r) => model(cal(), r, { retard: 0 }).margin);
    if (mapKey === 'iq') return E.axis.map((r) => model(cal(), r).injCap * 100);
    return null;
  }
  function range(d) {
    if (lockRange) return lockRange;
    const v = cal()[mapKey], s = stockCal[mapKey], lim = (limitLine() || []).map((x) => clamp(x, d.min, d.max));
    const lo = Math.min(...v, ...s, ...lim), hi = Math.max(...v, ...s, ...lim);
    const pad = Math.max((hi - lo) * 0.15, d.step * 4);
    return [Math.max(d.min, lo - pad), Math.min(d.max, hi + pad)];
  }
  function drawEditor(body) {
    const svg = body.querySelector('[data-editor]'), d = CURVE_DEF[mapKey];
    if (!svg) return;
    const v = cal()[mapKey], s = stockCal[mapKey];
    const [lo, hi] = range(d);
    const X = (i) => EX.l + i / (E.axis.length - 1) * (EX.r - EX.l);
    const Y = (val) => EX.b - (val - lo) / (hi - lo) * (EX.b - EX.t);
    const line = (vals) => vals.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(' ');
    let h = '';
    // gridlines on a round step (0.25 bar, 1°, 50 bar...) rather than quarters of an odd range
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500].find((x) => (hi - lo) / x <= 5) || 1000;
    for (let val = Math.ceil(lo / step) * step; val <= hi + 1e-9; val += step) {
      const y = Y(val).toFixed(1);
      h += `<line x1="${EX.l}" x2="${EX.r}" y1="${y}" y2="${y}" stroke="#1a1d22"/><text x="${EX.l - 6}" y="${+y + 3}" text-anchor="end" fill="#6f757d" font-size="9">${+val.toFixed(2)}</text>`;
    }
    E.axis.forEach((r, i) => { h += `<text x="${X(i).toFixed(1)}" y="${EX.b + 14}" text-anchor="middle" fill="#6f757d" font-size="9">${r / 1000}k</text>`; });
    h += `<text x="${EX.l - 6}" y="${EX.t - 4}" text-anchor="end" fill="#6f757d" font-size="9">${esc(d.unit)}</text>`;
    // limit line for the open map
    const lim = limitLine();
    if (lim) h += `<polyline points="${line(lim.map((x) => clamp(x, lo, hi)))}" fill="none" stroke="#ff5a3c" stroke-width="1.2" stroke-dasharray="4,3" opacity=".75"/>`;
    h += `<polyline points="${line(s)}" fill="none" stroke="#6f757d" stroke-width="1.4" stroke-dasharray="2,3"/>`;
    h += `<polyline points="${line(v)}" fill="none" stroke="${d.color}" stroke-width="2.2" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px ${d.color}88)"/>`;
    v.forEach((val, i) => {
      const x = X(i).toFixed(1), y = Y(val).toFixed(1), diff = Math.abs(val - s[i]) > 1e-6;
      h += `<g class="pt" data-i="${i}" tabindex="0" role="slider" aria-label="${esc(d.label)} at ${E.axis[i]} rpm" aria-valuenow="${val}" aria-valuemin="${d.min}" aria-valuemax="${d.max}">` +
        `<circle cx="${x}" cy="${y}" r="13" fill="transparent"/><circle class="dot" cx="${x}" cy="${y}" r="4.5" fill="${diff ? d.color : '#0a0b0d'}" stroke="${d.color}" stroke-width="1.6"/>` +
        `<text x="${x}" y="${(+y - 9).toFixed(1)}" text-anchor="middle" fill="${diff ? '#f4f6f8' : '#8a8f96'}" font-size="8.5" font-family="Courier New,monospace">${val.toFixed(d.dp)}</text></g>`;
    });
    h += `<g font-size="9" font-family="Segoe UI,sans-serif"><line x1="${EX.l + 4}" x2="${EX.l + 20}" y1="${EX.t - 4}" y2="${EX.t - 4}" stroke="${d.color}" stroke-width="2"/><text x="${EX.l + 24}" y="${EX.t - 1}" fill="#c7cbd0">Map ${slot}</text>` +
      `<line x1="${EX.l + 72}" x2="${EX.l + 88}" y1="${EX.t - 4}" y2="${EX.t - 4}" stroke="#6f757d" stroke-dasharray="2,3" stroke-width="1.4"/><text x="${EX.l + 92}" y="${EX.t - 1}" fill="#c7cbd0">Stock</text>` +
      (lim ? `<line x1="${EX.l + 132}" x2="${EX.l + 148}" y1="${EX.t - 4}" y2="${EX.t - 4}" stroke="#ff5a3c" stroke-dasharray="4,3"/><text x="${EX.l + 152}" y="${EX.t - 1}" fill="#c7cbd0">${mapKey === 'boost' ? 'Turbo limit' : mapKey === 'timing' ? 'Knock limit' : 'Injector limit'}</text>` : '') + '</g>';
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('.pt');
    const fi = focused && svg.contains(focused) ? focused.dataset.i : null;
    svg.innerHTML = h;
    if (fi != null) svg.querySelector(`.pt[data-i="${fi}"]`).focus();
    body.querySelectorAll('[data-cells] input').forEach((inp) => {
      const i = +inp.dataset.i;
      if (document.activeElement !== inp) inp.value = v[i].toFixed(d.dp);
      inp.classList.toggle('ct-chg', Math.abs(v[i] - s[i]) > 1e-6);
    });
  }
  function drawPred(svg, p) {
    const L = 40, R = 400, Tp = 14, B = 196;
    const r0 = p.pts[0].rpm, r1 = p.pts[p.pts.length - 1].rpm;
    const nice = (v, unit) => Math.ceil(v * 1.08 / 4 / unit) * unit * 4; // four even steps
    const hpTop = nice(Math.max(...p.pts.map((x) => Math.max(x.hp, x.stockHp))), 25);
    const tqTop = nice(Math.max(...p.pts.map((x) => Math.max(x.tq, x.stockTq))), 25);
    const X = (r) => L + (r - r0) / (r1 - r0) * (R - L);
    const Y = (v, top) => B - v / top * (B - Tp);
    const line = (k, top) => p.pts.map((x) => `${X(x.rpm).toFixed(1)},${Y(x[k], top).toFixed(1)}`).join(' ');
    let h = '';
    for (let k = 0; k <= 4; k++) {
      const y = Y(hpTop * k / 4, hpTop).toFixed(1);
      h += `<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" stroke="#1a1d22"/><text x="${L - 5}" y="${+y + 3}" text-anchor="end" fill="#ff5a3c" font-size="9">${Math.round(hpTop * k / 4)}</text>` +
        `<text x="${R + 5}" y="${+y + 3}" fill="#4fa8ff" font-size="9">${Math.round(tqTop * k / 4)}</text>`;
    }
    for (let r = Math.ceil(r0 / 1000) * 1000; r <= r1; r += 1000) h += `<text x="${X(r).toFixed(1)}" y="${B + 14}" text-anchor="middle" fill="#6f757d" font-size="9">${r / 1000}k</text>`;
    h += `<polyline points="${line('stockTq', tqTop)}" fill="none" stroke="#4fa8ff" stroke-opacity=".35" stroke-width="1.4" stroke-dasharray="3,3"/>` +
      `<polyline points="${line('stockHp', hpTop)}" fill="none" stroke="#ff5a3c" stroke-opacity=".35" stroke-width="1.4" stroke-dasharray="3,3"/>` +
      `<polyline points="${line('tq', tqTop)}" fill="none" stroke="#4fa8ff" stroke-width="2.2" style="filter:drop-shadow(0 0 4px #4fa8ff88)"/>` +
      `<polyline points="${line('hp', hpTop)}" fill="none" stroke="#ff5a3c" stroke-width="2.2" style="filter:drop-shadow(0 0 4px #ff5a3c88)"/>`;
    // the gearbox's rating, when the curve gets near it
    if (tqTop > fx.transCap) h += `<line x1="${L}" x2="${R}" y1="${Y(fx.transCap, tqTop).toFixed(1)}" y2="${Y(fx.transCap, tqTop).toFixed(1)}" stroke="#ffb020" stroke-dasharray="5,4" stroke-width="1"/><text x="${R - 4}" y="${(Y(fx.transCap, tqTop) - 4).toFixed(1)}" text-anchor="end" fill="#ffb020" font-size="8.5">gearbox ${fmt(fx.transCap)} Nm</text>`;
    h += `<g font-size="9"><line x1="${L + 6}" x2="${L + 20}" y1="${Tp - 4}" y2="${Tp - 4}" stroke="#ff5a3c" stroke-width="2"/><text x="${L + 24}" y="${Tp - 1}" fill="#c7cbd0">hp</text>` +
      `<line x1="${L + 44}" x2="${L + 58}" y1="${Tp - 4}" y2="${Tp - 4}" stroke="#4fa8ff" stroke-width="2"/><text x="${L + 62}" y="${Tp - 1}" fill="#c7cbd0">Nm</text>` +
      `<line x1="${L + 84}" x2="${L + 98}" y1="${Tp - 4}" y2="${Tp - 4}" stroke="#8a8f96" stroke-dasharray="3,3"/><text x="${L + 102}" y="${Tp - 1}" fill="#c7cbd0">stock</text></g>`;
    svg.innerHTML = h;
  }

  // limiters, gearbox and ECU switches
  function settingsDefs() {
    const pet = E.fuel === 'petrol';
    const c = cal();
    const defs = [
      { k: 'rev', label: 'Rev limiter', min: pet ? 5000 : 4000, max: () => maxRpm() + 600, step: 50, show: (v) => fmt(v) + ' rpm' },
      { k: 'shift', label: 'Shift point (D, full throttle)', min: pet ? 4000 : 3000, max: () => c.rev - 100, step: 50, show: (v) => fmt(v) + ' rpm' },
      { k: 'launch', label: 'Launch control rpm', min: 1500, max: pet ? 5500 : 3500, step: 50, show: (v) => fmt(v) + ' rpm' },
      { k: 'vmax', label: 'Speed limiter', min: 0, max: 330, step: 5, show: (v) => (v ? v + ' km/h' : 'Off'), snap: (v) => (v < 120 ? 0 : v) },
      { k: 'tq', label: 'Torque limiter', min: pet ? 300 : 250, max: Math.max(pet ? 950 : 850, Math.round(E.tq * 2.2 / 50) * 50), step: 10, show: (v) => fmt(v) + ' Nm' },
      { k: 'shiftSpeed', label: 'Shift speed (TCU)', seg: ['Stock', 'Sport', 'Race'] },
    ];
    if (pet) {
      defs.push({ k: 'burble', label: 'Overrun burble', seg: ['Off', 'Stock', 'Sport', 'Max'] },
        { k: 'knock', label: 'Knock control', seg: ['Off', 'On'], bool: true },
        { k: 'dpf', label: 'Catalyst monitor', seg: ['Off', 'On'], bool: true });
    } else {
      defs.push({ k: 'smoke', label: 'Smoke limiter (min lambda)', min: 0.95, max: 1.4, step: 0.01, show: (v) => 'λ ' + v.toFixed(2) },
        { k: 'pilot', label: 'Pilot injection', seg: ['Off', 'On'], bool: true },
        { k: 'egr', label: 'EGR function', seg: ['Off', 'On'], bool: true },
        { k: 'dpf', label: 'DPF function', seg: ['Off', 'On'], bool: true });
    }
    defs.push({ k: 'protect', label: 'ECU protections (limp, EGT)', seg: ['Off', 'On'], bool: true });
    return defs;
  }
  function buildSettings(box) {
    box.innerHTML = '';
    settingsDefs().forEach((d) => {
      const row = document.createElement('div');
      row.className = 'ct-row';
      row.dataset.k = d.k;
      if (d.seg) {
        row.innerHTML = `<span>${esc(d.label)}</span><b></b><div class="ct-seg" role="group" aria-label="${esc(d.label)}">${d.seg.map((s, i) => `<button data-v="${i}">${s}</button>`).join('')}</div>`;
        row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          const v = d.bool ? b.dataset.v === '1' : +b.dataset.v;
          cal()[d.k] = v;
          changed(`${d.label.toLowerCase()} ${d.seg[+b.dataset.v].toLowerCase()}`);
          if (['dpf', 'egr', 'protect'].includes(d.k) && wasOn) ignitionOn({ coolant: 90 });
          b.blur();
        }));
      } else {
        row.innerHTML = `<span>${esc(d.label)}</span><b></b><input type="range" step="${d.step}" aria-label="${esc(d.label)}">`;
        const inp = row.querySelector('input');
        inp.addEventListener('input', () => {
          let v = +inp.value;
          if (d.snap) v = d.snap(v);
          cal()[d.k] = v;
          row.querySelector('b').textContent = d.show(v);
        });
        inp.addEventListener('change', () => changed(`${d.label.toLowerCase()} ${d.show(cal()[d.k])}`));
      }
      box.appendChild(row);
    });
  }
  function syncSettings(box) {
    if (!box) return;
    const c = cal();
    settingsDefs().forEach((d) => {
      const row = box.querySelector(`[data-k="${d.k}"]`);
      if (!row) return;
      if (d.seg) {
        const cur = d.bool ? (c[d.k] ? 1 : 0) : c[d.k] ?? 0;
        row.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === cur)));
        row.querySelector('b').textContent = '';
      } else {
        const inp = row.querySelector('input');
        inp.min = d.min; inp.max = typeof d.max === 'function' ? d.max() : d.max;
        if (document.activeElement !== inp) inp.value = c[d.k];
        row.querySelector('b').textContent = d.show(c[d.k]);
      }
    });
  }

  // ---- Parts view ----
  // the Parts view: every part in its group, searchable by name, option, description or group. 'upgraded', 'stock' and
  // 'worn' (a condition bar past 60%) filter on the part's state instead of its text
  const PART_GROUPS = ['Engine', 'Turbo & intake', 'Exhaust', 'Fuel', 'Ignition', 'Cooling', 'Hybrid', 'Brakes', 'Drivetrain', 'Chassis'];
  const WEAR_OF = { internals: 'pistons engine', gasket: 'gasket', turbo: 'turbo', chargepipe: 'chargepipe', diverter: 'diverter', vgt: 'vgt',
    intercooler: 'intercooler', hpfp: 'hpfp', pump: 'pump fuelfilter', lpfp: 'lpfp', injectors: 'injectors', injection: 'fuelfilter', trans: 'trans',
    plugs: 'plugs', coils: 'coils', glow: 'glow', egr: 'egr', intake: 'airfilter', catchcan: 'valves', swirl: 'swirl', springs: 'springs', chain: 'chain',
    oilpump: 'oilpump', oilcooler: 'oil', radiator: 'radiator', waterpump: 'waterpump', thermostat: 'thermostat', hoses: 'hoses coolant', fan: 'fan',
    pads: 'brake', discs: 'discs', fluid: 'fluid', suspension: 'dampers', tyres: 'tyre pressure' };
  let partQuery = '';
  function buildParts(body) {
    const groups = PART_GROUPS.filter((g) => P.some((p) => p.group === g));
    const shared = (k) => window.CarService && CarService.parts.find((x) => x.key === k);
    body.innerHTML = `<div class="ct-search"><input type="search" data-partsearch placeholder="Search parts - gasket, turbo, fuel, worn, upgraded..." aria-label="Search parts">` +
      `<span data-partcount></span></div>` +
      groups.map((g) => `<div class="ct-label" style="margin:14px 0 8px"><span>${g}</span></div><div class="ct-parts" data-g="${g}"></div>`).join('') +
      '<div class="ct-hint" data-nomatch hidden>No parts match.</div>';
    P.forEach((p) => {
      const cur = p.opts.find((o) => o.id === part(p.k));
      const card = document.createElement('div');
      card.className = 'ct-card ct-part';
      const wk = WEAR_OF[p.k], keys = (wk || '').split(' ').filter((k) => wearParts[k] || shared(k));
      card.innerHTML = `<h4>${esc(p.label)}<small>${esc(cur.label)}</small></h4><div class="ct-seg" role="group" aria-label="${esc(p.label)}">` +
        p.opts.map((o) => `<button data-o="${o.id}" aria-pressed="${o.id === cur.id}">${esc(o.label)}</button>`).join('') + `</div><p>${esc(cur.desc)}</p>` +
        keys.map((k) => `<div class="ct-cond" data-wear="${k}"><span>${k === 'engine' ? 'Engine wear' : keys.length > 1 ? (wearParts[k] || shared(k)).label : 'Condition'}</span><span><i></i></span><b></b></div>`).join('');
      card.dataset.text = [p.label, p.group, ...p.opts.map((o) => o.label + ' ' + o.desc), ...keys.map((k) => (wearParts[k] || shared(k)).label)].join(' ').toLowerCase();
      card.dataset.state = cur.id !== p.opts[0].id ? 'upgraded' : 'stock';
      card.dataset.keys = keys.join(' ');
      card.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => { setPart(p.k, b.dataset.o); b.blur(); render(true); }));
      body.querySelector(`[data-g="${p.group}"]`).appendChild(card);
    });
    body.insertAdjacentHTML('beforeend', '<div class="ct-hint" style="margin-top:12px">Parts are the car\'s hardware, shared by both maps - but with one of your saved maps loaded, a change saves into it, and switching to a map slot that holds a saved map puts its parts back on. Every part with a condition bar wears as you drive - service it in the Servicing tab; fitting an upgrade starts that part fresh.</div>');
    const search = body.querySelector('[data-partsearch]');
    const filter = () => {
      partQuery = search.value;
      const words = partQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      const worn = (c) => c.dataset.keys.split(' ').some((k) => k && (wearParts[k] || shared(k)).value > 60);
      const hit = (c, w) => (w === 'worn' ? worn(c) : w === 'upgraded' || w === 'stock' ? c.dataset.state === w : c.dataset.text.includes(w));
      body.querySelectorAll('.ct-part').forEach((c) => { c.hidden = !words.every((w) => hit(c, w)); shown += !c.hidden; });
      body.querySelectorAll('[data-g]').forEach((g) => { g.hidden = ![...g.children].some((c) => !c.hidden); g.previousElementSibling.hidden = g.hidden; });
      body.querySelector('[data-nomatch]').hidden = shown > 0;
      body.querySelector('[data-partcount]').textContent = words.length ? `${shown} of ${P.length}` : `${P.length} parts`;
    };
    search.value = partQuery; // a part change re-renders the view - the search stays
    search.addEventListener('input', filter);
    filter();
    renderWear();
  }
  function renderWear() {
    if (!root) return;
    root.querySelectorAll('[data-wear]').forEach((el) => {
      // the car's own engine wear (its Engine service row) sits beside the tune's parts
      const p = wearParts[el.dataset.wear] || (window.CarService && CarService.parts.find((x) => x.key === el.dataset.wear));
      if (!p) return;
      const removed = !!p.read && p.read(p.value) === 'Removed';
      const h = removed ? 0 : 100 - p.value;
      el.querySelector('i').style.width = (removed ? 0 : el.dataset.wear === 'dpf' ? 100 - p.value : h) + '%';
      el.querySelector('i').style.background = h < 25 ? '#ff5a3c' : h < 60 ? '#ffb020' : '#33d17a';
      el.querySelector('b').textContent = removed ? 'Removed' : el.dataset.wear === 'dpf' ? Math.round(p.value) + '% soot' : Math.round(h) + '%';
    });
  }

  // ---- Datalog: live lanes (last 30 s), recorded logs, per-cylinder view ----
  const LANES = () => (E.fuel === 'petrol' ? [
    { k: 'rpm', label: 'RPM', lo: 0, hi: 8000, color: '#e6e8eb', show: (v) => fmt(v) },
    { k: 'boost', t: 'boostT', label: 'Boost', lo: -0.8, hi: 2.6, color: '#ff5a3c', show: (v) => v.toFixed(2) + ' bar' },
    { k: 'afr', t: 'afrT', label: 'AFR', lo: 10, hi: 16, color: '#33d17a', show: (v) => (v == null ? 'cut' : v.toFixed(1)) },
    { k: 'timing', label: 'Timing ±', lo: -10, hi: 10, color: '#c48cff', show: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°' },
    { k: 'retard', label: 'Knock retard', lo: 0, hi: 10, color: '#ff7a45', show: (v) => v.toFixed(1) + '°' },
    { k: 'iat', label: 'Intake air', lo: 10, hi: 90, color: '#4fa8ff', show: (v) => v.toFixed(0) + ' °C' },
    { k: 'egt', label: 'EGT', lo: 0, hi: 1100, color: '#ffb020', show: (v) => fmt(v) + ' °C' },
    { k: 'coolT', label: 'Coolant', lo: 20, hi: 130, color: '#ff9d2e', show: (v) => v.toFixed(0) + ' °C' },
    { k: 'oilT', label: 'Oil temp', lo: 20, hi: 150, color: '#e8c34a', show: (v) => v.toFixed(0) + ' °C' },
    { k: 'rail', t: 'railT', label: 'Fuel rail', lo: 0, hi: 400, color: '#8fd3ff', show: (v) => fmt(v) + ' bar' },
    { k: 'duty', label: 'Inj. duty', lo: 0, hi: 100, color: '#e8c34a', show: (v) => v.toFixed(0) + ' %' },
  ] : [
    { k: 'rpm', label: 'RPM', lo: 0, hi: 5500, color: '#e6e8eb', show: (v) => fmt(v) },
    { k: 'boost', t: 'boostT', label: 'Boost', lo: -0.6, hi: 2.6, color: '#ff5a3c', show: (v) => v.toFixed(2) + ' bar' },
    { k: 'iq', label: 'Fuel (IQ)', lo: 0, hi: 80, color: '#33d17a', show: (v) => v.toFixed(1) + ' mg' },
    { k: 'lambda', label: 'Lambda', lo: 0.9, hi: 3, color: '#2ec4b6', show: (v) => (v == null ? 'cut' : v.toFixed(2)) },
    { k: 'smoke', label: 'Smoke', lo: 0, hi: 100, color: '#8a8f96', show: (v) => v.toFixed(0) + ' %' },
    { k: 'rail', t: 'railT', label: 'Rail', lo: 0, hi: 2600, color: '#4fa8ff', show: (v) => fmt(v) + ' bar' },
    { k: 'soi', label: 'Inj. timing ±', lo: -4, hi: 8, color: '#c48cff', show: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°' },
    { k: 'pcp', label: 'Cyl. pressure', lo: 0, hi: 240, color: '#ff7a45', show: (v) => fmt(v) + ' bar' },
    { k: 'egt', label: 'EGT', lo: 0, hi: 1000, color: '#ffb020', show: (v) => fmt(v) + ' °C' },
    { k: 'iat', label: 'Intake air', lo: 10, hi: 90, color: '#8fd3ff', show: (v) => v.toFixed(0) + ' °C' },
    { k: 'coolT', label: 'Coolant', lo: 20, hi: 130, color: '#ff9d2e', show: (v) => v.toFixed(0) + ' °C' },
    { k: 'oilT', label: 'Oil temp', lo: 20, hi: 150, color: '#e8c34a', show: (v) => v.toFixed(0) + ' °C' },
  ]);
  const live = [], logs = [];
  let rec = null, shown = null, sampleT = 0;
  function sample(dt) {
    sampleT += dt;
    if (sampleT < 0.1) return;
    sampleT = 0;
    const s = { t: performance.now() / 1000 };
    LANES().forEach((l) => { s[l.k] = ch[l.k]; if (l.t) s[l.t] = ch[l.t]; });
    s.knock = ch.knockHit;
    live.push(s);
    if (live.length > 300) live.shift();
    if (rec) { rec.samples.push(s); if (rec.samples.length >= 1200) stopRec(); }
  }
  function buildLog(body) {
    body.innerHTML = `
      <div class="ct-card">
        <div class="ct-label"><span data-logtitle>Live · last 30 s</span>
          <span class="ct-tools" style="margin:0">
            <button class="ct-btn ct-rec" data-rec aria-pressed="false">● Record</button>
            <button class="ct-btn" data-livebtn>Live</button>
            <button class="ct-btn" data-csv disabled>Export CSV</button>
          </span></div>
        <svg class="ct-log" data-lanes></svg>
        <div class="ct-logs" data-logs></div>
      </div>
      <div class="ct-card" style="margin-top:12px">
        <div class="ct-label"><span>${E.fuel === 'petrol' ? 'Cylinders · knock retard, knock count, misfires' : 'Cylinders · injector balance, overload events, misfires'}</span></div>
        <div class="ct-cyls" data-cyls></div>
      </div>
      <div class="ct-hint">Record a pull in Dyno mode or on the road, then read it back: ${E.fuel === 'petrol'
        ? 'boost should track its target, AFR stay 11.5-12.5 under boost, knock retard stay under 3°, and EGT under 950 °C.'
        : 'boost should track its target, lambda stay above 1.1 (smoke) and rail pressure on target; keep EGT under 800 °C and cylinder pressure under ' + pcpLimit() + ' bar.'}</div>`;
    body.querySelector('[data-rec]').addEventListener('click', (e) => { if (rec) stopRec(); else startRec(); e.currentTarget.blur(); });
    body.querySelector('[data-livebtn]').addEventListener('click', (e) => { shown = null; e.currentTarget.blur(); renderLogs(); });
    body.querySelector('[data-csv]').addEventListener('click', (e) => { if (shown) exportCsv(shown); e.currentTarget.blur(); });
    renderLogs();
    drawLog();
  }
  function startRec() { rec = { n: logs.length + 1, at: new Date(), samples: [] }; renderLogs(); }
  function stopRec() {
    if (rec && rec.samples.length > 10) { logs.push(rec); shown = rec; }
    rec = null;
    renderLogs();
  }
  function renderLogs() {
    if (!root || view !== 'log') return;
    const b = root.querySelector('[data-rec]');
    if (!b) return;
    b.setAttribute('aria-pressed', String(!!rec));
    b.textContent = rec ? '■ Stop' : '● Record';
    root.querySelector('[data-csv]').disabled = !shown;
    root.querySelector('[data-logtitle]').textContent = rec ? `Recording log ${rec.n}…` : shown ? `Log ${shown.n} · ${(shown.samples.length / 10).toFixed(1)} s` : 'Live · last 30 s';
    root.querySelector('[data-logs]').innerHTML = logs.slice().reverse().map((l) => {
      const peakB = Math.max(...l.samples.map((s) => s.boost ?? 0));
      return `<button data-l="${l.n}" aria-current="${l === shown}"><span>Log ${l.n} · ${l.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>` +
        `<span>${(l.samples.length / 10).toFixed(1)} s · peak ${peakB.toFixed(2)} bar · ${l.samples.filter((s) => s.knock).length} knock</span></button>`;
    }).join('');
    root.querySelectorAll('[data-l]').forEach((b2) => b2.addEventListener('click', () => { shown = logs.find((l) => l.n === +b2.dataset.l); b2.blur(); renderLogs(); drawLog(); }));
  }
  function drawLog() {
    const svg = root && root.querySelector('[data-lanes]');
    if (!svg) return;
    const lanes = LANES(), data = shown ? shown.samples : live, W = 620, LH = 34, L = 92, R = 548;
    svg.setAttribute('viewBox', `0 0 ${W} ${lanes.length * LH + 16}`);
    const n = shown ? data.length : 300;
    const X = (i) => L + i / Math.max(1, n - 1) * (R - L);
    let h = '';
    lanes.forEach((l, li) => {
      const top = li * LH + 4, bot = top + LH - 6;
      const Y = (v) => bot - clamp01((v - l.lo) / (l.hi - l.lo)) * (bot - top);
      const off = shown ? 0 : n - data.length;
      const pts = (k) => data.map((s, i) => (s[k] == null ? null : `${X(i + off).toFixed(1)},${Y(s[k]).toFixed(1)}`)).filter(Boolean).join(' ');
      const last = data[data.length - 1];
      h += `<rect x="${L}" y="${top}" width="${R - L}" height="${bot - top}" fill="#0c0d10"/>` +
        `<text x="6" y="${top + 12}" fill="${l.color}" font-size="9.5" font-weight="700" font-family="Segoe UI,sans-serif">${l.label}</text>` +
        `<text x="6" y="${top + 25}" fill="#aab0b8" font-size="9">${last ? l.show(last[l.k]) : '--'}</text>` +
        (l.t && last && last[l.t] != null ? `<text x="${W - 4}" y="${top + 25}" fill="#6f757d" font-size="8.5" text-anchor="end">tgt ${l.show(last[l.t])}</text>` : '') +
        `<text x="${W - 4}" y="${top + 12}" fill="#5d636b" font-size="8" text-anchor="end">${l.hi}</text>`;
      if (l.t) h += `<polyline points="${pts(l.t)}" fill="none" stroke="#e6e8eb" stroke-opacity=".45" stroke-width="1" stroke-dasharray="3,2"/>`;
      h += `<polyline points="${pts(l.k)}" fill="none" stroke="${l.color}" stroke-width="1.3" stroke-linejoin="round"/>`;
    });
    // knock events as ticks across every lane
    data.forEach((s, i) => { if (s.knock) h += `<line x1="${X(i + (shown ? 0 : n - data.length)).toFixed(1)}" x2="${X(i + (shown ? 0 : n - data.length)).toFixed(1)}" y1="2" y2="${lanes.length * LH}" stroke="#ff5a3c" stroke-opacity=".35"/>`; });
    h += `<text x="${L}" y="${lanes.length * LH + 12}" fill="#5d636b" font-size="8.5">${shown ? '0 s' : '-30 s'}</text><text x="${R}" y="${lanes.length * LH + 12}" fill="#5d636b" font-size="8.5" text-anchor="end">${shown ? (data.length / 10).toFixed(1) + ' s' : 'now'}</text>`;
    svg.innerHTML = h;
    // cylinders
    const box = root.querySelector('[data-cyls]');
    if (box) box.innerHTML = cyl.map((k, n2) => `<div class="ct-cyl" data-dead="${k.dead}"><b>CYL ${n2 + 1}</b>` +
      (E.fuel === 'petrol'
        ? `<div class="bar" title="Knock retard"><i style="height:${k.retard * 10}%"></i></div><small>${k.retard.toFixed(1)}° pulled</small><small>${k.knocks} knock</small>`
        : `<div class="bar" title="Injector balance"><i style="height:${clamp(50 + (k.balance + wearOf('injectors') * 0.02 * (n2 === weakCyl ? 1 : 0.3)) * 50, 0, 100)}%;background:#4fa8ff"></i></div><small>${(k.balance + wearOf('injectors') * 0.02 * (n2 === weakCyl ? 1 : 0.3)).toFixed(2)} mg</small><small>${k.knocks} overload</small>`) +
      `<small>${k.misfires} misfire</small><small style="color:${k.damage > 50 ? '#ff5a3c' : k.damage > 10 ? '#ffb020' : '#6f757d'}">${k.dead ? 'DEAD' : (100 - k.damage).toFixed(0) + '% health'}</small></div>`).join('');
  }
  function exportCsv(l) {
    const lanes = LANES(), keys = lanes.flatMap((x) => (x.t ? [x.k, x.t] : [x.k]));
    const t0 = l.samples[0].t;
    const rows = [['time_s', ...keys, 'knock'].join(',')].concat(l.samples.map((s) => [(s.t - t0).toFixed(2), ...keys.map((k) => (s[k] == null ? '' : +(+s[k]).toFixed(3))), s.knock ? 1 : 0].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `${(S.slug || 'car')}-log-${l.n}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Guide ----
  function buildGuide(body) {
    body.innerHTML = `<div class="ct-guide">${E.fuel === 'diesel' ? GUIDE_DIESEL() : GUIDE_PETROL()}${GUIDE_COMMON()}</div>`;
  }
  const GUIDE_DIESEL = () => `
    <h3>How a diesel makes power</h3>
    <p>A diesel has no throttle: the pedal asks for <b>fuel</b>, and fuel is what makes torque. The catch is that every gram of fuel needs about 14.5 g of air to burn. Below a lambda of about 1.15 there isn't enough air, so the extra fuel comes out as <b>black smoke</b> and <b>heat</b> instead of power. That makes diesel tuning a balance between <b>fuel</b> and <b>air</b> (boost), with <b>injection timing</b> and <b>rail pressure</b> deciding how well the fuel burns.</p>
    <h3>What you can tune</h3>
    <table><tr><th>Map / setting</th><th>What it does</th><th>Gain</th><th>Risk · what to watch</th></tr>
      <tr><td><b>Fuel (IQ)</b></td><td>Fuel per stroke at full load, % of stock</td><td>The main torque lever: +15-20% is a typical stage 1</td><td>Smoke, EGT. Watch <b>lambda</b> (keep it over 1.1) and <b>EGT</b> (under 800 °C)</td></tr>
      <tr><td><b>Boost</b></td><td>Turbo target pressure</td><td>More air lets more fuel burn cleanly</td><td>Turbo overspeed past its limit line, hotter intake air, more <b>cylinder pressure</b></td></tr>
      <tr><td><b>Injection timing</b></td><td>Start of injection, degrees of advance</td><td>+1.5 to 3° gives torque and <b>lowers</b> EGT</td><td>Cylinder pressure and a harsher clatter. Over ${pcpLimit()} bar damages pistons and the head gasket</td></tr>
      <tr><td><b>Rail pressure</b></td><td>Common-rail pressure</td><td>Finer spray: cleaner burn, more fuel through the injector</td><td>The HP pump must hold it. Watch <b>rail vs target</b>; injectors wear faster</td></tr>
      <tr><td><b>Smoke limiter</b></td><td>The lowest lambda the ECU allows</td><td>Lower means more fuel before the boost arrives</td><td>Smoke on every throttle stab, DPF fills fast</td></tr>
      <tr><td><b>Torque limiter</b></td><td>Caps engine torque</td><td>Raise it or the other maps hit a wall</td><td>The <b>gearbox</b>: past its rating the clutch packs slip</td></tr>
      <tr><td><b>Pilot injection</b></td><td>A small pre-injection that softens combustion</td><td>None worth having</td><td>Off = louder, rougher, higher peak pressure</td></tr>
      <tr><td><b>EGR / DPF functions</b></td><td>Emissions systems</td><td>EGR off keeps the intake clean; a freer DPF breathes better</td><td>A removed part with its function still on = fault + limp mode. Emissions deletes are for off-road use only - illegal on public roads in most countries</td></tr>
    </table>
    <h3>Your first diesel tune</h3>
    <ol>
      <li>Warm the engine up. Open the <b>Dyno</b> tab, turn on Dyno mode, roll into <b>4th</b> at about 1,200 rpm, press Space and floor it to the limiter. That's your <b>stock baseline</b>.</li>
      <li>Load <b>Stage 1</b> into Map 2, switch to Map 2 (key 2) and do the same pull with the <b>Datalog</b> recording.</li>
      <li>Read the log: <b>boost</b> should sit on its dashed target line, <b>lambda</b> should stay over ~1.1, <b>rail</b> should track its target, and <b>EGT</b> should stay under 800 °C.</li>
      <li>Want more? Add fuel <b>a few % at a time</b> where lambda is still high (usually mid-range), and a little boost to match. When smoke or EGT climbs, stop adding fuel and look at boost, injection timing or hardware.</li>
      <li>Raise the <b>torque limiter</b> to just above your target, and stay under the gearbox's rating unless the clutch packs are uprated.</li>
      <li>When lambda goes under 1.1 and EGT nears 800 °C, you've reached what the stock turbo can support: a bigger intercooler, then a hybrid turbo, injectors and pump are the next steps.</li>
    </ol>
    <h3>What wears, and why</h3>
    <ul>
      <li><b>DPF soot</b> fills with smoke and mileage and burns off on long fast drives. At 60% the ECU starts a regeneration at motorway speed. Run one from <b>Diagnostics → DPF regeneration</b>. Full = limp mode.</li>
      <li><b>EGR valve</b> soots up at part load, faster with a smoky tune.</li>
      <li><b>Injectors</b> wear with rail pressure. Worn ones drift out of balance: rough running, smoke and misfires (see the cylinder balance in the Datalog).</li>
      <li><b>HP pump</b> wears when it can't hold rail pressure. <b>Turbo</b> wears past its limit line and on hot exhaust. <b>Glow plugs</b> wear with cold starts.</li>
      <li><b>Pistons</b> take damage from cylinder pressure over the limit and EGT over 850 °C. Each overload event is a knock you can hear. A destroyed cylinder means limp mode and an engine rebuild.</li>
    </ul>`;
  const GUIDE_PETROL = () => `
    <h3>How a turbo petrol makes power</h3>
    <p>Power is <b>air</b>, and the turbo supplies it. The ECU matches fuel to the air (the <b>AFR</b>) and fires the spark at the best moment (<b>timing</b>). The limit is <b>knock</b>: under too much pressure and heat, the end-gas explodes instead of burning. The knock sensors hear it, and the ECU pulls timing on that cylinder to protect the pistons. Every tune trades boost and timing against the knock margin your <b>fuel</b> (octane), <b>intake temperature</b> and <b>AFR</b> give you.</p>
    <h3>What you can tune</h3>
    <table><tr><th>Map / setting</th><th>What it does</th><th>Gain</th><th>Risk · what to watch</th></tr>
      <tr><td><b>Boost</b></td><td>Turbo target pressure</td><td>The big lever: +0.3 bar ≈ +15% torque</td><td>Knock, intake temperature, turbo overspeed past its limit line</td></tr>
      <tr><td><b>Ignition timing</b></td><td>Spark advance over stock</td><td>Each degree nearer best torque ≈ +1-2%</td><td>Knock. Watch <b>knock retard</b> per cylinder; keep it under 3°</td></tr>
      <tr><td><b>Target AFR</b></td><td>Full-load mixture</td><td>Leaner is a touch stronger; richer is safer</td><td>Lean means hot, and knock. Watch AFR <b>actual vs target</b> - if actual goes leaner, the fuel system is maxed</td></tr>
      <tr><td><b>Knock control</b></td><td>Pulls timing on a knocking cylinder</td><td>-</td><td><b>Never turn it off</b> unless you want to watch detonation destroy a piston</td></tr>
      <tr><td><b>Torque limiter</b></td><td>Caps engine torque</td><td>Stock caps the ${esc(E.name.split(' ')[0])} at ${fmt(E.tq)} Nm</td><td>The gearbox: past its rating the clutch packs slip</td></tr>
      <tr><td><b>Burble</b></td><td>Fuel on the overrun for pops and bangs</td><td>Sound</td><td>Hot exhaust; cooks the catalyst on Sport and Max</td></tr>
      <tr><td><b>Limiters</b></td><td>Rev limit, speed limiter, launch rpm, shift point, shift speed</td><td>Vmax off lifts the 250 km/h limit</td><td>Revs past ${fmt(maxRpm())} rpm wear the engine; Race shifts wear the clutch packs</td></tr>
    </table>
    <h3>Fuel is your knock margin</h3>
    <p><b>RON 95</b> is what the stock tune expects, and it's already knock-limited on a hot day. <b>RON 98</b> gives about 2° more margin, <b>RON 102</b> about 5°, and <b>E85</b> about 9° (plus a cooler charge). E85 needs about 40% more fuel, though, so it needs a <b>port injection kit</b> and an <b>uprated pump</b>.</p>
    <h3>Your first petrol tune</h3>
    <ol>
      <li>Warm up, open <b>Dyno</b>, turn on Dyno mode, roll into <b>4th</b> at about 2,000 rpm and do a full pull. That's your <b>stock baseline</b>.</li>
      <li>Fill up with <b>RON 98</b> (Parts → Fuel), load <b>Stage 1</b> into Map 2, switch to it and pull again with the <b>Datalog</b> recording.</li>
      <li>Read the log: boost on target, <b>AFR 11.5-12.5</b> under boost, <b>knock retard under 3°</b>, IAT under ~60 °C, EGT under 950 °C.</li>
      <li>Retard but no damage means the ECU is saving you - take timing out where it pulls (the dashed knock-limit line in the timing map shows where), or run better fuel.</li>
      <li>Add boost <b>0.05-0.1 bar at a time</b>. When IAT climbs over repeated pulls, fit the big intercooler. When AFR goes leaner than target, the fuel system is maxed.</li>
      <li>Past ~1.5 bar the stock turbo is overspeeding up top: a hybrid turbo is the next step.</li>
    </ol>
    <h3>What wears, and why</h3>
    <ul>
      <li><b>Pistons</b> take detonation damage. With knock control on, the ECU retards timing and the damage is tiny. With it off, or on <b>pre-ignition</b> (low-rpm, high-boost knock, worse on old oil and low octane), each event can crack a piston. A destroyed cylinder means limp mode and a rebuild.</li>
      <li><b>Spark plugs</b> wear faster under boost; worn plugs misfire under load, and strain the <b>coils</b>.</li>
      <li><b>Turbo</b> wears past its limit line and on EGT over 980 °C. The <b>fuel pump</b> wears when it can't keep up. The <b>catalyst</b> cooks on misfires, hot exhaust and burbles.</li>
    </ul>`;
  const GUIDE_COMMON = () => `
    <h3>Building the engine</h3>
    <p>The factory internals are the real limit on a big tune. The stock con-rods take about <b>${fmt(E.rod)} Nm</b>. Past that they fatigue a little on every hard pull, and the "Needs attention" list warns you. Build the engine in <b>Parts → Engine internals</b>:</p>
    <table><tr><th>Internals</th><th>Damage taken</th><th>Rods good for</th><th>Safe revs</th></tr>
      <tr><td><b>Stock</b></td><td>all of it</td><td>~${fmt(E.rod)} Nm</td><td>${fmt(E.maxRpm)} rpm</td></tr>
      <tr><td><b>Forged</b> pistons, rods, head studs</td><td>~30%</td><td>~${fmt(E.rod * 1.5)} Nm</td><td>${fmt(E.maxRpm + 400)} rpm</td></tr>
      <tr><td><b>Fully built</b>: billet crank, race bearings, lower compression</td><td>~12%</td><td>~${fmt(E.rod * 2)} Nm</td><td>${fmt(E.maxRpm + 800)} rpm</td></tr>
    </table>
    <p>Fitting new internals puts in a fresh short block, which also repairs any damage. A built engine still wears; it just takes far more abuse first.</p>
    <h3>When it goes bad - and when it lets go</h3>
    <p>Everything a hard tune does to the engine shows up in <b>Servicing</b>. <b>Engine</b> is general wear: torque over stock, hot exhaust, running lean, over-revving, overheating. <b>Pistons</b> is the worst cylinder's damage from ${E.fuel === 'petrol' ? 'detonation and pre-ignition' : 'cylinder pressure and exhaust heat'}. Low oil starves the bottom end on top of that.</p>
    <ul>
      <li>Past about <b>55%</b> you'll hear a <b>rod knock</b>: once per revolution, louder under load. At 70% the dashboard warns of engine noise.</li>
      <li>Past about <b>85%</b> every hard pull at high revs is a gamble, and more so with a dead cylinder. A cylinder that fails under full load usually takes the engine with it.</li>
      <li>When it <b>lets go</b>, a rod goes through the block: a bang, shrapnel, smoke pouring off it, and the engine dies on the spot. It won't turn over again - just a starter clunk - until you <b>repair the Engine</b> or <b>service the Pistons</b>, which rebuilds it.</li>
    </ul>
    <h3>Cooling and oil</h3>
    <p>Every bit of fuel burned puts heat into the coolant: roughly a third of it. The radiator sheds heat with airflow (road speed, then the fan), and only once the thermostat opens. A stock engine flat out at speed sits just above its ${E.tstat} °C thermostat. A tune that makes more power puts in more heat than the stock radiator can shed, and knock-retarded or lean running adds more. "Needs attention" shows where it settles.</p>
    <ul>
      <li><b>Past 108 °C</b> the ECU pulls power. <b>Past 110 °C</b> it logs an overheat (P0217). <b>Past 120 °C</b> the head gasket and pistons start taking damage.</li>
      <li><b>Oil</b> runs 20-30 °C over the coolant when worked hard. Past ~110 °C it thins and oil pressure sags; past 130 °C it breaks down fast. Low oil pressure wears the bearings, which brings on the rod knock.</li>
      <li><b>Parts:</b> an aluminium or race radiator (+25 / +50% cooling), a high-flow water pump, a lower-temperature thermostat (cooler, slower to warm up), a big oil cooler, and a high-volume oil pump. Radiator fins clog, the water pump and thermostat wear out, and a worn oil pump loses pressure - all in Servicing → Cooling and Lubrication.</li>
    </ul>
    <h3>Brakes</h3>
    <p>The discs heat with every stop (~60 °C from 100 km/h) and cool with airflow. Past the pads' <b>fade</b> point (~450 °C stock) they grip less. Brake fluid soaks up moisture with age: wet fluid boils far lower. When the fluid boils the pedal goes long and you lose about half your braking. Upgrade the pads (sport ~600 °C, race ~780 °C - but grabby cold), discs (slotted, two-piece floating), a big brake kit, and racing fluid (boils at ~310 °C). Worn discs and dampers also lengthen stopping distances.</p>
    <h3>Gearbox</h3>
    <p>The <b>Gearbox</b> view sets every gear's <b>ratio</b>, its own full-throttle <b>shift point</b>, and its own <b>torque limit</b>. The gearing chart shows where each upshift lands. Keep the drops inside the shaded torque band, shorten the ratios for acceleration, lengthen 7th and 8th for top speed, and cap 1st and 2nd if the tyres can't take the torque. The final drive (Parts) shifts every gear at once.</p>
    <h3>Valvetrain</h3>
    <p><b>Cams</b> trade bottom end for top end. Race cams on stock <b>valve springs</b> float the valves ~400 rpm early, so fit uprated springs with them. Springs fatigue with high-rev use and float sooner as they do. The <b>timing chain</b> stretches with miles, revs and old oil: it rattles at idle past ~60%, logs P0016 past 75%, and at 100% it can jump a tooth under load - valves into pistons.</p>
    <h3>Map 1 and Map 2</h3>
    <p>Two complete calibrations, switched with the car's own <b>1</b> and <b>2</b> keys or the Map buttons. Keep a safe one and an aggressive one - or stock and your tune, to compare on the dyno. Parts belong to the car, so they apply to both.</p>
    <h3>Limp mode</h3>
    <p>With <b>ECU protections</b> on, a serious fault (a dead turbo, overheated exhaust, a destroyed cylinder, a missing DPF or EGR the ECU still expects, a slipping gearbox) caps boost and revs to save the engine. Fix the cause and cycle the ignition. With protections off there's no safety net.</p>
    <h3>Diagnostics</h3>
    <p>The <b>Diagnostics</b> tab reads every fault this page can set, shows the ECU's live data, and runs service functions: ${E.fuel === 'diesel' ? 'a DPF regeneration, injector balance and compression tests' : 'a compression test, misfire counters and resetting the knock adaptation'}. Every change - tunes, parts, services, refuels, faults - goes into the <b>History</b> tab, and you can restore the car to any point there.</p>
    <h3>Fault codes you may see</h3>
    <table><tr><th>Code</th><th>Meaning</th></tr>
      ${Object.entries(FAULTS).filter(([k, f]) => k !== 'LIMP' && !/^P030[2-8]/.test(k) && (!f.fuel || f.fuel === E.fuel)).map(([k, f]) => `<tr><td><code>${k === 'P0301' ? 'P0301-6' : k}</code></td><td>${esc(k === 'P0301' ? 'Misfire in that cylinder' : f.title)}</td></tr>`).join('')}
      ${WEAR[E.fuel].filter((d) => !FAULTS[d.code]).map((d) => `<tr><td><code>${d.code}</code></td><td>${esc(d.title)}</td></tr>`).join('')}
    </table>`;

  // ================= diagnostics hooks (car-diagnostics.js) =================
  api.pids = () => {
    const c = ch, pet = E.fuel === 'petrol';
    const row = (label, value, warn = '') => ({ label, value, warn });
    const rows = [
      row('Engine speed', fmt(c.rpm) + ' rpm'),
      row('Boost actual / target', `${c.boost.toFixed(2)} / ${c.boostT.toFixed(2)} bar`, c.boostT - c.boost > 0.4 && c.load > 0.8 ? 'warn' : ''),
      row('Intake air temp', c.iat.toFixed(0) + ' °C', c.iat > 65 ? 'bad' : c.iat > 50 ? 'warn' : ''),
      row('Exhaust gas temp', fmt(c.egt) + ' °C', c.egt > (pet ? 950 : 800) ? 'bad' : c.egt > (pet ? 900 : 720) ? 'warn' : ''),
    ];
    if (pet) {
      rows.push(row('AFR actual / target', c.afr == null ? 'fuel cut' : `${c.afr.toFixed(1)} / ${(c.afrT ?? c.afr).toFixed(1)}`, c.afr && c.afrT && c.afr - c.afrT > 0.6 ? 'bad' : ''),
        row('Ignition timing ±', (c.timing >= 0 ? '+' : '') + c.timing.toFixed(1) + '°'),
        row('Knock retard (max cyl)', c.retard.toFixed(1) + '°', c.retard > 5 ? 'bad' : c.retard > 2.5 ? 'warn' : ''),
        row('Fuel rail pressure', fmt(c.rail) + ' bar', c.rail < c.railT - 40 ? 'bad' : ''),
        row('Injector duty', c.duty.toFixed(0) + ' %', c.duty > 90 ? 'warn' : ''),
        row('Knock adaptation', adapt < 0.999 ? `-${((1 - adapt) * 100).toFixed(0)}% boost` : 'none', adapt < 0.95 ? 'warn' : ''),
        row('Fuel', part('fuel') === 'e85' ? 'E85' : 'RON ' + part('fuel')));
    } else {
      rows.push(row('Injection quantity', c.iq.toFixed(1) + ' mg/stroke'),
        row('Lambda', c.lambda == null ? 'fuel cut' : c.lambda.toFixed(2), c.lambda && c.lambda < 1.1 ? 'bad' : c.lambda && c.lambda < 1.18 ? 'warn' : ''),
        row('Rail actual / target', `${fmt(c.rail)} / ${fmt(c.railT)} bar`, c.rail < c.railT - 60 ? 'bad' : ''),
        row('Injection timing ±', (c.soi >= 0 ? '+' : '') + c.soi.toFixed(1) + '°'),
        row('Peak cylinder pressure', fmt(c.pcp) + ' bar', c.pcp > pcpLimit() ? 'bad' : c.pcp > pcpLimit() - 15 ? 'warn' : ''),
        row('Smoke opacity', c.smoke.toFixed(0) + ' %', c.smoke > 40 ? 'warn' : ''),
        row('DPF soot load', fx.dpf ? Math.round(wearOf('dpf')) + ' %' + (regen > 0 || forcedRegen > 0 ? ' · regenerating' : '') : 'removed', wearOf('dpf') > 80 ? 'bad' : wearOf('dpf') > 60 ? 'warn' : ''));
    }
    const tstat = E.tstat + fx.tstat;
    rows.push(row('Coolant temp', c.coolT.toFixed(0) + ' °C' + (fanOn ? ' · fan on' : ''), c.coolT > 110 ? 'bad' : c.coolT > tstat + 12 ? 'warn' : ''),
      row('Oil temp', c.oilT.toFixed(0) + ' °C', c.oilT > 135 ? 'bad' : c.oilT > 125 ? 'warn' : ''),
      row('Oil pressure', Math.round(c.oilP * 100) + ' % of normal', c.oilP < 0.6 ? 'bad' : c.oilP < 0.8 ? 'warn' : ''));
    if (window.CarService && CarService.brakeTemp) rows.push(row('Brake discs', Math.round(CarService.brakeTemp()) + ' °C', CarService.brakeTemp() > 600 ? 'bad' : CarService.brakeTemp() > 450 ? 'warn' : ''));
    const doom = c.doom || 0;
    rows.push(row('Engine condition', blown ? 'SEIZED' : `${Math.round(doom * 100)}% worn` + (doom > 0.55 ? ' · rod knock' : ''), blown || doom > 0.85 ? 'bad' : doom > 0.55 ? 'warn' : ''),
      row('Calibration', `Map ${slot} · ${cal().name}`), row('Limp mode', limp ? 'ACTIVE (' + limp + ')' : 'off', limp ? 'bad' : ''));
    return rows;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  api.functions = () => {
    const f = [
      { id: 'compression', label: 'Compression test', run: async (out) => {
        out('> Cranking with injection disabled...', 'hi');
        for (let n = 0; n < E.cyl; n++) {
          await sleep(350);
          const k = cyl[n], pct = k.dead ? 8 + Math.random() * 6 : 100 - k.damage * 0.7 - Math.random() * 2;
          out(`    Cylinder ${n + 1}   ${pct.toFixed(0).padStart(3)}%   ${k.dead ? 'FAIL' : pct < 80 ? 'LOW ' : 'OK  '}`, k.dead ? 'err' : pct < 80 ? 'warn' : 'ok');
        }
      } },
      { id: 'adapt', label: 'Reset adaptations', run: async (out) => {
        out('> Resetting knock, boost and fuel trim adaptations...', 'hi');
        await sleep(700);
        adapt = 1; cyl.forEach((k) => { k.retard = 0; });
        out('    Adaptations reset. The ECU relearns on the next drive.', 'ok');
        log('tune', 'ECU adaptations reset');
      } },
    ];
    if (E.fuel === 'petrol') {
      f.push({ id: 'misfire', label: 'Misfire counters', run: async (out) => {
        out('> Reading misfire and knock counters...', 'hi');
        await sleep(500);
        cyl.forEach((k, n) => out(`    Cylinder ${n + 1}   misfires ${String(k.misfires).padStart(4)}   knock ${String(k.knocks).padStart(5)}`, k.misfires > 20 || k.knocks > 200 ? 'warn' : ''));
      } });
    } else {
      f.push({ id: 'balance', label: 'Injector balance test', run: async (out) => {
        out('> Idle balance: injection corrections per cylinder...', 'hi');
        await sleep(600);
        cyl.forEach((k, n) => {
          const v = k.balance + wearOf('injectors') * 0.02 * (n === weakCyl ? 1 : 0.3);
          out(`    Injector ${n + 1}   ${(v >= 0 ? '+' : '') + v.toFixed(2)} mg   ${Math.abs(v) > 1.5 ? 'OUT OF LIMIT' : Math.abs(v) > 1 ? 'HIGH' : 'OK'}`, Math.abs(v) > 1.5 ? 'err' : Math.abs(v) > 1 ? 'warn' : 'ok');
        });
      } }, { id: 'regen', label: 'DPF regeneration', run: async (out) => {
        if (!fx.dpf) return out('    No particulate filter fitted.', 'warn');
        if (!wasOn) return out('    Engine must be running.', 'err');
        out(`> Forced regeneration at ${Math.round(wearOf('dpf'))}% soot - raising exhaust temperature...`, 'hi');
        log('regen', `Forced DPF regeneration started at ${Math.round(wearOf('dpf'))}% soot`);
        forcedRegen = 1;
        for (let s = 0; s < 120 && wearOf('dpf') > 5 && wasOn; s++) {
          await sleep(500);
          burnSoot(1.6);
          if (s % 4 === 0) out(`    EGT ${fmt(egtNow)} °C · soot ${Math.round(wearOf('dpf'))}%`);
        }
        forcedRegen = 0;
        out(wasOn ? '    Regeneration complete.' : '    Aborted: engine stopped.', wasOn ? 'ok' : 'err');
        if (wasOn) log('regen', `Forced DPF regeneration complete (${Math.round(wearOf('dpf'))}% soot)`);
      } });
    }
    return f;
  };

  window.CarTune = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
