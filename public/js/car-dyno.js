// Shared chassis dyno, injected into every car's raw HTML after car-service.js (which tabs the dyno panel).
//
// A car hooks in with:
//   CarDyno.init({ fuel, turbo, rpmMax, hpMax, tqMax }) - once at load. fuel 'petrol' | 'diesel'; turbo = has an
//        intercooler; rpmMax / hpMax / tqMax size the empty chart (a run that goes past them grows it)
//   CarDyno.tick({ dt, ignition, rpm, throttle, hp, tq, gear, gearLabel, speed, coolant, boost, egt, oil, ambient })
//        once per frame. throttle 0..1, gear 0-based (-1 = no drive gear). boost (bar) / egt / oil / ambient (°C)
//        only if the car models them - every other dyno channel is simulated here
//   CarDyno.on   - dyno mode: the car skips kickdown (a pull starts low in a tall gear) and Space runs the dyno
//   CarDyno.hold - a run is armed or recording: the car's auto box holds the gear so the pull stays in it
//
// Flow: dyno mode on, roll into a gear, Space arms, the run records from the first touch of throttle, Space again
// finalises it into the run list. Runs last for the session; Save PDF prints the selected run as a dyno sheet.
// The car's name (nickname, defaults to the model) is edited in the panel title and saved per car.
// Telemetry: the car's cards and the dyno channels are sorted - what can hurt the engine beside the chart (the car's
// 2-column grid), fuel / trip / ambient below it; a narrow panel flows them all into one grid under the chart. The
// status line (run summary) always sits right under the chart. The Telemetry menu switches cards off per car.
(function () {
  const S = window.__CAR_STATE__ || {};
  const cfg = { fuel: 'petrol', turbo: true, rpmMax: 7000, hpMax: 300, tqMax: 400 };
  const api = { on: false, hold: false };
  const BIN = 50; // rpm per logged point
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (cur, target, tau, dt) => cur + (target - cur) * Math.min(1, dt / tau);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const petrol = () => cfg.fuel !== 'diesel';

  // ---- name: a nickname over the model (the car's menu name); blank goes back to the model ----
  const model = S.name || document.title;
  let nickname = S.nickname || '';
  const carName = () => nickname || model;

  // ---- dyno channels: live everywhere, logged into every run sample ----
  const ch = { afr: null, cut: false, load: 0, ambient: 28 + Math.random() * 4, egt: null, iat: null, oil: null, knock: 0 };
  const ambientBase = ch.ambient;
  let soak = 0, tqSeen = 0, clock = 0, hpS = 0, tqS = 0, knockHit = false;
  function simulate(i) {
    const { dt, ignition: on, rpm, throttle } = i;
    clock += dt;
    if (on) tqSeen = Math.max(tqSeen, i.tq);
    const load = ch.load = on ? clamp01(i.tq / Math.max(tqSeen, cfg.tqMax * 0.5)) : 0; // self-calibrating to the car's peak
    const rpmF = clamp01(rpm / cfg.rpmMax);
    const cut = ch.cut = on && throttle < 0.02 && rpm > 1300; // overrun fuel cut
    hpS = on ? ease(hpS, i.hp, 0.1, dt) : 0;
    tqS = on ? ease(tqS, i.tq, 0.1, dt) : 0;
    // intercooler heat soak: builds over sustained load, sheds slowly once it's off
    soak = ease(soak, on ? load * 22 : 0, on && load > 0.3 ? 30 : 90, dt);
    const amb = ch.ambient = i.ambient ?? ease(ch.ambient, ambientBase + soak * 0.12, 30, dt); // the cell warms up during pulls
    const coolant = i.coolant ?? amb;
    ch.oil = i.oil ?? ease(ch.oil ?? coolant, on ? coolant + 4 + load * 20 + rpmF * 8 : amb, on ? 45 : 400, dt);
    const boost = i.boost ?? (cfg.turbo ? load * 1.1 : 0);
    ch.iat = ease(ch.iat ?? amb, amb + (!on ? 0 : cfg.turbo ? 3 + Math.max(0, boost) * 14 + soak : 6 + soak * 0.4), 2.5, dt);
    const egtHot = petrol() ? 300 + rpmF * 250 + load * 400 : 170 + rpmF * 130 + load * 450;
    ch.egt = i.egt ?? ease(ch.egt ?? amb, on ? egtHot * (cut ? 0.55 : 1) : amb, on ? 1.2 : 25, dt);
    // AFR: petrol runs stoich (with the lambda wobble) and goes rich from ~60% pedal or load; a diesel is always
    // lean, richest at full fuelling
    const demand = Math.max(throttle, load);
    if (!on) ch.afr = null;
    else {
      const target = cut ? (petrol() ? 22 : 70)
        : petrol() ? 14.7 - clamp01((demand - 0.55) / 0.35) * 2.3 + (demand < 0.55 ? Math.sin(clock * 7) * 0.12 : 0)
        : 17.5 + Math.pow(1 - load, 1.5) * 45;
      ch.afr = ease(ch.afr ?? target, target, 0.15, dt);
    }
    // knock: sensor noise floor rises with rpm (a diesel's combustion is noisy anyway); a petrol picks up
    // knock events under heavy load, worse when lugging low rpm or with heat-soaked intake air
    knockHit = false;
    const floor = !on ? 0 : (petrol() ? 3 + rpmF * 9 : 12 + rpmF * 10) + Math.random() * 3;
    if (on && petrol() && !cut) {
      const lug = clamp01((2600 - rpm) / 1400) * load;
      const perSec = Math.pow(load, 4) * (0.08 + Math.max(0, ch.iat - 48) * 0.03 + lug * 1.2);
      if (Math.random() < perSec * dt) { ch.knock = Math.max(ch.knock, 30 + Math.random() * 55); knockHit = true; }
    }
    ch.knock = ease(ch.knock, floor, 0.2, dt);
  }

  const CH = [
    { k: 'afr', label: 'Air / Fuel', unit: ':1', color: '#33d17a',
      show: (v) => (ch.cut ? 'CUT' : v.toFixed(1)),
      warn: (v) => (petrol() ? (ch.load > 0.8 && v > 13.2 ? 'red' : '') : (v < 16.5 ? 'amber' : '')) },
    { k: 'ambient', label: 'Ambient', unit: '°C', color: '#8fd3ff', lo: 15, hi: 45, show: (v) => v.toFixed(1), warn: () => '' },
    { k: 'egt', label: 'Exhaust', unit: '°C', color: '#ff7a45', lo: 0, hi: 1000, show: (v) => fmt(v),
      warn: (v) => (v > (petrol() ? 920 : 760) ? 'red' : v > (petrol() ? 860 : 700) ? 'amber' : '') },
    { k: 'iat', label: 'Intercooler', unit: '°C', color: '#4fa8ff', lo: 15, hi: 90, show: (v) => v.toFixed(0),
      warn: (v) => (v > 65 ? 'red' : v > 50 ? 'amber' : '') },
    { k: 'oil', label: 'Oil Temp', unit: '°C', color: '#e8c34a', lo: 15, hi: 150, show: (v) => v.toFixed(0),
      warn: (v) => (v > 135 ? 'red' : v > 125 ? 'amber' : '') },
    { k: 'knock', label: 'Knock', unit: '%', color: '#c48cff', lo: 0, hi: 100, show: (v) => v.toFixed(0),
      warn: (v) => (v > 65 ? 'red' : v > 35 ? 'amber' : '') },
  ];
  const byK = Object.fromEntries(CH.map((c) => [c.k, c]));

  // ---- runs ----
  let state = 'idle'; // idle | armed | rec
  let run = null, selected = null, live = null, hover = null;
  const runs = [];
  const samplesOf = (r) => r.samples || r.bins.filter(Boolean);
  function arm() { state = 'armed'; api.hold = true; msg('Armed - apply throttle to start logging'); }
  function cancel() { state = 'idle'; api.hold = false; msg('Run cancelled'); }
  function start(i) {
    state = 'rec';
    run = { n: runs.length + 1, gear: i.gearLabel || 'G' + (i.gear + 1), at: new Date(), bins: [], ambient: ch.ambient,
      max: { egt: 0, iat: 0, oil: 0, knock: 0, boost: null }, minAfr: null, knockEvents: 0, t: 0 };
  }
  function record(i) {
    const k = Math.round(i.rpm / BIN), prev = run.bins[k];
    const s = { rpm: i.rpm, hp: hpS, tq: tqS, afr: ch.cut ? null : ch.afr, boost: i.boost ?? null, iat: ch.iat,
      egt: ch.egt, oil: ch.oil, knock: ch.knock, speed: i.speed ?? null };
    if (!prev || s.hp > prev.hp) run.bins[k] = s; // best pull at each rpm: a lift or a limiter bounce can't drag it down
    const m = run.max;
    m.egt = Math.max(m.egt, ch.egt); m.iat = Math.max(m.iat, ch.iat); m.oil = Math.max(m.oil, ch.oil); m.knock = Math.max(m.knock, ch.knock);
    if (i.boost != null) m.boost = Math.max(m.boost ?? -1, i.boost);
    if (!ch.cut && ch.afr != null && i.throttle > 0.5) run.minAfr = Math.min(run.minAfr ?? 99, ch.afr);
    if (knockHit) run.knockEvents++;
    run.t += i.dt;
  }
  function finish() {
    state = 'idle'; api.hold = false; live = null;
    const samples = samplesOf(run);
    // the limiter bounce at the end only logs cut-off power - trim that tail off, like dyno software does
    while (samples.length > 6 && samples[samples.length - 1].hp < samples[samples.length - 2].hp * 0.9) samples.pop();
    if (samples.length < 6) { msg('Run too short - discarded'); run = null; return paint(); }
    run.samples = samples; delete run.bins;
    run.peakHp = samples.reduce((a, b) => (b.hp > a.hp ? b : a));
    run.peakTq = samples.reduce((a, b) => (b.tq > a.tq ? b : a));
    runs.push(run);
    msg(`Run ${run.n} saved - ${fmt(run.peakHp.hp)} hp @ ${fmt(run.peakHp.rpm)} rpm, ${fmt(run.peakTq.tq)} Nm @ ${fmt(run.peakTq.rpm)} rpm`);
    selected = run; run = null;
    renderRuns();
    paint();
  }
  function space() {
    if (state === 'idle') arm();
    else if (state === 'armed') cancel();
    else finish();
    paint();
  }
  function setOn(on) {
    api.on = on;
    msg(on ? 'Dyno mode - kickdown off. Roll into a gear, then press Space to arm' : 'Dyno mode off');
    if (!on && state === 'rec') finish();
    else if (!on && state === 'armed') cancel();
    paint();
  }

  // ---- chart: one SVG builder for the panel (dark) and the PDF sheet (light) ----
  const W = 640, PL = 46, PR = 594, PT = 22;
  let PB = 220, H = 260; // H: the panel chart's viewBox height (fitChart); PB follows whichever chart is being drawn
  const DARK = { bg: '#0a0a0a', grid: '#1a1d22', label: '#6f757d', text: '#c7cbd0', hp: '#ff5a3c', tq: '#4fa8ff', glow: true };
  const LIGHT = { bg: '#ffffff', grid: '#e4e6ea', label: '#5f6368', text: '#202124', hp: '#d93025', tq: '#1a63c9', glow: false };
  const STEPS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500];
  function niceTop(v) {
    const need = Math.max(v, 1) * 1.08 / 5;
    return 5 * (STEPS.find((s) => s >= need) || Math.ceil(need / 100) * 100);
  }
  // fit: scale to the run alone (a finished run); otherwise never smaller than the car's own figures
  function scaleFor(samples, fit) {
    let r0 = Infinity, r1 = 0, hp = fit ? 0 : cfg.hpMax, tq = fit ? 0 : cfg.tqMax;
    samples.forEach((s) => { r0 = Math.min(r0, s.rpm); r1 = Math.max(r1, s.rpm); hp = Math.max(hp, s.hp); tq = Math.max(tq, s.tq); });
    const lo = samples.length ? Math.floor(r0 / 500) * 500 : 1000, hi = Math.ceil((r1 + 100) / 500) * 500;
    return {
      x0: fit ? lo : Math.min(1000, lo),
      x1: fit ? hi : Math.max(Math.ceil(cfg.rpmMax / 500) * 500, hi),
      hp: niceTop(hp), tq: niceTop(tq),
    };
  }
  const X = (sc, rpm) => PL + (rpm - sc.x0) / (sc.x1 - sc.x0) * (PR - PL);
  const Y = (top, v) => PB - v / top * (PB - PT);
  function chartSVG(sc, samples, th, o = {}) {
    PB = (o.h || 260) - 40; // the panel's chart takes its box's shape; the PDF sheet's stays 640x260
    const halo = `stroke="${th.bg}" stroke-width="3" paint-order="stroke"`;
    let s = '';
    for (let i = 0; i <= 5; i++) {
      const y = (PB - i * (PB - PT) / 5).toFixed(1);
      s += `<line x1="${PL}" x2="${PR}" y1="${y}" y2="${y}" stroke="${th.grid}"/>` +
        `<text x="${PL - 6}" y="${+y + 3}" text-anchor="end" fill="${th.hp}">${Math.round(sc.hp * i / 5)}</text>` +
        `<text x="${PR + 6}" y="${+y + 3}" fill="${th.tq}">${Math.round(sc.tq * i / 5)}</text>`;
    }
    const step = sc.x1 - sc.x0 > 4000 ? 1000 : 500;
    for (let r = Math.ceil(sc.x0 / step) * step; r <= sc.x1; r += step) {
      const x = X(sc, r).toFixed(1);
      s += `<line x1="${x}" x2="${x}" y1="${PT}" y2="${PB}" stroke="${th.grid}"/>` +
        `<text x="${x}" y="${PB + 14}" text-anchor="middle" fill="${th.label}">${r / 1000}k</text>`;
    }
    s += `<text x="${PL - 6}" y="${PT - 9}" text-anchor="end" fill="${th.hp}" font-weight="700">hp</text>` +
      `<text x="${PR + 6}" y="${PT - 9}" fill="${th.tq}" font-weight="700">Nm</text>` +
      `<text x="${(PL + PR) / 2}" y="${PB + 30}" text-anchor="middle" fill="${th.label}" letter-spacing="1">RPM</text>` +
      `<g font-weight="700"><line x1="${PL + 8}" x2="${PL + 24}" y1="${PT - 12}" y2="${PT - 12}" stroke="${th.hp}" stroke-width="2.4"/>` +
      `<text x="${PL + 28}" y="${PT - 9}" fill="${th.text}">Power</text>` +
      `<line x1="${PL + 72}" x2="${PL + 88}" y1="${PT - 12}" y2="${PT - 12}" stroke="${th.tq}" stroke-width="2.4"/>` +
      `<text x="${PL + 92}" y="${PT - 9}" fill="${th.text}">Torque</text></g>`;
    const line = (key, top, color) => {
      const pts = samples.map((p) => `${X(sc, p.rpm).toFixed(1)},${Y(top, p[key]).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"` +
        (th.glow ? ` style="filter:drop-shadow(0 0 4px ${color}99)"` : '') + '/>';
    };
    if (samples.length > 1) s += line('tq', sc.tq, th.tq) + line('hp', sc.hp, th.hp);
    const mark = (p, key, top, color, text) => {
      const x = X(sc, p.rpm), y = Y(top, p[key]);
      const tx = Math.max(PL + 48, Math.min(PR - 48, x)), ty = y < PT + 16 ? y + 15 : y - 8;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="${color}" stroke="${th.bg}" stroke-width="1.5"/>` +
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" fill="${color}" font-weight="700" ${halo}>${text}</text>`;
    };
    if (o.peaks) {
      s += mark(o.peaks.tq, 'tq', sc.tq, th.tq, `${fmt(o.peaks.tq.tq)} Nm @ ${fmt(o.peaks.tq.rpm)}`) +
        mark(o.peaks.hp, 'hp', sc.hp, th.hp, `${fmt(o.peaks.hp.hp)} hp @ ${fmt(o.peaks.hp.rpm)}`);
    }
    if (o.live) {
      const x = X(sc, o.live.rpm).toFixed(1);
      s += `<line x1="${x}" x2="${x}" y1="${PT}" y2="${PB}" stroke="${th.text}" stroke-opacity=".25" stroke-dasharray="2,3"/>` +
        `<circle cx="${x}" cy="${Y(sc.tq, o.live.tq).toFixed(1)}" r="3.4" fill="${th.tq}"/>` +
        `<circle cx="${x}" cy="${Y(sc.hp, o.live.hp).toFixed(1)}" r="3.4" fill="${th.hp}"/>`;
    }
    if (o.hover) {
      const p = o.hover, x = X(sc, p.rpm), right = x > (PL + PR) / 2, tx = right ? x - 8 : x + 8, a = right ? 'end' : 'start';
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PT}" y2="${PB}" stroke="${th.text}" stroke-opacity=".35"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${Y(sc.tq, p.tq).toFixed(1)}" r="3" fill="${th.tq}"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${Y(sc.hp, p.hp).toFixed(1)}" r="3" fill="${th.hp}"/>` +
        `<g text-anchor="${a}" font-weight="700" ${halo}><text x="${tx.toFixed(1)}" y="${PT + 12}" fill="${th.text}">${fmt(p.rpm)} rpm</text>` +
        `<text x="${tx.toFixed(1)}" y="${PT + 24}" fill="${th.hp}">${p.hp.toFixed(1)} hp</text>` +
        `<text x="${tx.toFixed(1)}" y="${PT + 36}" fill="${th.tq}">${p.tq.toFixed(1)} Nm</text>` +
        (p.afr != null ? `<text x="${tx.toFixed(1)}" y="${PT + 48}" fill="${th.label}">AFR ${p.afr.toFixed(1)}</text>` : '') + '</g>';
    }
    if (o.empty) s += `<text x="${(PL + PR) / 2}" y="${(PT + PB) / 2}" text-anchor="middle" fill="${th.label}" font-size="11">${esc(o.empty)}</text>`;
    return `<g font-family="Arial,Helvetica,sans-serif" font-size="9">${s}</g>`;
  }

  // ---- panel ----
  let svg = null, readout = null, pill = null, chip = null, toggle = null, pdfBtn = null, runsBox = null, chEls = {}, built = false, sc = null;
  const gauges = [];
  const msg = (t) => { if (readout) readout.textContent = t; };
  const CSS = `
    .cd-name{font:700 .78rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;color:#f4f6f8;background:transparent;
      border:1px solid transparent;border-radius:6px;padding:4px 8px;margin-left:-8px;max-width:100%;text-overflow:ellipsis;}
    .cd-name:hover{border-color:#2a2d33;}
    .cd-name:focus{outline:none;border-color:#e8402a;background:#121418;}
    .cd-name-wrap{display:inline-flex;align-items:center;gap:4px;min-width:0;}
    .cd-name-wrap svg{width:12px;height:12px;color:#5d636b;flex:none;cursor:pointer;}
    .cd-model{font:400 .66rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;color:#6f757d;text-transform:none;letter-spacing:0;margin-left:2px;}
    .cd-btn{font:700 .58rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:8px 12px;
      border-radius:999px;border:1px solid #2a2d33;background:#121418;color:#c7cbd0;cursor:pointer;display:inline-flex;align-items:center;gap:8px;
      transition:color .15s,border-color .15s,background .15s;}
    .cd-btn:hover:not(:disabled){color:#fff;border-color:#4a4f57;}
    .cd-btn:disabled{opacity:.35;cursor:default;}
    .cd-btn svg{width:13px;height:13px;}
    .cd-switch i{width:24px;height:13px;border-radius:7px;background:#2a2d33;position:relative;transition:background .15s;}
    .cd-switch i::after{content:"";position:absolute;left:2px;top:2px;width:9px;height:9px;border-radius:50%;background:#8a8f96;transition:transform .15s,background .15s;}
    .cd-switch[aria-checked=true]{color:#fff;border-color:#e8402a;background:rgba(232,64,42,.12);}
    .cd-switch[aria-checked=true] i{background:#e8402a;}
    .cd-switch[aria-checked=true] i::after{transform:translateX(11px);background:#fff;}
    .cd-pill{font:700 .56rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:7px 10px;
      border-radius:999px;border:1px solid #2a2d33;color:#8a8f96;display:none;align-items:center;gap:6px;white-space:nowrap;}
    .cd-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;}
    .cd-pill[data-s=idle],.cd-pill[data-s=armed],.cd-pill[data-s=rec]{display:inline-flex;}
    .cd-pill[data-s=armed]{color:#ffb020;border-color:#5a4210;animation:cdPulse 1.1s ease-in-out infinite;}
    .cd-pill[data-s=rec]{color:#ff5a3c;border-color:#5a1e14;background:rgba(255,90,60,.08);}
    .cd-pill[data-s=rec]::before{animation:cdBlink .8s steps(1) infinite;}
    #dyno-toggle-btn .cd-pill{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#131313;
      box-shadow:0 6px 20px -6px rgba(0,0,0,.7);pointer-events:none;}
    @keyframes cdPulse{50%{opacity:.45;}}
    @keyframes cdBlink{50%{opacity:0;}}
    .dyno-svg{cursor:crosshair;}
    /* the chart with its status line right under it, the engine cards beside both, the rest across the width below */
    .dyno-panel .dyno-content-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 1fr auto;gap:0;align-items:start;}
    .dyno-content-row > .dyno-svg{grid-area:1/1;}
    .dyno-content-row > .dyno-readout{grid-area:2/1;margin:0;}
    .dyno-content-row > .telemetry-grid{grid-area:1/2/3/3;margin-left:16px;}
    .dyno-content-row > .cd-channels{grid-column:1/-1;}
    /* narrow: chart and status line across the top, every card in one grid under them - no half-empty rows */
    .dyno-panel.cs-narrow .dyno-content-row{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));grid-template-rows:none;gap:10px;}
    .cs-narrow .dyno-content-row > .dyno-svg,.cs-narrow .dyno-content-row > .dyno-readout{grid-area:auto/1/auto/-1;}
    .cs-narrow .dyno-content-row > .telemetry-grid,.cs-narrow .dyno-content-row > .cd-channels{display:contents;}
    /* a dragged panel height: the chart takes what the cards and runs leave, rather than all of it - down to 240px,
       past which the section scrolls instead */
    .cs-sized #dyno-graph-wrap{display:flex;flex-direction:column;}
    .cs-sized .dyno-content-row{height:auto !important;flex:1 1 auto;}
    .dyno-panel.cs-sized:not(.cs-narrow) .dyno-content-row{grid-template-rows:minmax(240px,1fr) auto auto;}
    .cs-sized.cs-narrow .dyno-content-row{flex:none;} /* stacked chart + cards keep their height; the section scrolls */
    .cd-channels{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:10px;margin-top:12px;}
    .cd-ch{background:#0a0b0d;border:1px solid #1c1f24;border-radius:10px;transition:border-color .2s;}
    /* every small graph in the panel - the car's telemetry cards and the dyno channels - is the same card */
    .dyno-panel .telemetry-card,.cd-ch{height:78px;box-sizing:border-box;padding:8px 10px 7px;display:flex;flex-direction:column;
      align-items:center;gap:3px;min-width:0;text-align:center;}
    .dyno-panel .telemetry-title,.cd-ch-l{font-size:.56rem;line-height:1.2;letter-spacing:.1em;text-transform:uppercase;margin:0;
      max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cd-ch-l{font-family:"Segoe UI",system-ui,Arial,sans-serif;color:#7d838b;}
    .dyno-panel .telemetry-value,.cd-ch-v{font:700 .85rem/1.1 "Courier New",monospace;color:#f4f6f8;margin:0;white-space:nowrap;}
    .cd-ch-v small{font-size:.58rem;color:#7d838b;margin-left:2px;}
    .dyno-panel .telemetry-svg,.cd-ch svg{display:block;width:100%;height:30px;margin-top:auto;flex:none;}
    .dyno-panel .telemetry-svg *,.cd-ch polyline{vector-effect:non-scaling-stroke;}
    .cd-ch polyline{fill:none;stroke-width:1.4;stroke-linejoin:round;}
    .cd-gauge{display:block;height:30px;width:auto;aspect-ratio:100/52;margin-top:auto;flex:none;fill:none;stroke-width:9;}
    .cd-gauge-track{stroke:#1c1f24;}
    .cd-gauge-val{stroke-dasharray:0 100;transition:stroke-dasharray .15s linear;}
    .cd-off{display:none !important;}
    .cd-menu{inset:auto;margin:0;min-width:200px;overflow:auto;padding:10px 8px;background:#121418;
      border:1px solid #2a2d33;border-radius:12px;color:#c7cbd0;box-shadow:0 14px 34px -10px rgba(0,0,0,.85);
      font:.72rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;}
    .cd-menu .cd-switch{width:100%;justify-content:space-between;flex-direction:row-reverse;}
    .cd-menu h4{margin:12px 6px 4px;font-size:.5rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6f757d;}
    .cd-menu label{display:flex;align-items:center;gap:9px;padding:6px;border-radius:6px;cursor:pointer;white-space:nowrap;}
    .cd-menu label:hover{background:#1a1d22;}
    .cd-menu input{margin:0;accent-color:#e8402a;}
    .cd-menu-off label{opacity:.4;cursor:default;}
    .cd-ch[data-w=amber]{border-color:#4a3a14;} .cd-ch[data-w=amber] .cd-ch-v{color:#ffb020;}
    .cd-ch[data-w=red]{border-color:#5a1e14;} .cd-ch[data-w=red] .cd-ch-v{color:#ff5a3c;}
    .cd-runs{margin-top:14px;}
    .cd-runs[hidden]{display:none;}
    .cd-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;font:700 .6rem/1 "Segoe UI",system-ui,Arial,sans-serif;
      letter-spacing:.14em;text-transform:uppercase;color:#c7cbd0;}
    .cd-head span{font-weight:400;letter-spacing:.02em;text-transform:none;color:#6f757d;}
    .cd-wrap{overflow:auto;border:1px solid #1c1f24;border-radius:10px;max-height:190px;}
    .cd-table{width:100%;border-collapse:collapse;font:.7rem/1.3 "Courier New",monospace;color:#c7cbd0;white-space:nowrap;}
    .cd-table th{font:700 .5rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6f757d;
      text-align:right;padding:8px 10px;border-bottom:1px solid #1c1f24;background:#0a0b0d;position:sticky;top:0;}
    .cd-table td{text-align:right;padding:6px 10px;border-bottom:1px solid #15171b;}
    .cd-table tr:last-child td{border-bottom:0;}
    .cd-table th:first-child,.cd-table td:first-child{text-align:left;}
    .cd-runs-t tbody tr{cursor:pointer;}
    .cd-runs-t tbody tr:hover{background:#121418;}
    .cd-runs-t tr[aria-selected=true]{background:rgba(232,64,42,.08);}
    .cd-runs-t tr[aria-selected=true] td:first-child{box-shadow:inset 2px 0 #e8402a;}
    .cd-hp{color:#ff5a3c;} .cd-tq{color:#4fa8ff;}
    .cd-icon{background:none;border:1px solid transparent;border-radius:6px;color:#8a8f96;cursor:pointer;padding:3px 5px;line-height:0;}
    .cd-icon:hover{color:#fff;border-color:#2a2d33;}
    .cd-icon svg{width:13px;height:13px;}
    .cd-log{margin-top:10px;}
    .cd-log summary{cursor:pointer;font:700 .58rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;
      color:#8a8f96;padding:6px 0;}
    .cd-log summary:hover{color:#fff;}
    .cd-log .cd-wrap{max-height:260px;overflow:auto;margin-top:6px;}
  `;
  const PDF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9.5 15.5 12 18l2.5-2.5"/></svg>';
  const TELE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>';
  const PEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';

  function build() {
    const panel = document.querySelector('.dyno-panel');
    svg = panel && panel.querySelector('.dyno-svg');
    if (!svg) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    readout = document.getElementById('dyno-readout');
    if (!cfg.turbo) byK.iat.label = 'Intake Air';
    if (!petrol()) Object.assign(byK.afr, { lo: 15, hi: 70 });
    else Object.assign(byK.afr, { lo: 10, hi: 22 });

    // title: editable car name, model alongside once it's renamed
    const title = panel.querySelector('.dyno-title');
    title.innerHTML = `<span class="cd-name-wrap"><input class="cd-name" maxlength="60" spellcheck="false" aria-label="Car name" title="Rename this car" placeholder="${esc(model)}">${PEN_ICON}</span><span class="cd-model"></span>`;
    const input = title.querySelector('.cd-name'), modelEl = title.querySelector('.cd-model');
    const measure = document.createElement('canvas').getContext('2d');
    const fit = () => { // the field hugs its text
      measure.font = getComputedStyle(input).font;
      input.style.width = Math.ceil(measure.measureText(input.value || input.placeholder).width + 20) + 'px';
    };
    const showName = () => {
      input.value = carName();
      modelEl.textContent = nickname ? model : '';
      fit();
    };
    showName();
    title.querySelector('svg').addEventListener('click', () => { input.focus(); input.select(); });
    input.addEventListener('input', fit);
    // typing a name mustn't drive the car (M = manual, I = ignition...)
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = carName(); input.blur(); }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const v = input.value.trim().replace(/\s+/g, ' ');
      nickname = v === model ? '' : v;
      showName();
      CarAPI.saveName(nickname || null);
    });
    input.addEventListener('blur', showName);

    const actions = panel.querySelector('.dyno-title-actions');
    pill = document.createElement('span');
    pill.className = 'cd-pill';
    toggle = document.createElement('button');
    toggle.className = 'cd-btn cd-switch';
    toggle.setAttribute('role', 'switch');
    toggle.title = 'Dyno mode: kickdown off, Space arms and finishes a run';
    toggle.innerHTML = '<i></i>Dyno mode';
    toggle.addEventListener('click', () => { setOn(!api.on); toggle.blur(); });
    pdfBtn = document.createElement('button');
    pdfBtn.className = 'cd-btn';
    pdfBtn.innerHTML = PDF_ICON + 'Save PDF';
    pdfBtn.title = 'Save the selected run as a PDF dyno sheet';
    pdfBtn.addEventListener('click', () => { if (selected) savePDF(selected); pdfBtn.blur(); });
    actions.prepend(pill, toggle, pdfBtn);

    // status chip on the floating dyno button, so dyno mode (Space no longer brakes) shows with the panel shut
    chip = document.createElement('span');
    chip.className = 'cd-pill';
    const fab = document.getElementById('dyno-toggle-btn');
    if (fab) fab.appendChild(chip);

    // channels strip + run list under the chart
    const row = panel.querySelector('.dyno-content-row');
    const strip = document.createElement('div');
    strip.className = 'cd-channels';
    CH.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'cd-ch';
      el.innerHTML = `<div class="cd-ch-l">${c.label}</div><div class="cd-ch-v">--</div>` +
        `<svg viewBox="0 0 100 24" preserveAspectRatio="none"><polyline stroke="${c.color}"/></svg>`;
      strip.appendChild(el);
      chEls[c.k] = { el, v: el.querySelector('.cd-ch-v'), line: el.querySelector('polyline'), hist: [] };
    });
    runsBox = document.createElement('div');
    runsBox.className = 'cd-runs';
    runsBox.hidden = true;
    if (readout) svg.after(readout); // status line stays right under the chart
    row.append(strip);
    row.after(runsBox);

    // the car's telemetry cards: sparklines stretch to the shared card size, long titles get a short label, and the
    // bounded readings show as semicircle gauges in the card's own colour
    panel.querySelectorAll('.telemetry-svg').forEach((s) => s.setAttribute('preserveAspectRatio', 'none'));
    const SHORT = { 'Fuel Consumption': 'Consumption', 'Exhaust Gas Temp': 'Exhaust Temp' };
    panel.querySelectorAll('.telemetry-title').forEach((t) => {
      t.title = t.textContent;
      t.textContent = SHORT[t.textContent] || t.textContent;
    });
    const arc = 'M8 48A42 42 0 0 1 92 48';
    ['temp', 'fuel', 'boost', 'oil'].forEach((k) => {
      const line = document.getElementById(`tele-${k}-line`);
      if (!line) return;
      const spark = line.ownerSVGElement;
      spark.insertAdjacentHTML('afterend', `<svg class="cd-gauge" viewBox="0 0 100 52"><path class="cd-gauge-track" d="${arc}"/>` +
        `<path class="cd-gauge-val" d="${arc}" pathLength="100" stroke="${line.getAttribute('stroke')}"/></svg>`);
      spark.style.display = 'none'; // the car keeps plotting it - the gauge reads its newest point
      gauges.push({ line, val: spark.nextElementSibling.lastElementChild });
    });

    // ---- telemetry: what can hurt the engine sits beside the chart, the rest (fuel, trip, ambient) below it ----
    const grid = panel.querySelector('.telemetry-grid');
    const cards = [...panel.querySelectorAll('.telemetry-card')].filter((el) => el.querySelector('.telemetry-value[id]'))
      .map((el) => ({ id: el.querySelector('.telemetry-value').id.replace(/-val$/, ''), label: el.querySelector('.telemetry-title').textContent, el }))
      .concat(CH.map((c) => ({ id: 'ch-' + c.k, label: c.label, el: chEls[c.k].el })));
    const BESIDE = ['tele-temp', 'ch-oil', 'tele-oil', 'tele-boost', 'ch-egt', 'ch-iat', 'ch-afr', 'ch-knock'];
    const beside = grid ? BESIDE.map((id) => cards.find((c) => c.id === id)).filter(Boolean) : [];
    const below = cards.filter((c) => !beside.includes(c));
    beside.forEach((c) => grid.appendChild(c.el));
    below.forEach((c) => strip.appendChild(c.el));

    // Telemetry menu: a master switch plus one box per card, saved per car in the layout
    const saved = (S.layout && S.layout.telemetry) || {};
    const off = new Set(saved.off || []);
    let teleOn = !saved.hidden;
    const menu = document.createElement('div');
    menu.className = 'cd-menu';
    menu.popover = 'auto';
    const box = (c) => `<label><input type="checkbox" data-id="${esc(c.id)}">${esc(c.label)}</label>`;
    menu.innerHTML = '<button class="cd-btn cd-switch" role="switch"><i></i>Telemetry</button>' +
      (beside.length ? `<h4>Beside the chart</h4>${beside.map(box).join('')}` : '') + `<h4>Below the chart</h4>${below.map(box).join('')}`;
    const master = menu.querySelector('.cd-switch');
    const shown = (c) => teleOn && !off.has(c.id);
    const applyTele = () => {
      cards.forEach((c) => c.el.classList.toggle('cd-off', !shown(c)));
      if (grid) grid.classList.toggle('cd-off', !beside.some(shown)); // no cards beside: the chart takes the width
      strip.classList.toggle('cd-off', !below.some(shown));
      master.setAttribute('aria-checked', String(teleOn));
      menu.classList.toggle('cd-menu-off', !teleOn);
      menu.querySelectorAll('input').forEach((i) => { i.checked = !off.has(i.dataset.id); i.disabled = !teleOn; });
      fitChart();
    };
    const saveTele = () => {
      applyTele();
      if (window.CarService && CarService.setLayout) CarService.setLayout('telemetry', { off: off.size ? [...off] : null, hidden: !teleOn });
    };
    master.addEventListener('click', () => { teleOn = !teleOn; saveTele(); });
    menu.addEventListener('change', (e) => { const id = e.target.dataset.id; if (e.target.checked) off.delete(id); else off.add(id); saveTele(); });
    const teleBtn = document.createElement('button');
    teleBtn.className = 'cd-btn';
    teleBtn.innerHTML = TELE_ICON + 'Telemetry';
    teleBtn.title = 'Choose which telemetry shows';
    teleBtn.popoverTargetElement = menu;
    teleBtn.addEventListener('click', () => teleBtn.blur());
    toggle.before(teleBtn);
    document.body.appendChild(menu);
    // opens under its button, or over it when the panel sits low on the page; keys typed in it mustn't drive the car,
    // and Escape shuts only the menu, not the panel
    menu.addEventListener('beforetoggle', (e) => {
      if (e.newState !== 'open') return;
      const r = teleBtn.getBoundingClientRect(), up = innerHeight - r.bottom < 320 && r.top > innerHeight - r.bottom;
      Object.assign(menu.style, {
        top: up ? 'auto' : r.bottom + 6 + 'px', bottom: up ? innerHeight - r.top + 6 + 'px' : 'auto',
        right: Math.max(8, innerWidth - r.right) + 'px', maxHeight: (up ? r.top : innerHeight - r.bottom) - 18 + 'px',
      });
    });
    window.addEventListener('scroll', () => { if (menu.matches(':popover-open')) menu.hidePopover(); }, { passive: true });
    ['keydown', 'keyup'].forEach((t) => menu.addEventListener(t, (e) => e.stopPropagation()));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.matches(':popover-open')) { e.stopImmediatePropagation(); menu.hidePopover(); }
    }, true);
    applyTele();
    new ResizeObserver(() => requestAnimationFrame(fitChart)).observe(svg);
    if (grid) new ResizeObserver(() => requestAnimationFrame(fitChart)).observe(grid);

    svg.addEventListener('mousemove', (e) => {
      const r = selected && state !== 'rec' ? selected : null;
      if (!r || !sc) return;
      const p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const v = p.matrixTransform(svg.getScreenCTM().inverse());
      const rpm = sc.x0 + (v.x - PL) / (PR - PL) * (sc.x1 - sc.x0);
      const near = r.samples.reduce((a, b) => (Math.abs(b.rpm - rpm) < Math.abs(a.rpm - rpm) ? b : a));
      hover = v.x >= PL && v.x <= PR ? near : null;
      draw();
    });
    svg.addEventListener('mouseleave', () => { hover = null; draw(); });

    const keys = document.querySelector('.keys, .hint');
    if (keys) keys.insertAdjacentHTML('beforeend', ' <span><kbd>Space</kbd>arm / finish a dyno run (dyno mode)</span>');

    // Space runs the dyno instead of braking: capture on window gets it before the car's own key handlers
    const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    window.addEventListener('keydown', (e) => {
      if (!api.on || e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) space();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (!api.on || e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);

    built = true;
    msg('Turn on Dyno mode to start a run');
    paint();
  }

  // state-driven bits: pills, switch, buttons, chart
  function paint() {
    if (!built) return;
    const s = api.on ? state : 'off';
    const text = { off: '', idle: 'Ready · Space', armed: 'Armed', rec: 'Rec ' + (run ? run.gear : '') }[s];
    [pill, chip].forEach((p) => { p.dataset.s = s; p.textContent = text; });
    chip.textContent = s === 'idle' ? 'Dyno' : text;
    toggle.setAttribute('aria-checked', String(api.on));
    pdfBtn.disabled = !selected;
    draw();
  }

  // the panel's chart fills its box - with its status line, as tall as the cards beside it, or as the dragged panel
  // height allows - by giving its viewBox the box's shape rather than letterboxing a 640x260 chart
  function fitChart() {
    const w = svg.clientWidth, panel = svg.closest('.dyno-panel'), grid = svg.parentElement.querySelector('.telemetry-grid');
    if (!w) return;
    const narrow = panel.classList.contains('cs-narrow'), sized = !narrow && panel.classList.contains('cs-sized');
    const beside = !narrow && grid && !grid.classList.contains('cd-off') ? grid.offsetHeight - (readout ? readout.offsetHeight : 0) : 0;
    const h = Math.max(sized ? 120 : 260, Math.round(W * (sized ? svg.clientHeight : beside) / w));
    if (h === H) return;
    H = h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    draw();
  }

  function draw() {
    if (!built) return;
    if (state === 'rec' && run) {
      const samples = samplesOf(run);
      sc = scaleFor(samples, false);
      svg.innerHTML = chartSVG(sc, samples, DARK, { live, h: H });
      return;
    }
    const r = state === 'armed' ? null : selected;
    sc = scaleFor(r ? r.samples : [], !!r);
    const empty = !api.on ? (runs.length ? '' : 'Turn on Dyno mode to start a run')
      : state === 'armed' ? 'Armed - apply throttle to start logging'
      : r ? '' : 'Roll into a gear, then press Space to arm';
    svg.innerHTML = chartSVG(sc, r ? r.samples : [], DARK, { peaks: r && { hp: r.peakHp, tq: r.peakTq }, hover, empty, h: H });
  }

  let logOpen = false;
  function renderRuns() {
    runsBox.hidden = !runs.length;
    if (!runs.length) return;
    const head = ['Run', 'Gear', 'Power', 'Torque', 'AFR @ peak', 'EGT max', byK.iat.label + ' max', 'Oil max', 'Knock', '']
      .map((c) => `<th>${c}</th>`).join('');
    const rows = runs.slice().reverse().map((r) => `<tr data-n="${r.n}" aria-selected="${r === selected}">` +
      `<td>#${r.n}</td><td>${esc(r.gear)}</td>` +
      `<td class="cd-hp">${fmt(r.peakHp.hp)} hp @ ${fmt(r.peakHp.rpm)}</td><td class="cd-tq">${fmt(r.peakTq.tq)} Nm @ ${fmt(r.peakTq.rpm)}</td>` +
      `<td>${r.peakHp.afr != null ? r.peakHp.afr.toFixed(1) : '–'}</td><td>${fmt(r.max.egt)} °C</td><td>${r.max.iat.toFixed(0)} °C</td>` +
      `<td>${r.max.oil.toFixed(0)} °C</td><td>${r.max.knock.toFixed(0)}% · ${r.knockEvents}×</td>` +
      `<td><button class="cd-icon" data-pdf="${r.n}" title="Save run ${r.n} as PDF" aria-label="Save run ${r.n} as PDF">${PDF_ICON}</button></td></tr>`).join('');
    const log = selected ? logTable(selected) : '';
    runsBox.innerHTML = `<div class="cd-head">Runs<span>click a run to view it · hover the chart to read it</span></div>` +
      `<div class="cd-wrap"><table class="cd-table cd-runs-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` +
      (selected ? `<details class="cd-log"${logOpen ? ' open' : ''}><summary>Data log · run ${selected.n}</summary><div class="cd-wrap">${log}</div></details>` : '');
    runsBox.querySelectorAll('tbody tr[data-n]').forEach((tr) => tr.addEventListener('click', (e) => {
      const r = runs.find((x) => x.n === +tr.dataset.n);
      const pdf = e.target.closest('[data-pdf]');
      if (pdf) { pdf.blur(); return savePDF(r); }
      selected = r; hover = null;
      renderRuns();
      paint();
    }));
    const det = runsBox.querySelector('.cd-log');
    if (det) det.addEventListener('toggle', () => { logOpen = det.open; });
  }

  // data log: the run read off every 250 rpm (the nearest logged point, so gaps stay gaps)
  function logRows(r, step) {
    const s = r.samples, out = [];
    for (let rpm = Math.ceil(s[0].rpm / step) * step; rpm <= s[s.length - 1].rpm; rpm += step) {
      const p = s.reduce((a, b) => (Math.abs(b.rpm - rpm) < Math.abs(a.rpm - rpm) ? b : a));
      if (Math.abs(p.rpm - rpm) <= 150) out.push(p);
    }
    return out;
  }
  function logCols(r) {
    const hasBoost = r.samples.some((s) => s.boost != null);
    return [
      ['RPM', (s) => fmt(Math.round(s.rpm / 10) * 10)],
      ['Power hp', (s) => s.hp.toFixed(1), 'cd-hp'],
      ['Torque Nm', (s) => s.tq.toFixed(1), 'cd-tq'],
      ['AFR', (s) => (s.afr == null ? 'cut' : s.afr.toFixed(1))],
      hasBoost && ['Boost bar', (s) => (s.boost == null ? '–' : s.boost.toFixed(2))],
      [byK.iat.label + ' °C', (s) => s.iat.toFixed(0)],
      ['EGT °C', (s) => fmt(s.egt)],
      ['Oil °C', (s) => s.oil.toFixed(0)],
      ['Knock %', (s) => s.knock.toFixed(0)],
      ['Speed km/h', (s) => (s.speed == null ? '–' : fmt(s.speed))],
    ].filter(Boolean);
  }
  function logTable(r, step = 250) {
    const cols = logCols(r);
    return `<table class="cd-table"><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>` +
      logRows(r, step).map((s) => `<tr>${cols.map((c) => `<td${c[2] ? ` class="${c[2]}"` : ''}>${c[1](s)}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>';
  }

  // ---- PDF: a printable dyno sheet in a hidden frame - the print dialog's "Save as PDF" writes the file ----
  const sheetTitle = (r) => `${carName()} - Dyno Run ${r.n} - ${r.at.toISOString().slice(0, 10)}`;
  function sheetHTML(r) {
    const s = scaleFor(r.samples, true), name = carName();
    const when = r.at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const card = (label, value, sub, cls = '') => `<div class="card ${cls}"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
    const stat = (label, value) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`;
    const chart = `<svg viewBox="0 0 ${W} 260" xmlns="http://www.w3.org/2000/svg">${chartSVG(s, r.samples, LIGHT, { peaks: { hp: r.peakHp, tq: r.peakTq } })}</svg>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheetTitle(r))}</title><style>
      @page{size:A4 portrait;margin:12mm;}
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      body{margin:0;font:11px/1.35 "Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#202124;}
      header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;padding-bottom:10px;border-bottom:2px solid #202124;}
      .eyebrow{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#d93025;}
      h1{margin:4px 0 0;font-size:24px;line-height:1.1;letter-spacing:-.01em;}
      .model{color:#5f6368;font-size:12px;margin-top:3px;}
      .meta{text-align:right;color:#5f6368;font-size:10.5px;line-height:1.6;}
      .meta b{color:#202124;font-size:14px;}
      .cards{display:grid;grid-template-columns:1.2fr 1.2fr 1fr 1fr;gap:8px;margin:12px 0;}
      .card{border:1px solid #dadce0;border-radius:8px;padding:9px 12px;}
      .card .l{font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#5f6368;}
      .card .v{font-size:22px;font-weight:700;margin-top:2px;}
      .card .s{color:#5f6368;font-size:10px;}
      .card.hp .v{color:#d93025;} .card.tq .v{color:#1a63c9;}
      .chart{border:1px solid #dadce0;border-radius:8px;padding:8px 4px 2px;}
      .chart svg{display:block;width:100%;height:auto;}
      .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid #dadce0;border-radius:8px;margin:12px 0;overflow:hidden;}
      .stat{padding:7px 10px;border-right:1px solid #ececec;border-bottom:1px solid #ececec;}
      .stat span{display:block;font-size:8px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5f6368;}
      .stat b{font-size:12.5px;}
      h2{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#5f6368;margin:14px 0 6px;}
      table{width:100%;border-collapse:collapse;font:9.5px/1.25 "SF Mono",Menlo,Consolas,"Courier New",monospace;}
      th{font:700 7.5px/1.2 "Segoe UI",system-ui,Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5f6368;
        text-align:right;padding:5px 6px;border-bottom:1.5px solid #202124;}
      td{text-align:right;padding:3.5px 6px;border-bottom:1px solid #ececec;}
      th:first-child,td:first-child{text-align:left;}
      tr{break-inside:avoid;}
      .cd-hp{color:#d93025;font-weight:700;} .cd-tq{color:#1a63c9;font-weight:700;}
      footer{margin-top:12px;padding-top:8px;border-top:1px solid #dadce0;color:#80868b;font-size:8.5px;display:flex;justify-content:space-between;}
    </style></head><body>
      <header>
        <div><div class="eyebrow">Chassis Dyno Report</div><h1>${esc(name)}</h1>${nickname ? `<div class="model">${esc(model)}</div>` : ''}</div>
        <div class="meta"><b>Run ${r.n}</b><br>${esc(when)}<br>Gear ${esc(r.gear)} · ${r.t.toFixed(1)} s pull</div>
      </header>
      <div class="cards">
        ${card('Max Power', `${fmt(r.peakHp.hp)} hp`, `@ ${fmt(r.peakHp.rpm)} rpm · ${fmt(r.peakHp.hp * 0.7457)} kW · ${fmt(r.peakHp.hp * 1.0139)} PS`, 'hp')}
        ${card('Max Torque', `${fmt(r.peakTq.tq)} Nm`, `@ ${fmt(r.peakTq.rpm)} rpm · ${fmt(r.peakTq.tq * 0.7376)} lb-ft`, 'tq')}
        ${card('AFR @ Peak', r.peakHp.afr != null ? r.peakHp.afr.toFixed(1) + ' :1' : '–', r.minAfr != null ? `richest ${r.minAfr.toFixed(1)} :1 under load` : '&nbsp;')}
        ${card('Ambient', `${r.ambient.toFixed(1)} °C`, `${cfg.fuel === 'diesel' ? 'Diesel' : 'Petrol'} · ${cfg.turbo ? 'turbocharged' : 'naturally aspirated'}`)}
      </div>
      <div class="chart">${chart}</div>
      <div class="stats">
        ${stat('EGT max', `${fmt(r.max.egt)} °C`)}${stat(byK.iat.label + ' max', `${r.max.iat.toFixed(0)} °C`)}${stat('Oil temp max', `${r.max.oil.toFixed(0)} °C`)}
        ${stat('Knock max', `${r.max.knock.toFixed(0)} %`)}${stat('Knock events', r.knockEvents)}
        ${stat('Boost max', r.max.boost != null ? `${r.max.boost.toFixed(2)} bar` : '–')}${stat('Start', `${fmt(r.samples[0].rpm)} rpm`)}
        ${stat('End', `${fmt(r.samples[r.samples.length - 1].rpm)} rpm`)}${stat('Logged points', r.samples.length)}${stat('Correction', 'none (uncorrected)')}
      </div>
      <h2>Data log · every 500 rpm</h2>
      ${logTable(r, 500)}
      <footer><span>${esc(name)} · run ${r.n} · ${esc(when)}</span><span>Instrument Cluster Sim · simulated chassis dyno</span></footer>
    </body></html>`;
  }
  function savePDF(r) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    // some browsers name the PDF after the top page rather than the printed frame, so retitle those for the dialog
    const docs = [document, window.top.document].map((d) => [d, d.title]);
    frame.onload = () => {
      docs.forEach(([d]) => { d.title = sheetTitle(r); });
      frame.contentWindow.addEventListener('afterprint', () => {
        docs.forEach(([d, t]) => { d.title = t; });
        setTimeout(() => frame.remove(), 0);
      });
      frame.contentWindow.print();
    };
    frame.srcdoc = sheetHTML(r);
    document.body.appendChild(frame);
    msg(`Run ${r.n}: choose "Save as PDF" in the print dialog`);
  }

  // ---- per frame ----
  let frameN = 0;
  function tick(i) {
    simulate(i);
    if (!built) return;
    if (state === 'armed' && i.ignition && i.gear >= 0 && i.throttle > 0.05) { start(i); paint(); }
    if (state === 'rec') {
      if (!i.ignition) finish();
      else {
        record(i);
        live = { rpm: i.rpm, hp: hpS, tq: tqS };
        if (frameN % 2 === 0) draw();
        msg(`${run.gear} · ${fmt(i.rpm)} rpm · ${hpS.toFixed(1)} hp · ${tqS.toFixed(1)} Nm` + (i.speed != null ? ` · ${fmt(i.speed)} km/h` : ''));
      }
    }
    if (frameN++ % 6) return; // channels at ~10 Hz
    gauges.forEach((g) => {
      // every car plots its telemetry sparklines as y = 60 - frac * 50, so the newest point is the reading on the car's own scale
      const pts = g.line.getAttribute('points') || '';
      const frac = pts ? clamp01((60 - pts.slice(pts.lastIndexOf(',') + 1)) / 50) : 0;
      g.val.style.strokeDasharray = `${(frac * 100).toFixed(1)} 100`;
    });
    CH.forEach((c) => {
      const el = chEls[c.k], v = ch[c.k];
      if (v == null) { el.v.innerHTML = '--'; el.el.dataset.w = ''; return; }
      el.v.innerHTML = `${c.show(v)}<small>${ch.cut && c.k === 'afr' ? '' : c.unit}</small>`;
      el.el.dataset.w = i.ignition ? c.warn(v) : '';
      el.hist.push(Math.max(c.lo, Math.min(c.hi, v)));
      if (el.hist.length > 90) el.hist.shift();
      el.line.setAttribute('points', el.hist.map((h, n) => `${(n / 89 * 100).toFixed(1)},${(22 - (h - c.lo) / (c.hi - c.lo) * 20).toFixed(1)}`).join(' '));
    });
  }

  api.init = (o) => { Object.assign(cfg, o); paint(); };
  api.tick = tick;
  window.CarDyno = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
