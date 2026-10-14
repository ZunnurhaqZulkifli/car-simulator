// Shared servicing, dashboard faults + tyre screech, injected into every car's raw HTML alongside car-api.js.
//
// A car hooks in with:
//   CarService.tick({ dt, speed, braking, slip, engineWear, ignition, lowFuel }) - once per frame: wears parts,
//        drives the screech, the service light and the dashboard messages. slip = wheelspin/launch (0 none, 1+ heavy),
//        engineWear = the car's own engine wear % (the car keeps owning it and its repair button)
//        lowFuel = the car is into its fuel reserve (pops the Low Fuel message)
//   CarService.holdMessages(sec)        - hold dashboard messages for up to sec (0 releases them), e.g. while
//        the car's own start-up chime plays
//   CarService.brakeMul()                - multiply brake decel (worn pads + tyres stop longer)
//   CarService.oilMul()                  - multiply engine wear rate (old oil wears the engine faster)
//   CarService.attachAudio(ctx, out, { chime, randomFaults }) - once its Web Audio graph exists. The screech
//        plays into `out` (the car's master gain, so mute + master volume apply); `chime` is the car's own
//        chime player (else the shared BMW chime file is used); randomFaults pops random check-control messages.
//
// The dyno panel is split into tabbed sections: Dyno (the car's own chart), Tuning (the car's tuning panel, while
// it's hidden from beside the cluster), Servicing, Diagnostics (filled by
// car-diagnostics.js through CarService.sections.diag) and Controls (the car's keyboard/info line, moved in). Service rows: the car's own engine Wear row
// is moved in and cloned for the rest, so they pick up each car's styling. A part at 100% raises its own
// dashboard message + chime, logs an active fault code and lights the service light until it's serviced.
// Levels and the fault memory ride along on every CarAPI.save() via saveData(), so both persist per car.
(function () {
  const saved = (window.__CAR_STATE__ && window.__CAR_STATE__.service) || {};
  // value is 0 (as new) .. 100 (worn out); read() turns it into what the driver sees
  const parts = [
    { key: 'engine', code: 'P0300', module: 'ECM', label: 'Engine', external: true,
      title: 'Engine malfunction', msg: 'Engine worn out. Reduced power - have the engine repaired.' },
    { key: 'brake', code: 'C1170', module: 'ABS', col: 'brake_wear_pct', label: 'Brakes', rate: (t) => t.brakeWork * 0.003,
      title: 'Brake pads worn', msg: 'Stopping distance increased. Replace the brake pads immediately.' },
    { key: 'oil', code: 'P2B0A', module: 'ECM', col: 'oil_wear_pct', label: 'Oil life', rate: (t) => t.km * 0.1,
      title: 'Oil service overdue', msg: 'Engine oil has broken down. Change the oil to avoid engine damage.' },
    { key: 'oilLevel', code: 'P250F', module: 'ECM', col: 'oil_level_loss_pct', label: 'Oil level', rate: (t) => t.km * 0.06,
      read: (v) => (5 - v / 100 * 1.5).toFixed(1) + ' L',
      title: 'Engine oil level low', msg: 'Top up engine oil at the next opportunity.' },
    { key: 'coolant', code: 'P2560', module: 'ECM', col: 'coolant_loss_pct', label: 'Coolant', rate: (t) => t.km * 0.04,
      read: (v) => (7 - v / 100 * 2).toFixed(1) + ' L',
      title: 'Coolant level low', msg: 'Stop safely and top up coolant. Risk of overheating.' },
    { key: 'tyre', code: 'C1A10', module: 'TPMS', col: 'tyre_wear_pct', label: 'Tyres', rate: (t) => t.km * 0.05 + t.brakeWork * 0.0005 + t.screech * t.dt * 0.05,
      title: 'Tyres worn out', msg: 'Tread at the legal limit. Grip reduced - replace the tyres.' },
    { key: 'pressure', code: 'C0750', module: 'TPMS', col: 'tyre_pressure_loss_pct', label: 'Tyre press.', rate: (t) => t.km * 0.08 + t.dt * 0.001,
      read: (v) => (2.4 - v / 100 * 0.8).toFixed(1) + ' bar',
      title: 'Tyre pressure low', msg: 'Pressure loss detected. Check and inflate the tyres.' },
    { key: 'battery', code: 'P0562', module: 'BMS', col: 'battery_drain_pct', label: 'Battery', rate: (t) => t.dt * 0.004 + t.km * 0.02,
      read: (v) => (12.7 - v / 100 * 0.9).toFixed(1) + ' V',
      title: 'Battery discharged', msg: '12V battery weak. The engine may not restart - replace the battery.' },
  ];
  const byKey = Object.fromEntries(parts.map((p) => [p.key, p]));

  // fault memory: code -> { code, title, module, status: 'active' (still broken) | 'stored' (history), at }
  const codes = new Map();
  function logCode(code, title, module, status) {
    const prev = codes.get(code);
    if (prev && prev.status === 'active' && status === 'active') return; // same ongoing fault keeps its first-seen time
    codes.set(code, { code, title, module, status, at: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) });
  }
  ((window.__CAR_STATE__ && window.__CAR_STATE__.faultCodes) || []).forEach((c) => codes.set(c.code, { ...c }));
  parts.forEach((p) => {
    p.value = saved[p.col] ?? 0;
    const c = codes.get(p.code);
    // engine wear is the car's own, unknown until the first tick(): trust the saved code until then
    p.fault = p.external ? !!c && c.status === 'active' : p.value >= 100;
    if (p.external) return;
    if (p.fault) logCode(p.code, p.title, p.module, 'active');
    else if (c && c.status === 'active') c.status = 'stored';
  });
  // clears history; anything still broken comes straight back as active, like a real scan tool
  function clearCodes() {
    const stillPresent = [...codes.values()].filter((c) => c.status === 'active');
    codes.clear();
    stillPresent.forEach((c) => codes.set(c.code, c));
    return stillPresent;
  }

  const RANDOM_FAULTS = [
    ['B1A50', 'BCM', 'Washer fluid low', 'Top up washer fluid at the next opportunity.'],
    ['B2610', 'BCM', 'Light malfunction', 'Rear left brake light failed. Have it checked.'],
    ['B2615', 'BCM', 'Low beam failed', 'Front right low beam faulty. Have it checked.'],
    ['B1342', 'BCM', 'Remote key battery low', 'Replace the battery in the remote key.'],
    ['C1B00', 'ABS', 'Park Distance Control failed', 'Sensors dirty or faulty. Manoeuvre with care.'],
    ['C1D20', 'ABS', 'Driver assistance restricted', 'Camera view obstructed. Clean the windscreen.'],
    ['P0700', 'ECM', 'Drivetrain malfunction', 'Moderate driving possible. Have the vehicle checked.'],
    ['B1F35', 'BCM', 'Passenger seat belt', 'Fasten the front passenger seat belt.'],
  ];

  const WRENCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z"/></svg>';
  let light = null, lightOn = '', banner = null;

  function render(p) {
    if (!p.pctEl) return;
    p.pctEl.textContent = p.read ? p.read(p.value) : Math.round(p.value) + '%';
    p.fillEl.style.width = Math.min(100, p.value) + '%';
  }

  const sections = {};
  const TAB_CSS = `
    .cs-tabs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px;}
    .cs-tab{font:700 .62rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;
      padding:9px 16px;border-radius:999px;border:1px solid #2a2d33;background:#121418;color:#8a8f96;cursor:pointer;
      display:inline-flex;align-items:center;gap:7px;transition:color .15s,border-color .15s,background .15s;}
    .cs-tab:hover{color:#fff;border-color:#4a4f57;}
    .cs-tab[aria-selected=true]{color:#fff;border-color:#e8402a;background:rgba(232,64,42,.12);}
    .cs-tab svg{width:14px;height:14px;}
    .cs-tab .cs-badge{min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#e8402a;color:#fff;
      font-size:.55rem;letter-spacing:0;display:none;align-items:center;justify-content:center;}
    .cs-tab[hidden]{display:none;}
    /* hidden tuning panel: the whole panel sits in the Tuning tab (so the car's own .side-panel / .tuning-panel
       styles keep applying) minus its frame and size; its sections flow into columns across the tab */
    .cs-in-tab{flex:none !important;left:auto !important;top:auto !important;width:auto !important;max-width:none !important;height:auto !important;max-height:none !important;
      margin:0 !important;padding:0 !important;border:0 !important;background:none !important;box-shadow:none !important;}
    .cs-in-tab > .cs-grip{display:none;}
    .cs-in-tab > .cs-scroller{columns:250px;column-gap:28px;}
    .cs-in-tab > .cs-scroller > *{break-inside:avoid;}
    /* wide enough: everything above Live Data in one column, its gauges in the next, the digital readout beside them */
    .dyno-panel:not(.cs-narrow) .cs-in-tab > .cs-scroller{columns:3;max-width:1020px;}
    .dyno-panel:not(.cs-narrow) .cs-in-tab .tuning-section:has(> .led-multi-panel){break-before:column;break-inside:auto;margin-top:0;}
    .dyno-panel:not(.cs-narrow) .cs-in-tab .led-multi-panel{break-before:column;}
    /* control deck: its items move onto an inner row (same flex layout) that scrolls once a height is set,
       so the grips stay put; docked in the dyno panel it never outgrows the panel */
    .cs-ctl-row{display:flex;flex-direction:inherit;flex-wrap:inherit;align-items:inherit;justify-content:inherit;gap:inherit;
      flex:1 1 100%;min-width:0;max-height:100%;overflow:auto;}
    .cs-dock > .controls, .cs-dock > .deck{max-width:100% !important;}
    .cs-tabs .dyno-close{margin-left:auto;}
    .cs-section{background:#0d0e10;border:1px solid #1f2125;border-radius:12px;padding:16px 18px;}
    .cs-section[hidden]{display:none;}
    .cs-dock > .controls, .cs-dock > .deck{margin:0 0 12px;padding:10px 14px;gap:8px 14px;background:#0d0e10;border:1px solid #1f2125;border-radius:12px;}
    /* resizable panel: inner layout follows the panel's own width via the cs-narrow / cs-xs classes set by a
       ResizeObserver (container queries would size-contain the panel and collapse the cars' shrink-to-fit pages) */
    .dyno-panel{position:relative;z-index:3;box-sizing:border-box;min-width:0;}
    .cs-grip{position:absolute;z-index:4;touch-action:none;}
    /* grips sit just inside the edges: the sized panel clips overflow, so anything outside can't be grabbed */
    .cs-grip-e{top:14px;right:0;bottom:18px;width:10px;cursor:ew-resize;}
    .cs-grip-s{left:14px;right:18px;bottom:0;height:10px;cursor:ns-resize;}
    .cs-grip-se{right:1px;bottom:1px;width:18px;height:18px;cursor:nwse-resize;
      background:linear-gradient(135deg,transparent 55%,#4a4f57 55%,#4a4f57 62%,transparent 62%,transparent 72%,#4a4f57 72%,#4a4f57 79%,transparent 79%);}
    .cs-grip-e::after,.cs-grip-s::after{content:"";position:absolute;border-radius:3px;background:#e8402a;opacity:0;transition:opacity .15s;}
    .cs-grip-e::after{top:0;bottom:0;right:2px;width:2px;}
    .cs-grip-s::after{left:0;right:0;bottom:2px;height:2px;}
    .cs-grip:hover::after,.cs-resizing .cs-grip::after{opacity:.7;}
    .cs-resizing,.cs-resizing *{user-select:none !important;}
    /* several cars centre the page in an overflow:hidden body; once the dyno panel is open or an area is enlarged
       the page outgrows its frame, so let it scroll - auto margins centre it while it fits and pin it to the
       top-left once it doesn't, so nothing ends up out of reach */
    html{overflow:auto !important;}
    body{overflow:visible !important;}
    .page-layout{margin:auto !important;}
    .cs-widened .page-layout{max-width:none !important;} /* only once an area is widened, so defaults stay pixel-identical */
    .cs-tall{display:flex;flex-direction:column;overflow:hidden;}
    .cs-tall > .cs-scroller{flex:1 1 auto;min-height:0;overflow:auto;}
    /* once the height has been dragged, the open section fills it and scrolls; the dyno chart grows into it */
    .dyno-panel.cs-sized{display:flex;flex-direction:column;overflow:hidden;}
    .dyno-panel.cs-sized.dyno-collapsed{display:none;}
    .cs-sized > .cs-section:not([hidden]){flex:1 1 auto;min-height:0;overflow:auto;}
    .cs-sized > .cs-section[data-sec=dyno]:not([hidden]){display:flex;flex-direction:column;}
    .cs-sized #dyno-graph-wrap{flex:1 1 auto;min-height:0;}
    .cs-sized .dyno-content-row{height:100%;}
    /* chart fills the height and whatever width the car's 2-column telemetry cards leave (car-dyno.js fits its
       viewBox to that box); the cards scroll once they outgrow the height */
    .cs-sized .dyno-content-row > .dyno-svg{height:100%;min-height:150px;flex:1 1 0;min-width:0;}
    .cs-sized .telemetry-grid{max-height:100%;overflow:auto;align-content:start;}
    .cs-narrow .dyno-content-row{flex-direction:column;height:auto;}
    .cs-narrow .dyno-content-row > .dyno-svg{height:auto;width:100%;flex:none;}
    .cs-narrow .telemetry-grid{width:100%;flex:none;max-height:none;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));}
    .cs-xs .cs-tab{padding:8px 11px;letter-spacing:.08em;}
    .cs-xs .cs-section{padding:12px;}
    .cs-section-title{font-size:.72rem;font-weight:700;letter-spacing:.08em;color:#c7cbd0;text-transform:uppercase;margin-bottom:12px;}
  `;
  const TAB_ICONS = {
    dyno: '<path d="M4 4v16h16"/><path d="M7 14l3.5-4.5 3 2.5L18 6"/>',
    tuning: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    service: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z"/>',
    diag: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 11h2l1.5-3 3 6 1.5-3h2"/><path d="M9 21h6"/>',
    keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  };
  // splits the car's dyno panel into tabbed, self-contained sections
  function buildTabs(panel) {
    const style = document.createElement('style');
    style.textContent = TAB_CSS;
    document.head.appendChild(style);
    const tabs = document.createElement('div');
    tabs.className = 'cs-tabs';
    tabs.setAttribute('role', 'tablist');
    const btns = {};
    const select = (id) => Object.keys(sections).forEach((k) => {
      sections[k].hidden = k !== id;
      btns[k].setAttribute('aria-selected', String(k === id));
    });
    [['dyno', 'Dyno'], ['tuning', 'Tuning'], ['service', 'Servicing'], ['diag', 'Diagnostics'], ['keys', 'Controls']].forEach(([id, label]) => {
      const sec = document.createElement('section');
      sec.className = 'cs-section';
      sec.setAttribute('role', 'tabpanel');
      sec.dataset.sec = id;
      sections[id] = sec;
      const btn = document.createElement('button');
      btn.className = 'cs-tab';
      btn.setAttribute('role', 'tab');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[id]}</svg>${label}` +
        (id === 'diag' ? '<span class="cs-badge"></span>' : '');
      btn.addEventListener('click', () => { select(id); btn.blur(); });
      btn.hidden = id === 'tuning'; // only while the tuning panel is hidden
      btns[id] = btn;
      tabs.appendChild(btn);
    });
    const close = document.getElementById('dyno-close-btn'); // look up before the panel's content is detached below
    while (panel.firstChild) sections.dyno.appendChild(panel.firstChild);
    if (close) tabs.appendChild(close);
    // the car's keyboard / controls info (.keys on the 530e, .hint elsewhere) moves out from under the controls
    sections.keys.innerHTML = '<div class="cs-section-title">Controls</div>';
    const info = document.querySelector('.keys, .hint');
    if (info) {
      info.style.cssText = 'margin:0;text-align:left;justify-content:flex-start;font-size:.7rem;line-height:1.8;color:#aab0b8;';
      sections.keys.appendChild(info);
    }
    // while the panel is open the car's driving controls (.controls, or .deck on the 530e) dock under the
    // tabs so they stay in reach on every section; closing puts them back where the car laid them out
    const dock = document.createElement('div');
    dock.className = 'cs-dock';
    const controls = document.querySelector('.deck, .controls');
    if (controls) {
      const home = document.createComment('controls home');
      controls.before(home);
      // car-layout.js sets html.cl-nodock while it arranges the page: the controls are then an area of their own
      const place = () => {
        const atHome = panel.classList.contains('dyno-collapsed') || document.documentElement.classList.contains('cl-nodock');
        if (atHome && home.nextSibling !== controls) home.after(controls);
        else if (!atHome && controls.parentNode !== dock) dock.appendChild(controls);
      };
      new MutationObserver(place).observe(panel, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(place).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      place();
    }
    panel.append(tabs, dock, sections.dyno, sections.tuning, sections.service, sections.diag, sections.keys);
    select('dyno');
    diagBadge = btns.diag.querySelector('.cs-badge');
    const toggle = document.getElementById('dyno-toggle-btn');
    if (toggle) { toggle.title = 'Dyno, servicing & diagnostics'; toggle.setAttribute('aria-label', toggle.title); }
    makeAreasResizable(panel);
    const tuning = document.querySelector('.tuning-panel, .side-panel');
    if (tuning) makeTuningHideable(tuning, btns.tuning, select);
  }

  // a floating button beside the dyno toggle hides the tuning panel from beside the cluster: the whole panel then
  // moves into the dyno panel's Tuning tab, and back to where the car laid it out when shown again
  function makeTuningHideable(tuning, tab, select) {
    const home = document.createComment('tuning home');
    tuning.before(home);
    const fab = document.createElement('button');
    fab.className = 'dyno-toggle-btn'; // the car's own floating-button look
    fab.style.left = '70px';
    // side-panel icon - the sliders icon is already the sound mixer's button
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>';
    const apply = (hidden) => {
      if (hidden) sections.tuning.appendChild(tuning);
      else home.after(tuning);
      tuning.classList.toggle('cs-in-tab', hidden);
      tab.hidden = !hidden;
      if (!hidden && !sections.tuning.hidden) select('dyno');
      fab.classList.toggle('active', hidden); // lit only away from the default, like the mute button
      fab.title = hidden ? 'Show tuning panel' : 'Hide tuning panel (moves into a Dyno tab)';
      fab.setAttribute('aria-label', fab.title);
    };
    fab.addEventListener('click', () => {
      const hidden = !tuning.classList.contains('cs-in-tab');
      apply(hidden);
      if (hidden) select('tuning');
      setLayout('tuning', { hidden });
      fab.blur();
    });
    document.body.appendChild(fab);
    apply(!!(layout.tuning && layout.tuning.hidden));
  }

  // ---- resizable areas (dyno panel, tuning panel, gauge cluster, control deck) ----
  // Drag the right edge (width), bottom edge (height) or corner (both); double-click a grip to reset. Sizes are
  // kept in `layout` ({ dyno|tuning|cluster|controls: { w, h }, tuning.hidden }), saved per car with the rest of the state.
  const layout = { ...((window.__CAR_STATE__ && window.__CAR_STATE__.layout) || {}) };
  function setLayout(key, patch) {
    const entry = { ...layout[key], ...patch };
    if (Object.values(entry).some(Boolean)) layout[key] = entry;
    else delete layout[key];
    if (window.saveCarState) window.saveCarState(); // the car's own save - layout rides along in saveData()
  }
  const resizables = [];
  const areas = []; // { key, el, apply(w, h), minW, minH, scale } - car-layout.js moves these around the page
  // scale: only the width is ever set and the content's own aspect ratio sets the height (the gauge cluster);
  // vertical drags are turned into the width that gives that height
  function makeResizable(el, key, { grips = ['e', 's', 'se'], minW = 340, minH = 260, scale = false, onApply = () => {} } = {}) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const apply = (w, h) => {
      el.style.width = w ? w + 'px' : '';
      el.style.maxWidth = w ? 'none' : '';
      el.style.flex = w ? '0 0 auto' : ''; // flex items (the tuning panel) would otherwise keep their flex-basis
      el.style.height = h ? h + 'px' : '';
      el.style.zIndex = w ? '3' : ''; // grown past its column: sit above the neighbour it now overlaps
      document.documentElement.classList.toggle('cs-widened', resizables.some((r) => r.style.width));
      onApply(w, h);
    };
    resizables.push(el);
    areas.push({ key, el, apply, minW, minH, scale });
    const saved = layout[key];
    if (saved) apply(saved.w, saved.h);
    const save = () => setLayout(key, { w: parseFloat(el.style.width) || null, h: parseFloat(el.style.height) || null });
    const DIRS = { e: [true, false], s: [false, true], se: [true, true] };
    grips.forEach((dir) => {
      const [dx, dy] = DIRS[dir];
      const grip = document.createElement('div');
      grip.className = 'cs-grip cs-grip-' + dir;
      grip.title = 'Drag to resize, double-click to reset';
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
        // wider than its column is allowed (it overlays its neighbour), but never wider than the window
        const clampW = (w) => Math.round(Math.max(minW, Math.min(window.innerWidth - 24, w)));
        const clampH = (h) => Math.round(Math.max(minH, h));
        document.body.classList.add('cs-resizing');
        const move = (ev) => {
          if (scale) {
            const mx = ev.clientX - start.x, my = ev.clientY - start.y, ratio = start.w / start.h;
            const byX = dx && (!dy || Math.abs(mx) >= Math.abs(my) * ratio); // corner: whichever axis leads
            // linear, not edge-chasing: the cluster grows around its centre on most cars, so following the pointer
            // would need runaway growth - drag distance maps straight to size instead
            apply(clampW(start.w + (byX ? mx : my * ratio)), null);
            return;
          }
          let w = dx ? clampW(start.w + ev.clientX - start.x) : parseFloat(el.style.width) || null;
          let h = dy ? clampH(start.h + ev.clientY - start.y) : parseFloat(el.style.height) || null;
          // most cars centre the page, so resizing also shifts the element - nudge until the dragged edge
          // lands under the pointer
          for (let i = 0; i < 5; i++) {
            apply(w, h);
            const now = el.getBoundingClientRect();
            const ex = dx ? start.right + ev.clientX - start.x - now.right : 0;
            const ey = dy ? start.bottom + ev.clientY - start.y - now.bottom : 0;
            if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
            if (dx) w = clampW(w + ex);
            if (dy) h = clampH(h + ey);
          }
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          document.body.classList.remove('cs-resizing');
          save();
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
      grip.addEventListener('dblclick', () => {
        if (scale) apply(null, null);
        else apply(dx ? null : parseFloat(el.style.width) || null, dy ? null : parseFloat(el.style.height) || null);
        save();
      });
      el.appendChild(grip);
    });
  }

  function makeAreasResizable(panel) {
    // dyno panel: inner layout follows its own width; a set height makes the open section fill + scroll
    // (next frame: toggling layout classes inside the callback itself trips the ResizeObserver loop warning)
    new ResizeObserver(([entry]) => requestAnimationFrame(() => {
      const w = entry.contentRect.width; // inside the padding
      panel.classList.toggle('cs-narrow', w < 720);
      panel.classList.toggle('cs-xs', w < 480);
    })).observe(panel);
    makeResizable(panel, 'dyno', { onApply: (w, h) => panel.classList.toggle('cs-sized', !!h) });

    // tuning panel (.side-panel on the 530e): content moves into a scroller so the grips stay put when it scrolls
    const tuning = document.querySelector('.tuning-panel, .side-panel');
    if (tuning) {
      const scroller = document.createElement('div');
      scroller.className = 'cs-scroller';
      while (tuning.firstChild) scroller.appendChild(tuning.firstChild);
      tuning.appendChild(scroller);
      makeResizable(tuning, 'tuning', { minW: 220, minH: 200, onApply: (w, h) => tuning.classList.toggle('cs-tall', !!h) });
    }

    // gauge cluster: the dials keep their proportions, so every grip scales it as a whole
    const cluster = document.querySelector('.cluster');
    if (cluster) makeResizable(cluster, 'cluster', { minW: 480, scale: true });

    // control deck (.deck, or .controls on the 550d / Iriz): same size at home and docked in the dyno panel
    const controls = document.querySelector('.deck, .controls');
    if (controls) {
      const row = document.createElement('div');
      row.className = 'cs-ctl-row';
      while (controls.firstChild) row.appendChild(controls.firstChild);
      controls.appendChild(row);
      makeResizable(controls, 'controls', { minW: 300, minH: 60 });
    }
  }

  let diagBadge = null;

  function build() {
    const repair = document.getElementById('repair-btn');
    const engineRow = repair && repair.closest('.tune-row');
    const panel = document.querySelector('.dyno-panel');
    if (!engineRow || !panel) return;
    buildTabs(panel);
    const section = sections.service;
    section.innerHTML = '<div class="cs-section-title">Servicing</div>';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 22px;';
    section.appendChild(grid);
    parts.forEach((p) => {
      if (p.external) return;
      const row = engineRow.cloneNode(true);
      row.style.margin = '0';
      row.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      row.querySelector('.tune-label').textContent = p.label;
      p.pctEl = row.querySelector('.tune-pct');
      p.fillEl = row.querySelector('.tuning-bar-fill');
      const btn = row.querySelector('.icon-btn');
      btn.title = 'Service ' + p.label.toLowerCase();
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', () => { p.value = 0; render(p); btn.blur(); }); // tick() clears the fault + files its code as history
      grid.appendChild(row);
      render(p);
    });
    // the car's own engine row moves in too - its ids and repair handler stay the car's
    engineRow.style.margin = '0';
    engineRow.querySelector('.tune-label').textContent = 'Engine';
    grid.prepend(engineRow);

    // service light: cloned into the car's own tell-tale row (BMW .warning-lights / Iriz .lamps)
    const lights = document.querySelector('.warning-lights, .lamps');
    if (lights && lights.firstElementChild) {
      const base = lights.firstElementChild.classList[0];
      light = document.createElement(lights.firstElementChild.tagName);
      light.className = base;
      light.title = 'Service required';
      light.innerHTML = WRENCH;
      lightOn = base === 'wl' ? 'on-amber' : 'on';
      lights.appendChild(light);
    }

    // check-control style message over the cluster
    const cluster = document.querySelector('.cluster');
    if (cluster) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(440px,86%);' +
        'display:none;gap:12px;align-items:center;padding:10px 14px;border-radius:10px;z-index:5;cursor:pointer;' +
        'background:rgba(8,8,10,.94);border:1px solid #3a2a14;box-shadow:0 10px 30px -10px rgba(0,0,0,.9);' +
        'font-family:"Segoe UI",system-ui,Arial,sans-serif;text-align:left;';
      banner.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:26px;height:26px;flex:none" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>' +
        '<div><div data-t style="font-size:.78rem;font-weight:700;color:#f4f6f8;letter-spacing:.02em"></div>' +
        '<div data-m style="font-size:.68rem;color:#aab0b8;margin-top:2px"></div></div>';
      banner.addEventListener('click', () => { showFor = 0; });
      cluster.appendChild(banner);
    }
  }

  // ---- dashboard messages: queued, one at a time, each with a chime ----
  const queue = [];
  let showFor = 0, holdFor = 0;
  function announce(title, msg, color) { queue.push({ title, msg, color }); }
  function updateBanner(dt, ignition) {
    if (!ignition) { queue.length = 0; showFor = 0; holdFor = 0; }
    if (holdFor > 0) { holdFor -= dt; return; }
    if (showFor > 0) { showFor -= dt; return; }
    if (banner) banner.style.display = 'none';
    const next = queue.shift();
    if (!next) return;
    showFor = 7;
    chime();
    if (!banner) return;
    banner.style.color = next.color;
    banner.style.borderColor = next.color;
    banner.querySelector('[data-t]').textContent = next.title;
    banner.querySelector('[data-m]').textContent = next.msg;
    banner.style.display = 'flex';
  }

  // ---- audio: tyre screech + chime ----
  let actx = null, out = null, screechGain = null, screechVol = 0.5, warnChimeVol = 0.8, carChime = null, chimeBuf = null;
  let randomFaults = false, nextRandomIn = 40 + Math.random() * 80;
  function chime() {
    if (carChime) return carChime();
    if (!actx || !chimeBuf) return;
    const src = actx.createBufferSource();
    src.buffer = chimeBuf;
    const g = actx.createGain();
    g.gain.value = warnChimeVol;
    src.connect(g).connect(out);
    src.start();
  }

  // looped noise through two narrow band-passes (the squeal's fundamental + overtone), wobbled by a
  // slow LFO so it chatters like rubber skipping on tarmac
  function attachAudio(ctx, dest, opts = {}) {
    if (screechGain) return;
    actx = ctx;
    out = dest;
    carChime = opts.chime || null;
    randomFaults = !!opts.randomFaults;
    if (!carChime) {
      fetch('/audio/bmw-chime-sms.mp3').then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
        .then((b) => { chimeBuf = b; }).catch(() => {}); // optional - no file, no chime
    }
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 60;
    lfo.connect(lfoDepth);
    [[1150, 18, 1], [2350, 22, 0.45]].forEach(([freq, q, level]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      lfoDepth.connect(bp.frequency);
      src.connect(bp).connect(g).connect(screechGain);
    });
    screechGain.connect(dest);
    src.start();
    lfo.start();
    if (window.EngineMixer) {
      window.EngineMixer.addLayer({ id: 'screech', label: 'Tyre Screech', value: screechVol, set: (f) => { screechVol = f; } });
      window.EngineMixer.addLayer({ id: 'warnChime', label: 'Warning Chime', value: warnChimeVol, set: (f) => { warnChimeVol = f; } });
    }
  }

  // wheelspin / launch only - braking doesn't screech (ABS)
  const screechAmount = (slip) => Math.min(1, slip);

  let wasIgnition = false, bulbCheck = 0, lowFuelShown = false;
  window.CarService = {
    tick({ dt, speed, braking, slip = 0, engineWear = 0, ignition, lowFuel = false }) {
      const screech = screechAmount(slip);
      const t = { dt, screech, km: speed * dt / 3600, brakeWork: (braking / 100) * speed * dt }; // brakeWork ~170 for a full stop from 100 km/h
      byKey.engine.value = engineWear;
      parts.forEach((p) => {
        if (p.rate) {
          const amount = p.rate(t);
          if (amount > 0 && p.value < 100) { p.value = Math.min(100, p.value + amount); render(p); }
        }
        if (p.value >= 100 && !p.fault) {
          p.fault = true;
          logCode(p.code, p.title, p.module, 'active');
          if (ignition) announce(p.title, p.msg, '#ff5f3d');
        }
        if (p.value < 100 && p.fault) {
          p.fault = false;
          const c = codes.get(p.code);
          if (c) c.status = 'stored'; // repaired - stays in history until the codes are cleared
        }
      });
      // switching on: re-announce whatever is still broken, like a real check-control on start-up
      if (ignition && !wasIgnition) {
        parts.forEach((p) => { if (p.fault) announce(p.title, p.msg, '#ff5f3d'); });
        bulbCheck = 3; // lit with the rest of the tell-tales at start-up, so the driver knows the lamp works
      }
      wasIgnition = ignition;
      bulbCheck = Math.max(0, bulbCheck - dt);
      if (light) light.classList.toggle(lightOn, ignition && (bulbCheck > 0 || parts.some((p) => p.fault)));
      if (randomFaults && ignition && (nextRandomIn -= dt) <= 0) {
        nextRandomIn = 40 + Math.random() * 80;
        const [code, module, title, msg] = RANDOM_FAULTS[Math.floor(Math.random() * RANDOM_FAULTS.length)];
        logCode(code, title, module, 'stored');
        announce(title, msg, '#ff9d2e');
      }
      if (diagBadge) {
        diagBadge.textContent = codes.size;
        diagBadge.style.display = codes.size ? 'inline-flex' : 'none';
      }
      // low fuel: once on dropping into it, and again at every start-up while still low
      if (ignition && lowFuel && !lowFuelShown) announce('Low Fuel', 'Fuel reserve reached. Refuel at the next opportunity.', '#ff9d2e');
      lowFuelShown = ignition && lowFuel;
      updateBanner(dt, ignition);
      // 3.0 makeup gain: the narrow band-passes only let a sliver of the noise through
      if (screechGain) screechGain.gain.setTargetAtTime(screech * screechVol * 3.0, actx.currentTime, 0.06);
    },
    // 100% worn brakes lose 40% stopping power, bald tyres another 25%
    brakeMul: () => (1 - byKey.brake.value / 100 * 0.4) * (1 - byKey.tyre.value / 100 * 0.25),
    // fully degraded oil triples engine wear
    oilMul: () => 1 + byKey.oil.value / 100 * 2,
    attachAudio,
    holdMessages: (sec) => { holdFor = sec; },
    setLayout, // for car-dyno.js / car-layout.js: their settings ride along in the per-car layout
    layout,
    areas,
    // for car-diagnostics.js
    parts,
    codes,
    clearCodes,
    sections,
    ignitionOn: () => wasIgnition,
    saveData: () => ({
      ...Object.fromEntries(parts.filter((p) => p.col).map((p) => [p.col, p.value])),
      fault_codes: [...codes.values()],
      layout,
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
