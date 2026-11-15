// first look: the cluster as loaded, and with ?bulbs-style window.__bulbs held on
export default async ({ run, shotEl, wait, log }) => {
  await shotEl('0-off');
  log(await run(`[...document.querySelectorAll('.warning-lights .wl')].map(e => e.id + ':' + e.className).join(' ')`));
  await run('window.__bulbs = true'); await wait(600); await shotEl('0-bulbs');
};
