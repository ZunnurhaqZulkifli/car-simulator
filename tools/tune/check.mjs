// Self-check for public/js/car-tune.js's engine model - Node only, no browser, nothing saved anywhere.
//   node tools/tune/check.mjs [js dir (default public/js)] [saved tunes JSON (from dump-tunes.php)] [old car-tune.js to compare against]
// Loads car-tune.js in a vm with a stub DOM + CarService, inits every engine in ENGINES on its car page's own torque table
// (where the page has it as a literal) and asserts:
//   - every part option does something (moves the predicted curve or a fitted effect), and the new tiers / parts move the
//     figure they're for (boost cap, fuel cap, IAT, knock margin, cooling, rod rating...)
//   - every preset predicts finite figures, its needs name real parts, and fitted it raises nothing critical
//   - blue smoke follows rings / turbo / PCV / gasket wear, black smoke a petrol's mixture; neither at idle or cruise
//   - 'engineblow' fires once, with its detail; ch.blown follows blowUp / rebuild; a car that loads blown never fires it
//   - (with a tunes dump) every saved tune loads, and predicts what the old code did with the new parts at stock
// Exits 1 on any failure.
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [jsDir = `${root}/public/js`, dumpFile, oldFile] = process.argv.slice(2);
const SRC = readFileSync(`${jsDir}/car-tune.js`, 'utf8');
let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('  FAIL', what); } };

