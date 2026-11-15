// boxes the lamp maps hang off: the cluster, its SVG / dial row, the lamp layer (page px)
export default async ({ run, log }) => {
  log(await run(`JSON.stringify(Object.fromEntries(['.cluster', '#cl-svg', '.warning-lights', '.dials', '#speed-svg', '#tach-svg', '.tft', '.wl-face'].map(s => {
    const e = document.querySelector(s); if (!e) return [s, null]; const r = e.getBoundingClientRect(); return [s, [r.x, r.y, r.width, r.height].map(v => +v.toFixed(1))]; })))`));
};
