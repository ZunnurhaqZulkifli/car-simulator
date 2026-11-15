// A blown engine with the ignition held on (what car-tune will do; here CarTune.blown is stubbed true while it runs):
// the MIL, DSC / ABS and the charge / oil-pressure warnings must come on. Shot: blown.png
export default async ({ run, hold, wait, shot, until, log }) => {
  await hold('i', 60); await wait(400); await hold('i', 60);
  await until('window.__tap.tick && window.__tap.tick.rpm > 400', 15000).catch(() => log('no start'));
  await wait(5000);
  await run('CarTune.blown = () => true'); await wait(600);
  log(await run(`JSON.stringify({ lamps: [...document.querySelectorAll('#os-lamps .lp.on, .warning-lights .wl[class*="on-"]')].map(g => g.id || g.getAttribute('transform') || g.title),
    status: (document.getElementById('status-txt') || document.getElementById('info-head') || document.getElementById('tft-msg') || {}).textContent,
    upper: [...document.querySelectorAll('#upper .up-fg.show')].map(g => g.id) })`));
  await shot('blown', '.cluster');
};
