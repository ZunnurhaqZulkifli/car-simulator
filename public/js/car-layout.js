// Arrangeable car page, injected into every car's raw HTML after car-service.js (whose resizable areas it moves).
//
// The page's areas - gauge cluster, control deck, tuning panel, dyno panel, whichever the car has (car-service.js
// finds them by class) - follow one of three presets, picked from the floating Layout button:
//   classic - the car's own flow layout; the area grips resize it, as before
//   pitwall - the dyno panel as a full-height column on the right, the rest stacked on the left
//   free    - the user's own arrangement: every area at its own rect on the page
// Arrange mode overlays every area: drag to move, edges and corners to resize. Edges snap to the window and to
// each other (flush, or a gutter apart), else to an 8px grid. Dragging anything outside Free starts a Free layout
// from where everything stands. Saved per car as layout.arrange = { preset, cluster|controls|tuning|dyno: {x,y,w,h} }.
(function () {
  const M = 16, GAP = 16, GRID = 8, SNAP = 10;
  const LABELS = { cluster: 'Cluster', controls: 'Controls', tuning: 'Tuning', dyno: 'Dyno' };
  const KEYS = Object.keys(LABELS);
  const html = document.documentElement;
  let CS = null, areas = [], preset = 'classic', editing = false, arrange = {};

  const area = (k) => areas.find((a) => a.key === k);
  // a closed dyno panel, or a tuning panel tucked into the dyno panel's tab, isn't on the page
  const shown = (a) => a && !a.el.classList.contains('dyno-collapsed') && !a.el.classList.contains('cs-in-tab');
  const rectOf = (a) => {
    const r = a.el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const saved = (a, r) => ({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.w, h: a.scale ? null : r.h }); // the cluster's height follows its width
  function put(a, r) {
    a.apply(r.w, a.scale ? null : r.h);
    a.el.style.left = r.x + 'px';
    a.el.style.top = r.y + 'px';
  }

  // ---- presets ----
  function pitwall() {
    const vw = html.clientWidth, vh = innerHeight, W = vw - 2 * M;
    const [cluster, controls, tuning, dyno] = KEYS.map((k) => (shown(area(k)) ? area(k) : null));
    const fill = (min) => (y) => Math.max(min, vh - M - y); // whatever height the window has left
    const col = (list, x, w) => { // stacks [area, height, maxWidth] down a column, each centred in it
      let y = M;
      list.forEach(([a, h, maxW = w]) => {
        if (!a) return;
        const aw = Math.min(w, maxW);
        put(a, { x: x + Math.round((w - aw) / 2), y, w: aw, h: typeof h === 'function' ? h(y) : h });
        y += a.el.offsetHeight + GAP;
      });
      return y;
    };
    const dw = Math.min(760, Math.max(480, Math.round(W * 0.42)));
    if (dyno && W - dw - GAP >= 520) {
      const lw = W - dw - GAP;
      col([[cluster, null, 1100], [controls, null], [tuning, fill(240)]], M, lw);
      put(dyno, { x: M + lw + GAP, y: M, w: dw, h: Math.max(480, vh - 2 * M) });
    } else if (dyno) { // too narrow for two columns: one column, dyno last
      col([[cluster, null, 1100], [controls, null], [tuning, null], [dyno, Math.max(480, vh - 2 * M)]], M, W);
    } else { // dyno closed: cluster + controls centred, tuning beside them, until it opens into its column
      const tw = tuning ? Math.max(240, (CS.layout.tuning || {}).w || 260) : 0;
      const side = tw && tw + GAP, mw = Math.min(W - side, 1100), x0 = M + Math.round((W - mw - side) / 2);
      const bottom = col([[cluster, null], [controls, null]], x0, mw);
      if (tuning) put(tuning, { x: x0 + mw + GAP, y: M, w: tw, h: Math.max(300, bottom - GAP - M) });
    }
  }

  function layout() {
    const canvas = preset !== 'classic';
    html.classList.toggle('cl-canvas', canvas);
    html.classList.toggle('cl-nodock', canvas || editing);
    if (!canvas) { // back to the car's own flow, at the sizes its grips set
      areas.forEach((a) => {
        a.el.style.left = a.el.style.top = '';
        const s = CS.layout[a.key] || {};
        a.apply(s.w, s.h);
      });
    } else if (preset === 'pitwall') pitwall();
    else {
      let bottom = M; // an area the free layout never placed (shown since) goes under the rest
      areas.forEach((a) => {
        if (!shown(a) || !arrange[a.key]) return;
        put(a, arrange[a.key]);
        bottom = Math.max(bottom, arrange[a.key].y + a.el.offsetHeight + GAP);
      });
      areas.forEach((a) => { if (shown(a) && !arrange[a.key]) put(a, { x: M, y: bottom, w: a.el.offsetWidth || 480, h: null }); });
    }
    // arrange mode overlays whatever is on the page
    areas.forEach((a) => { if (editing && shown(a)) { a.el.appendChild(a.ov); label(a); } else a.ov.remove(); });
  }

  // animate a re-layout: every area slides from where it was (position only - its new size applies at once)
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function flip(change) {
    const before = new Map(areas.filter(shown).map((a) => [a, a.el.getBoundingClientRect()]));
    change();
    if (still.matches) return;
    before.forEach((b, a) => {
      if (!shown(a)) return;
      const r = a.el.getBoundingClientRect(), dx = b.left - r.left, dy = b.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) a.el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }

  function save() {
    CS.setLayout('arrange', { preset: preset === 'classic' ? null : preset, ...Object.fromEntries(KEYS.map((k) => [k, arrange[k] || null])) });
  }

  // freeze every area where it stands and go absolute - nothing visibly moves
  function toFree() {
    const rects = areas.filter(shown).map((a) => [a, rectOf(a)]);
    arrange = {};
    rects.forEach(([a, r]) => { arrange[a.key] = saved(a, r); });
    preset = 'free';
    layout();
    renderPicker();
  }

  function choose(p) {
    if (p === 'free' && !Object.keys(arrange).length) { toFree(); save(); setEditing(true); return; }
    preset = p;
    const dyno = area('dyno');
    flip(() => {
      if (p === 'pitwall' && dyno && dyno.el.classList.contains('dyno-collapsed')) document.getElementById('dyno-toggle-btn')?.click();
      layout();
    });
    save();
    renderPicker();
  }

  // ---- snapping: an edge within SNAP px of a line jumps onto it, otherwise onto the grid ----
  const guides = { x: null, y: null };
  function lines(others) {
    const vw = html.clientWidth, bottom = scrollY + innerHeight - M;
    return {
      left: [M, ...others.flatMap((o) => [o.x, o.x + o.w + GAP])],
      right: [vw - M, ...others.flatMap((o) => [o.x + o.w, o.x - GAP])],
      top: [M, ...others.flatMap((o) => [o.y, o.y + o.h + GAP])],
      bottom: [bottom, ...others.flatMap((o) => [o.y + o.h, o.y - GAP])],
    };
  }
  // the closest snap for any of the given [edge value, lines] pairs: { d: shift to apply, at: the line }
  const nearest = (pairs) => pairs.reduce((best, [v, ls]) => ls.reduce((b, l) => (Math.abs(l - v) <= SNAP && (!b || Math.abs(l - v) < Math.abs(b.d)) ? { d: l - v, at: l } : b), best), null);
  const toGrid = (v) => Math.round(v / GRID) * GRID;
  function snapMove(r, L) {
    const sx = nearest([[r.x, L.left], [r.x + r.w, L.right]]), sy = nearest([[r.y, L.top], [r.y + r.h, L.bottom]]);
    guides.x = sx && sx.at; guides.y = sy && sy.at;
    return { ...r, x: Math.max(0, sx ? r.x + sx.d : toGrid(r.x)), y: Math.max(0, sy ? r.y + sy.d : toGrid(r.y)) };
  }
  function snapEdge(v, ls, axis) {
    const s = nearest([[v, ls]]);
    if (s) guides[axis] = s.at;
    return s ? v + s.d : toGrid(v);
  }
  function snapResize(a, s, dir, dx, dy, L) {
    let { x, y, w, h } = s;
    guides.x = guides.y = null;
    if (a.scale) { // width only, the height follows - from whichever axis the pointer leads with
      const ratio = s.h / s.w, gx = dir.includes('e') ? dx : -dx, gy = (dir.includes('s') ? dy : -dy) / ratio;
      w = s.w + (Math.abs(gx) >= Math.abs(gy) ? gx : gy);
      if (dir.includes('e')) w = snapEdge(x + w, L.right, 'x') - x;
      else w = s.x + s.w - snapEdge(s.x + s.w - w, L.left, 'x');
      w = Math.max(a.minW, Math.min(html.clientWidth, w));
      if (dir.includes('w')) x = s.x + s.w - w;
      if (dir.includes('n')) y = s.y + s.h - Math.round(w * ratio);
      return { x, y, w, h: Math.round(w * ratio) };
    }
    if (dir.includes('e')) w = Math.max(a.minW, snapEdge(s.x + s.w + dx, L.right, 'x') - x);
    if (dir.includes('w')) { w = Math.max(a.minW, s.x + s.w - snapEdge(s.x + dx, L.left, 'x')); x = s.x + s.w - w; }
    if (dir.includes('s')) h = Math.max(a.minH, snapEdge(s.y + s.h + dy, L.bottom, 'y') - y);
    if (dir.includes('n')) { h = Math.max(a.minH, s.y + s.h - snapEdge(s.y + dy, L.top, 'y')); y = s.y + s.h - h; }
    return { x: Math.max(0, x), y: Math.max(0, y), w, h };
  }

  // ---- arrange mode ----
  let ghost, gx, gy, bar;
  const overlaps = (r, others) => others.some((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
  function showGuides() {
    gx.style.cssText = guides.x == null ? 'display:none' : `left:${guides.x}px;top:0;height:${html.scrollHeight}px`;
    gy.style.cssText = guides.y == null ? 'display:none' : `top:${guides.y}px;left:0;width:${html.scrollWidth}px`;
  }
  function label(a) {
    if (!shown(a)) return;
    a.ov.querySelector('span').textContent = `${a.el.offsetWidth} × ${a.el.offsetHeight}`;
  }

  function startDrag(a, e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const dir = e.target.dataset.dir || '';
    if (preset !== 'free') toFree();
    const ov = a.ov, start = rectOf(a);
    ov.setPointerCapture(e.pointerId);
    const others = areas.filter((o) => o !== a && shown(o)).map(rectOf), L = lines(others);
    let target = start;
    html.classList.add('cl-dragging');
    a.el.classList.add('cl-active');
    const move = (ev) => {
      const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
      if (dir) { // resizing snaps live
        target = snapResize(a, start, dir, dx, dy, L);
        put(a, target);
      } else { // the area follows the pointer; the placeholder shows where it will land
        const raw = { ...start, x: start.x + dx, y: start.y + dy };
        target = snapMove(raw, L);
        a.el.style.left = raw.x + 'px';
        a.el.style.top = raw.y + 'px';
        ghost.style.cssText = `display:block;left:${target.x}px;top:${target.y}px;width:${target.w}px;height:${target.h}px`;
        ghost.classList.toggle('cl-bad', overlaps(target, others));
      }
      showGuides();
      label(a);
    };
    const up = () => {
      ov.removeEventListener('pointermove', move);
      ov.removeEventListener('pointerup', up);
      ov.removeEventListener('pointercancel', up);
      html.classList.remove('cl-dragging');
      a.el.classList.remove('cl-active');
      ghost.style.display = 'none';
      guides.x = guides.y = null;
      showGuides();
      if (!dir) flip(() => put(a, target));
      arrange[a.key] = saved(a, rectOf(a));
      label(a);
      save();
      renderPicker();
    };
    ov.addEventListener('pointermove', move);
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
  }

  function setEditing(on) {
    editing = on;
    html.classList.toggle('cl-edit', on);
    const dyno = area('dyno');
    if (on && dyno && dyno.el.classList.contains('dyno-collapsed')) document.getElementById('dyno-toggle-btn')?.click(); // so it can be placed
    layout();
    bar.hidden = !on;
  }

  // ---- a wide tuning panel (built as a narrow sidebar) splits into a side column - model, spec, setup - and a main
  // one with the visual sections (live data, diagrams); back to the car's own order when narrow ----
  function tuningAcross(el) {
    const sc = el.querySelector(':scope > .cs-scroller');
    const side = document.createElement('div'), main = document.createElement('div');
    side.className = 'cl-tune-side';
    main.className = 'cl-tune-main';
    const visual = (c) => c.matches('.tuning-section') && c.querySelector('.subgauge-grid, .led-multi-panel, .xd-card, :scope > svg');
    let order = null; // the car's own children, in order, while split
    return () => {
      const wide = !!sc && el.offsetWidth >= 600; // beside the cluster, or in the dyno panel's Tuning tab
      if (wide === !!order) return;
      if (wide) {
        const kids = [...sc.children];
        if (!kids.some(visual)) return; // nothing to set beside the setup
        order = kids;
        kids.forEach((c) => (visual(c) ? main : side).appendChild(c));
        sc.append(side, main);
      } else {
        order.forEach((c) => sc.appendChild(c));
        side.remove();
        main.remove();
        order = null;
      }
      el.classList.toggle('cl-across', !!order);
    };
  }

  // ---- picker: a thumbnail of each preset, drawn with placeholder blocks ----
  const SCHEMA = {
    classic: { cluster: [3, 4, 71, 52], controls: [3, 59, 71, 9], tuning: [77, 4, 20, 64], dyno: [3, 71, 94, 25] },
    pitwall: { cluster: [3, 5, 55, 43], controls: [3, 51, 55, 9], tuning: [3, 63, 55, 32], dyno: [61, 5, 36, 90] },
    free: { cluster: [26, 8, 50, 38], controls: [26, 49, 50, 9], dyno: [5, 63, 44, 31], tuning: [53, 63, 42, 31] },
  };
  const ICON = {
    layout: '<rect x="3" y="3" width="11" height="8" rx="1.5"/><rect x="3" y="14" width="11" height="7" rx="1.5"/><rect x="17" y="3" width="4" height="18" rx="1.5"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  };
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  function freeSchema() { // the saved free layout, scaled into the thumbnail
    const rs = areas.filter((a) => arrange[a.key]).map((a) => {
      const r = arrange[a.key];
      return [a.key, { ...r, h: r.h || Math.round(r.w * a.el.offsetHeight / Math.max(1, a.el.offsetWidth)) }];
    });
    if (!rs.length) return null;
    const pw = Math.max(html.clientWidth, ...rs.map(([, r]) => r.x + r.w + M));
    const ph = Math.max(innerHeight, ...rs.map(([, r]) => r.y + r.h + M));
    return Object.fromEntries(rs.map(([k, r]) => [k, [r.x / pw * 100, r.y / ph * 100, r.w / pw * 100, r.h / ph * 100]]));
  }
  const thumb = (schema, empty) => `<div class="cl-thumb${empty ? ' cl-thumb-empty' : ''}">` +
    Object.entries(schema).filter(([k]) => area(k)).map(([k, [x, y, w, h]]) =>
      `<i class="cl-b cl-b-${k}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${w.toFixed(1)}%;height:${h.toFixed(1)}%"></i>`).join('') +
    (empty ? `<em>${svgIcon('move')}</em>` : '') + '</div>';
  const PRESETS = [
    ['classic', 'Classic', "The car's own layout"],
    ['pitwall', 'Pit Wall', 'Dyno docked on the right'],
    ['free', 'Free', 'Drag and snap anything'],
  ];
  let menu = null;
  function renderPicker() {
    if (!menu) return;
    const free = freeSchema();
    menu.querySelector('.cl-presets').innerHTML = PRESETS.map(([p, name, sub]) =>
      `<button class="cl-preset" data-p="${p}" aria-pressed="${p === preset}">` +
      thumb(p === 'free' ? free || SCHEMA.free : SCHEMA[p], p === 'free' && !free) +
      `<b>${name}</b><small>${p === 'free' && !free ? 'Start from where things are' : sub}</small></button>`).join('');
  }

  const CSS = `
    .cl-canvas .page-layout{position:absolute !important;left:0;top:0;width:100% !important;max-width:none !important;min-height:0 !important;
      margin:0 !important;padding:0 !important;display:block !important;}
    .cl-canvas .rig{display:contents !important;}
    .cl-canvas .cl-area:not(.cs-in-tab){position:absolute !important;margin:0 !important;box-sizing:border-box;}
    .cl-canvas .cs-grip,.cl-edit .cs-grip{display:none;}
    /* a wide tuning panel reads across: identity + setup in a side column, live data and diagrams beside it -
       gauges in one row, the digital readout as a strip under them */
    .cl-across > .cs-scroller{display:grid;grid-template-columns:minmax(240px,320px) minmax(0,1fr);gap:0 26px;align-items:start;}
    .cl-tune-side{min-width:0;}
    .cl-tune-main{min-width:0;align-self:stretch;display:flex;flex-wrap:wrap;gap:18px 26px;align-content:start;
      padding-left:26px;border-left:1px solid rgba(255,255,255,.06);}
    .cl-tune-main > .tuning-section{margin:0;padding:0;border:0;min-width:0;flex:1 1 280px;container-type:inline-size;}
    .cl-tune-main > .tuning-section:not(:has(.subgauge-grid,.led-multi-panel)){flex:0 1 300px;} /* a diagram keeps a sidebar's width */
    .cl-tune-main .subgauge-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;}
    @container (min-width:440px){ .cl-tune-main .subgauge-grid{grid-template-columns:repeat(4,minmax(0,1fr));} }
    .cl-tune-main .subgauge-grid > *{width:100%;max-width:168px;justify-self:center;}
    .cl-tune-main .led-multi-panel{grid-template-columns:repeat(auto-fill,52px minmax(78px,1fr));gap:6px 14px;}
    .cl-tune-main .led-multi-panel .lm-val{text-align:left;} /* each value sits by its own label across the strip */
    .cl-edit body{background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1.3px) !important;background-size:16px 16px !important;}
    .cl-ov{position:absolute;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;
      border:1.5px dashed rgba(232,64,42,.75);border-radius:12px;background:rgba(8,9,12,.5);transition:background .15s;}
    .cl-ov:hover,.cl-active > .cl-ov{background:rgba(232,64,42,.1);border-style:solid;}
    .cl-active{z-index:50 !important;opacity:.92;}
    .cl-dragging,.cl-dragging *{cursor:grabbing !important;user-select:none !important;}
    .cl-chip{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#121418;border:1px solid #2a2d33;
      color:#f4f6f8;font:700 .62rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;
      box-shadow:0 10px 30px -8px rgba(0,0,0,.8);pointer-events:none;}
    .cl-chip svg{width:14px;height:14px;color:#8a8f96;}
    .cl-chip span{font:400 .66rem/1 "Courier New",monospace;letter-spacing:0;text-transform:none;color:#8a8f96;}
    .cl-h{position:absolute;width:12px;height:12px;border-radius:3px;background:#e8402a;border:2px solid #0a0a0a;box-sizing:border-box;}
    .cl-h-n,.cl-h-s{left:calc(50% - 6px);cursor:ns-resize;} .cl-h-e,.cl-h-w{top:calc(50% - 6px);cursor:ew-resize;}
    .cl-h-n,.cl-h-ne,.cl-h-nw{top:3px;} .cl-h-s,.cl-h-se,.cl-h-sw{bottom:3px;}
    .cl-h-e,.cl-h-ne,.cl-h-se{right:3px;} .cl-h-w,.cl-h-nw,.cl-h-sw{left:3px;}
    .cl-h-ne,.cl-h-sw{cursor:nesw-resize;} .cl-h-nw,.cl-h-se{cursor:nwse-resize;}
    .cl-ghost,.cl-guide{position:absolute;display:none;pointer-events:none;z-index:2147481000;}
    .cl-ghost{box-sizing:border-box;border:2px dashed #e8402a;border-radius:14px;background:rgba(232,64,42,.07);}
    .cl-ghost.cl-bad{border-color:#ffb020;background:rgba(255,176,32,.07);}
    .cl-guide{display:block;background:#e8402a;opacity:.7;width:1px;height:1px;}
    .cl-bar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483001;display:flex;align-items:center;gap:12px;
      padding:8px 8px 8px 16px;border-radius:999px;background:#121418;border:1px solid #2a2d33;box-shadow:0 14px 34px -10px rgba(0,0,0,.85);
      font:.72rem/1.2 "Segoe UI",system-ui,Arial,sans-serif;color:#8a8f96;white-space:nowrap;}
    .cl-bar[hidden]{display:none;}
    .cl-bar b{color:#f4f6f8;letter-spacing:.12em;text-transform:uppercase;font-size:.62rem;}
    .cl-bar i{width:7px;height:7px;border-radius:50%;background:#e8402a;box-shadow:0 0 0 4px rgba(232,64,42,.18);}
    .cl-btn{font:700 .58rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;border-radius:999px;
      border:1px solid #2a2d33;background:#1a1d22;color:#f4f6f8;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}
    .cl-btn:hover{border-color:#e8402a;}
    .cl-btn svg{width:13px;height:13px;}
    .cl-btn-main{background:#e8402a;border-color:#e8402a;}
    .cl-menu{inset:auto;margin:0;width:min(540px,calc(100vw - 32px));padding:14px;box-sizing:border-box;background:#121418;color:#c7cbd0;
      border:1px solid #2a2d33;border-radius:14px;box-shadow:0 18px 44px -12px rgba(0,0,0,.9);font:.72rem/1.3 "Segoe UI",system-ui,Arial,sans-serif;}
    .cl-head{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 12px;}
    .cl-head b{color:#f4f6f8;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;}
    .cl-head span{color:#6f757d;font-size:.66rem;}
    .cl-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
    .cl-preset{display:flex;flex-direction:column;gap:3px;padding:8px;border-radius:12px;border:1px solid #23262c;background:#0d0e10;color:#c7cbd0;
      cursor:pointer;text-align:left;font:inherit;text-transform:none;letter-spacing:0;transition:border-color .15s,background .15s;}
    .cl-preset:hover{border-color:#3a3f48;}
    .cl-preset[aria-pressed=true]{border-color:#e8402a;background:rgba(232,64,42,.08);}
    .cl-preset b{margin-top:6px;color:#f4f6f8;font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;}
    .cl-preset small{color:#6f757d;font-size:.64rem;}
    .cl-thumb{position:relative;aspect-ratio:16/10;border-radius:8px;background:#08090b;border:1px solid #1c1f24;overflow:hidden;}
    .cl-b{position:absolute;box-sizing:border-box;border-radius:4px;border:1px solid #2c3038;background:#16181d no-repeat center;}
    .cl-preset[aria-pressed=true] .cl-b{border-color:rgba(232,64,42,.45);}
    .cl-b-cluster{background-image:radial-gradient(circle at 30% 55%,transparent 0 8px,#454b55 8px 10px,transparent 10px),
      radial-gradient(circle at 70% 55%,transparent 0 8px,#454b55 8px 10px,transparent 10px);}
    .cl-b-controls{background-image:repeating-linear-gradient(90deg,#3a3f48 0 10px,transparent 10px 14px);background-size:76% 3px;}
    .cl-b-tuning{background-image:repeating-linear-gradient(180deg,#3a3f48 0 2px,transparent 2px 7px);background-size:64% 78%;}
    .cl-b-dyno{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 20' preserveAspectRatio='none'%3E%3Cpath d='M1 18 C10 16 16 7 24 5 S35 6 39 9' fill='none' stroke='%23e8402a' stroke-width='1.6' vector-effect='non-scaling-stroke'/%3E%3Cpath d='M1 12 C9 6 18 4 26 4 S36 9 39 14' fill='none' stroke='%234fa8ff' stroke-width='1.6' vector-effect='non-scaling-stroke'/%3E%3C/svg%3E");
      background-size:84% 60%;}
    .cl-thumb-empty .cl-b{border-style:dashed;background-color:transparent;opacity:.75;}
    .cl-thumb em{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e8402a;}
    .cl-thumb em svg{width:22px;height:22px;padding:6px;border-radius:50%;background:#121418;border:1px solid #2a2d33;}
    .cl-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;color:#6f757d;font-size:.66rem;}
  `;

  function build() {
    CS = window.CarService;
    if (!CS || !CS.areas || !CS.areas.length) return; // a car without the shared panels keeps its own page
    areas = CS.areas.filter((a) => LABELS[a.key]);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const st = (CS.layout.arrange) || {};
    preset = ['pitwall', 'free'].includes(st.preset) ? st.preset : 'classic';
    KEYS.forEach((k) => { if (st[k]) arrange[k] = st[k]; });

    areas.forEach((a) => {
      a.el.classList.add('cl-area');
      a.ov = document.createElement('div');
      a.ov.className = 'cl-ov';
      a.ov.innerHTML = `<div class="cl-chip">${svgIcon('grip')}${LABELS[a.key]}<span></span></div>` +
        (a.scale ? ['ne', 'nw', 'se', 'sw'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']).map((d) => `<i class="cl-h cl-h-${d}" data-dir="${d}"></i>`).join('');
      a.ov.addEventListener('pointerdown', (e) => startDrag(a, e));
    });
    // the cluster wears the same frame as the car's other panels: its control deck's corners, border and fill
    const deck = area('controls'), cluster = area('cluster');
    if (deck && cluster) {
      const d = getComputedStyle(deck.el);
      Object.assign(cluster.el.style, {
        borderRadius: d.borderRadius, borderWidth: d.borderTopWidth, borderStyle: d.borderTopStyle, borderColor: d.borderTopColor,
        backgroundColor: d.backgroundColor, backgroundImage: d.backgroundImage, boxShadow: d.boxShadow,
      });
    }
    const tuning = area('tuning');
    if (tuning) {
      const across = tuningAcross(tuning.el);
      new ResizeObserver(() => requestAnimationFrame(across)).observe(tuning.el);
    }

    [ghost, gx, gy] = ['cl-ghost', 'cl-guide', 'cl-guide'].map((c) => {
      const el = document.createElement('div');
      el.className = c;
      document.body.appendChild(el);
      return el;
    });
    gx.style.display = gy.style.display = 'none';
    bar = document.createElement('div');
    bar.className = 'cl-bar';
    bar.hidden = true;
    bar.innerHTML = '<i></i><b>Arranging</b><span>Drag to move · handles resize · edges snap together</span><button class="cl-btn cl-btn-main">Done</button>';
    bar.querySelector('button').addEventListener('click', () => setEditing(false));
    document.body.appendChild(bar);

    // Layout button beside the other floating buttons, opening the preset picker above it
    const fab = document.createElement('button');
    fab.className = 'dyno-toggle-btn';
    fab.style.left = 16 + 54 * document.querySelectorAll('.dyno-toggle-btn').length + 'px';
    fab.title = 'Layout';
    fab.setAttribute('aria-label', fab.title);
    fab.innerHTML = svgIcon('layout');
    menu = document.createElement('div');
    menu.className = 'cl-menu';
    menu.popover = 'auto';
    menu.innerHTML = '<div class="cl-head"><b>Layout</b><span>Saved for this car</span></div><div class="cl-presets"></div>' +
      `<div class="cl-foot"><span>Dragging anything switches to Free</span><button class="cl-btn">${svgIcon('move')}Arrange</button></div>`;
    fab.popoverTargetElement = menu;
    fab.addEventListener('click', () => fab.blur());
    menu.addEventListener('beforetoggle', (e) => {
      if (e.newState !== 'open') return;
      renderPicker();
      const r = fab.getBoundingClientRect();
      Object.assign(menu.style, { left: r.left + 'px', bottom: innerHeight - r.top + 10 + 'px', top: 'auto' });
    });
    menu.addEventListener('click', (e) => {
      const p = e.target.closest('[data-p]');
      if (p) choose(p.dataset.p);
      if (e.target.closest('.cl-foot button')) { menu.hidePopover(); setEditing(true); }
    });
    ['keydown', 'keyup'].forEach((t) => menu.addEventListener(t, (e) => e.stopPropagation())); // no driving from the menu
    document.body.append(fab, menu);

    // Escape shuts the picker, or leaves arrange mode - and nothing else (the car would close its dyno panel too)
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !(editing || menu.matches(':popover-open'))) return;
      e.stopImmediatePropagation();
      if (menu.matches(':popover-open')) menu.hidePopover();
      else setEditing(false);
    }, true);
    // the dyno panel opening / closing or the tuning panel moving in or out of its tab re-flows the presets
    const watched = [area('dyno'), tuning].filter(Boolean);
    let was = watched.map(shown).join();
    const seen = new MutationObserver(() => {
      const now = watched.map(shown).join();
      if (now === was) return;
      was = now;
      if (preset !== 'classic') flip(layout);
      else layout();
    });
    watched.forEach((a) => seen.observe(a.el, { attributes: true, attributeFilter: ['class'] }));
    let pending = 0;
    addEventListener('resize', () => {
      if (preset !== 'pitwall' || pending) return;
      pending = requestAnimationFrame(() => { pending = 0; layout(); });
    });
    // the car opens with its dyno panel shut; an arranged page has a place for it, so it opens there
    const dyno = area('dyno');
    if (preset !== 'classic' && dyno && dyno.el.classList.contains('dyno-collapsed')) document.getElementById('dyno-toggle-btn')?.click();
    layout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
