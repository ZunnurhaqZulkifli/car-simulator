// Handling, injected after car-tune.js on every car page. The chassis parts (tyres, suspension, anti-roll bars,
// alignment, aero, differential, bracing, steering rack, brake bias valve) and their setup - pressures, camber, toe,
// springs, bars, dampers, ride height, splitter and wing, brake bias, diff locking, steering ratio - live in the
// Handling tab and save with the car as { handling }. What they come to is CarHandling.hd, relative to the car's own
// stock chassis (1 = as delivered), which drive.html's tyre model reads every frame:
//   front / rear  each axle's lateral grip, lat(v) what the car corners at (the weaker axle limits it)
//   aeroF / aeroR the grip an axle gains at 200 km/h from downforce (x (v / 55.6)^2), cda the extra drag area m^2
//   response      how quickly the car answers the wheel, ratio the rack's speed (15:1 = 1)
//   kRoll / kPitch / zeta / drop  body roll and pitch stiffness, damping, ride height (m) - drop also lowers the CG (dh)
//   bias / biasRot  front brake share, and how much further back than stock (rotation on the brakes)
//   lsd / coast   diff lock on power / overrun 0-1, wet: how much the tyres lose on a wet road (1 = road tyres)
//   stiffF / stiffR the tyres' cornering stiffness, traction / brake the car page's launch grip and braking
//   damperWear    how fast the Servicing tab's dampers wear
// The car page gets traction through CarTune's T.grip (or reads hd.traction itself) and braking through
// CarService.brakeMul. CarHandling.onChange(fn) hears every change.
(() => {
  const S = window.__CAR_STATE__ || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n, dp = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sgn = (n, dp = 0) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n), dp);
  const log = (summary) => { if (window.CarAPI && CarAPI.log) CarAPI.log('tune', summary); };

  // ================= the stock chassis, as drive.html drives it =================
  // tyre grip g, kg, the front's share of the weight, the rear's of the drive, CG height m, wheelbase m
  const BASES = {
    'bmw-x1-xdrive20d': [1.6, 1650, 0.53, 0.6, 0.6, 2.76],
    'bmw-m3-touring': [2.4, 1850, 0.52, 0.75, 0.52, 2.857],
    'bmw-m5-cs': [2.4, 1825, 0.53, 0.75, 0.52, 2.982],
    'bmw-140i': [2.2, 1600, 0.54, 0.6, 0.52, 2.69],
    'bmw-320d': [1.6, 1550, 0.49, 1, 0.52, 2.81],
    'bmw-550d-mk2': [2.2, 1950, 0.53, 0.6, 0.52, 2.975],
    'bmw-530e': [2.2, 1950, 0.53, 0.6, 0.52, 2.975],
    'bmw-m5-e60': [2.0, 1830, 0.52, 1, 0.52, 2.889],
    'porsche-911-gt3-rs': [2.8, 1420, 0.39, 1, 0.45, 2.453],
    'bmw-335i-e90': [1.9, 1600, 0.51, 1, 0.52, 2.76],
    'honda-nsx-r': [2.2, 1230, 0.42, 1, 0.42, 2.53],
    'nissan-gt-r-nismo': [2.4, 1720, 0.54, 0.7, 0.48, 2.78],
    'bmw-550d': [2.0, 1940, 0.53, 0.6, 0.52, 2.968], // (not on the driving page)
    'proton-iriz': [0.95, 1100, 0.62, 0, 0.55, 2.555], // front-wheel drive
  };
  const [GRIP0, MASS, FRONT, DRIVE, H0, WB] = BASES[S.slug] || [1.8, 1600, 0.52, 1, 0.52, 2.8];
  const LAYOUT = DRIVE === 0 ? 'FWD' : DRIVE === 1 ? 'RWD' : 'AWD';
  const Q200 = 0.5 * 1.225 * 55.6 ** 2; // dynamic pressure at 200 km/h, Pa
  const BSTAR = FRONT + H0 / WB * 0.9; // the brake bias that locks both axles together at ~0.9 g
  const STOCK_BIAS = Math.round(clamp(BSTAR + 0.02, 0.45, 0.85) * 100); // factories sit a touch forward of it

  // ================= parts =================
  const opt = (id, label, desc, fx = {}) => ({ id, label, desc, fx });
  const PARTS = [
    { k: 'tyres', label: 'Tyres', opts: [
      opt('road', 'Road', 'The factory performance tyres: good everywhere, best nowhere.', { tyre: { grip: 1, wet: 1, pOpt: 2.4, resp: 1 } }),
      opt('sport', 'Ultra-high perf.', 'Stickier compound, stiffer sidewall: ~6% more grip and a crisper turn-in, still fine in the rain.', { tyre: { grip: 1.06, wet: 1.05, pOpt: 2.3, resp: 1.06 } }),
      opt('cup', 'Cup semi-slick', 'Track-day semi-slicks: ~14% more grip, sharp responses - but shallow tread aquaplanes. Poor in the rain.', { tyre: { grip: 1.14, wet: 1.5, pOpt: 2.0, resp: 1.12 } }),
      opt('slick', 'Racing slick', 'No tread at all: ~24% more grip in the dry - treacherous on a wet road, hopeless in snow.', { tyre: { grip: 1.24, wet: 2.3, pOpt: 1.8, resp: 1.18 } }),
      opt('winter', 'Winter', 'Soft, siped compound: ~8% less dry grip, far more on a wet or snowy road.', { tyre: { grip: 0.92, wet: 0.5, pOpt: 2.5, resp: 0.9 } }),
      opt('drift', 'Drift (hard rear)', 'Sport fronts on hard-compound rears: the tail lets go early and slides predictably.', { tyre: { grip: 1.04, rear: 0.86, wet: 1.1, pOpt: 2.4, resp: 1.04 } })] },
    { k: 'suspension', label: 'Suspension', opts: [
      opt('stock', 'Stock', 'Factory springs and dampers: fixed, tuned for comfort.', { spr: 100, drop: 0, dampD: 0.45, dw: 1 }),
      opt('lowering', 'Lowering springs', '25 mm lower on 25% stiffer springs over the stock dampers: less roll, a lower CG - and a little bouncy. Not adjustable.', { spr: 125, drop: 25, dampD: 0.45, dw: 1.15 }),
      opt('sport', 'Sport kit', 'Matched springs and dampers 20 mm lower (+35%), with 10-click adjustable damping.', { spr: 135, drop: 20, damp: [1, 10], dw: 0.9 }),
      opt('coilovers', 'Coilovers', 'Threaded coilovers: ride height and spring rate per axle, 16-click damping (bump and rebound together).', { spr: [70, 220], drop: [0, 60], damp: [1, 16], dw: 1.3 }),
      opt('race', 'Race 2-way', 'Remote-reservoir 2-way coilovers: separate bump and rebound (24 clicks each), the widest spring and height range. Harsh on the road.', { spr: [70, 320], drop: [0, 80], damp: [1, 24], twoWay: true, dw: 1.6 })] },
    { k: 'arb', label: 'Anti-roll bars', opts: [
      opt('stock', 'Stock', 'Factory bars, fixed.', {}),
      opt('adjustable', 'Adjustable', 'Thicker hollow bars, 5 holes each end (2-6): shift the balance front to rear.', { arb: [2, 6] }),
      opt('race', 'Race blade', 'Blade-adjustable race bars, 9 settings each end: the widest balance range.', { arb: [1, 9] })] },
    { k: 'alignment', label: 'Alignment', opts: [
      opt('stock', 'Stock arms', 'Toe adjusts on the factory arms; camber only by about half a degree.', {}),
      opt('camber', 'Camber kit', 'Camber plates and adjustable arms: up to -4.5° of camber and a wider toe range.', { cam: true, toe: 0.6 })] },
    { k: 'aero', label: 'Aero', opts: [
      opt('none', 'Stock', 'The body as delivered.', {}),
      opt('lip', 'Front lip', 'A carbon lip spoiler: ~30 kg on the nose at 200 km/h.', { clF: 0.14 }),
      opt('kit', 'Lip + ducktail', 'Lip and a ducktail spoiler: ~30 / 40 kg at 200 km/h, front / rear. Fixed.', { clF: 0.14, clR: 0.2 }),
      opt('gt', 'Splitter + GT wing', 'An adjustable splitter and a swan-neck GT wing: up to ~270 kg at 200 km/h - at the cost of drag.', { splitter: true, wing: true })] },
    { k: 'diff', label: 'Differential', opts: [
      opt('stock', 'Stock', 'The factory differential.', {}),
      opt('lsd', 'Clutch-pack LSD', '1.5-way plated LSD: set how hard it locks on the power and on the overrun.', { lsd: true }),
      opt('spool', 'Welded (spool)', 'Both driven wheels locked together: endless, easy drifts - and push into every corner.', { spool: true })] },
    { k: 'brace', label: 'Chassis bracing', opts: [
      opt('stock', 'Stock', 'The bare shell.', { brace: 0 }),
      opt('struts', 'Strut braces', 'Front and rear strut braces: the suspension mounts flex less - sharper turn-in.', { brace: 1 }),
      opt('cage', 'Bolt-in cage', 'A bolt-in roll cage tied to the strut tops: the stiffest shell, the most precise car (and a harder ride).', { brace: 2 })] },
    { k: 'rack', label: 'Steering rack', opts: [
      opt('stock', 'Stock', 'The factory 15:1 ratio.', {}),
      opt('quick', 'Quick rack', 'A shorter-ratio rack you can set from 11:1 to 17:1: fewer turns lock to lock.', { ratio: [11, 17] })] },
    { k: 'bias', label: 'Brake bias', opts: [
      opt('stock', 'Fixed', 'The factory proportioning valve.', {}),
      opt('valve', 'Bias valve', 'An adjustable proportioning valve: move the braking front to rear.', { bias: [45, 85] })] },
  ];
  const partOf = (k) => PARTS.find((p) => p.k === k);
  const fxOf = (parts) => Object.assign({}, ...PARTS.map((p) => (p.opts.find((o) => o.id === parts[p.k]) || p.opts[0]).fx));
  const STOCK_PARTS = Object.fromEntries(PARTS.map((p) => [p.k, p.opts[0].id]));

  // ================= setup: each value's range on the fitted parts - [min, max], or the one value it's fixed at =================
  const clicks = (f) => (f.damp ? Math.round(1 + 0.45 * (f.damp[1] - 1)) : 0);
  const SET = [
    { k: 'pF', span: [1.6, 3.2], g: 'Tyres', label: 'Front pressure', unit: ' bar', dp: 2, step: 0.05, stock: 2.3, range: () => [1.6, 3.2] },
    { k: 'pR', span: [1.6, 3.2], g: 'Tyres', label: 'Rear pressure', unit: ' bar', dp: 2, step: 0.05, stock: 2.5, range: () => [1.6, 3.2] },
    { k: 'camF', span: [-4.5, 0], g: 'Alignment', label: 'Front camber', unit: '°', dp: 1, step: 0.1, stock: -0.8, range: (f) => (f.cam ? [-4.5, 0] : [-1.3, -0.3]), need: 'Camber kit: past ±0.5°' },
    { k: 'camR', span: [-4.5, 0], g: 'Alignment', label: 'Rear camber', unit: '°', dp: 1, step: 0.1, stock: -1.4, range: (f) => (f.cam ? [-4.5, 0] : [-1.9, -0.9]), need: 'Camber kit: past ±0.5°' },
    { k: 'toeF', span: [-0.6, 0.6], g: 'Alignment', label: 'Front toe', unit: '°', dp: 2, step: 0.02, stock: 0.04, range: (f) => [-(f.toe || 0.3), f.toe || 0.3] },
    { k: 'toeR', span: [-0.6, 0.6], g: 'Alignment', label: 'Rear toe', unit: '°', dp: 2, step: 0.02, stock: 0.16, range: (f) => [-(f.toe || 0.3), f.toe || 0.4] },
    { k: 'sprF', span: [70, 320], g: 'Springs & bars', label: 'Front springs', unit: ' %', dp: 0, step: 5, stock: 100, range: (f) => f.spr ?? 100, need: 'Coilovers' },
    { k: 'sprR', span: [70, 320], g: 'Springs & bars', label: 'Rear springs', unit: ' %', dp: 0, step: 5, stock: 100, range: (f) => f.spr ?? 100, need: 'Coilovers' },
    { k: 'arbF', span: [1, 9], g: 'Springs & bars', label: 'Front anti-roll bar', unit: '', dp: 0, step: 1, stock: 3, range: (f) => f.arb || 3, need: 'Adjustable bars' },
    { k: 'arbR', span: [1, 9], g: 'Springs & bars', label: 'Rear anti-roll bar', unit: '', dp: 0, step: 1, stock: 3, range: (f) => f.arb || 3, need: 'Adjustable bars' },
    { k: 'bump', span: [1, 24], g: 'Dampers', label: 'Bump', unit: '', dp: 0, step: 1, stock: clicks, range: (f) => f.damp || 0, need: 'Sport kit or coilovers' },
    { k: 'reb', span: [1, 24], g: 'Dampers', label: 'Rebound', unit: '', dp: 0, step: 1, stock: clicks, range: (f) => (f.twoWay ? f.damp : 0), need: 'Race 2-way' },
    { k: 'rhF', span: [0, 80], g: 'Ride height', label: 'Front drop', unit: ' mm', dp: 0, step: 1, stock: 0, range: (f) => f.drop ?? 0, need: 'Coilovers' },
    { k: 'rhR', span: [0, 80], g: 'Ride height', label: 'Rear drop', unit: ' mm', dp: 0, step: 1, stock: 0, range: (f) => f.drop ?? 0, need: 'Coilovers' },
    { k: 'splitter', span: [0, 10], g: 'Aero', label: 'Splitter', unit: '', dp: 0, step: 1, stock: 0, range: (f) => (f.splitter ? [0, 10] : 0), need: 'Splitter + GT wing' },
    { k: 'wing', span: [0, 15], g: 'Aero', label: 'Wing angle', unit: '°', dp: 0, step: 1, stock: 0, range: (f) => (f.wing ? [0, 15] : 0), need: 'Splitter + GT wing' },
    { k: 'bias', span: [45, 85], g: 'Brakes', label: 'Brake bias', unit: ' % F', dp: 0, step: 1, stock: STOCK_BIAS, range: (f) => f.bias || STOCK_BIAS, need: 'Bias valve' },
    { k: 'lsdP', span: [0, 100], g: 'Differential', label: 'Power lock', unit: ' %', dp: 0, step: 5, stock: 25, range: (f) => (f.spool ? 100 : f.lsd ? [0, 90] : 25), need: 'Clutch-pack LSD' },
    { k: 'lsdC', span: [0, 100], g: 'Differential', label: 'Coast lock', unit: ' %', dp: 0, step: 5, stock: 10, range: (f) => (f.spool ? 100 : f.lsd ? [0, 70] : 10), need: 'Clutch-pack LSD' },
    { k: 'ratio', span: [11, 17], g: 'Steering', label: 'Steering ratio', unit: ':1', dp: 1, step: 0.5, stock: 15, range: (f) => f.ratio || 15, need: 'Quick rack' },
  ];
  const DEF = Object.fromEntries(SET.map((d) => [d.k, d]));
  const stockOf = (d, f) => (typeof d.stock === 'function' ? d.stock(f) : d.stock);
  const STOCK_SETUP = Object.fromEntries(SET.map((d) => [d.k, stockOf(d, fxOf(STOCK_PARTS))]));
  // a value as the fitted parts have it: clamped to an adjustable range, or what a fixed part sets
  function resolve(k, f, s) {
    const d = DEF[k], r = d.range(f);
    if (!Array.isArray(r)) return r;
    const v = s[k] ?? stockOf(d, f);
    return clamp(Math.round(v / d.step) * d.step, r[0], r[1]);
  }

  // ================= the model: the setup as a car on its tyres =================
  // Each axle's grip: the compound, its pressure against the compound's optimum, camber against the angle that keeps
  // the leaning outside tyre flat (more roll wants more), how much of the cornering load transfer that axle takes
  // (the stiffer end takes more and loses more - the balance), the platform (too soft rolls the tyres over, too stiff
  // skips), damping, bottoming out, toe and rake. Downforce adds to an axle's grip as its share of the weight.
  function calc(parts, s) {
    const f = fxOf(parts), t = f.tyre || { grip: 1, wet: 1, pOpt: 2.4, resp: 1 }, v = (k) => resolve(k, f, s);
    const kF = v('sprF') / 100, kR = v('sprR') / 100, kAvg = (kF + kR) / 2, bar = (n) => 0.5 + 0.25 * (n - 1);
    const KF = 0.6 * kF + 0.4 * bar(v('arbF')), KR = 0.6 * kR + 0.4 * bar(v('arbR')), K = (KF + KR) / 2, share = KF / (KF + KR);
    const dmp = (k) => (f.damp ? (v(k) - f.damp[0]) / (f.damp[1] - f.damp[0]) : f.dampD ?? 0.45);
    const db = dmp('bump'), dr = f.twoWay ? dmp('reb') : db, dAvg = (db + dr) / 2;
    const zeta = (0.35 + 1.3 * dAvg) / 0.935 / Math.sqrt(kAvg); // of the stock damping: stiffer springs on the same dampers bounce
    const dF = v('rhF'), dR = v('rhR'), rake = dF - dR, h = H0 - 0.85 * (dF + dR) / 2000;
    const bottom = Math.max(0, Math.max(dF, dR) - 38 * Math.sqrt(kAvg) - 10) * 0.0025; // past the bump travel left
    const cOpt = 2.3 + 0.7 / K + (t.grip - 1) * 3;
    const camG = (c) => 0.07 * (1 - ((-c - cOpt) / cOpt) ** 2), camL = (c) => 1 - 0.03 * Math.max(0, -c - 1);
    const pres = (p) => 1 - 0.09 * ((p - t.pOpt) / 0.5) ** 2;
    const lt = (sh) => 1 - 0.16 * (h / H0) * (sh / 0.5);
    const plat = 0.05 * (1 - ((K - 1.7) / 1.5) ** 2);
    const dGrip = 1 - 0.05 * Math.max(0, dAvg - 0.7) / 0.3 - 0.06 * Math.max(0, 0.8 - zeta) - bottom;
    const brace = f.brace || 0, tF = v('toeF'), tR = v('toeR'), pF = v('pF'), pR = v('pR'), rearT = t.rear || 1;
    const common = (1 + plat) * dGrip * (1 + 0.008 * brace);
    const GF = t.grip * pres(pF) * (1 + camG(v('camF'))) * lt(share) * common * (1 - 0.05 * Math.max(0, Math.abs(tF) - 0.2)) * (1 + 0.0006 * rake);
    const GR = t.grip * rearT * pres(pR) * (1 + camG(v('camR'))) * lt(1 - share) * common * (1 + 0.08 * (tR - 0.16)) * (1 - 0.0006 * rake);
    // downforce: the splitter and lip on the nose, the wing and ducktail at the back; rake works the front harder
    const clF = ((f.clF || 0) + (f.splitter ? 0.05 + 0.035 * v('splitter') : 0)) * (1 + 0.008 * rake);
    const clR = ((f.clR || 0) + (f.wing ? 0.12 + 0.058 * v('wing') : 0)) * (1 - 0.004 * rake);
    const dfF = Q200 * clF, dfR = Q200 * clR;
    const cda = clF / 10 + clR / 7 + 0.012 * (Math.abs(tF) + Math.abs(tR)); // a wing's drag, and the toe's scrub
    // braking: the tyres, camber's narrower patch, the bias against the one that locks both axles together, less dive
    const b = v('bias') / 100, P = v('lsdP') / 100, C = v('lsdC') / 100;
    const brake = t.grip * (0.65 * camL(v('camF')) * pres(pF) + 0.35 * rearT * camL(v('camR')) * pres(pR)) * (1 - 2.5 * (b - BSTAR) ** 2) *
      (1 + 0.03 * clamp(kAvg - 1, 0, 1) + 0.02 * (dAvg - 0.45));
    // traction off the line: the driven tyres, their camber, softer springs squatting onto them, the diff locking them
    const trac = t.grip * (DRIVE * rearT * camL(v('camR')) * pres(pR) * (1 + 0.04 * (1 - kR)) + (1 - DRIVE) * camL(v('camF')) * pres(pF) * (1 + 0.04 * (1 - kF))) *
      (1 + 0.14 * (P - 0.25)) * dGrip;
    const resp = t.resp * (1 + 0.12 * (pF - t.pOpt + 0.5 * (pR - t.pOpt))) * (1 - 0.35 * (tF - 0.04)) * (1 - 0.25 * (tR - 0.16)) *
      K ** 0.25 * (1 + 0.3 * (share - 0.5)) * (1 + 0.25 * (db - 0.45) + 0.1 * (dr - 0.45)) * (1 + 0.05 * brace);
    const stab = 1 + 1.5 * (GR / GF - 1) + 0.25 * (tR - 0.16) + 0.15 * (C - 0.1) - 0.8 * Math.max(0, BSTAR - b) + 0.1 * (dAvg - 0.45) - 0.04 * (P - 0.25);
    const comfort = 1 / (Math.sqrt(kAvg) * (0.7 + 0.3 * dAvg / 0.45) * (1 + 0.06 * brace) * (1 + 0.15 * ((pF + pR) / 2 - 2.4)));
    return { f, t, GF, GR, resp, trac, brake, stab, comfort, K, kAvg, share, zeta, dF, dR, rake, h, dfF, dfR, cda, b, P, C, cOpt, db, dr,
      ratio: v('ratio'), stiffF: (1 + 0.15 * (pF - t.pOpt)) * Math.sqrt(t.resp), stiffR: (1 + 0.15 * (pR - t.pOpt)) * (1 + 0.2 * (tR - 0.16)) * Math.sqrt(t.resp) };
  }
  const STOCK = calc(STOCK_PARTS, STOCK_SETUP);
  // the axles at u m/s (downforce included) and what the car corners at: the weaker axle limits it
  const axlesOf = (h, u) => {
    const x = (u / 55.6) ** 2, fr = h.front * (1 + h.aeroF * x), re = h.rear * (1 + h.aeroR * x);
    return [fr, re, (fr + re) / 2 - 0.4 * Math.abs(fr - re)];
  };
  function toHd(c) {
    const h = {
      front: c.GF / STOCK.GF, rear: c.GR / STOCK.GR,
      aeroF: 0.85 * c.dfF / (MASS * 9.81 * FRONT), aeroR: 0.85 * c.dfR / (MASS * 9.81 * (1 - FRONT)), cda: c.cda - STOCK.cda,
      response: c.resp / STOCK.resp, ratio: 15 / c.ratio, kRoll: c.K / STOCK.K, kPitch: c.kAvg, zeta: c.zeta / STOCK.zeta,
      drop: (c.dF + c.dR) / 2000, dh: c.h - H0, bias: c.b, biasRot: STOCK.b - c.b, lsd: c.P, coast: c.C, wet: c.t.wet,
      stiffF: c.stiffF / STOCK.stiffF, stiffR: c.stiffR / STOCK.stiffR, traction: c.trac / STOCK.trac, brake: c.brake / STOCK.brake,
      damperWear: c.f.dw || 1,
    };
    h.grip = axlesOf(h, 0)[2];
    return h;
  }
  const HD_STOCK = toHd(STOCK);

  // ================= state =================
  const api = { hd: HD_STOCK };
  const saved = S.handling && S.handling.v === 1 ? S.handling : null;
  const state = { parts: { ...STOCK_PARTS }, setup: { ...STOCK_SETUP } };
  if (saved) {
    PARTS.forEach((p) => { if (p.opts.some((o) => o.id === (saved.parts || {})[p.k])) state.parts[p.k] = saved.parts[p.k]; });
    SET.forEach((d) => { const v = (saved.setup || {})[d.k]; if (Number.isFinite(v)) state.setup[d.k] = v; });
  } else if (S.tune && S.tune.parts) { // the suspension and tyres used to be car-tune.js parts: they carry over, the
    // coilovers set up as a fast road car (they used to be worth ~6% on their own), the cups at their own pressures
    const o = S.tune.parts;
    if (o.suspension === 'sport' || o.suspension === 'coilovers') state.parts.suspension = o.suspension;
    if (o.suspension === 'coilovers') Object.assign(state.setup, { sprF: 130, sprR: 125, rhF: 20, rhR: 15, bump: 9 });
    if (o.tyres === 'cup') Object.assign(state.parts, { tyres: 'cup' }), Object.assign(state.setup, { pF: 1.9, pR: 2.1 });
  }
  let cur = null;
  const listeners = [];
  function update() {
    cur = calc(state.parts, state.setup);
    api.hd = toHd(cur);
    listeners.forEach((fn) => { try { fn(api.hd); } catch (e) { console.error(e); } });
    if (window.CarTune && CarTune.on && CarTune.reapply) CarTune.reapply(); // its T.grip carries the traction
  }
  update();
  api.onChange = (fn) => listeners.push(fn);
  api.axles = (u) => axlesOf(api.hd, u);
  api.saveData = () => ({ handling: { v: 1, parts: { ...state.parts }, setup: Object.fromEntries(SET.map((d) => [d.k, +(+state.setup[d.k]).toFixed(3)])) } });
  api.part = (k) => state.parts[k];
  api.mods = () => PARTS.filter((p) => state.parts[p.k] !== p.opts[0].id).map((p) => `${p.label}: ${p.opts.find((o) => o.id === state.parts[p.k]).label}`).join(' · ') || 'Factory chassis';
  window.CarHandling = api;

  // edits are logged once they settle: "Handling: front camber -2.5°, rear bar 6"
  let edited = new Set(), editTimer = 0;
  function noteEdit(label) {
    edited.add(label);
    clearTimeout(editTimer);
    editTimer = setTimeout(() => { log(`Handling: ${[...edited].join(', ')}`); edited = new Set(); }, 2500);
  }
  function setPart(k, id, quiet) {
    if (state.parts[k] === id) return;
    // the damping keeps its feel on dampers with more or fewer clicks (the stock ones sit at 45%)
    const was = fxOf(state.parts), share = (dk) => (was.damp && (dk === 'bump' || was.twoWay) ? (resolve(dk, was, state.setup) - 1) / (was.damp[1] - 1)
      : was.damp ? (resolve('bump', was, state.setup) - 1) / (was.damp[1] - 1) : 0.45);
    const keep = { bump: share('bump'), reb: share('reb') }, pOpt = (was.tyre || { pOpt: 2.4 }).pOpt;
    state.parts[k] = id;
    const f = fxOf(state.parts);
    if (k === 'tyres') ['pF', 'pR'].forEach((pk) => { state.setup[pk] = clamp(+(state.setup[pk] + f.tyre.pOpt - pOpt).toFixed(2), 1.6, 3.2); }); // set for the new tyres
    if (f.damp) ['bump', 'reb'].forEach((dk) => { state.setup[dk] = Math.round(1 + keep[dk] * (f.damp[1] - 1)); });
    update();
    if (!quiet) log(`Handling: fitted ${partOf(k).label} - ${partOf(k).opts.find((o) => o.id === id).label}`);
  }

  // ================= presets: whole setups (and the parts they're built around) =================
  const PRESETS = [
    { id: 'stock', name: 'Factory', desc: 'Every setting back to how the car left the factory (parts stay).', setup: {} },
    { id: 'road', name: 'Fast road', desc: 'Sport tyres on coilovers, a little more camber, a firmer rear: keen but forgiving.',
      parts: { tyres: 'sport', suspension: 'coilovers', alignment: 'camber' },
      setup: { pF: 2.3, pR: 2.35, camF: -1.6, camR: -1.8, toeF: 0.02, toeR: 0.18, sprF: 130, sprR: 125, bump: 0.55, rhF: 20, rhR: 15, lsdP: 35, lsdC: 15, ratio: 14 } },
    { id: 'track', name: 'Track day', desc: 'Cup tyres, race dampers and bars, a GT wing and an LSD: the fastest lap that stays honest.',
      parts: { tyres: 'cup', suspension: 'race', arb: 'race', alignment: 'camber', aero: 'gt', diff: 'lsd', brace: 'struts', rack: 'quick', bias: 'valve' },
      setup: { pF: 2.0, pR: 2.0, camF: -3.0, camR: -2.3, toeF: -0.04, toeR: 0.22, sprF: 190, sprR: 170, arbF: 6, arbR: 4, bump: 0.6, reb: 0.7, rhF: 45, rhR: 35,
        splitter: 6, wing: 8, bias: Math.round(BSTAR * 100) + 1, lsdP: 55, lsdC: 30, ratio: 13 } },
    { id: 'attack', name: 'Time attack', desc: 'Slicks, the cage and every gram of downforce: the most grip the car can have, dry only.',
      parts: { tyres: 'slick', suspension: 'race', arb: 'race', alignment: 'camber', aero: 'gt', diff: 'lsd', brace: 'cage', rack: 'quick', bias: 'valve' },
      setup: { pF: 1.8, pR: 1.8, camF: -3.3, camR: -2.6, toeF: -0.06, toeR: 0.24, sprF: 230, sprR: 210, arbF: 6, arbR: 5, bump: 0.7, reb: 0.78, rhF: 55, rhR: 45,
        splitter: 10, wing: 14, bias: Math.round(BSTAR * 100), lsdP: 60, lsdC: 35, ratio: 12 } },
    { id: 'drift', name: 'Drift', desc: 'Hard rears at high pressure, a stiff rear bar, max front camber and lock, a welded diff: it wants to slide.',
      parts: { tyres: 'drift', suspension: 'coilovers', arb: 'race', alignment: 'camber', diff: 'spool', rack: 'quick', bias: 'valve' },
      setup: { pF: 2.3, pR: 2.9, camF: -4.0, camR: -0.6, toeF: -0.2, toeR: 0, sprF: 170, sprR: 120, arbF: 2, arbR: 7, bump: 0.6, rhF: 35, rhR: 25,
        bias: Math.round(BSTAR * 100) - 8, ratio: 11 } },
    { id: 'rain', name: 'Rain', desc: 'Winter tyres, soft springs and bars, mild camber, gentle diff: stays planted when the road is greasy.',
      parts: { tyres: 'winter', suspension: 'coilovers', arb: 'adjustable', diff: 'lsd' },
      setup: { pF: 2.4, pR: 2.4, camF: -1.0, camR: -1.3, toeF: 0.04, toeR: 0.24, sprF: 85, sprR: 85, arbF: 2, arbR: 2, bump: 0.3, rhF: 5, rhR: 5, lsdP: 30, lsdC: 25 } },
  ];
  const presetNeeds = (p) => Object.entries(p.parts || {}).filter(([k, id]) => state.parts[k] !== id);
  function applyPreset(p, withParts) {
    if (withParts) Object.entries(p.parts || {}).forEach(([k, id]) => setPart(k, id, true));
    const f = fxOf(state.parts);
    SET.forEach((d) => { state.setup[d.k] = p.setup[d.k] ?? stockOf(d, f); });
    if (f.damp) ['bump', 'reb'].forEach((dk) => { if (p.setup[dk] != null) state.setup[dk] = Math.round(1 + p.setup[dk] * (f.damp[1] - 1)); }); // (a share of the clicks)
    update();
    log(`Handling: ${p.name} setup` + (withParts && p.parts ? ' (parts fitted)' : ''));
    activePreset = p.id;
    render(true);
  }
  let activePreset = null;
  api.applyPreset = (id, parts = true) => applyPreset(PRESETS.find((p) => p.id === id) || PRESETS[0], parts);

  // ======================================================================================================
  // ================= UI: the Handling tab =================
  // ======================================================================================================
  const CSS = `
    .chd{--ok:#33d17a;--warn:#ffb020;--bad:#ff5a3c;--info:#4fa8ff;--dim:#7d838b;--line:#1f2125;--card:#0a0b0d;--acc:#e8402a;
      font:.72rem/1.4 "Segoe UI",system-ui,Arial,sans-serif;color:#c7cbd0;}
    .chd [hidden]{display:none !important;}
    .chd-head{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin-bottom:12px;}
    .chd-head .cs-section-title{margin:0;}
    .chd-sub{font:.62rem/1.3 "Courier New",monospace;color:var(--dim);letter-spacing:.04em;}
    .chd-kpis{margin-left:auto;display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;}
    .chd-kpi{display:flex;flex-direction:column;align-items:flex-end;gap:3px;}
    .chd-kpi b{font:700 1rem/1 "Courier New",monospace;color:#f4f6f8;}
    .chd-kpi small{font:700 .5rem/1 "Segoe UI",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
    .chd-kpi i{font-style:normal;font:.56rem/1 "Courier New",monospace;}
    .chd-up{color:var(--ok);} .chd-down{color:var(--bad);} .chd-same{color:var(--dim);}
    .chd-nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px;}
    .chd-nav button{font:700 .6rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:8px 12px;border-radius:8px;
      border:1px solid transparent;background:none;color:#8a8f96;cursor:pointer;}
    .chd-nav button:hover{color:#fff;}
    .chd-nav button[aria-selected=true]{color:#fff;background:#16181c;border-color:#2a2d33;}
    .chd-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
    .chd-preset{flex:1 1 150px;text-align:left;padding:9px 11px;border-radius:9px;border:1px solid #2a2d33;background:#101215;color:#c7cbd0;font:inherit;
      display:flex;flex-direction:column;gap:3px;}
    .chd-preset b{font-size:.72rem;color:#f4f6f8;}
    .chd-preset span{font-size:.6rem;color:var(--dim);line-height:1.35;}
    .chd-preset[aria-current=true]{border-color:var(--acc);background:rgba(232,64,42,.08);}
    .chd-preset .chd-pbtns{display:flex;gap:6px;margin-top:4px;}
    .chd-btn{font:700 .55rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:6px 9px;border-radius:7px;
      border:1px solid #2a2d33;background:#16181c;color:#c9ccd1;cursor:pointer;}
    .chd-btn:hover{color:#fff;border-color:#4a4f57;}
    .chd-btn.chd-hot{border-color:#5a1e14;color:#ff8a70;}
    .chd-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr);gap:12px;align-items:start;}
    .cs-narrow .chd-grid{grid-template-columns:1fr;}
    .chd-col{display:flex;flex-direction:column;gap:12px;min-width:0;}
    .chd-side{position:sticky;top:0;}
    .chd-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0;}
    .chd-label{font:700 .55rem/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);margin-bottom:10px;
      display:flex;align-items:center;gap:8px;justify-content:space-between;}
    .chd-label em{font-style:normal;letter-spacing:.04em;text-transform:none;font-weight:400;color:#8a8f96;}
    .chd-sets{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px 18px;}
    .chd-row{display:grid;grid-template-columns:1fr auto;gap:3px 10px;align-items:center;}
    .chd-row > span{font-size:.64rem;color:#c2c6cc;display:flex;align-items:center;gap:6px;}
    .chd-row > b{font:700 .68rem/1 "Courier New",monospace;color:#f4f6f8;text-align:right;white-space:nowrap;}
    .chd-row > b i{font-style:normal;font-weight:400;font-size:.58rem;margin-left:5px;}
    .chd-track{grid-column:1/-1;position:relative;height:18px;}
    .chd-track input{position:absolute;inset:0;width:100%;margin:0;background:none;-webkit-appearance:none;appearance:none;cursor:pointer;}
    .chd-track input::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:#24272d;}
    .chd-track input::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#f4f6f8;border:3px solid var(--acc);box-sizing:border-box;}
    .chd-track input::-moz-range-track{height:4px;border-radius:2px;background:#24272d;}
    .chd-track input::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#f4f6f8;border:3px solid var(--acc);box-sizing:border-box;}
    .chd-track input:disabled{cursor:default;opacity:.4;}
    .chd-track input:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px rgba(232,64,42,.35);}
    .chd-track s{position:absolute;top:3px;width:2px;height:12px;margin-left:-1px;background:#4fa8ff;opacity:.7;pointer-events:none;border-radius:1px;z-index:1;}
    .chd-track u{position:absolute;top:7px;height:4px;background:rgba(51,209,122,.55);pointer-events:none;border-radius:2px;z-index:1;}
    .chd-row p{grid-column:1/-1;margin:0;font-size:.58rem;line-height:1.4;color:#8e949c;min-height:1.4em;}
    .chd-row[data-locked=true] > span, .chd-row[data-locked=true] > b{color:#6b7078;}
    .chd-row[data-locked=true] p{color:#6b7078;}
    .chd-lock{font:700 .48rem/1 "Segoe UI",sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:3px 5px;border-radius:4px;border:1px solid #33363c;color:#8a8f96;}
    .chd-svg{display:block;width:100%;height:auto;margin:0 auto;}
    .chd-svg.chd-top{max-width:250px;} .chd-svg.chd-sidev{max-width:400px;margin-top:6px;} .chd-svg.chd-meter{max-width:420px;}
    .chd-svg.chd-radar{max-width:400px;} .chd-svg.chd-env{max-width:320px;}
    .chd-svg text{font-family:"Segoe UI",system-ui,sans-serif;}
    .chd-meters{display:flex;flex-direction:column;gap:8px;}
    .chd-stats{width:100%;border-collapse:collapse;font-size:.64rem;}
    .chd-stats th{font:700 .5rem/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);text-align:left;
      padding:6px 6px;border-bottom:1px solid #2a2d33;}
    .chd-stats td{padding:5px 6px;border-bottom:1px solid #16181b;font:.64rem "Courier New",monospace;color:#c7cbd0;white-space:nowrap;}
    .chd-stats td:first-child{font-family:"Segoe UI",system-ui,sans-serif;color:#aab0b8;white-space:normal;}
    .chd-parts{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;}
    .chd-part h4{margin:0 0 8px;font-size:.72rem;color:#f4f6f8;display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
    .chd-part h4 small{font:.52rem/1 "Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
    .chd-part p{margin:8px 0 0;font-size:.62rem;color:#9aa0a8;line-height:1.45;min-height:2.9em;}
    .chd-part .chd-unl{font-size:.56rem;color:#6f9fd8;margin-top:6px;}
    .chd-seg{display:flex;flex-wrap:wrap;border:1px solid #2a2d33;border-radius:7px;overflow:hidden;}
    .chd-seg button{flex:1 1 auto;font:700 .55rem/1 "Segoe UI",sans-serif;letter-spacing:.04em;padding:7px 6px;background:#121418;color:#8a8f96;border:0;
      border-right:1px solid #2a2d33;cursor:pointer;}
    .chd-seg button:last-child{border-right:0;}
    .chd-seg button[aria-pressed=true]{background:rgba(232,64,42,.16);color:#fff;}
    .chd-guide{max-width:900px;font-size:.7rem;line-height:1.6;color:#b9bec5;}
    .chd-guide h3{font-size:.8rem;color:#f4f6f8;margin:18px 0 6px;}
    .chd-guide h3:first-child{margin-top:0;}
    .chd-guide p{margin:0 0 8px;}
    .chd-guide b{color:#e6e8eb;}
    .chd-guide table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:.64rem;}
    .chd-guide th{text-align:left;font:700 .52rem/1.2 "Segoe UI",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);padding:6px 8px;border-bottom:1px solid #2a2d33;}
    .chd-guide td{padding:6px 8px;border-bottom:1px solid #16181b;vertical-align:top;}
  `;
  let root = null, view = 'setup', built = false;
  const NAV = [['setup', 'Setup'], ['parts', 'Parts'], ['analysis', 'Analysis'], ['guide', 'Guide']];

  function build() {
    if (!window.CarService || !CarService.sections || !CarService.sections.handling) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = CarService.sections.handling;
    root.classList.add('chd');
    root.innerHTML = `
      <div class="chd-head">
        <div><div class="cs-section-title">Handling</div>
          <div class="chd-sub">${LAYOUT} · ${fmt(MASS)} kg · ${Math.round(FRONT * 100)} / ${Math.round((1 - FRONT) * 100)} · ${fmt(GRIP0, 2)} g stock tyres</div></div>
        <div class="chd-kpis" data-kpis></div>
      </div>
      <div class="chd-nav" role="tablist">${NAV.map(([id, l]) => `<button data-view="${id}" role="tab">${l}</button>`).join('')}</div>
      <div data-body></div>`;
    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; b.blur(); render(true); }));
    // typing or nudging a slider mustn't drive the car (the arrows are its signals)
    ['keydown', 'keyup'].forEach((t) => root.addEventListener(t, (e) => { if (e.target.matches('input')) e.stopPropagation(); }));
    built = true;
    render(true);
  }

  // ---- the numbers up top: cornering at 100 and 200 km/h, the balance, the response ----
  const latG = (h, kmh) => GRIP0 * axlesOf(h, kmh / 3.6)[2];
  const delta = (now, was, dp = 0, unit = '%') => {
    const d = unit === '%' ? (now / was - 1) * 100 : now - was;
    const cls = Math.abs(d) < (unit === '%' ? 0.5 : 10 ** -dp / 2) ? 'chd-same' : d > 0 ? 'chd-up' : 'chd-down';
    return `<i class="${cls}">${sgn(d, dp)}${unit}</i>`;
  };
  const balanceOf = (h, kmh = 120) => { const [fr, re] = axlesOf(h, kmh / 3.6); return (re - fr) / ((re + fr) / 2); }; // + understeer
  const balWord = (u) => (u > 0.06 ? 'Understeer' : u > 0.02 ? 'Mild understeer' : u < -0.06 ? 'Oversteer' : u < -0.02 ? 'Mild oversteer' : 'Neutral');
  function kpis() {
    const h = api.hd, u = balanceOf(h);
    root.querySelector('[data-kpis]').innerHTML = [
      [`${fmt(latG(h, 100), 2)} g`, 'Cornering 100 km/h', delta(latG(h, 100), latG(HD_STOCK, 100))],
      [`${fmt(latG(h, 200), 2)} g`, 'Cornering 200 km/h', delta(latG(h, 200), latG(HD_STOCK, 200))],
      [balWord(u), 'Balance', `<i class="chd-same">${sgn(u * 100, 1)}%</i>`],
      [`${fmt(h.response * 100)}%`, 'Response', delta(h.response, 1)],
    ].map(([v, l, d]) => `<div class="chd-kpi"><small>${l}</small><b>${v}</b>${d}</div>`).join('');
  }

  function render(full) {
    if (!built) return;
    kpis();
    root.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    const body = root.querySelector('[data-body]');
    if (full || body.dataset.shown !== view) {
      body.dataset.shown = view;
      body.innerHTML = '';
      ({ setup: buildSetup, parts: buildParts, analysis: buildAnalysis, guide: buildGuide })[view](body);
    } else if (view === 'setup') refreshSetup(body);
    else if (view === 'analysis') buildAnalysis(body);
  }

  // ---- Setup view: presets, every setting grouped, and the live chassis picture beside them ----
  const fmtVal = (d, v) => {
    if (d.k === 'toeF' || d.k === 'toeR') return Math.abs(v) < 0.005 ? '0.00°' : `${fmt(Math.abs(v), 2)}° ${v > 0 ? 'in' : 'out'}`;
    if (d.k === 'rhF' || d.k === 'rhR') return v ? `−${fmt(v)} mm` : 'stock';
    if (d.k === 'bump' || d.k === 'reb') { const r = d.range(fxOf(state.parts)); return Array.isArray(r) ? `${v} / ${r[1]}` : 'stock'; }
    if (d.k === 'arbF' || d.k === 'arbR') { const r = d.range(fxOf(state.parts)); return Array.isArray(r) ? `${v} / ${r[1]}` : 'stock'; }
    if (d.k === 'camF' || d.k === 'camR') return `${v < 0 ? '−' : ''}${fmt(Math.abs(v), 1)}°`;
    return fmt(v, d.dp) + d.unit;
  };
  // what the value does, now: against the tyre's optimum, the stock setting, the rest of the setup
  function hint(d, v) {
    const c = cur, s = STOCK_SETUP[d.k];
    switch (d.k) {
      case 'pF': case 'pR': {
        const o = c.t.pOpt, end = d.k === 'pF' ? 'front' : 'rear';
        if (Math.abs(v - o) < 0.08) return `Right at this tyre's ${fmt(o, 1)} bar optimum: the ${end} has its full grip.`;
        return v > o ? `${fmt(v - o, 2)} bar over the optimum: a sharper, livelier ${end} on a smaller patch (${sgn(-9 * ((v - o) / 0.5) ** 2, 1)}% grip).`
          : `${fmt(o - v, 2)} bar under: a softer, lazier ${end} and a squirming sidewall (${sgn(-9 * ((v - o) / 0.5) ** 2, 1)}% grip).`;
      }
      case 'camF': case 'camR': {
        const o = c.cOpt;
        if (Math.abs(-v - o) < 0.3) return `About optimal: at about −${fmt(o, 1)}° the outside tyre sits flat in a corner (it moves with roll stiffness).`;
        return -v < o ? `Short of the −${fmt(o, 1)}° or so that keeps the outside tyre flat: grip left on the table in corners.`
          : `Past about −${fmt(o, 1)}°: corner grip falls off, and the narrow patch costs ${d.k === 'camF' ? 'braking' : 'traction'}.`;
      }
      case 'toeF': return v < -0.02 ? 'Toe-out: the inside wheel turns in first - a sharp, eager turn-in, a nervous straight line.'
        : v > 0.1 ? 'Toe-in: rock steady in a straight line, but slow to turn in and it scrubs speed.' : 'Near zero: neutral turn-in, little scrub.';
      case 'toeR': return v < 0 ? 'Rear toe-out: the tail steers itself out of line - rotation, and a lot of it. Twitchy at speed.'
        : v > 0.25 ? 'Lots of rear toe-in: planted and stable, but it dulls rotation and scrubs speed.' : v < 0.06 ? 'Next to no rear toe: a free, lively rear - a little less stable.' : 'Mild toe-in: the factory-style stable rear.';
      case 'sprF': case 'sprR': {
        const end = d.k === 'sprF' ? 'front' : 'rear', o = d.k === 'sprF' ? 'rear' : 'front';
        return v > s * 1.15 ? `Stiffer ${end}: less roll and dive, quicker answers - and the ${end} takes more of the load transfer, so the ${o} gains grip.`
          : v < s * 0.9 ? `Softer ${end}: more roll, more mechanical grip at the ${end} over bumps, lazier answers.` : 'About the factory rate.';
      }
      case 'arbF': return v > s ? 'Stiffer front bar: the front takes more of the roll - more understeer, a flatter, quicker car.'
        : v < s ? 'Softer front bar: the front bites harder - less understeer, more roll.' : 'Factory bar.';
      case 'arbR': return v > s ? 'Stiffer rear bar: the rear takes more of the roll - the tail rotates more. The quickest balance tool there is.'
        : v < s ? 'Softer rear bar: a planted rear, more understeer, better traction out of slow corners.' : 'Factory bar.';
      case 'bump': return c.f.damp ? (c.db > 0.75 ? 'Hard: a flat, fast-responding body - but it skips over bumps and loses grip.'
        : c.db < 0.25 ? 'Soft: soaks up bumps, but the body wallows and answers late.' : 'Middling: a good balance of control and compliance.') : 'The factory dampers.';
      case 'reb': return c.f.twoWay ? (c.dr < c.db - 0.15 ? 'Less rebound than bump: the body springs back fast - bouncy over crests.'
        : c.dr > c.db + 0.25 ? 'Lots of rebound: holds the body down - steadier, but it can pack down over a run of bumps.' : 'Rebound a little over bump: the classic setup.') : '';
      case 'rhF': case 'rhR': {
        const r = c.rake;
        return (v ? `CG ${fmt((H0 - c.h) * 1000)} mm lower: less load transfer, less roll. ` : '') +
          (Math.abs(r) > 4 ? (r > 0 ? `Raked ${fmt(r)} mm nose-down: a keener front, more front downforce.` : `Tail-down by ${fmt(-r)} mm: a lazy front, the rear squats.`) : 'Level.') +
          (c.dF + c.dR > 0 && Math.max(c.dF, c.dR) > 38 * Math.sqrt(c.kAvg) + 10 ? ' Bottoming out - stiffen the springs or raise it.' : '');
      }
      case 'splitter': return c.f.splitter ? `${fmt(c.dfF / 9.81)} kg on the nose at 200 km/h (${fmt(c.dfF / 9.81 * 1.56)} kg at 250).` : '';
      case 'wing': return c.f.wing ? `${fmt(c.dfR / 9.81)} kg on the tail at 200 km/h; it costs ${fmt(0.5 * 1.225 * (c.cda - STOCK.cda) * 69.4 ** 3 / 1000)} kW to push through the air at 250.` : '';
      case 'bias': {
        const o = Math.round(BSTAR * 100);
        return Math.abs(v - o) <= 1 ? `At ${o}%, both axles lock together: the shortest stop.`
          : v > o ? `${v - o}% forward of ${o}%: the fronts lock first - safe, longer stops, push on the brakes.`
          : `${o - v}% behind ${o}%: the rears lock first - the car rotates on the brakes (trail-braking), unstable if overdone.`;
      }
      case 'lsdP': return v >= 100 ? 'Locked: both wheels always turn together - all the traction, push mid-corner, endless drifts.'
        : v > 50 ? 'Tight: strong traction and power oversteer on exit; pushes a little on the throttle mid-corner.' : v > 20 ? 'Moderate: the factory-like compromise.' : 'Nearly open: the inside wheel spins away out of slow corners.';
      case 'lsdC': return v >= 100 ? 'Locked off the power too: very stable on the brakes, reluctant to turn in.'
        : v > 35 ? 'High coast lock: stable on the brakes and on a lift, less rotation on entry.' : 'Low coast lock: the car rotates on a lift or on the brakes.';
      case 'ratio': return v < 14 ? `Quick: ${fmt(15 / v * 100 - 100)}% faster at the wheel - darty, less effort, less precision at speed.`
        : v > 15.5 ? 'Slow: calm and precise at speed, more work in hairpins.' : 'The factory ratio.';
    }
    return '';
  }
  function setRow(d) {
    const f = fxOf(state.parts), r = d.range(f), adj = Array.isArray(r), v = resolve(d.k, f, state.setup);
    const label = d.k === 'bump' && !f.twoWay ? 'Damping' : d.label;
    if (d.k === 'reb' && !f.twoWay) return '';
    const [lo, hi] = adj ? r : d.span, stockV = stockOf(d, f);
    const shown = !adj && (d.k === 'bump' || d.k === 'reb') ? lo + 0.45 * (hi - lo) : v; // (the stock dampers have no clicks)
    const pos = (x) => clamp((x - lo) / ((hi - lo) || 1), 0, 1) * 100;
    // the green band: the optimum this setup wants (pressures, camber, bias)
    const band = d.k === 'pF' || d.k === 'pR' ? [cur.t.pOpt - 0.08, cur.t.pOpt + 0.08] : d.k === 'camF' || d.k === 'camR' ? [-cur.cOpt - 0.3, -cur.cOpt + 0.3]
      : d.k === 'bias' ? [BSTAR * 100 - 1, BSTAR * 100 + 1] : null;
    return `<div class="chd-row" data-k="${d.k}" data-locked="${!adj}">
      <span>${esc(label)}${adj ? '' : `<em class="chd-lock" title="${esc(d.need || '')}">${esc(f.spool && d.g === 'Differential' ? 'welded' : d.need || 'fixed')}</em>`}</span>
      <b data-v>${fmtVal(d, v)}</b>
      <div class="chd-track">${band && adj ? `<u data-band style="left:${pos(band[0])}%;width:${Math.max(1.5, pos(band[1]) - pos(band[0]))}%"></u>` : ''}
        ${adj && stockV >= lo && stockV <= hi ? `<s style="left:${pos(stockV)}%" title="Stock: ${fmtVal(d, stockV)}"></s>` : ''}
        <input type="range" min="${lo}" max="${hi}" step="${d.step}" value="${shown}" ${adj ? '' : 'disabled'} aria-label="${esc(label)}"></div>
      <p data-h>${esc(hint(d, v))}</p></div>`;
  }
  function buildSetup(body) {
    body.innerHTML = `
      <div class="chd-presets">${PRESETS.map((p) => {
        const need = presetNeeds(p);
        return `<div class="chd-preset" data-preset="${p.id}" aria-current="${activePreset === p.id}"><b>${p.name}</b><span>${esc(p.desc)}</span>
          ${need.length ? `<span>Needs: ${need.map(([k, id]) => esc(partOf(k).opts.find((o) => o.id === id).label)).join(', ')}</span>` : ''}
          <div class="chd-pbtns"><button class="chd-btn" data-apply>Apply setup</button>${need.length ? '<button class="chd-btn chd-hot" data-fit>Fit parts + apply</button>' : ''}</div></div>`;
      }).join('')}</div>
      <div class="chd-grid">
        <div class="chd-col">${[...new Set(SET.map((d) => d.g))].map((g) => `
          <div class="chd-card"><div class="chd-label">${g}<em data-g="${g}">${groupNote(g)}</em></div><div class="chd-sets">${SET.filter((d) => d.g === g).map(setRow).join('')}</div></div>`).join('')}
        </div>
        <div class="chd-col chd-side">
          <div class="chd-card"><div class="chd-label">Chassis <em data-cnote></em></div><div data-top></div><div data-sidev></div></div>
          <div class="chd-card"><div class="chd-label">Balance <em>vs stock</em></div><div class="chd-meters" data-meters></div></div>
          <div class="chd-card"><div class="chd-label">Character <em>stock dashed</em></div><div data-radar></div></div>
        </div>
      </div>`;
    body.querySelectorAll('[data-preset]').forEach((el) => {
      const p = PRESETS.find((x) => x.id === el.dataset.preset);
      el.querySelector('[data-apply]').addEventListener('click', () => applyPreset(p, false));
      el.querySelector('[data-fit]')?.addEventListener('click', () => applyPreset(p, true));
    });
    body.querySelectorAll('.chd-row').forEach((row) => {
      const d = DEF[row.dataset.k], input = row.querySelector('input');
      input.addEventListener('input', () => {
        state.setup[d.k] = +input.value;
        activePreset = null;
        update();
        noteEdit(`${(d.k === 'bump' && !cur.f.twoWay ? 'damping' : d.label.toLowerCase())} ${fmtVal(d, resolve(d.k, cur.f, state.setup))}`);
        render();
      });
      input.addEventListener('change', () => input.blur()); // the arrow keys go back to the car
    });
    refreshSetup(body);
  }
  const groupNote = (g) => ({ Tyres: () => `${partOf('tyres').opts.find((o) => o.id === state.parts.tyres).label} · optimum ${fmt(cur.t.pOpt, 1)} bar`,
    Alignment: () => `best camber −${fmt(cur.cOpt, 1)}°`, 'Springs & bars': () => `front roll share ${fmt(cur.share * 100)}%`,
    Dampers: () => `body ζ ${fmt(0.42 * api.hd.zeta, 2)}`, 'Ride height': () => `CG ${fmt(cur.h * 1000)} mm`,
    Aero: () => `${fmt((cur.dfF + cur.dfR) / 9.81)} kg @ 200 km/h`, Brakes: () => `ideal ${Math.round(BSTAR * 100)}% F`,
    Differential: () => partOf('diff').opts.find((o) => o.id === state.parts.diff).label, Steering: () => `${fmt(cur.ratio * 0.2, 1)} turns lock to lock` }[g] || (() => ''))();
  function refreshSetup(body) {
    body.querySelectorAll('.chd-row').forEach((row) => {
      const d = DEF[row.dataset.k], v = resolve(d.k, cur.f, state.setup);
      row.querySelector('[data-v]').innerHTML = fmtVal(d, v) + (Math.abs(v - STOCK_SETUP[d.k]) > 1e-6 && !(d.k === 'bump' || d.k === 'reb') ? `<i class="chd-same">${sgn(v - STOCK_SETUP[d.k], d.dp)}</i>` : '');
      row.querySelector('[data-h]').textContent = hint(d, v);
      const band = row.querySelector('[data-band]'), input = row.querySelector('input');
      if (band) { // the optimum moves with the rest of the setup
        const lo = +input.min, hi = +input.max, pos = (x) => clamp((x - lo) / ((hi - lo) || 1), 0, 1) * 100;
        const b = d.k === 'pF' || d.k === 'pR' ? [cur.t.pOpt - 0.08, cur.t.pOpt + 0.08] : d.k === 'bias' ? [BSTAR * 100 - 1, BSTAR * 100 + 1] : [-cur.cOpt - 0.3, -cur.cOpt + 0.3];
        band.style.left = pos(b[0]) + '%'; band.style.width = Math.max(1.5, pos(b[1]) - pos(b[0])) + '%';
      }
    });
    body.querySelectorAll('[data-g]').forEach((em) => { em.textContent = groupNote(em.dataset.g); });
    body.querySelector('[data-top]').innerHTML = topView();
    body.querySelector('[data-sidev]').innerHTML = sideView();
    const ups = PARTS.filter((p) => state.parts[p.k] !== p.opts[0].id).length;
    body.querySelector('[data-cnote]').textContent = ups ? `${ups} upgrade${ups > 1 ? 's' : ''}` : 'factory';
    body.querySelector('[data-meters]').innerHTML = meters();
    body.querySelector('[data-radar]').innerHTML = radar();
  }

  // ---- graphics ----
  // grip against stock as a colour: red (less) through white to green (more)
  const gripCol = (r) => { const x = clamp((r - 1) / 0.2, -1, 1); return x >= 0 ? `hsl(140,${Math.round(70 * x)}%,${Math.round(78 - 26 * x)}%)` : `hsl(8,${Math.round(-85 * x)}%,${Math.round(78 + 20 * x)}%)`; };
  function topView() {
    const c = cur, h = api.hd, fy = 78, ry = 224, bar = (n) => 0.5 + 0.25 * (n - 1), f = c.f;
    const wheel = (x, y, toe, cam, col) => `<g transform="translate(${x} ${y}) rotate(${(x < 100 ? 1 : -1) * toe * 9})">
      <rect x="-9" y="-19" width="18" height="38" rx="4" fill="${col}" stroke="#0a0b0d" stroke-width="1.5"/>
      <path d="M-9 -12h18M-9 -4h18M-9 4h18M-9 12h18" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
      <rect x="${(x < 100 ? -1 : 1) * cam * 1.6 - 1.5}" y="-19" width="3" height="38" fill="rgba(0,0,0,.45)"/></g>`;
    const arb = (y, n, k) => `<path d="M58 ${y + (k ? 14 : -14)}h84" stroke="#8a8f96" stroke-width="${(1 + bar(n) * 1.6).toFixed(1)}" stroke-linecap="round" fill="none"/>
      <path d="M58 ${y + (k ? 14 : -14)}l-6 ${k ? -10 : 10}M142 ${y + (k ? 14 : -14)}l6 ${k ? -10 : 10}" stroke="#8a8f96" stroke-width="${(1 + bar(n)).toFixed(1)}" stroke-linecap="round"/>`;
    const coil = (x, y, k) => `<circle cx="${x}" cy="${y}" r="${(4 + 2.4 * k).toFixed(1)}" fill="none" stroke="#4fa8ff" stroke-width="${(1 + k).toFixed(1)}" opacity=".85"/>`;
    const cgy = fy + (ry - fy) * (1 - FRONT);
    const v = (k) => resolve(k, f, state.setup);
    return `<svg class="chd-svg chd-top" viewBox="0 0 200 300" role="img" aria-label="Chassis, top view">
      ${c.dfF ? `<rect x="44" y="${20 - Math.min(6, c.dfF / 400)}" width="112" height="${2 + Math.min(6, c.dfF / 400)}" rx="1.5" fill="#c48cff"/>
        <text x="100" y="12" text-anchor="middle" font-size="9" fill="#c48cff">↓ ${fmt(c.dfF / 9.81)} kg</text>` : ''}
      <path d="M62 30 Q100 18 138 30 L150 70 L152 250 Q100 272 48 250 L50 70 Z" fill="#16181c" stroke="#2f333a" stroke-width="1.5"/>
      <path d="M64 108 Q100 98 136 108 L132 132 Q100 126 68 132 Z" fill="#20242a"/>
      <path d="M68 196 Q100 202 132 196 L136 214 Q100 222 64 214 Z" fill="#20242a"/>
      ${arb(fy, v('arbF'), 1)}${arb(ry, v('arbR'), 0)}
      ${coil(66, fy, v('sprF') / 100)}${coil(134, fy, v('sprF') / 100)}${coil(66, ry, v('sprR') / 100)}${coil(134, ry, v('sprR') / 100)}
      ${wheel(36, fy, v('toeF'), -v('camF'), gripCol(h.front))}${wheel(164, fy, v('toeF'), -v('camF'), gripCol(h.front))}
      ${wheel(36, ry, v('toeR'), -v('camR'), gripCol(h.rear))}${wheel(164, ry, v('toeR'), -v('camR'), gripCol(h.rear))}
      <circle cx="100" cy="${cgy}" r="6" fill="none" stroke="#ffb020" stroke-width="1.5"/><path d="M100 ${cgy - 6}v12M94 ${cgy}h12" stroke="#ffb020" stroke-width="1.2"/>
      <text x="100" y="${cgy + 18}" text-anchor="middle" font-size="8" fill="#ffb020">CG ${fmt(c.h * 1000)} mm</text>
      <text x="100" y="${fy + 3}" text-anchor="middle" font-size="9" fill="#e9edf2" font-weight="700">${Math.round(FRONT * 100)}%</text>
      <text x="100" y="${ry + 3}" text-anchor="middle" font-size="9" fill="#e9edf2" font-weight="700">${Math.round((1 - FRONT) * 100)}%</text>
      <text x="8" y="${fy - 26}" font-size="8" fill="#8a8f96">F ${sgn((h.front - 1) * 100, 1)}%</text>
      <text x="8" y="${ry + 32}" font-size="8" fill="#8a8f96">R ${sgn((h.rear - 1) * 100, 1)}%</text>
      ${c.dfR ? `<rect x="40" y="276" width="120" height="${2 + Math.min(7, c.dfR / 400)}" rx="1.5" fill="#c48cff"/>
        <path d="M54 276v-8M146 276v-8" stroke="#c48cff" stroke-width="2"/>
        <text x="100" y="296" text-anchor="middle" font-size="9" fill="#c48cff">↓ ${fmt(c.dfR / 9.81)} kg</text>` : ''}
    </svg>`;
  }
  function sideView() {
    const c = cur, px = 20 / 340 * 3; // px per mm, exaggerated x3 so a 40 mm drop shows
    const dy = ((c.dF + c.dR) / 2) * px, tilt = Math.atan2((c.dF - c.dR) * px, 150) * 180 / Math.PI;
    const gy = 104, cgY = gy - c.h * 1000 * 20 / 340;
    const arrow = (x, kg, col) => (kg > 1 ? `<path d="M${x} ${42 - Math.min(30, kg / 7)}v${Math.min(30, kg / 7)}" stroke="${col}" stroke-width="2.5"/><path d="M${x - 4} ${38}l4 6 4-6" fill="${col}"/>` : '');
    return `<svg class="chd-svg chd-sidev" viewBox="0 0 300 116" role="img" aria-label="Chassis, side view">
      <path d="M0 ${gy}h300" stroke="#2a2d33"/>
      <g transform="translate(0 ${dy}) rotate(${-tilt} 150 70)">
        <path d="M24 82 L30 64 Q60 56 98 55 L132 36 Q170 30 204 35 L248 52 Q270 56 278 64 L280 82 Z" fill="#16181c" stroke="#3a3f47" stroke-width="1.5"/>
        <path d="M136 40 L162 37 L164 54 L120 55 Z M168 37 Q190 36 202 39 L230 54 L170 54 Z" fill="#232830"/>
        ${c.dfF ? '<path d="M18 84h26" stroke="#c48cff" stroke-width="3"/>' : ''}
        ${c.f.wing ? `<path d="M246 52 l2 -14 M262 54 l2 -16" stroke="#555b63" stroke-width="2"/><path d="M236 ${36 - (resolve('wing', c.f, state.setup) * 0.3)} L284 36" stroke="#c48cff" stroke-width="4" stroke-linecap="round"/>`
          : c.dfR ? '<path d="M262 50 l18 -4" stroke="#c48cff" stroke-width="3"/>' : ''}
      </g>
      <circle cx="78" cy="${gy - 18}" r="18" fill="#0d0e10" stroke="#555b63" stroke-width="3"/><circle cx="78" cy="${gy - 18}" r="8" fill="#2a2d33"/>
      <circle cx="226" cy="${gy - 18}" r="18" fill="#0d0e10" stroke="#555b63" stroke-width="3"/><circle cx="226" cy="${gy - 18}" r="8" fill="#2a2d33"/>
      <circle cx="${78 + 148 * (1 - FRONT)}" cy="${cgY}" r="4" fill="#ffb020"/>
      <path d="M${78 + 148 * (1 - FRONT)} ${cgY + 4}V${gy}" stroke="#ffb020" stroke-dasharray="2 2" opacity=".6"/>
      ${arrow(30, c.dfF / 9.81, '#c48cff')}${arrow(262, c.dfR / 9.81, '#c48cff')}
      <text x="150" y="114" text-anchor="middle" font-size="8" fill="#8a8f96">${c.dF + c.dR ? `−${fmt(c.dF)} / −${fmt(c.dR)} mm` : 'stock height'}${Math.abs(c.rake) > 4 ? ` · rake ${sgn(c.rake)} mm` : ''}${c.cda > STOCK.cda + 0.005 ? ` · drag +${fmt((c.cda - STOCK.cda), 2)} m²` : ''}</text>
    </svg>`;
  }
  // entry (braking, turn-in), mid-corner and exit (on the power): + understeer, - oversteer, against stock
  function phases() {
    const h = api.hd, mid = balanceOf(h), ent = mid - 0.6 * h.biasRot - 0.12 * (0.1 - h.coast) - 0.08 * (h.response - 1);
    const ext = mid + (DRIVE ? 1 : -1) * (0.12 * (h.lsd - 0.25) + 0.1 * (h.traction - 1)); // (a locked diff pushes a driven rear, pulls a driven front in)
    return [['Entry', ent], ['Mid-corner', mid], ['Exit', ext]];
  }
  function meters() {
    return phases().map(([name, u]) => {
      const x = 120 + clamp(u / 0.12, -1, 1) * 110;
      return `<svg class="chd-svg chd-meter" viewBox="0 0 240 42" role="img" aria-label="${name}: ${balWord(u)}">
        <defs><linearGradient id="chdb" x1="0" x2="1"><stop offset="0" stop-color="#4fa8ff"/><stop offset=".5" stop-color="#3a3f47"/><stop offset="1" stop-color="#ff7a45"/></linearGradient></defs>
        <text x="10" y="9" font-size="9" fill="#e9edf2" font-weight="700">${name}</text>
        <text x="230" y="9" font-size="8.5" fill="#aab0b8" text-anchor="end">${balWord(u)}</text>
        <rect x="10" y="22" width="220" height="6" rx="3" fill="url(#chdb)" opacity=".75"/>
        <path d="M120 19v12" stroke="#e9edf2" stroke-width="1" opacity=".5"/>
        <path d="M${x} 20 l-5 -6 h10 z" fill="#f4f6f8"/><rect x="${x - 1.5}" y="19" width="3" height="12" fill="#f4f6f8"/>
        <text x="10" y="40" font-size="7" fill="#4fa8ff">OVERSTEER</text><text x="230" y="40" font-size="7" fill="#ff7a45" text-anchor="end">UNDERSTEER</text>
      </svg>`;
    }).join('');
  }
  const charOf = (c, h) => [
    ['Grip', latG(h, 120) / latG(HD_STOCK, 120)], ['Turn-in', h.response * (h.ratio ** 0.3)], ['Stability', c.stab / STOCK.stab],
    ['Traction', h.traction], ['Braking', h.brake], ['Top speed', Math.cbrt(0.7 / (0.7 + h.cda))], ['Comfort', c.comfort / STOCK.comfort]];
  function radar() {
    const now = charOf(cur, api.hd), was = charOf(STOCK, HD_STOCK), n = now.length, cx = 150, cy = 104, R = 72;
    const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n, r = R * clamp(0.5 + (v - 1) * 1.6, 0.06, 1); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    const poly = (vals) => vals.map(([, v], i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${now.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `${(cx + Math.cos(a) * R * k).toFixed(1)},${(cy + Math.sin(a) * R * k).toFixed(1)}`; }).join(' ')}" fill="none" stroke="${k === 0.5 ? '#3a3f47' : '#1f2125'}"/>`).join('');
    const labels = now.map(([l, v], i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n, x = cx + Math.cos(a) * (R + 16), y = cy + Math.sin(a) * (R + 12) + 3, d = (v - 1) * 100;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="9" text-anchor="${Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'}" fill="#c7cbd0">${l}<tspan fill="${Math.abs(d) < 0.5 ? '#7d838b' : d > 0 ? '#33d17a' : '#ff5a3c'}"> ${sgn(d)}%</tspan></text>`;
    }).join('');
    return `<svg class="chd-svg chd-radar" viewBox="-30 0 360 206" role="img" aria-label="Handling character against stock">${rings}
      <polygon points="${poly(was)}" fill="none" stroke="#8a8f96" stroke-dasharray="3 3"/>
      <polygon points="${poly(now)}" fill="rgba(232,64,42,.22)" stroke="#e8402a" stroke-width="1.5"/>${labels}</svg>`;
  }

  // ---- Analysis view: cornering against speed, the body's answer to a corner, the grip envelope, every figure ----
  function gripChart() {
    const W = 560, H = 220, l = 44, r = 540, t = 14, b = 190, vmax = 300, h = api.hd;
    const gs = Array.from({ length: 31 }, (_, i) => i * 10);
    const top = Math.max(...gs.map((k) => GRIP0 * Math.max(axlesOf(h, k / 3.6)[0], axlesOf(h, k / 3.6)[1], 1))) * 1.12, lo = GRIP0 * 0.6;
    const X = (k) => l + (r - l) * k / vmax, Y = (g) => b - (b - t) * (g - lo) / (top - lo);
    const line = (fn) => gs.map((k, i) => `${i ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(fn(k)).toFixed(1)}`).join('');
    const grid = [...Array(7)].map((_, i) => { const g = lo + (top - lo) * i / 6; return `<path d="M${l} ${Y(g).toFixed(1)}H${r}" stroke="#1a1c20"/><text x="${l - 6}" y="${(Y(g) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#6b7078">${fmt(g, 1)}</text>`; }).join('') +
      [0, 50, 100, 150, 200, 250, 300].map((k) => `<text x="${X(k)}" y="${b + 14}" font-size="9" text-anchor="middle" fill="#6b7078">${k}</text>`).join('');
    return `<svg class="chd-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cornering grip against speed">${grid}
      <text x="${r}" y="${b + 26}" font-size="8.5" text-anchor="end" fill="#6b7078">km/h</text><text x="6" y="10" font-size="8.5" fill="#6b7078">lateral g</text>
      <path d="${line((k) => GRIP0)}" stroke="#8a8f96" stroke-dasharray="4 4" fill="none"/>
      <path d="${line((k) => GRIP0 * axlesOf(h, k / 3.6)[0])}" stroke="#4fa8ff" stroke-width="1" fill="none" opacity=".75"/>
      <path d="${line((k) => GRIP0 * axlesOf(h, k / 3.6)[1])}" stroke="#ffb020" stroke-width="1" fill="none" opacity=".75"/>
      <path d="${line((k) => latG(h, k))}" stroke="#e8402a" stroke-width="2.5" fill="none"/>
      <g font-size="9" transform="translate(60 0)"><rect x="${l + 8}" y="${t + 2}" width="10" height="3" fill="#e8402a"/><text x="${l + 22}" y="${t + 6}" fill="#c7cbd0">the car</text>
        <rect x="${l + 70}" y="${t + 2}" width="10" height="3" fill="#4fa8ff"/><text x="${l + 84}" y="${t + 6}" fill="#c7cbd0">front axle</text>
        <rect x="${l + 145}" y="${t + 2}" width="10" height="3" fill="#ffb020"/><text x="${l + 159}" y="${t + 6}" fill="#c7cbd0">rear axle</text>
        <path d="M${l + 222} ${t + 3.5}h10" stroke="#8a8f96" stroke-dasharray="3 2"/><text x="${l + 236}" y="${t + 6}" fill="#c7cbd0">stock</text></g></svg>`;
  }
  // a 1 g corner arriving at 0.1 s, through the driving page's spring-damper (its stock M Sport-ish base, chassis Normal)
  function rollChart() {
    const W = 560, H = 170, l = 44, r = 540, t = 12, b = 146, T = 2;
    const sim = (h) => {
      const w = 2 * Math.PI * 1.3 * Math.sqrt(h.kPitch * 1.22), z = 0.42 * h.zeta, to = 3.2 / (h.kRoll * 1.22), out = [];
      let x = 0, vel = 0;
      for (let i = 0; i <= 400; i++) { const tt = i * T / 400, tgt = tt > 0.1 ? to : 0; for (let k = 0; k < 4; k++) { vel += (w * w * (tgt - x) - 2 * z * w * vel) * T / 1600; x += vel * T / 1600; } out.push([tt, x]); }
      return out;
    };
    const a = sim(api.hd), s = sim(HD_STOCK), top = Math.max(...a.map((p) => p[1]), ...s.map((p) => p[1])) * 1.15;
    const X = (tt) => l + (r - l) * tt / T, Y = (x) => b - (b - t) * x / top;
    const path = (d) => d.map(([tt, x], i) => `${i ? 'L' : 'M'}${X(tt).toFixed(1)} ${Y(x).toFixed(1)}`).join('');
    const peak = Math.max(...a.map((p) => p[1])), settle = a.find(([tt, x], i) => tt > 0.1 && a.slice(i).every(([, y]) => Math.abs(y - a[a.length - 1][1]) < 0.05 * a[a.length - 1][1]))?.[0] ?? T;
    return `<svg class="chd-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body roll after turning in">
      ${[0.5, 1, 1.5, 2].map((tt) => `<path d="M${X(tt)} ${t}V${b}" stroke="#1a1c20"/><text x="${X(tt)}" y="${b + 13}" font-size="9" text-anchor="middle" fill="#6b7078">${tt} s</text>`).join('')}
      ${[1, 2, 3, 4].filter((d) => d < top).map((d) => `<path d="M${l} ${Y(d)}H${r}" stroke="#1a1c20"/><text x="${l - 6}" y="${Y(d) + 3}" font-size="9" text-anchor="end" fill="#6b7078">${d}°</text>`).join('')}
      <path d="${path(s)}" stroke="#8a8f96" stroke-dasharray="4 4" fill="none"/>
      <path d="${path(a)}" stroke="#4fa8ff" stroke-width="2.5" fill="none"/>
      <text x="${r}" y="${t + 8}" font-size="9" text-anchor="end" fill="#c7cbd0">peak ${fmt(peak, 2)}° · overshoot ${fmt(Math.max(0, peak / a[a.length - 1][1] - 1) * 100)}% · settled in ${fmt(settle - 0.1, 2)} s</text>
    </svg>`;
  }
  function envelope() {
    const h = api.hd, cx = 110, cy = 110, R = 80, g = (x) => x / (GRIP0 * 1.5) * R;
    const shape = (lat, brk, acc) => { const pts = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI, s = Math.sin(a), c = Math.cos(a); pts.push(`${(cx + c * g(lat)).toFixed(1)},${(cy + (s < 0 ? s * g(brk) : s * g(acc))).toFixed(1)}`); } return pts.join(' '); };
    const acc0 = GRIP0 * 0.55 * Math.max(0.5, DRIVE || 0.6);
    return `<svg class="chd-svg chd-env" viewBox="0 0 220 220" role="img" aria-label="Grip envelope">
      ${[0.5, 1, 1.5].map((k) => `<circle cx="${cx}" cy="${cy}" r="${g(GRIP0 * k)}" fill="none" stroke="#1a1c20"/>`).join('')}
      <path d="M${cx - R} ${cy}H${cx + R}M${cx} ${cy - R}V${cy + R}" stroke="#1f2125"/>
      <polygon points="${shape(GRIP0, GRIP0, acc0)}" fill="none" stroke="#8a8f96" stroke-dasharray="3 3"/>
      <polygon points="${shape(latG(h, 100), GRIP0 * h.brake, acc0 * h.traction)}" fill="rgba(79,168,255,.18)" stroke="#4fa8ff" stroke-width="1.5"/>
      <text x="${cx}" y="12" font-size="8.5" text-anchor="middle" fill="#8a8f96">BRAKING</text><text x="${cx}" y="216" font-size="8.5" text-anchor="middle" fill="#8a8f96">TRACTION</text>
      <text x="4" y="${cy - 4}" font-size="8.5" fill="#8a8f96">LEFT</text><text x="216" y="${cy - 4}" font-size="8.5" text-anchor="end" fill="#8a8f96">RIGHT</text></svg>`;
  }
  function buildAnalysis(body) {
    const c = cur, h = api.hd, s = STOCK, H = HD_STOCK;
    const kw = (cda) => 0.5 * 1.225 * cda * 69.4 ** 3 / 1000;
    const rows = [
      ['Cornering, 100 km/h', `${fmt(latG(H, 100), 2)} g`, `${fmt(latG(h, 100), 2)} g`, delta(latG(h, 100), latG(H, 100), 1)],
      ['Cornering, 200 km/h', `${fmt(latG(H, 200), 2)} g`, `${fmt(latG(h, 200), 2)} g`, delta(latG(h, 200), latG(H, 200), 1)],
      ['Cornering, 250 km/h', `${fmt(latG(H, 250), 2)} g`, `${fmt(latG(h, 250), 2)} g`, delta(latG(h, 250), latG(H, 250), 1)],
      ['Front / rear axle grip', '100 / 100%', `${fmt(h.front * 100)} / ${fmt(h.rear * 100)}%`, `<i class="chd-same">${balWord(balanceOf(h))}</i>`],
      ['Downforce at 200 km/h (F / R)', '0 / 0 kg', `${fmt(c.dfF / 9.81)} / ${fmt(c.dfR / 9.81)} kg`, c.dfF + c.dfR ? `<i class="chd-same">${fmt(c.dfF / (c.dfF + c.dfR) * 100)}% front</i>` : ''],
      ['Extra drag area / power at 250', '-', `+${fmt(c.cda - s.cda, 3)} m² · ${fmt(kw(c.cda - s.cda))} kW`, `<i class="${c.cda - s.cda > 0.01 ? 'chd-down' : 'chd-same'}">${sgn((Math.cbrt(0.7 / (0.7 + h.cda)) - 1) * 100, 1)}% v-max</i>`],
      ['Roll stiffness (front share)', `100% (${fmt(s.share * 100)}%)`, `${fmt(h.kRoll * 100)}% (${fmt(c.share * 100)}%)`, delta(h.kRoll, 1)],
      ['Body frequency / damping ζ', `${fmt(1.3 * Math.sqrt(1.22), 2)} Hz / 0.42`, `${fmt(1.3 * Math.sqrt(h.kPitch * 1.22), 2)} Hz / ${fmt(0.42 * h.zeta, 2)}`, delta(h.zeta, 1)],
      ['CG height', `${fmt(H0 * 1000)} mm`, `${fmt(c.h * 1000)} mm`, `<i class="${c.h < H0 - 0.001 ? 'chd-up' : 'chd-same'}">${sgn((c.h - H0) * 1000)} mm</i>`],
      ['Steering response', '100%', `${fmt(h.response * 100)}%`, delta(h.response, 1)],
      ['Steering ratio / lock to lock', '15.0:1 · 3.0 turns', `${fmt(c.ratio, 1)}:1 · ${fmt(c.ratio * 0.2, 1)} turns`, delta(h.ratio, 1)],
      ['Brake bias (ideal)', `${STOCK_BIAS}% (${Math.round(BSTAR * 100)}%)`, `${fmt(c.b * 100)}%`, `<i class="chd-same">${sgn(c.b * 100 - STOCK_BIAS)} pt</i>`],
      ['Braking grip / 100-0 km/h', '100%', `${fmt(h.brake * 100)}% · ${sgn((1 / h.brake - 1) * 100, 1)}% distance`, delta(h.brake, 1)],
      ['Traction off the line', '100%', `${fmt(h.traction * 100)}%`, delta(h.traction, 1)],
      ['Diff lock power / coast', '25 / 10%', `${fmt(c.P * 100)} / ${fmt(c.C * 100)}%`, ''],
      ['Wet grip (rain / snow)', `${fmt(72)}% / ${fmt(38)}%`, `${fmt(Math.max(10, 100 - 28 * h.wet))}% / ${fmt(Math.max(10, 100 - 62 * h.wet))}%`, delta(Math.max(0.1, 1 - 0.28 * h.wet), 0.72)],
      ['Damper wear rate', '100%', `${fmt(h.damperWear * 100)}%`, ''],
    ];
    body.innerHTML = `
      <div class="chd-grid">
        <div class="chd-col">
          <div class="chd-card"><div class="chd-label">Cornering grip against speed <em>downforce grows with speed²</em></div>${gripChart()}</div>
          <div class="chd-card"><div class="chd-label">Body roll turning into a 1 g corner <em>springs, bars, dampers</em></div>${rollChart()}</div>
        </div>
        <div class="chd-col">
          <div class="chd-card"><div class="chd-label">Grip envelope <em>stock dashed</em></div>${envelope()}</div>
          <div class="chd-card"><div class="chd-label">Balance</div><div class="chd-meters">${meters()}</div></div>
        </div>
      </div>
      <div class="chd-card" style="margin-top:12px"><div class="chd-label">Every figure <em>${esc(api.mods())}</em></div>
        <table class="chd-stats"><tr><th></th><th>Stock</th><th>Now</th><th></th></tr>
        ${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }

  // ---- Parts view ----
  function buildParts(body) {
    const unlocks = (k, id) => {
      const f = fxOf({ ...state.parts, [k]: id });
      return SET.filter((d) => Array.isArray(d.range(f)) && !Array.isArray(d.range(fxOf({ ...state.parts, [k]: partOf(k).opts[0].id })))).map((d) => (d.k === 'bump' && !f.twoWay ? 'Damping' : d.label));
    };
    body.innerHTML = `<div class="chd-parts">${PARTS.map((p) => {
      const o = p.opts.find((x) => x.id === state.parts[p.k]) || p.opts[0], un = unlocks(p.k, o.id);
      return `<div class="chd-card chd-part" data-k="${p.k}"><h4>${p.label}<small>${o.id === p.opts[0].id ? 'factory' : 'upgraded'}</small></h4>
        <div class="chd-seg">${p.opts.map((x) => `<button data-id="${x.id}" aria-pressed="${x.id === o.id}" title="${esc(x.desc)}">${esc(x.label)}</button>`).join('')}</div>
        <p>${esc(o.desc)}</p>${un.length ? `<div class="chd-unl">Unlocks: ${esc(un.join(', '))}</div>` : ''}</div>`;
    }).join('')}</div>`;
    body.querySelectorAll('.chd-part').forEach((card) => card.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      setPart(card.dataset.k, b.dataset.id);
      activePreset = null;
      b.blur();
      render(true);
    })));
  }

  // ---- Guide ----
  function buildGuide(body) {
    body.innerHTML = `<div class="chd-guide">
      <h3>How it works</h3>
      <p>Every car rides on its tyres' grip. A tuned setup changes <b>how much</b> grip each axle has and <b>how fast</b> the car uses it. The driving page reads this tab every frame: the cornering limit, how sharply the car answers the wheel, how it leans, pitches and settles, how the tail behaves at the limit and in drift mode, top speed through the drag of a wing, and - on the car itself - launch traction and braking.</p>
      <p>The car corners at what its <b>weaker axle</b> can hold. A front that runs out first <b>understeers</b> (pushes wide, safe); a rear that runs out first <b>oversteers</b> (the tail steps out, rotates the car). Balanced, it uses both.</p>
      <h3>The settings</h3>
      <table><tr><th>Setting</th><th>More</th><th>Less</th></tr>
        <tr><td><b>Tyre pressure</b></td><td>Sharper, livelier - past the green optimum, less grip</td><td>Softer, lazier - under it, less grip</td></tr>
        <tr><td><b>Camber</b></td><td>More corner grip up to the green band (~−2.5 to −3.5°); costs braking (front) and traction (rear)</td><td>Better straight-line braking and traction</td></tr>
        <tr><td><b>Front toe-out</b></td><td>Eager turn-in, nervous straight line</td><td>Toe-in: stable, slow to turn</td></tr>
        <tr><td><b>Rear toe-in</b></td><td>Planted, stable rear</td><td>Toe-out: rotation, twitchy</td></tr>
        <tr><td><b>Springs</b></td><td>Less roll, quicker; that end takes more load transfer and loses grip</td><td>More grip at that end, more roll</td></tr>
        <tr><td><b>Anti-roll bars</b></td><td>Front stiffer: understeer · Rear stiffer: oversteer</td><td>The opposite - bars are the fine balance tool</td></tr>
        <tr><td><b>Dampers</b></td><td>A flat, fast car; too hard skips over bumps</td><td>Compliant, but it wallows and bounces</td></tr>
        <tr><td><b>Ride height</b></td><td>Lower: a lower CG (less transfer); too low bottoms out. Nose lower (rake): keener front</td><td>Higher: more travel</td></tr>
        <tr><td><b>Splitter / wing</b></td><td>Grip that grows with speed² - and drag that costs top speed</td><td>Less drag, less high-speed grip</td></tr>
        <tr><td><b>Brake bias</b></td><td>Forward of ideal: stable, longer stops</td><td>Behind ideal: rotation on the brakes, rear lock-up</td></tr>
        <tr><td><b>Diff power lock</b></td><td>Traction and power oversteer; locked = drift</td><td>The inside wheel spins away</td></tr>
        <tr><td><b>Diff coast lock</b></td><td>Stable on a lift and on the brakes</td><td>Rotates on a lift</td></tr>
        <tr><td><b>Steering ratio</b></td><td>(Lower number) quicker, darty</td><td>Calmer at speed, more work in hairpins</td></tr>
      </table>
      <h3>Fixing what you feel</h3>
      <table><tr><th>The car</th><th>Try</th></tr>
        <tr><td>Pushes wide into slow corners</td><td>Softer front bar, stiffer rear bar, more front camber, a little front toe-out, bias a point back</td></tr>
        <tr><td>Pushes wide in fast corners</td><td>More splitter, less wing, a nose-down rake</td></tr>
        <tr><td>Snaps sideways on a lift</td><td>More coast lock, more rear toe-in, softer rear bar, bias forward</td></tr>
        <tr><td>Spins its wheels out of corners</td><td>Softer rear springs, more power lock, less rear camber, rear pressure at the optimum</td></tr>
        <tr><td>Lazy, leans, wallows</td><td>Stiffer springs and bars, more bump damping, the quick rack, strut braces</td></tr>
        <tr><td>Nervous over bumps, skips</td><td>Softer dampers, softer springs, raise it if it's bottoming out</td></tr>
        <tr><td>Slow on the straight</td><td>Less wing - every degree is drag</td></tr>
        <tr><td>Hopeless in the rain</td><td>Off the slicks and cups: road, or winter tyres. Softer everything</td></tr>
      </table>
      <p>Tip: the blue tick on each slider is stock; the green band is where that setting is optimal for the rest of the setup.</p>
    </div>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  // self-checks (devtools console): the factory setup is the stock car, every lever moves what it should
  {
    const e = (a, b) => Math.abs(a - b) < 1e-9, h0 = HD_STOCK, mk = (parts, setup) => toHd(calc({ ...STOCK_PARTS, ...parts }, { ...STOCK_SETUP, ...setup }));
    console.assert(e(h0.front, 1) && e(h0.rear, 1) && e(h0.grip, 1) && e(h0.response, 1) && e(h0.traction, 1) && e(h0.brake, 1) && !h0.cda && !h0.aeroR, 'stock handling should be the stock car', h0);
    const stiffRear = mk({ arb: 'race' }, { arbR: 9 }), slick = mk({ tyres: 'slick' }, { pF: 1.8, pR: 1.8 }), wing = mk({ aero: 'gt' }, { wing: 15 });
    console.assert(stiffRear.rear < stiffRear.front, 'a stiff rear bar should take rear grip (oversteer)', stiffRear);
    console.assert(slick.grip > 1.2 && slick.wet > 2, 'slicks: far more dry grip, far less wet', slick);
    console.assert(wing.aeroR > 0.1 && wing.cda > 0.1 && axlesOf(wing, 69)[2] > axlesOf(wing, 10)[2], 'a wing: grip that grows with speed, and drag', wing);
  }
})();