// each car page's stock torque table and the engine it inits (literal tables only; the rest get a synthetic one)
const PAGES = {};
for (const f of readdirSync(`${root}/storage/app/public/cars`)) {
  const html = readFileSync(`${root}/storage/app/public/cars/${f}`, 'utf8');
  const init = html.match(/CarTune\.init\(\{\s*engine:\s*'(\w+)',\s*torque:\s*(\w+)/);
  const name = init ? init[2] : 'RPM_TORQUE_TABLE';
  const lit = html.match(new RegExp(`const ${name}\\s*=\\s*(\\[\\[[\\d.,\\[\\]\\s]+\\]\\])`));
  const num = (k) => { const m = html.match(new RegExp(`CarTune\\.init\\(\\{[^}]*?\\b${k}:\\s*([\\d.]+)`)); return m ? +m[1] : undefined; };
  PAGES[f.replace('.html', '')] = { engine: init && init[1], torque: lit ? JSON.parse(lit[1]) : null,
    figs: { rev: num('rev'), shift: num('shift'), launch: num('launch'), vmax: num('vmax'), finalDrive: num('finalDrive') } };
}
Object.assign(PAGES['bmw-550d'], { engine: 'B57Q', figs: { rev: 7000, shift: 6700, launch: 2800, vmax: 0, finalDrive: 2.813 } }); // not wired yet (no CarTune.init on the page): its table is the page's Map 4
{ // the Iriz page's Stage 1 curve, sampled the way the page builds it
  const st = { flatFrom: 3.5, flatTo: 4.94, fade: 0.134 }, nm = 150;
  const shape = (k) => (k < st.flatFrom ? 0.7 + 0.3 * Math.max(0, k - 1) / (st.flatFrom - 1) : k < st.flatTo ? 1 : Math.max(0.5, 1 - (k - st.flatTo) * st.fade));
  PAGES['proton-iriz'] = { engine: 'VVT16', figs: { rev: 6800, shift: 6500, launch: 4000, vmax: 0, finalDrive: 4.06 }, torque: [[0, 0], ...Array.from({ length: 19 }, (_, n) => [500 + n * 500, +(nm * shape(0.5 + n * 0.5)).toFixed(1)])] };
}
const ENGINE_KEYS = [...SRC.slice(SRC.indexOf('const ENGINES = {'), SRC.indexOf('// ================= part catalogue')).matchAll(/^ {4}(\w+): \{$/gm)].map((m) => m[1]);
const synth = (tq, max) => [[0, 0], [800, tq * 0.5], [1500, tq * 0.8], [2500, tq], [max * 0.7, tq], [max, tq * 0.72], [max + 1500, tq * 0.4]];

// a fresh car-tune.js per car: stub DOM, CarService and CarDyno; _P hands the test the part catalogue
function load(src, engine, { tune = null, torque, figs = {}, engineMap = 1, slots, slot } = {}) {
  const listeners = {}, events = [], timers = [], parts = [], brakes = {};
  const document = {
    readyState: 'complete', head: { appendChild() {} }, body: { appendChild() {} },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    dispatchEvent: (e) => { events.push(e); (listeners[e.type] || []).forEach((f) => f(e)); return !e.defaultPrevented; },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  };
  const CarService = {
    parts, codes: new Map(), sections: null,
    addPart(p) { const o = { ...p, value: p.value || 0 }; parts.push(o); return o; },
    fault() {}, announce() {}, oilMul: () => 1, setHardware: (hw) => Object.assign(brakes, hw), ignitionOn: () => true,
  };
  ['engine', 'oil', 'oilLevel', 'coolant', 'battery', 'tyre', 'pressure', 'dampers'].forEach((key) => parts.push({ key, value: 0 }));
  class Ev { constructor(type, o = {}) { this.type = type; this.detail = o.detail; this.cancelable = !!o.cancelable; this.defaultPrevented = false; } preventDefault() { if (this.cancelable) this.defaultPrevented = true; } }
  const ctx = { document, CarService, CarDyno: { ch: { ambient: 25 } }, __CAR_STATE__: { slug: 'zz-check', tune, engineMap },
    performance, console, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, setInterval: () => 0, clearTimeout() {},
    setTimeout: (f) => { timers.push(f); return timers.length; }, matchMedia: () => ({ matches: true }), CustomEvent: Ev, Event: Ev, devicePixelRatio: 1 };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.replace('window.CarTune = api;', 'window.CarTune = api; api._P = () => P;'), ctx);
  const e = engine;
  const tq = torque || synth(400, 7000);
  const top = Math.max(...tq.map((p) => p[1]));
  const f = { rev: 7000, shift: 6800, launch: 3000, vmax: 0, finalDrive: 3.2, ...Object.fromEntries(Object.entries(figs).filter(([, v]) => v != null)) };
  ctx.CarTune.init({ engine: e, torque: tq, ...f, gears: [4.7, 3.1, 2.1, 1.7, 1.3, 1.0, 0.84, 0.67], wheelR: 0.33, slot, slots });
  return { T: ctx.CarTune, ctx, events, timers, parts, listeners, top, brakes };
}
const peak = (T, n = 1) => T.predict(n);
const fit = (T, k, id) => T.setPart(k, id);

// ---------------- every engine ----------------
const results = {};
for (const key of ENGINE_KEYS) {
  const page = Object.values(PAGES).find((p) => p.engine === key) || { figs: {} };
  // a page whose table isn't a literal (the NSX's is built from its cam curves): a flat curve at the engine's rating
  const probe = load(SRC, key, { torque: synth(400, 7000), figs: page.figs }).T.presets()[0].cal;
  const torque = page.torque || synth(probe.tq, probe.rev);
  const make = (o) => load(SRC, key, { torque, figs: page.figs, ...o });
  const { T } = make();
  ok(T.on, `${key}: init`);
  const P = T._P(), petrol = T.fuel === 'petrol';
  const base = peak(T);
  ok(Number.isFinite(base.hp) && base.hp > 50, `${key}: stock predicts ${base.hp}`);
  results[key] = { parts: P.length, stockHp: Math.round(base.hp) };
  // saved ids: the controller takes part keys / option ids up to 20 characters
  P.forEach((p) => { ok(p.k.length <= 20 && p.opts.every((o) => String(o.id).length <= 20), `${key}: ${p.k} has an id over 20 characters`); });
  // stock hardware leaves every new effect at neutral
  const hw = { ...T.T.hw };
  ok(hw.injScale === 1 && hw.meth === 0 && hw.taper === 0 && hw.fly === 0 && hw.tqAdd === 0 && hw.diMul === 1 && hw.trap === 1, `${key}: stock new parts are neutral`);

  // every option of every part does something to the model (a dead option would be a cosmetic part)
  const sig = (L) => JSON.stringify({ hw: { ...L.T.T.hw, sound: L.T.T.hw.sound }, b: L.brakes, p: Math.round(peak(L.T).hp * 100), q: Math.round(peak(L.T).tq * 100) });
  for (const p of P) {
    if (p.opts.length < 2 || p.k === 'diff') continue;
    const s0 = sig(make());
    for (const o of p.opts.slice(1)) {
      const L = make(); fit(L.T, p.k, o.id);
      ok(sig(L) !== s0 || ['motor', 'inverter', 'battery', 'charger'].includes(p.k), `${key}: ${p.k}=${o.id} changes nothing`);
    }
  }
  // tiers: a higher option of the same part is the stronger one
  const tierUp = (k, read, what) => {
    const p = P.find((x) => x.k === k);
    if (!p) return;
    const vals = p.opts.map((o) => { const t = make().T; fit(t, k, o.id); return read(t); });
    for (let n = 1; n < vals.length; n++) ok(vals[n] > vals[n - 1] - 1e-9, `${key}: ${k} ${p.opts[n].id} (${vals[n].toFixed(3)}) not above ${p.opts[n - 1].id} (${vals[n - 1].toFixed(3)}) on ${what}`);
  };
  tierUp('internals', (t) => t.T.hw.rod * 1000 + t.T.hw.rev, 'rod rating / revs');
  tierUp('trans', (t) => t.T.hw.transCap, 'gearbox rating');
  tierUp('trans', (t) => -t.T.shiftCut[0], 'shift time');
  tierUp('transcooler', (t) => -t.T.hw.transWear, 'gearbox wear');
  tierUp('radiator', (t) => t.T.hw.radUA, 'cooling');
  tierUp('oilcooler', (t) => t.T.hw.oilCool, 'oil cooling');
  tierUp('intercooler', (t) => t.T.hw.ic, 'intercooler efficiency');
  tierUp('lpfp', (t) => t.T.hw.lp, 'feed flow');
  tierUp('coils', (t) => -t.T.hw.coilSpark, 'misfire resistance');
  tierUp('plugs', (t) => t.T.hw.margin, 'knock margin');
  tierUp('gasket', (t) => t.T.hw.pcp, 'cylinder pressure');
  tierUp('catchcan', (t) => -t.T.hw.trap, 'oil-mist trap');
  tierUp('meth', (t) => t.T.hw.meth, 'meth flow');
  tierUp('diinj', (t) => t.T.hw.diMul, 'DI injector flow');
  // the Pro gearbox holds every preset's torque, well over the race box
  { const t = make().T, r = make().T; fit(t, 'trans', 'pro'); fit(r, 'trans', 'race');
    const top = Math.max(...T.presets().map((pr) => { const L = make(); L.T.loadPreset(1, pr.id); return peak(L.T).tq; }));
    ok(t.T.hw.transCap >= top && t.T.hw.transCap > r.T.hw.transCap * 1.2, `${key}: Pro gearbox ${Math.round(t.T.hw.transCap)} Nm (race ${Math.round(r.T.hw.transCap)}, biggest preset ${Math.round(top)})`); }
  if (petrol) {
    tierUp('hpfp', (t) => t.T.hw.pump, 'HP pump flow');
    tierUp('injection', (t) => t.T.hw.port + t.T.hw.fuelCap, 'injector flow');
    // the turbos, by the top of their boost curve; a wastegate holds more up top
    const tp = P.find((x) => x.k === 'turbo');
    const tops = tp.opts.map((o) => { const t = make().T; fit(t, 'turbo', o.id); return Math.max(...t.T.hw.turbo); });
    for (let n = 1; n < tops.length; n++) ok(tops[n] > tops[n - 1], `${key}: turbo ${tp.opts[n].id} tops out no higher than ${tp.opts[n - 1].id}`);
    if (P.some((x) => x.k === 'wastegate')) { // spools sooner, and holds the top end
      const L = make(); fit(L.T, 'wastegate', 'gate');
      ok(L.T.T.hw.spoolRpm < T.T.hw.spoolRpm && L.T.T.hw.taper > 0, `${key}: wastegate spool ${T.T.hw.spoolRpm}->${L.T.T.hw.spoolRpm}`);
    }
    // meth: more margin and a cooler charge on boost (on an NA engine only once a kit's on)
    if (!P.find((x) => x.k === 'turbo').opts[0].label.includes('NA')) {
      const L0 = make(), L1 = make(); fit(L1.T, 'meth', 'kit');
      const r = 5000, m0 = L0.T.model(1, r), m1 = L1.T.model(1, r);
      ok(m1.margin > m0.margin + 0.5 && m1.iat < m0.iat - 2, `${key}: meth kit margin ${m0.margin.toFixed(2)}->${m1.margin.toFixed(2)}, iat ${m0.iat.toFixed(1)}->${m1.iat.toFixed(1)}`);
    }
    // flex: E85 without it runs lean of target; with it, on target
    { const L = make(); fit(L.T, 'fuel', 'e85'); fit(L.T, 'flex', 'none'); const a = L.T.model(1, 5000); fit(L.T, 'flex', 'kit'); const b = L.T.model(1, 5000);
      ok(a.afr > a.afrT * 1.04 && Math.abs(b.afr - b.afrT) < 0.01, `${key}: flex sensor: E85 ${a.afr.toFixed(2)}/${a.afrT.toFixed(2)} without, ${b.afr.toFixed(2)} with`);
      ok(L.T.predict(1).warn.every((w) => w.key !== 'flex'), `${key}: flex warning stays with the sensor fitted`); }
    // bigger injectors on the untouched stock map run it rich (and warn); on a tuned map they don't
    { const k = P.some((x) => x.k === 'diinj') ? ['diinj', 'ext'] : ['injection', 'port'];
      const L = make(); fit(L.T, ...k); L.T.loadPreset(1, 'stock');
      const m = L.T.model(1, 5000);
      ok(m.afr < m.afrT * 0.97 && L.T.predict(1).warn.some((w) => w.key === 'injscale'), `${key}: ${k.join('=')} on the stock map: afr ${m.afr.toFixed(2)} vs ${m.afrT.toFixed(2)}`); }
    // E85 as in the real world: ~30% more fuel flow and use; with the flex sensor (timing) and fuel enough, a turbo engine
    // makes 6%+ more on its own map, an NA one 2-6%; below 10 °C it misfires until it warms, 98 and a warm day don't
    { const na = P.find((x) => x.k === 'turbo').opts[0].label.includes('None') || !!T.T.hw.na || P.find((x) => x.k === 'intercooler').opts[0].fx.ic === 0;
      const fuelled = (fuel) => { const L = make(); ['injection', 'lpfp', 'hpfp'].forEach((k) => { const p = P.find((x) => x.k === k); if (p) fit(L.T, k, p.opts[p.opts.length - 1].id); });
        fit(L.T, 'flex', 'kit'); fit(L.T, 'fuel', fuel); L.T.loadPreset(1, 'stock'); return L; };
      const a = fuelled('98'), b = fuelled('e85'), gain = peak(b.T).hp / peak(a.T).hp;
      ok(na ? gain > 1.02 && gain < 1.06 : gain > 1.06, `${key}: E85 over 98 on the stock map ${((gain - 1) * 100).toFixed(1)}% (${na ? 'NA: 2-6%' : 'turbo: 6%+'})`);
      const use = [a, b].map((L) => drive(L, { secs: 0.5, rpm: 5000, boost: na ? 0 : 1 }).out.fuelMul);
      ok(use[1] / use[0] > 1.25 && use[1] / use[0] < 1.35, `${key}: E85 burns ${(use[1] / use[0]).toFixed(2)}x the fuel of 98 (want ~1.3)`);
      const misses = (fuel, amb) => { const L = make(); fit(L.T, 'fuel', fuel); fit(L.T, 'flex', 'kit'); L.ctx.CarDyno.ch.ambient = amb;
        drive(L, { secs: 20, rpm: 900, pedal: 0, boost: -0.6, speed: 0, gear: -1, coolant: 20 }); return L.T.cylinders().reduce((n, k) => n + k.misfires, 0); };
      ok(misses('e85', -5) > 0 && misses('e85', 0) > 0 && misses('98', -5) === 0 && misses('e85', 25) === 0, `${key}: E85 cold start (${misses('e85', -5)} misfires at -5 °C, ${misses('98', -5)} on 98, ${misses('e85', 25)} at 25 °C)`); }
    // the new top fuel tiers flow 20%+ more than the old top ones
    { const capWith = (n) => { const L = make(); ['injection', 'diinj', 'hpfp', 'lpfp'].forEach((k) => { const p = P.find((x) => x.k === k); if (p) fit(L.T, k, p.opts[p.opts.length - n].id); }); return L.T.model(1, 5000).cap; };
      ok(capWith(1) > capWith(2) * 1.2, `${key}: top fuel system ${capWith(1).toFixed(2)} vs the old top ${capWith(2).toFixed(2)}`); }
  } else {
    tierUp('injectors', (t) => t.T.hw.inj, 'injector size');
    tierUp('pump', (t) => t.T.hw.pump, 'HP pump flow');
    ok(!P.some((x) => x.k === 'fuel' || x.opts.some((o) => o.id === 'e85')), `${key}: a diesel offers E85`);
    const tp = P.find((x) => x.k === 'turbo');
    const tops = tp.opts.map((o) => { const t = make().T; fit(t, 'turbo', o.id); return Math.max(...t.T.hw.turbo); });
    for (let n = 1; n < tops.length; n++) ok(tops[n] > tops[n - 1], `${key}: turbo ${tp.opts[n].id} tops out no higher than ${tp.opts[n - 1].id}`);
  }
  // the light pulley: ~1% more; the flywheel only where there's a clutch
  { const L = make(); fit(L.T, 'pulley', 'light'); const a = T.model(1, 5000).tqRaw, b = L.T.model(1, 5000).tqRaw;
    ok(b > a * 1.008, `${key}: light pulley adds nothing (${a} vs ${b})`); }
  ok(P.some((x) => x.k === 'flywheel') === !!['S55', 'GT3', 'C30A', 'S85', 'VR38', 'VVT16'].includes(key), `${key}: flywheel only on a clutch car`);

  // presets: finite, real parts, and nothing critical once their hardware is on
  for (const pr of T.presets()) {
    const L = make();
    L.T.loadPreset(1, pr.id);
    const p = peak(L.T);
    ok(Number.isFinite(p.hp) && p.hp > 30, `${key}/${pr.id}: predicts ${p.hp}`);
    results[key][pr.id] = `${Math.round(p.hp)} hp / ${Math.round(p.tq)} Nm`;
  }
  // a car whose first tune is each preset gets that preset's hardware fitted - then nothing critical, no detonation
  // (strict on everything for the presets this job added; the older ones only on critical faults and the new failure modes)
  const NEW = ['stage4', 'map1', 'map2', 'map3', 'map5', 'map6'].concat(['B57Q', 'VVT16'].includes(key) ? ['stock', 'stage2'] : []);
  for (const pr of T.presets()) {
    const L = make({ slots: ['stock', pr.id], slot: 2 });
    const p = L.T.predict(2), all = p.warn.filter((x) => ['crit', 'high'].includes(x.sev));
    const w = all.filter((x) => (NEW.includes(pr.id) ? x.sev === 'crit' || ['rod', 'trans', 'rev'].includes(x.key) : ['det', 'pcp', 'dpf', 'egr'].includes(x.key)) || ['flex', 'injscale'].includes(x.key));
    ok(!w.length, `${key}/${pr.id} on its own hardware: ${w.map((x) => x.text).join(' | ')}`);
    results[key][pr.id] = `${Math.round(p.hp)} hp / ${Math.round(p.tq)} Nm${all.length ? ' (' + all.map((x) => x.key).join(',') + ')' : ''}`;
  }
}

// ---------------- smoke: blue follows wear, black follows mixture; never at idle or cruise ----------------
function drive(L, { secs = 3, rpm = 5500, pedal = 1, boost = 1.2, coolant = 90, speed = 120, gear = 3, fuelCut = false } = {}) {
  let out;
  for (let t = 0; t < secs; t += 1 / 60) out = L.T.tick({ dt: 1 / 60, ignition: true, rpm, pedal, boost, speed, gear, coolant, fuelCut });
  return { blue: L.T.ch.oilSmoke, black: L.T.ch.smoke, out };
}
const wear = (L, k, v) => { const p = L.parts.find((x) => x.key === 'tune-' + k); p.value = v; };
for (const [key, page] of [['B58', 'bmw-140i'], ['B47', 'bmw-320d'], ['S85', 'bmw-m5-e60'], ['VR38', 'nissan-gt-r-nismo']]) {
  const mk = () => load(SRC, key, { torque: PAGES[page].torque, figs: PAGES[page].figs });
  const petrol = mk().T.fuel === 'petrol';
  const wot = { rpm: 6000, pedal: 1, boost: key === 'S85' ? 0 : 1.2 }, idle = { rpm: 800, pedal: 0, boost: -0.6, speed: 0, gear: -1 },
    cruise = { rpm: 2200, pedal: 0.25, boost: -0.2, speed: 100 }, overrun = { rpm: 4500, pedal: 0, boost: -0.7, fuelCut: true };
  const fresh = mk();
  const s0 = drive(fresh, wot);
  ok(s0.blue < 1, `${key}: new engine burns no oil (${s0.blue.toFixed(1)}%)`);
  if (petrol) ok(s0.black < 12, `${key}: stock full-throttle pull is at most a haze (${s0.black.toFixed(1)}%)`);
  for (const [k, w, cond, lo] of [['rings', 100, overrun, 60], ['rings', 60, overrun, 0], ['gasket', 100, cruise, 40], ['pcv', 100, overrun, 50], ['turbo', 100, wot, 60]]) {
    if (key === 'S85' && k === 'turbo') continue;
    const L = mk(); wear(L, k, w); const s = drive(L, cond);
    if (w >= 100) ok(s.blue >= lo, `${key}: ${k} at ${w}% blue smoke ${s.blue.toFixed(1)}% (want ${lo}+)`);
    else ok(s.blue < 12, `${key}: ${k} at ${w}% should be faint, got ${s.blue.toFixed(1)}%`);
  }
  // heavy smoke burns oil
  { const L = mk(); wear(L, 'rings', 100); const lvl = L.parts.find((p) => p.key === 'oilLevel'); drive(L, { ...overrun, secs: 20 });
    ok(lvl.value > 0.15, `${key}: worn rings burn oil (level loss ${lvl.value.toFixed(3)}%)`); }
  if (!petrol) continue;
  // a rich map, leaking injectors, big injectors on a stock map, misfires: clearly black - but not at idle or cruise
  { const L = mk(); wear(L, 'injectors', 100); const s = drive(L, wot); ok(s.black > 35, `${key}: leaking injectors black ${s.black.toFixed(1)}%`);
    const I = mk(), C = mk(); wear(I, 'injectors', 100); wear(C, 'injectors', 100);
    ok(drive(I, idle).black < 1 && drive(C, cruise).black < 1, `${key}: leaking injectors smoke at idle / cruise`); }
  { // a rich map: the AFR table 1.2 richer than stock
    const st = mk().T.presets()[0].cal, rich = { ...st, afr: st.afr.map((a) => +(a - 1.2).toFixed(2)), name: 'Rich' };
    const L = load(SRC, key, { torque: PAGES[page].torque, figs: PAGES[page].figs, tune: { v: 1, slots: { 1: rich, 2: rich }, parts: {}, wear: {}, library: [] } });
    const s = drive(L, wot); ok(s.black > 35, `${key}: a rich map (afr -1.2) black ${s.black.toFixed(1)}%`); }
  { const L = mk(); const k = L.T._P().some((x) => x.k === 'diinj') ? ['diinj', 'ext'] : ['injection', 'port']; fit(L.T, ...k); L.T.loadPreset(1, 'stock');
    const s = drive(L, wot); ok(s.black > 35, `${key}: ${k[1]} injectors on the stock map black ${s.black.toFixed(1)}%`); }
  { const L = mk(); wear(L, 'plugs', 100); wear(L, 'coils', 100); let mx = 0;
    for (let n = 0; n < 240; n++) { L.T.tick({ dt: 1 / 60, ignition: true, ...wot, speed: 120, gear: 3, coolant: 90 }); mx = Math.max(mx, L.T.ch.smoke); }
    ok(mx > 15, `${key}: misfires puff black (peak ${mx.toFixed(1)}%)`); }
}

// ---------------- the blow-up: once, with its detail; ch.blown until the rebuild; never on load ----------------
{
  const L = load(SRC, 'B58', { torque: PAGES['bmw-140i'].torque });
  const fired = () => L.events.filter((e) => e.type === 'engineblow');
  // push it over: every cylinder near dead, the doom hazard climbs past 85%
  L.T.cylinders().forEach((k) => { k.damage = 99; });
  for (let n = 0; n < 6000 && !fired().length; n++) L.T.tick({ dt: 1 / 60, ignition: true, rpm: 6800, pedal: 1, boost: 1.2, speed: 150, gear: 3, coolant: 90 });
  ok(fired().length === 1, `engineblow fired ${fired().length}x`);
  const d = fired()[0] && fired()[0].detail;
  ok(d && typeof d.cause === 'string' && d.cyl >= 1 && d.cyl <= 6 && d.rpm > 1000 && d.speed === 150, `engineblow detail ${JSON.stringify(d)}`);
  ok(L.T.ch.blown === true && L.T.blown(), 'ch.blown after blowUp');
  for (let n = 0; n < 600; n++) L.T.tick({ dt: 1 / 60, ignition: true, rpm: 6800, pedal: 1, boost: 1.2, speed: 150, gear: 3, coolant: 90 });
  ok(fired().length === 1, 'engineblow fires only once');
  // the carstart veto: quiet while the blow-up turns the key back on, a starter clunk after
  ok(L.timers.length >= 1, 'the switch-off is scheduled');
  const save = L.T.saveData();
  ok(save.tune.wear.blown === 100, 'saved as blown');
  const R = load(SRC, 'B58', { torque: PAGES['bmw-140i'].torque, tune: JSON.parse(JSON.stringify(save.tune)) });
  ok(R.T.ch.blown === true, 'a blown engine loads blown');
  for (let n = 0; n < 600; n++) R.T.tick({ dt: 1 / 60, ignition: true, rpm: 0, pedal: 0, boost: 0, speed: 0, gear: -1, coolant: 30 });
  ok(!R.events.some((e) => e.type === 'engineblow'), 'no engineblow for an engine that loads blown');
  const ev = new R.ctx.Event('carstart', { cancelable: true }); R.ctx.document.dispatchEvent(ev);
  ok(ev.defaultPrevented, 'a blown engine vetoes the start');
  R.parts.find((p) => p.key === 'tune-pistons').onService();
  ok(R.T.ch.blown === false && !R.T.blown(), 'ch.blown clears on rebuild');
}

// ---------------- saved tunes (read-only dump of the cars table): load, and predict what the old code did ----------------
if (dumpFile && existsSync(dumpFile)) {
  const OLD = oldFile && existsSync(oldFile) ? readFileSync(oldFile, 'utf8') : null;
  const cars = JSON.parse(readFileSync(dumpFile, 'utf8'));
  console.log('\nsaved tunes (slot 1 / slot 2 hp: old code -> new):');
  for (const car of cars) {
    const page = PAGES[car.slug];
    if (!page || !page.engine || !car.tune) continue;
    const o = { torque: page.torque || synth(400, 7000), figs: page.figs, tune: car.tune, engineMap: car.engine_map };
    let L;
    try { L = load(SRC, page.engine, JSON.parse(JSON.stringify(o))); } catch (e) { ok(false, `${car.slug}: load threw ${e.message}`); continue; }
    const now = [1, 2].map((n) => Math.round(L.T.predict(n).hp));
    let line = `  ${car.slug.padEnd(20)} ${now.join(' / ')}`;
    const A = OLD && load(OLD, page.engine, JSON.parse(JSON.stringify(o)));
    if (A && A.T.on) { // (an old file from before this engine existed has nothing to compare)
      const was = [1, 2].map((n) => Math.round(A.T.predict(n).hp));
      line = `  ${car.slug.padEnd(20)} ${was.join(' / ')} -> ${now.join(' / ')}`;
      [1, 2].forEach((n, i) => {
        const why = L.T.predict(n).warn.find((w) => w.key === 'injscale');
        ok(Math.abs(now[i] - was[i]) <= 1 || why, `${car.slug} slot ${n}: ${was[i]} -> ${now[i]} hp with no new part fitted`);
        if (why) line += `  (slot ${n}: ${why.text.slice(0, 60)}...)`;
      });
    }
    // stock new parts; the save round-trips with every new part present
    const s = L.T.saveData();
    ok(['rings', 'pcv', 'pulley'].every((k) => s.tune.parts[k] === 'stock'), `${car.slug}: new parts load stock`);
    ok(Object.keys(s.tune.parts).length <= 60 && Object.keys(s.tune.wear).length <= 80 && s.tune.stats.mods <= 80, `${car.slug}: save within the controller's limits`);
    console.log(line);
  }
}

console.log('\nper engine (parts · stock · presets):');
for (const [k, r] of Object.entries(results)) console.log(`  ${k.padEnd(7)} ${String(r.parts).padStart(2)} parts · ${Object.entries(r).filter(([x]) => x !== 'parts').map(([x, v]) => `${x}: ${v}`).join(' · ')}`);
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
