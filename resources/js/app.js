// Nav links (Garage/Upload) leave the car page entirely, unloading its iframe - flush its
// unsaved state to the backend first instead of waiting for the 10s autosave interval.
document.querySelectorAll('.navbar-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    const frame = document.querySelector('.car-frame');
    const save = frame && frame.contentWindow.saveCarState;
    if (typeof save !== 'function') return;

    e.preventDefault();
    const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
    Promise.race([Promise.resolve(save()).catch(() => {}), timeout])
      .finally(() => { window.location.href = link.href; });
  });
});
