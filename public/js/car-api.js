// Shared by every car's HTML file. Reads the state the backend injected as
// window.__CAR_STATE__ and posts updates back to it.
//
// CarAPI.log(type, summary) queues an activity for the car's history (car-history.js): it rides along on the
// next save, which goes out a beat later, so the server stores it with the state it left. CarAPI.hold() stops
// all saving - a restore reloads the page, and the page's own save on the way out must not undo it. Only the latest
// load of a car may save (state.page): an older copy gets a 409 and stops, so it can't put back an out-of-date car.
(function () {
  let queue = [], held = false, soon = null;
  const post = (path, body) => {
    const state = window.__CAR_STATE__;
    if (!state || held) return Promise.resolve();
    return fetch(`/car/${state.slug}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
      body: JSON.stringify(body),
    });
  };

  // refuels and map changes show up as differences between saves. While the pump runs (its button is lit) the
  // level at the start is held, and the fill is logged by the first save after it stops
  let last = null, fuelFrom = null;
  function watch(d) {
    const pumping = !!document.querySelector('#refuel-btn.active');
    if (d.fuel_level != null) {
      if (pumping && fuelFrom == null) fuelFrom = Math.min(last && last.fuel_level != null ? last.fuel_level : 1, d.fuel_level);
      if (!pumping && fuelFrom != null) {
        const added = d.fuel_level - fuelFrom, shown = document.getElementById('fuel-pct');
        const litres = shown && /L/.test(shown.textContent) && d.fuel_level > 0.05 ? parseFloat(shown.textContent) / d.fuel_level * added : null;
        if (added > 0.004) {
          queue.push({ type: 'refuel', summary: `Refuelled ${litres ? '+' + litres.toFixed(1) + ' L ' : ''}(${Math.round(fuelFrom * 100)}% → ${Math.round(d.fuel_level * 100)}%)` });
        }
        fuelFrom = null;
      }
    }
    if (last && d.engine_map != null && last.engine_map != null && d.engine_map !== last.engine_map && !(window.CarTune && CarTune.on)) {
      queue.push({ type: 'tune', summary: `Engine map ${last.engine_map} → ${d.engine_map}` });
    }
    last = d;
  }

  // a rejected save names the first field the server turned down (console + a toast at most once a minute)
  function saveFailed(r) {
    r.clone().json().then((j) => {
      const first = j && j.errors ? Object.entries(j.errors)[0] : null;
      showSaveError(first ? `${first[0]}: ${first[1][0]}` : `HTTP ${r.status}`);
    }, () => showSaveError(`HTTP ${r.status}`));
  }
  let lastToast = 0;
  function showSaveError(detail) {
    console.error('Car state not saved -', detail);
    if (!document.body || Date.now() - lastToast < 60000) return;
    lastToast = Date.now();
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;max-width:440px;padding:10px 14px;border-radius:10px;' +
      'background:#1a0c0a;border:1px solid #ff5a3c;color:#ffb3a3;font:12px/1.45 "Segoe UI",system-ui,Arial,sans-serif;box-shadow:0 10px 30px -10px #000;';
    el.textContent = `Couldn't save this car (${detail}). Anything changed since the last good save will be lost on reload.`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }

  // the car was opened again since this page loaded (another tab or window, or this is a back-button copy): what this
  // page holds is out of date, so it stops saving for good and asks for a reload rather than overwrite the newer state
  function showStale() {
    console.error('Car state not saved - this car is open in a newer page');
    if (!document.body || document.getElementById('car-stale')) return;
    const el = document.createElement('div');
    el.id = 'car-stale';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483646;max-width:440px;padding:10px 14px;border-radius:10px;' +
      'display:flex;gap:12px;align-items:center;background:#1a0c0a;border:1px solid #ff5a3c;color:#ffb3a3;' +
      'font:12px/1.45 "Segoe UI",system-ui,Arial,sans-serif;box-shadow:0 10px 30px -10px #000;';
    el.textContent = 'This car is open in another tab or window, so this copy is out of date and has stopped saving.';
    const btn = document.createElement('button');
    btn.textContent = 'Reload';
    btn.style.cssText = 'flex:none;padding:6px 12px;border-radius:7px;border:1px solid #ff5a3c;background:#ff5a3c;color:#1a0c0a;font:700 12px "Segoe UI",system-ui,Arial,sans-serif;cursor:pointer;';
    btn.addEventListener('click', () => location.reload());
    el.appendChild(btn);
    document.body.appendChild(el);
  }

  window.CarAPI = {
    save(data) {
      if (data && !held) watch(data);
      const events = queue.splice(0, 30);
      const req = post('state', {
        ...data,
        ...(window.CarService ? window.CarService.saveData() : {}),
        ...(window.CarTune && window.CarTune.on ? window.CarTune.saveData() : {}),
        ...(events.length ? { events } : {}),
        page: window.__CAR_STATE__ && window.__CAR_STATE__.page,
      });
      // a failed save keeps its events for the next one - and says so, rather than losing the session quietly
      return req.then((r) => {
        if (r && r.status === 409) { held = true; showStale(); return r; }
        if (r && !r.ok) { queue.unshift(...events); saveFailed(r); }
        return r;
      }, (e) => { queue.unshift(...events); showSaveError('the server didn\'t answer'); throw e; });
    },

    log(type, summary) {
      queue.push({ type, summary: String(summary).slice(0, 160) });
      clearTimeout(soon);
      soon = setTimeout(() => { if (window.saveCarState) window.saveCarState(); }, 400);
    },

    hold(on = true) { held = on; },

    // null = back to the model name
    saveName(nickname) {
      return post('name', { nickname });
    },

    saveEngineMix(mix) {
      return post('engine-mix', { engine_mix: mix });
    },
  };
})();
