// Diagnostics tab, injected after car-service.js. Fills CarService.sections.diag with a scan-tool style view:
// vehicle health ring, per-module live readings, the fault memory (clearable) and a scan console.
// Everything it shows comes from CarService (parts, codes, clearCodes, ignitionOn) - no per-car code.
(function () {
  const MODULES = [
    { id: 'ECM', name: 'Engine control module' },
    { id: 'ABS', name: 'Brake / stability control' },
    { id: 'TPMS', name: 'Tyre pressure monitor' },
    { id: 'BMS', name: 'Battery management' },
    { id: 'BCM', name: 'Body control module' },
  ];
  const COLORS = { ok: '#33d17a', warn: '#ff9d2e', bad: '#ff5f3d', dim: '#8a8f96' };

  const CSS = `
    .cd-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px;}
    .cd-head .cs-section-title{margin-bottom:4px;}
    .cd-sub{font:.62rem/1.4 "Courier New",monospace;color:#8a8f96;letter-spacing:.06em;}
    .cd-conn{display:inline-flex;align-items:center;gap:6px;}
    .cd-conn i{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor;display:inline-block;}
    .cd-actions{display:flex;gap:8px;flex-wrap:wrap;}
    .cd-btn{font:700 .6rem/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:9px 14px;
      border-radius:8px;border:1px solid #2a2d33;background:#16181c;color:#c9ccd1;cursor:pointer;transition:.15s;}
    .cd-btn:hover:not(:disabled){color:#fff;border-color:#e8402a;}
    .cd-btn:disabled{opacity:.4;cursor:not-allowed;}
    .cd-btn.cd-primary{background:rgba(51,209,122,.12);border-color:#2a6b47;color:#7ff0a8;}
    .cd-top{display:grid;grid-template-columns:170px 1fr;gap:14px;margin-bottom:14px;}
    .cd-card{background:#090a0c;border:1px solid #1f2125;border-radius:10px;padding:12px;}
    .cd-health{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;}
    .cd-ring{width:118px;height:118px;}
    .cd-ring text{font-family:"Courier New",monospace;}
    .cd-counts{display:flex;gap:14px;font:.58rem/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8a8f96;}
    .cd-counts b{display:block;font:700 1rem/1.1 "Courier New",monospace;color:#f4f6f8;letter-spacing:0;}
    .cd-modules{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;}
    .cd-mod{position:relative;transition:border-color .2s,box-shadow .2s;}
    .cd-mod.cd-scanning{border-color:#4fa8ff;box-shadow:0 0 0 1px #4fa8ff inset,0 0 18px -6px #4fa8ff;}
    .cd-mod-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
    .cd-dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 8px currentColor;background:currentColor;}
    .cd-mod-id{font:700 .72rem/1 "Courier New",monospace;color:#f4f6f8;letter-spacing:.06em;}
    .cd-mod-name{font-size:.56rem;color:#8a8f96;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cd-row{display:grid;grid-template-columns:64px 1fr auto;align-items:center;gap:8px;font-size:.6rem;color:#aab0b8;margin-top:5px;}
    .cd-bar{height:4px;border-radius:2px;background:#1f2125;overflow:hidden;}
    .cd-bar i{display:block;height:100%;border-radius:2px;transition:width .4s,background .4s;}
    .cd-val{font:700 .62rem/1 "Courier New",monospace;color:#f4f6f8;}
    .cd-note{font-size:.58rem;color:#8a8f96;margin-top:4px;}
    .cd-bottom{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .cd-label{font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;color:#8a8f96;margin-bottom:8px;display:flex;justify-content:space-between;}
    .cd-codes{max-height:220px;overflow-y:auto;}
    .cd-code{display:grid;grid-template-columns:58px 1fr auto;gap:10px;align-items:center;padding:8px 2px;border-top:1px solid #16181b;}
    .cd-code:first-child{border-top:0;}
    .cd-code b{font:700 .74rem/1 "Courier New",monospace;}
    .cd-code-t{font-size:.66rem;color:#e6e8eb;}
    .cd-code-m{font-size:.56rem;color:#6f747b;margin-top:2px;letter-spacing:.04em;}
    .cd-tag{font:700 .52rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.12em;padding:4px 7px;border-radius:4px;border:1px solid currentColor;}
    .cd-empty{font-size:.66rem;color:#5d626a;padding:18px 0;text-align:center;}
    .cd-console{background:#030405;border:1px solid #16201a;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;}
    .cd-log{height:190px;overflow-y:auto;font:.64rem/1.55 "Courier New",monospace;color:#8a8f96;white-space:pre-wrap;word-break:break-word;}
    .cd-log .ok{color:#7ff0a8;} .cd-log .warn{color:#ffc46b;} .cd-log .err{color:#ff8a70;} .cd-log .hi{color:#e6e8eb;}
    .cd-cursor{display:inline-block;width:7px;height:11px;background:#7ff0a8;vertical-align:-1px;animation:cdBlink 1s steps(1) infinite;}
    @keyframes cdBlink{50%{opacity:0;}}
    .cd-progress{height:3px;border-radius:2px;background:#101418;margin-top:8px;overflow:hidden;}
    .cd-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#33d17a,#4fa8ff);transition:width .3s;}
    /* follows the (resizable) dyno panel's width, not the window's */
    .cs-narrow .cd-top,.cs-narrow .cd-bottom{grid-template-columns:1fr;}
    .cs-narrow .cd-health{flex-direction:row;gap:18px;}
    .cs-sized .cd-log{height:auto;min-height:150px;max-height:40vh;}
  `;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const health = (p) => Math.max(0, 100 - p.value);
  const tone = (h) => (h <= 0 ? COLORS.bad : h < 25 ? COLORS.warn : COLORS.ok);
  const reading = (p) => (p.read ? p.read(p.value) : Math.round(health(p)) + '%');

  let root, els = {}, busy = false;

  function moduleState(m) {
    const CS = window.CarService;
    const ps = CS.parts.filter((p) => p.module === m.id);
    const cs = [...CS.codes.values()].filter((c) => c.module === m.id);
    if (ps.some((p) => p.fault) || cs.some((c) => c.status === 'active')) return 'bad';
    if (cs.length || ps.some((p) => health(p) < 25)) return 'warn';
    return 'ok';
  }

  function build() {
    const CS = window.CarService;
    if (!CS || !CS.sections || !CS.sections.diag) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const slug = (window.__CAR_STATE__ && window.__CAR_STATE__.slug) || 'vehicle';
    root = CS.sections.diag;
    root.innerHTML = `
      <div class="cd-head">
        <div>
          <div class="cs-section-title">Diagnostics</div>
          <div class="cd-sub">OBD-II &middot; ${esc(slug.replace(/-/g, ' ').toUpperCase())} &middot; <span class="cd-conn" data-conn></span></div>
        </div>
        <div class="cd-actions">
          <button class="cd-btn cd-primary" data-scan>Run full scan</button>
          <button class="cd-btn" data-clear>Clear codes</button>
        </div>
      </div>
      <div class="cd-top">
        <div class="cd-card cd-health">
          <svg class="cd-ring" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#1a1c20" stroke-width="9"/>
            <circle data-arc cx="60" cy="60" r="50" fill="none" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="314.16" stroke-dashoffset="314.16" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset .6s,stroke .6s"/>
            <text data-score x="60" y="64" text-anchor="middle" font-size="24" font-weight="700" fill="#f4f6f8">--</text>
            <text x="60" y="82" text-anchor="middle" font-size="8" fill="#8a8f96" letter-spacing="1.5">HEALTH</text>
          </svg>
          <div class="cd-counts"><div><b data-active>0</b>Active</div><div><b data-stored>0</b>Stored</div></div>
        </div>
        <div class="cd-modules" data-modules></div>
      </div>
      <div class="cd-bottom">
        <div class="cd-card">
          <div class="cd-label"><span>Fault memory</span><span data-codecount></span></div>
          <div class="cd-codes" data-codes></div>
        </div>
        <div class="cd-console">
          <div class="cd-label"><span>Scan console</span><span data-status>Idle</span></div>
          <div class="cd-log" data-log></div>
          <div class="cd-progress"><i data-progress></i></div>
        </div>
      </div>`;
    ['conn', 'scan', 'clear', 'arc', 'score', 'active', 'stored', 'modules', 'codes', 'codecount', 'log', 'progress', 'status']
      .forEach((k) => { els[k] = root.querySelector(`[data-${k}]`); });
    els.modules.innerHTML = MODULES.map((m) => `
      <div class="cd-card cd-mod" data-mod="${m.id}">
        <div class="cd-mod-head"><span class="cd-dot"></span><div style="min-width:0">
          <div class="cd-mod-id">${m.id}</div><div class="cd-mod-name">${m.name}</div></div></div>
        <div data-rows></div>
      </div>`).join('');
    els.scan.addEventListener('click', () => { els.scan.blur(); scan(); });
    els.clear.addEventListener('click', () => { els.clear.blur(); clear(); });
    log('Diagnostic interface ready. Switch the ignition on and run a full scan.', 'hi');
    render();
    setInterval(() => { if (!root.hidden) render(); }, 500);
  }

  function render() {
    const CS = window.CarService;
    const on = CS.ignitionOn();
    els.conn.style.color = on ? COLORS.ok : COLORS.dim;
    els.conn.innerHTML = `<i></i>${on ? 'Connected' : 'No ignition'}`;
    els.scan.disabled = els.clear.disabled = busy || !on;

    const score = Math.round(CS.parts.reduce((a, p) => a + health(p), 0) / CS.parts.length);
    els.arc.style.strokeDashoffset = String(314.16 * (1 - score / 100));
    els.arc.style.stroke = score < 50 ? COLORS.bad : score < 80 ? COLORS.warn : COLORS.ok;
    els.score.textContent = score + '%';

    const codes = [...CS.codes.values()];
    els.active.textContent = codes.filter((c) => c.status === 'active').length;
    els.stored.textContent = codes.filter((c) => c.status === 'stored').length;
    els.codecount.textContent = codes.length ? codes.length + ' code' + (codes.length > 1 ? 's' : '') : '';

    MODULES.forEach((m) => {
      const card = els.modules.querySelector(`[data-mod="${m.id}"]`);
      card.querySelector('.cd-dot').style.color = on ? COLORS[moduleState(m)] : COLORS.dim;
      const ps = CS.parts.filter((p) => p.module === m.id);
      const n = codes.filter((c) => c.module === m.id).length;
      card.querySelector('[data-rows]').innerHTML = ps.map((p) => `
        <div class="cd-row"><span>${esc(p.label)}</span>
          <span class="cd-bar"><i style="width:${health(p)}%;background:${tone(health(p))}"></i></span>
          <span class="cd-val">${esc(reading(p))}</span></div>`).join('') +
        (ps.length ? '' : `<div class="cd-note">Lighting, comfort &amp; driver assistance</div>`) +
        `<div class="cd-note">${n ? n + ' fault code' + (n > 1 ? 's' : '') : 'No fault codes'}</div>`;
    });

    els.codes.innerHTML = codes.length ? codes.map((c) => {
      const col = c.status === 'active' ? COLORS.bad : COLORS.warn;
      return `<div class="cd-code"><b style="color:${col}">${esc(c.code)}</b>
        <div><div class="cd-code-t">${esc(c.title)}</div><div class="cd-code-m">${esc(c.module)} &middot; ${esc(c.at)}</div></div>
        <span class="cd-tag" style="color:${col}">${c.status === 'active' ? 'ACTIVE' : 'STORED'}</span></div>`;
    }).join('') : '<div class="cd-empty">No fault codes stored</div>';
  }

  function log(text, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    els.log.querySelector('.cd-cursor')?.remove();
    els.log.appendChild(line);
    while (els.log.childElementCount > 200) els.log.firstElementChild.remove();
    const cursor = document.createElement('span');
    cursor.className = 'cd-cursor';
    els.log.appendChild(cursor);
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function scan() {
    const CS = window.CarService;
    if (busy || !CS.ignitionOn()) return;
    busy = true;
    els.status.textContent = 'Scanning';
    render();
    log('');
    log('> Full system scan started', 'hi');
    let found = 0;
    for (let i = 0; i < MODULES.length; i++) {
      const m = MODULES[i];
      const card = els.modules.querySelector(`[data-mod="${m.id}"]`);
      card.classList.add('cd-scanning');
      log(`> Querying ${m.id} (${m.name})...`);
      await sleep(500 + Math.random() * 400);
      CS.parts.filter((p) => p.module === m.id).forEach((p) => {
        const h = health(p);
        log(`    ${p.label.padEnd(12)} ${reading(p).padStart(8)}   ${h <= 0 ? 'FAIL' : h < 25 ? 'LOW ' : 'OK  '}`, h <= 0 ? 'err' : h < 25 ? 'warn' : '');
      });
      const cs = [...CS.codes.values()].filter((c) => c.module === m.id);
      if (!cs.length) log('    No fault codes', 'ok');
      cs.forEach((c) => log(`    ${c.code}  ${c.title}  [${c.status.toUpperCase()}]`, c.status === 'active' ? 'err' : 'warn'));
      found += cs.length;
      card.classList.remove('cd-scanning');
      els.progress.style.width = ((i + 1) / MODULES.length * 100) + '%';
    }
    const due = CS.parts.filter((p) => health(p) < 25).map((p) => p.label);
    const score = Math.round(CS.parts.reduce((a, p) => a + health(p), 0) / CS.parts.length);
    log(`> Scan complete: ${found} fault code${found === 1 ? '' : 's'}, vehicle health ${score}%`, found ? 'warn' : 'ok');
    if (due.length) log(`> Service recommended: ${due.join(', ')}`, 'warn');
    await sleep(600);
    els.progress.style.width = '0';
    els.status.textContent = 'Idle';
    busy = false;
    render();
  }

  async function clear() {
    const CS = window.CarService;
    if (busy || !CS.ignitionOn()) return;
    busy = true;
    els.status.textContent = 'Clearing';
    render();
    const before = CS.codes.size;
    log('');
    log('> Clearing fault memory on all modules...', 'hi');
    await sleep(900);
    const still = CS.clearCodes();
    log(`    ${before - still.length} code${before - still.length === 1 ? '' : 's'} erased`, 'ok');
    still.forEach((c) => log(`    ${c.code} ${c.title}: fault still present, service required`, 'err'));
    els.status.textContent = 'Idle';
    busy = false;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
