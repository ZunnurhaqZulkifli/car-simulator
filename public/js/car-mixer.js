// Shared engine sound-layer mixer, injected into every car's raw HTML alongside car-api.js.
//
// A car opts in by calling, once its Web Audio graph is built (end of initAudio):
//
//   window.EngineMixer.register({
//     title: 'Petrol Engine',
//     layers: [
//       { id: 'master', label: 'Master',         value: 1,    set: f => {...} },
//       { id: 'rasp',   label: 'Combustion Rasp', value: 0.47, set: f => {...} },
//       ...
//     ],
//   });
//
// `value` is the car's own default fraction (0..1); `set(frac)` applies that layer's
// volume in the car's audio graph. This module owns only the UI + persistence: it merges
// any saved settings from window.__CAR_STATE__.engineMix, calls set() for each layer, and
// debounce-saves changes back through CarAPI.saveEngineMix().
(function () {
  const PREFIX = 'emix';
  let layers = [];
  let title = 'Engine';
  let registered = false;
  let panelBuilt = false;
  let saveTimer = null;

  const saved = (window.__CAR_STATE__ && window.__CAR_STATE__.engineMix) || {};

  function injectStyles() {
    if (document.getElementById(PREFIX + '-styles')) return;
    const css = `
      .${PREFIX}-btn{position:fixed;right:16px;bottom:16px;width:44px;height:44px;border-radius:50%;
        border:1px solid #2a2a2a;background:#131313;color:#c9c9c9;cursor:pointer;z-index:2147483000;
        display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px -6px rgba(0,0,0,.7);
        transition:color .15s,border-color .15s;}
      .${PREFIX}-btn:hover{color:#fff;border-color:#e8402a;}
      .${PREFIX}-btn svg{width:20px;height:20px;}
      .${PREFIX}-panel{position:fixed;right:16px;bottom:70px;width:min(420px,calc(100vw - 32px));
        max-height:min(70vh,520px);overflow-y:auto;background:#0c0c0c;border:1px solid #2a1210;
        border-radius:14px;padding:14px 16px;z-index:2147483000;
        box-shadow:0 24px 60px -20px rgba(0,0,0,.85);font-family:"Segoe UI",system-ui,Arial,sans-serif;
        display:none;}
      .${PREFIX}-panel.${PREFIX}-open{display:block;}
      .${PREFIX}-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
      .${PREFIX}-title{font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:#8a8f96;}
      .${PREFIX}-close{background:none;border:none;color:#8a8f96;font-size:1.1rem;line-height:1;cursor:pointer;padding:2px 6px;}
      .${PREFIX}-close:hover{color:#fff;}
      .${PREFIX}-note{font-size:.72rem;color:#8a8f96;padding:8px 2px;}
      .${PREFIX}-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px 18px;}
      .${PREFIX}-row{display:flex;flex-direction:column;gap:6px;min-width:0;}
      .${PREFIX}-row label{font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:#8a8f96;
        display:flex;justify-content:space-between;gap:8px;}
      .${PREFIX}-row input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
        background:linear-gradient(90deg,#e8402a var(--pct,0%),#262626 var(--pct,0%));}
      .${PREFIX}-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;
        border-radius:50%;background:#f4f6f8;border:3px solid #e8402a;cursor:pointer;margin-top:-6px;}
      .${PREFIX}-row input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;
        background:#f4f6f8;border:3px solid #e8402a;cursor:pointer;}
    `;
    const style = document.createElement('style');
    style.id = PREFIX + '-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  let btn, panel, grid, note;

  function build() {
    injectStyles();

    btn = document.createElement('button');
    btn.className = PREFIX + '-btn';
    btn.title = 'Engine sound mixer';
    btn.setAttribute('aria-label', 'Engine sound mixer');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2.4" fill="#0c0c0c"/>' +
      '<line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2.4" fill="#0c0c0c"/>' +
      '<line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2.4" fill="#0c0c0c"/></svg>';

    panel = document.createElement('div');
    panel.className = PREFIX + '-panel';
    panel.innerHTML =
      `<div class="${PREFIX}-head"><span class="${PREFIX}-title">${title} &mdash; Sound Layer Mixer</span>` +
      `<button class="${PREFIX}-close" aria-label="Close">&times;</button></div>` +
      `<div class="${PREFIX}-note">Start the engine to adjust the sound layers.</div>` +
      `<div class="${PREFIX}-grid"></div>`;

    grid = panel.querySelector('.' + PREFIX + '-grid');
    note = panel.querySelector('.' + PREFIX + '-note');

    btn.addEventListener('click', () => panel.classList.toggle(PREFIX + '-open'));
    panel.querySelector('.' + PREFIX + '-close').addEventListener('click', () => panel.classList.remove(PREFIX + '-open'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.classList.remove(PREFIX + '-open'); });

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    if (registered) renderRows();
  }

  function renderRows() {
    panel.querySelector('.' + PREFIX + '-title').innerHTML = title + ' &mdash; Sound Layer Mixer';
    note.style.display = 'none';
    grid.innerHTML = '';
    layers.forEach((layer) => {
      const pct = Math.round(layer.value * 100);
      const row = document.createElement('div');
      row.className = PREFIX + '-row';
      const rid = PREFIX + '-r-' + layer.id;
      row.innerHTML =
        `<label for="${rid}">${layer.label} <span>${pct}%</span></label>` +
        `<input id="${rid}" type="range" min="0" max="100" value="${pct}">`;
      const input = row.querySelector('input');
      const out = row.querySelector('span');
      input.style.setProperty('--pct', pct + '%');
      input.addEventListener('input', () => {
        const f = parseInt(input.value, 10) / 100;
        layer.value = f;
        out.textContent = input.value + '%';
        input.style.setProperty('--pct', input.value + '%');
        try { layer.set(f); } catch (e) { /* graph not ready */ }
        scheduleSave();
      });
      grid.appendChild(row);
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const map = {};
      layers.forEach((l) => { map[l.id] = Math.round(l.value * 1000) / 1000; });
      if (window.CarAPI && window.CarAPI.saveEngineMix) window.CarAPI.saveEngineMix(map);
    }, 600);
  }

  window.EngineMixer = {
    register(config) {
      title = config.title || title;
      layers = (config.layers || []).map((l) => {
        const value = (saved && typeof saved[l.id] === 'number') ? saved[l.id] : (l.value != null ? l.value : 1);
        return { id: l.id, label: l.label || l.id, value, set: l.set || function () {} };
      });
      registered = true;
      // push merged (saved) values into the audio graph immediately
      layers.forEach((l) => { try { l.set(l.value); } catch (e) {} });
      if (panel) renderRows();
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
