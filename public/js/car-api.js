// Shared by every car's HTML file. Reads the state the backend injected as
// window.__CAR_STATE__ and posts updates back to it.
window.CarAPI = {
  save(data) {
    const state = window.__CAR_STATE__;
    if (!state) return Promise.resolve();
    return fetch(`/car/${state.slug}/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': state.csrfToken,
      },
      body: JSON.stringify(data),
    });
  },

  saveEngineMix(mix) {
    const state = window.__CAR_STATE__;
    if (!state) return Promise.resolve();
    return fetch(`/car/${state.slug}/engine-mix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': state.csrfToken,
      },
      body: JSON.stringify({ engine_mix: mix }),
    });
  },
};
