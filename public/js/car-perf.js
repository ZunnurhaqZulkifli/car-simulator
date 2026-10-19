// Performance tab (a Dragy / VBOX style meter), injected after car-dyno.js. Fills CarService.sections.perf.
// Fed by CarDyno.tick, which hands every frame on: it reads { dt, speed (km/h), gear (-1 = no drive gear) } - no
// per-car code. Saved runs go into the car's history.
//
// Flow: switch Timing on and stop - the run starts the moment the car moves off and ends when it's stopped again,
// then re-arms by itself. Every split is interpolated between frames, so it reads to the hundredth. Runs last for
// the session; click one to view it, and the next run races it as a ghost. Reuses car-dyno.js's .cd-* styles
// (switch, pill, run table).
(function () {
  const G = 9.80665, MILE = 1609.344;
  const STOP = 0.1; // km/h: at or under it the car is standing still
  const CAP = 300; // s: a run that never stops ends here, so a long cruise can't log forever
  const C = { speed: '#4fa8ff', acc: '#33d17a', brk: '#ff5a3c', mark: '#ffb020', best: '#c48cff', ghost: '#8a8f96',
    grid: '#1a1d22', label: '#6f757d', text: '#c7cbd0', bg: '#0a0a0a' };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (cur, target, tau, dt) => cur + (target - cur) * Math.min(1, dt / tau);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const secs = (t) => (t < 60 ? t.toFixed(2) : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`);
  const signed = (g, dp = 2) => (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(dp);

  // the board; lo = lower is better. A run's res[k] = { v, sub } once it's reached
  const TILES = [
    { k: 'ft', label: '60 ft', dist: 18.288, unit: 's', dp: 2, lo: true, hint: '18.3 m launch' },
    { k: '0-100', label: '0–100 km/h', from: 0, to: 100, unit: 's', dp: 2, lo: true, hint: 'standing start' },
    { k: '0-200', label: '0–200 km/h', from: 0, to: 200, unit: 's', dp: 2, lo: true, hint: 'standing start' },
    { k: '100-200', label: '100–200 km/h', from: 100, to: 200, unit: 's', dp: 2, lo: true, hint: 'rolling' },
    { k: '200-300', label: '200–300 km/h', from: 200, to: 300, unit: 's', dp: 2, lo: true, hint: 'rolling' },
    { k: 'q', label: '¼ mile', dist: MILE / 4, mark: '¼ mi', unit: 's', dp: 2, lo: true, hint: '402 m' },
    { k: 'h', label: '½ mile', dist: MILE / 2, mark: '½ mi', unit: 's', dp: 2, lo: true, hint: '805 m' },
    { k: 'm', label: '1 mile', dist: MILE, mark: '1 mi', unit: 's', dp: 2, lo: true, hint: '1,609 m' },
    { k: 'stop', label: '100–0 km/h', unit: 'm', dp: 1, lo: true, hint: 'braking distance' },
    { k: 'acc', label: 'Peak accel', unit: 'g', dp: 2, peak: true, hint: 'longitudinal' },
    { k: 'brk', label: 'Peak braking', unit: 'g', dp: 2, peak: true, hint: 'longitudinal' },
    { k: 'top', label: 'Top speed', unit: 'km/h', dp: 1, peak: true, hint: 'this run' },
  ];
  const bestOf = (tl, list) => {
    const vs = list.map((r) => r.res[tl.k] && r.res[tl.k].v).filter((v) => v != null);
    return vs.length ? (tl.lo ? Math.min(...vs) : Math.max(...vs)) : null;
  };

  // ---- timing ----
  let on = false, state = 'off'; // off | wait (moving / no drive gear) | ready (stopped: moving off starts a run) | rec
  let run = null, selected = null, hover = null, gS = 0, lastV = 0, note = '';
  const runs = [];

  function start(i) {
    state = 'rec';
    hover = null;
    run = { n: runs.length + 1, t: 0, d: 0, v: 0, res: {}, marks: [], up: { 0: { t: 0, d: 0 } }, stopFrom: null,
      samples: [{ t: 0, v: 0, d: 0, g: gS }], vs: selected, flashed: new Set() };
    note = `Run ${run.n} · ${i.gearLabel || 'G' + (i.gear + 1)}` + (run.vs ? ` · racing run ${run.vs.n}` : '');
  }
  // one frame of a run: crossings land at their interpolated instant inside the frame
  function step(i) {
    const r = run, dt = i.dt, v0 = r.v, v1 = i.speed, t0 = r.t, d0 = r.d;
    const t1 = t0 + dt, d1 = d0 + (v0 + v1) / 7.2 * dt; // trapezoid, km/h -> m
    const at = (f) => ({ t: t0 + f * dt, d: d0 + f * (d1 - d0), v: v0 + f * (v1 - v0) });
    [100, 200, 300].forEach((x) => {
      if (v0 < x && v1 >= x) {
        const p = r.up[x] = at((x - v0) / (v1 - v0)); // the latest climb through x, so a rolling split starts there
        if (x === 100) r.stopFrom = null;
        if (!r.marks.some((m) => m.v === x)) r.marks.push({ t: p.t, v: x });
      } else if (x === 100 && v0 >= x && v1 < x) r.stopFrom = at((v0 - x) / (v0 - v1));
    });
    TILES.forEach((tl) => {
      if (r.res[tl.k]) return;
      if (tl.to) {
        const a = r.up[tl.from], b = r.up[tl.to];
        if (a && b) r.res[tl.k] = { v: b.t - a.t, sub: `in ${fmt(b.d - a.d)} m` };
      } else if (tl.dist && d1 >= tl.dist) {
        const p = at((tl.dist - d0) / (d1 - d0));
        r.res[tl.k] = { v: p.t, sub: `trap ${p.v.toFixed(1)} km/h` };
        if (tl.mark) r.marks.push({ t: p.t, mark: tl.mark });
      }
    });
    if (gS > (r.res.acc ? r.res.acc.v : 0)) r.res.acc = { v: gS, sub: `at ${fmt(v1)} km/h` };
    if (-gS > (r.res.brk ? r.res.brk.v : 0)) r.res.brk = { v: -gS, sub: `at ${fmt(v1)} km/h` };
    if (v1 > (r.res.top ? r.res.top.v : 0)) r.res.top = { v: v1, sub: `at ${secs(t1)} s` };
    Object.assign(r, { t: t1, d: d1, v: v1 });
    if (t1 - r.samples[r.samples.length - 1].t >= 0.05) r.samples.push({ t: t1, v: v1, d: d1, g: gS }); // 20 Hz log
  }
  function finish() {
    const r = run;
    run = null;
    r.samples.push({ t: r.t, v: r.v, d: r.d, g: gS });
    if (r.stopFrom && r.v <= STOP) r.res.stop = { v: r.d - r.stopFrom.d, sub: `in ${(r.t - r.stopFrom.t).toFixed(2)} s` };
    if (!r.res.top || r.res.top.v < 20) { note = `Run ${r.n} discarded - under 20 km/h`; return; }
    runs.push(r);
    selected = r;
    const q = r.res.q, z = r.res['0-100'];
    note = `Run ${r.n} saved` + (z ? ` · 0–100 ${z.v.toFixed(2)} s` : '') + (q ? ` · ¼ mile ${q.v.toFixed(2)} s ${q.sub}` : '') +
      (!z && !q ? ` · top ${r.res.top.v.toFixed(1)} km/h` : '');
    if (window.CarAPI && CarAPI.log) CarAPI.log('perf', note.replace(/^Run (\d+) saved/, 'Performance run $1'));
    renderRuns();
  }
  function setOn(v) {
    on = v;
    if (!on && run) finish();
    state = on ? 'wait' : 'off';
    note = on ? '' : 'Timing off';
    draw();
  }

  let frameN = 0;
  function tick(i) {
    const v = i.speed ?? 0;
    if (i.dt > 0) gS = ease(gS, (v - lastV) / 3.6 / i.dt / G, 0.1, i.dt);
    lastV = v;
    if (state === 'rec') {
      step(i);
      if (v <= STOP || run.t >= CAP) { finish(); state = v <= STOP ? 'ready' : 'wait'; draw(); }
    } else if (on) {
      if (state === 'ready' && v > STOP && i.gear >= 0) { start(i); step(i); }
      else state = v <= STOP ? 'ready' : 'wait';
    }
    paint(v, frameN++);
  }

  // ---- panel ----
  const CSS = `
    .cp-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;}
    .cp-top .cs-section-title{margin-bottom:4px;}
    .cp-cap{font:.62rem/1.4 "Courier New",monospace;color:#6f757d;letter-spacing:.04em;}
    .cp-actions{display:flex;align-items:center;gap:8px;}
    .cp-hero{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;}
    .cp-card{background:#0a0b0d;border:1px solid #1c1f24;border-radius:12px;padding:12px 14px;flex:1 1 130px;min-width:0;
      display:flex;flex-direction:column;gap:6px;transition:border-color .25s,box-shadow .25s;}
    .cp-l{font:700 .56rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#7d838b;}
    .cp-v{font:800 2.1rem/1 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;font-variant-numeric:tabular-nums;color:#f4f6f8;
      letter-spacing:-.02em;white-space:nowrap;}
    .cp-v small{font-size:.72rem;font-weight:600;color:#6f757d;margin-left:4px;letter-spacing:.04em;}
    .cp-sub{font:.62rem/1.3 "Courier New",monospace;color:#6f757d;min-height:1em;}
    .cp-timer{flex:2 1 220px;background:radial-gradient(120% 140% at 0% 0%,rgba(79,168,255,.07),transparent 60%),#0a0b0d;}
    .cp-timer .cp-v{font-size:3.1rem;}
    .cp-timer[data-s=armed]{border-color:#7a5a14;animation:cpArm 1.1s ease-in-out infinite;}
    @keyframes cpArm{50%{border-color:#2a2410;}}
    .cp-timer[data-s=rec]{border-color:#5a1e14;box-shadow:0 0 0 1px rgba(255,90,60,.25) inset,0 0 34px -12px rgba(255,90,60,.6);}
    .cp-timer[data-s=rec] .cp-v{text-shadow:0 0 22px rgba(255,90,60,.45);}
    .cp-meter{height:3px;border-radius:2px;background:#1c1f24;overflow:hidden;margin-top:auto;}
    .cp-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#4fa8ff,#c48cff);box-shadow:0 0 8px #4fa8ff;}
    .cp-gcard{flex:0 0 auto;flex-direction:row;align-items:center;gap:12px;}
    .cp-gm{width:104px;height:104px;display:block;flex:none;}
    .cp-gm circle.r{fill:none;stroke:#1f2329;}
    .cp-gm text{font:700 6.5px "Segoe UI",system-ui,Arial,sans-serif;fill:#4c5259;letter-spacing:.08em;}
    .cp-gread{display:flex;flex-direction:column;gap:7px;}
    .cp-gread .cp-v{font-size:1.5rem;}
    .cp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:8px;margin-bottom:12px;}
    .cp-tile{position:relative;overflow:hidden;background:#0a0b0d;border:1px solid #1c1f24;border-radius:10px;padding:9px 11px 11px;
      display:flex;flex-direction:column;gap:3px;min-width:0;transition:border-color .25s;}
    .cp-tile .cp-l{font-size:.52rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cp-tv{font:700 1.12rem/1.15 "Courier New",monospace;color:#f4f6f8;white-space:nowrap;}
    .cp-tv small{font-size:.6rem;color:#6f757d;margin-left:3px;}
    .cp-tile[data-empty] .cp-tv{color:#30353c;}
    .cp-ts{font:.58rem/1.2 "Courier New",monospace;color:#6f757d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cp-td{position:absolute;top:8px;right:9px;font:700 .5rem/1 "Courier New",monospace;color:#8a8f96;}
    .cp-tp{position:absolute;left:0;bottom:0;height:2px;width:0;background:#ffb020;box-shadow:0 0 6px #ffb020;}
    .cp-tile[data-done] .cp-tp{width:100% !important;background:#2a2d33;box-shadow:none;}
    .cp-tile.cp-pb{border-color:#4b3470;} .cp-tile.cp-pb .cp-tv{color:#c48cff;text-shadow:0 0 14px rgba(196,140,255,.4);}
    .cp-tile.cp-pb .cp-td{color:#0a0b0d;background:#c48cff;padding:3px 5px;border-radius:4px;top:6px;right:7px;letter-spacing:.08em;}
    .cp-tile.cp-hit{animation:cpHit 1.4s ease-out;}
    @keyframes cpHit{0%{border-color:#ffb020;box-shadow:0 0 0 1px #ffb020 inset,0 0 26px -2px rgba(255,176,32,.55);}100%{box-shadow:none;}}
    .cp-chart{display:block;width:100%;height:auto;background:#0a0b0d;border:1px solid #1c1f24;border-radius:12px;cursor:crosshair;}
    .cp-runs{margin-top:14px;}
    .cp-runs[hidden]{display:none;}
    .cp-runs th small{font-weight:400;letter-spacing:0;text-transform:none;}
    .cp-runs td.cp-best{color:#c48cff;font-weight:700;}
    .cs-tab[data-tab=perf][data-s=armed]::after,.cs-tab[data-tab=perf][data-s=rec]::after{content:"";width:6px;height:6px;border-radius:50%;
      background:#ffb020;animation:cdPulse 1.1s ease-in-out infinite;}
    .cs-tab[data-tab=perf][data-s=rec]::after{background:#ff5a3c;animation:cdBlink .8s steps(1) infinite;}
  `;
  // g-meter: 36 px per g, rings at .5 / 1 / 1.5 g; acceleration pushes the dot up, braking down
  const GPX = 36;
  const GM = `<svg class="cp-gm" viewBox="-60 -60 120 120" aria-hidden="true">
    <circle class="r" r="54"/><circle class="r" r="36"/><circle class="r" r="18" stroke-dasharray="2 3"/>
    <line x1="-58" x2="58" stroke="#1f2329"/><line y1="-58" y2="58" stroke="#1f2329"/>
    <text x="0" y="-45" text-anchor="middle">ACCEL</text><text x="0" y="50" text-anchor="middle">BRAKE</text>
    <text x="38" y="-3">1.0</text><text x="56" y="-3" text-anchor="end">1.5</text>
    <line data-g="pa" x1="-9" x2="9" stroke="${C.acc}" stroke-width="2" stroke-linecap="round" opacity="0"/>
    <line data-g="pb" x1="-9" x2="9" stroke="${C.brk}" stroke-width="2" stroke-linecap="round" opacity="0"/>
    <polyline data-g="trail" fill="none" stroke-width="5" stroke-linecap="round" opacity=".28"/>
    <circle data-g="dot" r="5.5" fill="${C.text}"/></svg>`;

  let els = null;
  const trail = [];
  function build() {
    const CS = window.CarService;
    const sec = CS && CS.sections && CS.sections.perf;
    if (!sec) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    sec.innerHTML = `<div class="cp-top"><div><div class="cs-section-title">Performance</div>
        <div class="cp-cap">Clock starts the moment the car moves · splits interpolated to 0.01 s</div></div>
        <div class="cp-actions"><span class="cd-pill"></span>
        <button class="cd-btn cd-switch" role="switch" aria-checked="false" title="Time every run from a standstill"><i></i>Timing</button></div></div>
      <div class="cp-hero">
        <div class="cp-card cp-timer"><div class="cp-l">Run time</div><div class="cp-v"><span data-h="t">0.00</span><small>s</small></div>
          <div class="cp-sub" data-h="msg"></div></div>
        <div class="cp-card"><div class="cp-l">Speed</div><div class="cp-v"><span data-h="v">0</span><small>km/h</small></div>
          <div class="cp-sub" data-h="top"></div><div class="cp-meter"><i data-h="vbar"></i></div></div>
        <div class="cp-card"><div class="cp-l">Distance</div><div class="cp-v"><span data-h="d">0</span><small>m</small></div>
          <div class="cp-sub" data-h="mi"></div><div class="cp-meter"><i data-h="dbar"></i></div></div>
        <div class="cp-card cp-gcard">${GM}<div class="cp-gread"><div class="cp-l">Long. G</div>
          <div class="cp-v"><span data-h="g">+0.00</span><small>g</small></div><div class="cp-sub" data-h="gpk"></div></div></div>
      </div>
      <div class="cp-tiles">${TILES.map((tl) => `<div class="cp-tile" data-k="${tl.k}" data-empty><div class="cp-l">${tl.label}</div>` +
        `<div class="cp-tv">—</div><div class="cp-ts">${tl.hint}</div><div class="cp-td"></div><div class="cp-tp"></div></div>`).join('')}</div>
      <svg class="cp-chart" viewBox="0 0 ${W} ${H}"></svg>
      <div class="cp-runs" hidden></div>`;
    const q = (s) => sec.querySelector(s), h = (k) => q(`[data-h="${k}"]`), gm = (k) => q(`[data-g="${k}"]`);
    els = {
      sec, timer: q('.cp-timer'), pill: q('.cd-pill'), toggle: q('.cd-switch'), chart: q('.cp-chart'), runs: q('.cp-runs'),
      tab: document.querySelector('.cs-tab[data-tab=perf]'),
      t: h('t'), v: h('v'), d: h('d'), g: h('g'), msg: h('msg'), top: h('top'), mi: h('mi'), gpk: h('gpk'), vbar: h('vbar'), dbar: h('dbar'),
      dot: gm('dot'), trail: gm('trail'), pa: gm('pa'), pb: gm('pb'),
      tiles: TILES.map((tl) => {
        const box = q(`.cp-tile[data-k="${tl.k}"]`);
        return { box, v: box.querySelector('.cp-tv'), s: box.querySelector('.cp-ts'), d: box.querySelector('.cp-td'), p: box.querySelector('.cp-tp') };
      }),
    };
    els.toggle.addEventListener('click', () => { setOn(!on); els.toggle.blur(); });
    els.runs.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-n]');
      if (!tr) return;
      selected = runs.find((r) => r.n === +tr.dataset.n);
      hover = null;
      renderRuns();
      draw();
    });
    els.chart.addEventListener('mousemove', (e) => {
      if (run || !selected) return;
      const p = els.chart.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const x = p.matrixTransform(els.chart.getScreenCTM().inverse()).x, t = (x - PL) / (PR - PL) * chartX1;
      hover = x >= PL && x <= PR ? selected.samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)) : null;
      draw();
    });
    els.chart.addEventListener('mouseleave', () => { hover = null; draw(); });
    draw();
  }

  // live readouts every frame, the board a few times a second, the chart at ~15 Hz while a run records
  function paint(v, n) {
    if (!els) return;
    const r = run || selected, s = { off: 'off', wait: 'idle', ready: 'armed', rec: 'rec' }[state];
    if (els.tab) els.tab.dataset.s = s; // the tab blinks while armed / recording, so it shows from the other tabs
    if (!els.sec.offsetParent) return; // tab not shown / panel shut
    els.pill.dataset.s = els.timer.dataset.s = s;
    els.pill.textContent = { off: '', wait: 'Stop to arm', ready: 'Ready · launch', rec: 'Recording' }[state];
    els.toggle.setAttribute('aria-checked', String(on));
    els.t.textContent = secs(r ? r.t : 0);
    els.v.textContent = v.toFixed(v < 100 ? 1 : 0);
    els.d.textContent = r ? fmt(r.d) : '0';
    els.top.textContent = r && r.res.top ? `top ${r.res.top.v.toFixed(1)} km/h` : '';
    els.mi.textContent = r ? `${(r.d / MILE).toFixed(3)} mi` : '';
    els.vbar.style.width = clamp01(v / 320) * 100 + '%';
    els.dbar.style.width = clamp01((r ? r.d : 0) / MILE) * 100 + '%';
    els.msg.textContent = state === 'rec' || note ? note
      : { off: 'Switch Timing on to time your runs', wait: 'Come to a stop to arm the clock', ready: 'Armed - the clock starts as you move off' }[state];
    // g-meter
    const y = Math.max(-56, Math.min(56, -gS * GPX)), col = gS > 0.04 ? C.acc : gS < -0.04 ? C.brk : C.text;
    trail.push(y);
    if (trail.length > 20) trail.shift();
    els.dot.setAttribute('cy', y.toFixed(1));
    els.dot.setAttribute('fill', col);
    els.dot.style.filter = `drop-shadow(0 0 5px ${col})`;
    els.trail.setAttribute('points', trail.map((t) => `0,${t.toFixed(1)}`).join(' '));
    els.trail.setAttribute('stroke', col);
    els.g.textContent = signed(gS);
    const pa = r && r.res.acc, pb = r && r.res.brk;
    [[els.pa, pa, -1], [els.pb, pb, 1]].forEach(([el, pk, dir]) => {
      el.setAttribute('opacity', pk ? 1 : 0);
      if (pk) el.setAttribute('transform', `translate(0 ${(dir * Math.min(56, pk.v * GPX)).toFixed(1)})`);
    });
    els.gpk.textContent = pa || pb ? `pk ${signed(pa ? pa.v : 0)} / ${signed(pb ? -pb.v : 0)}` : '';
    if (n % 4) return;
    paintTiles(r);
    if (state === 'rec') draw();
  }

  function paintTiles(r) {
    const others = runs.filter((x) => x !== r);
    TILES.forEach((tl, i) => {
      const el = els.tiles[i], res = r && r.res[tl.k], best = bestOf(tl, others);
      const better = res && (best == null || (tl.lo ? res.v <= best : res.v >= best));
      el.v.innerHTML = res ? `${res.v.toFixed(tl.dp)}<small>${tl.unit}</small>` : '—';
      el.s.textContent = res ? res.sub : tl.hint;
      el.d.textContent = !res || best == null ? '' : better ? 'BEST' : signed(res.v - best, tl.dp);
      el.box.classList.toggle('cp-pb', !!(better && others.length));
      el.box.toggleAttribute('data-empty', !res);
      el.box.toggleAttribute('data-done', !!(res && !tl.peak));
      const live = r && r === run && !res && !tl.peak;
      el.p.style.width = !live ? '0' : (tl.dist ? clamp01(r.d / tl.dist) : tl.to ? clamp01((r.v - tl.from) / (tl.to - tl.from)) : 0) * 100 + '%';
      if (r === run && res && !tl.peak && !r.flashed.has(tl.k)) { // a split just landed
        r.flashed.add(tl.k);
        el.box.classList.remove('cp-hit');
        void el.box.offsetWidth;
        el.box.classList.add('cp-hit');
      }
    });
  }

  function renderRuns() {
    if (!els) return;
    els.runs.hidden = !runs.length;
    if (!runs.length) return;
    const head = '<th>Run</th>' + TILES.map((tl) => `<th>${tl.label.replace(' km/h', '')} <small>${tl.unit}</small></th>`).join('');
    const rows = runs.slice().reverse().map((r) => `<tr data-n="${r.n}" aria-selected="${r === selected}"><td>#${r.n}</td>` +
      TILES.map((tl) => {
        const x = r.res[tl.k], best = runs.length > 1 && x && x.v === bestOf(tl, runs);
        return `<td${best ? ' class="cp-best"' : ''}>${x ? x.v.toFixed(tl.dp) : '–'}</td>`;
      }).join('') + '</tr>').join('');
    els.runs.innerHTML = '<div class="cd-head">Runs<span>click a run to view it · your next run races it as a ghost · purple = session best</span></div>' +
      `<div class="cd-wrap"><table class="cd-table cd-runs-t"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---- chart: speed over time on top, longitudinal G under it, sharing the time axis ----
  const W = 640, H = 300, PL = 46, PR = 604, ST = 24, SB = 178, GT = 198, GB = 262;
  let chartX1 = 10;
  function chartSVG(r, ghost, o) {
    const all = [r, ghost].filter(Boolean);
    const maxT = Math.max(10, ...all.map((x) => x.t));
    const step = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => Math.ceil(maxT / s) <= 8) || 300;
    const x1 = chartX1 = Math.ceil(maxT / step) * step;
    const maxV = Math.max(100, ...all.map((x) => (x.res.top ? x.res.top.v : 0)));
    const vStep = maxV > 250 ? 50 : maxV > 120 ? 40 : 20, vTop = Math.ceil(maxV * 1.06 / vStep) * vStep;
    const maxG = all.reduce((m, x) => x.samples.reduce((a, p) => Math.max(a, Math.abs(p.g)), m), 1);
    const gTop = Math.ceil(maxG * 1.1 * 2) / 2, GZ = (GT + GB) / 2;
    const X = (t) => PL + t / x1 * (PR - PL), Y = (v) => SB - v / vTop * (SB - ST);
    const YG = (g) => GZ - Math.max(-gTop, Math.min(gTop, g)) / gTop * (GZ - GT);
    const pts = (list, f) => list.map((p) => `${X(p.t).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
    const halo = `stroke="${C.bg}" stroke-width="3" paint-order="stroke"`;
    let s = `<defs><linearGradient id="cp-sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.speed}" stop-opacity=".32"/>` +
      `<stop offset="1" stop-color="${C.speed}" stop-opacity="0"/></linearGradient>` +
      `<clipPath id="cp-up"><rect x="${PL}" y="${GT - 2}" width="${PR - PL}" height="${GZ - GT + 2}"/></clipPath>` +
      `<clipPath id="cp-dn"><rect x="${PL}" y="${GZ}" width="${PR - PL}" height="${GB - GZ + 2}"/></clipPath></defs>`;
    for (let v = 0; v <= vTop; v += vStep) {
      s += `<line x1="${PL}" x2="${PR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${C.grid}"/>` +
        `<text x="${PL - 6}" y="${Y(v) + 3}" text-anchor="end" fill="${C.speed}">${v}</text>`;
    }
    [-gTop, -gTop / 2, 0, gTop / 2, gTop].forEach((g, i) => {
      s += `<line x1="${PL}" x2="${PR}" y1="${YG(g)}" y2="${YG(g)}" stroke="${g ? C.grid : '#2a2d33'}"/>` +
        (i % 2 ? '' : `<text x="${PL - 6}" y="${YG(g) + 3}" text-anchor="end" fill="${g > 0 ? C.acc : g < 0 ? C.brk : C.label}">${g ? signed(g, 1) : '0'}</text>`);
    });
    for (let t = 0; t <= x1; t += step) {
      const x = X(t).toFixed(1);
      s += `<line x1="${x}" x2="${x}" y1="${ST}" y2="${SB}" stroke="${C.grid}"/><line x1="${x}" x2="${x}" y1="${GT}" y2="${GB}" stroke="${C.grid}"/>` +
        `<text x="${x}" y="${GB + 14}" text-anchor="middle" fill="${C.label}">${t}s</text>`;
    }
    s += `<text x="${PL - 6}" y="${ST - 10}" text-anchor="end" fill="${C.speed}" font-weight="700">km/h</text>` +
      `<text x="${PL + 4}" y="${GT - 6}" fill="${C.label}" font-weight="700" letter-spacing="1">LONG. G</text>` +
      `<text x="${(PL + PR) / 2}" y="${GB + 30}" text-anchor="middle" fill="${C.label}" letter-spacing="1">TIME</text>`;
    const key = [['Speed', C.speed], ['Accel', C.acc], ['Braking', C.brk]].concat(ghost ? [[`Run ${ghost.n}`, C.ghost, '4,3']] : []);
    key.forEach(([label, col, dash], i) => {
      const x = PL + 8 + i * 70;
      s += `<line x1="${x}" x2="${x + 16}" y1="${ST - 13}" y2="${ST - 13}" stroke="${col}" stroke-width="2.4"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` +
        `<text x="${x + 20}" y="${ST - 10}" fill="${C.text}" font-weight="700">${label}</text>`;
    });
    if (ghost) {
      s += `<polyline points="${pts(ghost.samples, (p) => Y(p.v))}" fill="none" stroke="${C.ghost}" stroke-width="1.5" stroke-dasharray="4,3" opacity=".7"/>` +
        `<polyline points="${pts(ghost.samples, (p) => YG(p.g))}" fill="none" stroke="${C.ghost}" stroke-width="1" stroke-dasharray="3,3" opacity=".45"/>`;
    }
    if (r && r.samples.length > 1) {
      const last = r.samples[r.samples.length - 1], sp = pts(r.samples, (p) => Y(p.v)), gp = pts(r.samples, (p) => YG(p.g));
      s += `<polygon points="${X(0)},${SB} ${sp} ${X(last.t).toFixed(1)},${SB}" fill="url(#cp-sg)"/>` +
        `<polyline points="${sp}" fill="none" stroke="${C.speed}" stroke-width="2.2" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px ${C.speed}99)"/>`;
      [['cp-up', C.acc], ['cp-dn', C.brk]].forEach(([clip, col]) => {
        s += `<g clip-path="url(#${clip})"><polygon points="${X(0)},${GZ} ${gp} ${X(last.t).toFixed(1)},${GZ}" fill="${col}" fill-opacity=".2"/>` +
          `<polyline points="${gp}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" style="filter:drop-shadow(0 0 3px ${col}88)"/></g>`;
      });
      r.marks.forEach((m) => {
        const x = X(m.t);
        if (m.mark) {
          s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${ST}" y2="${GB}" stroke="${C.mark}" stroke-opacity=".5" stroke-dasharray="2,3"/>` +
            `<text x="${(x + 4).toFixed(1)}" y="${ST + 10}" fill="${C.mark}" font-weight="700" ${halo}>${m.mark} ${secs(m.t)}</text>`;
        } else {
          const y = Y(m.v), tx = Math.max(PL + 52, x - 7);
          s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="${C.mark}" stroke="${C.bg}" stroke-width="1.5"/>` +
            `<text x="${tx.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="end" fill="${C.mark}" font-weight="700" ${halo}>${m.v} · ${secs(m.t)}s</text>`;
        }
      });
      if (o.live) {
        s += `<circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4" fill="#fff" style="filter:drop-shadow(0 0 6px ${C.speed})"/>` +
          `<circle cx="${X(last.t).toFixed(1)}" cy="${YG(last.g).toFixed(1)}" r="3" fill="#fff"/>`;
      }
    }
    if (o.hover) {
      const p = o.hover, x = X(p.t), right = x > (PL + PR) / 2, tx = (right ? x - 8 : x + 8).toFixed(1);
      s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${ST}" y2="${GB}" stroke="${C.text}" stroke-opacity=".35"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="${C.speed}"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${YG(p.g).toFixed(1)}" r="3" fill="${p.g >= 0 ? C.acc : C.brk}"/>` +
        `<g text-anchor="${right ? 'end' : 'start'}" font-weight="700" ${halo}>` +
        `<text x="${tx}" y="${ST + 24}" fill="${C.text}">${secs(p.t)} s</text>` +
        `<text x="${tx}" y="${ST + 36}" fill="${C.speed}">${p.v.toFixed(1)} km/h</text>` +
        `<text x="${tx}" y="${ST + 48}" fill="${C.label}">${fmt(p.d)} m</text>` +
        `<text x="${tx}" y="${ST + 60}" fill="${p.g >= 0 ? C.acc : C.brk}">${signed(p.g)} g</text></g>`;
    }
    if (!r) {
      const empty = { off: 'Switch Timing on, stop, then launch', wait: 'Come to a stop to arm the clock',
        ready: 'Armed - the clock starts the moment you move' }[state];
      s += `<text x="${(PL + PR) / 2}" y="${(ST + SB) / 2}" text-anchor="middle" fill="${C.label}" font-size="11">${empty}</text>`;
    }
    return `<g font-family="Arial,Helvetica,sans-serif" font-size="9">${s}</g>`;
  }
  function draw() {
    if (!els) return;
    const r = run || selected;
    els.chart.innerHTML = chartSVG(r, r && r.vs, { live: !!run, hover });
    if (!run) paintTiles(r);
  }

  window.CarPerf = { tick };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
