// History tab, injected after car-tune.js. Fills CarService.sections.history with the car's activity log: every
// drive, refuel, repair, service, tune and part change, fault, dyno / performance run and restore, newest first,
// each with the state the car was left in. Restore puts the whole car back to that point (the server rewrites
// its saved state, then the page reloads without saving over it). Rows come from GET /car/{slug}/activities;
// they're written by CarAPI.log (car-api.js) riding along on the car's saves.
(function () {
  const S = window.__CAR_STATE__ || {};
  const GROUPS = [
    { id: 'all', label: 'All' },
    { id: 'drive', label: 'Drives', types: ['drive'], color: '#8a8f96' },
    { id: 'fuel', label: 'Fuel', types: ['refuel'], color: '#4fa8ff' },
    { id: 'service', label: 'Service', types: ['repair', 'service', 'regen'], color: '#33d17a' },
    { id: 'tune', label: 'Tuning', types: ['tune', 'parts'], color: '#c48cff' },
    { id: 'fault', label: 'Faults', types: ['fault', 'clear', 'damage'], color: '#ffb020' },
    { id: 'runs', label: 'Runs', types: ['dyno', 'perf'], color: '#ff7a45' },
    { id: 'other', label: 'Other', types: ['rename', 'restore'], color: '#e6e8eb' },
  ];
  const groupOf = (type) => GROUPS.find((g) => g.types && g.types.includes(type)) || GROUPS[GROUPS.length - 1];
  const ICONS = {
    drive: '<path d="M5 17h14M7 17l1.5-6h7L17 17"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    refuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h13"/><path d="M14 8h2.5a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 0 3 0V9l-2.5-2.5"/>',
    service: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z"/>',
    tune: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    fault: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
    runs: '<path d="M4 4v16h16"/><path d="M7 14l3.5-4.5 3 2.5L18 6"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  };
  const CSS = `
    .ch-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;}
    .ch-head .cs-section-title{margin-bottom:4px;}
    .ch-sub{font-size:.62rem;color:#8a8f96;max-width:560px;line-height:1.45;}
    .ch-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
    .ch-filters button{font:700 .56rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;
      border-radius:999px;border:1px solid #2a2d33;background:#121418;color:#8a8f96;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}
    .ch-filters button i{width:7px;height:7px;border-radius:50%;}
    .ch-filters button[aria-pressed=true]{color:#fff;border-color:#4a4f57;background:#1a1d22;}
    .ch-btn{font:700 .56rem/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:7px 10px;border-radius:7px;
      border:1px solid #2a2d33;background:#16181c;color:#c9ccd1;cursor:pointer;}
    .ch-btn:hover:not(:disabled){color:#fff;border-color:#4a4f57;}
    .ch-btn:disabled{opacity:.4;cursor:default;}
    .ch-btn.ch-danger{border-color:#5a1e14;color:#ff8a70;}
    .ch-btn.ch-danger:hover{background:rgba(255,90,60,.12);color:#fff;}
    .ch-day{font:700 .55rem/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#6f757d;margin:14px 0 6px;}
    .ch-day:first-child{margin-top:0;}
    .ch-row{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid #1a1c20;border-radius:9px;
      background:#0a0b0d;margin-bottom:5px;}
    .ch-row:hover{border-color:#2a2d33;}
    .ch-ico{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#121418;}
    .ch-ico svg{width:15px;height:15px;}
    .ch-sum{font-size:.68rem;color:#e6e8eb;line-height:1.35;word-break:break-word;}
    .ch-meta{font:.58rem/1.4 "Courier New",monospace;color:#6f757d;margin-top:2px;}
    .ch-meta b{color:#ff8a70;font-weight:700;}
    .ch-row .ch-btn{opacity:0;transition:opacity .15s;}
    .ch-row:hover .ch-btn,.ch-row:focus-within .ch-btn,.cs-narrow .ch-row .ch-btn{opacity:1;}
    .ch-confirm{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-top:6px;padding:8px 10px;
      border-radius:7px;background:rgba(255,90,60,.06);border:1px solid #3a1a14;font-size:.62rem;color:#ffb3a3;}
    .ch-confirm span{flex:1 1 260px;}
    .ch-empty{font-size:.66rem;color:#5d626a;padding:24px 0;text-align:center;}
    .ch-more{display:flex;justify-content:center;margin-top:10px;}
  `;
  let root, list, more, filter = 'all', rows = [], done = false, loading = false, confirmId = null, failed = false;
  const fmtKm = (v) => (v == null ? '' : Math.round(v).toLocaleString('en-US') + ' km');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function build() {
    const CS = window.CarService;
    if (!CS || !CS.sections || !CS.sections.history) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = CS.sections.history;
    root.innerHTML = `
      <div class="ch-head">
        <div><div class="cs-section-title">History</div>
          <div class="ch-sub">Every drive, refuel, service, tune and fault, with the car's state right after it. Restore puts the whole car back to any point - odometer, fuel, wear, parts, tune and fault memory.</div></div>
        <button class="ch-btn" data-refresh>Refresh</button>
      </div>
      <div class="ch-filters" role="group" aria-label="Filter history">${GROUPS.map((g) =>
        `<button data-g="${g.id}">${g.color ? `<i style="background:${g.color}"></i>` : ''}${g.label}</button>`).join('')}</div>
      <div data-list></div>
      <div class="ch-more"><button class="ch-btn" data-more hidden>Load older</button></div>`;
    list = root.querySelector('[data-list]');
    more = root.querySelector('[data-more]');
    root.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.g; b.blur(); render(); }));
    root.querySelector('[data-refresh]').addEventListener('click', (e) => { e.currentTarget.blur(); refresh(); });
    more.addEventListener('click', () => { more.blur(); load(rows.length ? rows[rows.length - 1].id : null); });
    // fresh rows while the tab is open (events land a beat after they happen, with the next save)
    new MutationObserver(() => { if (!root.hidden) refresh(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
    setInterval(() => { if (!root.hidden && !confirmId) refresh(); }, 8000);
    render();
  }

  async function fetchRows(before) {
    const r = await fetch(`/car/${S.slug}/activities${before ? '?before=' + before : ''}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function refresh() {
    if (loading || !S.slug) return;
    loading = true;
    const before = rows.map((r) => r.id).join();
    try {
      const fresh = await fetchRows(null);
      failed = false;
      // keep older pages already loaded below the newest one
      const oldest = fresh.length ? fresh[fresh.length - 1].id : Infinity;
      rows = fresh.concat(rows.filter((r) => r.id < oldest));
      if (fresh.length < 60 && !rows.some((r) => r.id < oldest)) done = true;
    } catch (e) { failed = true; }
    loading = false;
    if (failed || rows.map((r) => r.id).join() !== before) render(); // unchanged: leave the list (and focus) alone
  }
  async function load(before) {
    if (loading) return;
    loading = true;
    try {
      const page = await fetchRows(before);
      rows = rows.concat(page);
      done = page.length < 60;
    } catch (e) { failed = true; }
    loading = false;
    render();
  }

  function render() {
    if (!list) return;
    root.querySelectorAll('[data-g]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === filter)));
    const shown = rows.filter((r) => filter === 'all' || groupOf(r.type).id === filter);
    more.hidden = done || !rows.length;
    if (failed && !rows.length) { list.innerHTML = '<div class="ch-empty">History unavailable - the server didn\'t answer.</div>'; return; }
    if (!shown.length) { list.innerHTML = `<div class="ch-empty">${rows.length ? 'Nothing of this kind yet.' : loading ? 'Loading…' : 'No history yet. Drive, refuel, service or tune the car and it shows up here.'}</div>`; return; }
    let day = '', h = '';
    shown.forEach((r) => {
      const at = new Date(r.at), d = at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (d !== day) { day = d; h += `<div class="ch-day">${esc(d)}</div>`; }
      const g = groupOf(r.type), ico = ICONS[g.id] || ICONS.other;
      const meta = [at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), fmtKm(r.odometer), r.fuel != null ? `fuel ${Math.round(r.fuel * 100)}%` : '',
        r.wear != null ? `engine ${Math.round(r.wear)}%` : '', r.tune ? `Map ${r.map} · ${r.tune}` : '', r.faults ? `<b>${r.faults} active fault${r.faults > 1 ? 's' : ''}</b>` : '']
        .filter(Boolean).map((x) => (x.startsWith('<b>') ? x : esc(x))).join(' · ');
      h += `<div class="ch-row" data-id="${r.id}">
        <span class="ch-ico" style="color:${g.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></span>
        <div><div class="ch-sum">${esc(r.summary)}</div><div class="ch-meta">${meta}</div></div>
        <button class="ch-btn" data-restore="${r.id}" title="Put the car back to this point">Restore</button>
        ${confirmId === r.id ? `<div class="ch-confirm"><span>Restore the car to this point? Odometer, fuel, wear, parts, tune and fault memory go back to how they were here. The page reloads.</span>
          <span style="flex:none;display:flex;gap:6px"><button class="ch-btn ch-danger" data-yes>Restore</button><button class="ch-btn" data-no>Cancel</button></span></div>` : ''}
      </div>`;
    });
    list.innerHTML = h;
    list.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => { confirmId = +b.dataset.restore; render(); list.querySelector('[data-yes]').focus(); }));
    const yes = list.querySelector('[data-yes]'), no = list.querySelector('[data-no]');
    if (no) no.addEventListener('click', () => { confirmId = null; render(); });
    if (yes) yes.addEventListener('click', () => restore(confirmId, yes));
  }

  async function restore(id, btn) {
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    // nothing on this page may save over the restored state - not the autosave, not the save on the way out
    if (window.CarAPI && CarAPI.hold) CarAPI.hold();
    try {
      const r = await fetch(`/car/${S.slug}/activities/${id}/restore`, {
        method: 'POST', headers: { 'X-CSRF-TOKEN': S.csrfToken, Accept: 'application/json' },
      });
      if (!r.ok) throw new Error(r.status);
      location.reload();
    } catch (e) {
      if (window.CarAPI && CarAPI.hold) CarAPI.hold(false); // nothing changed - saving resumes
      btn.disabled = false;
      btn.textContent = 'Failed - retry';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
