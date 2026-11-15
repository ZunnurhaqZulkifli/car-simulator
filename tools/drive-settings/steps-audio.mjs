// Settings › Audio (run with PAD=1): the pad's Settings button (a BracketRight tap through the fake relay) opens the
// menu and the telemetry says so; each slider scales its own sound's gain (crash out gain, indicator tick, wind levels -
// read where the page sets them; crashAt reset, else a hit within 0.2 s of the last is folded into it), 0 % silences it, the volumes survive a reload, Reset puts them back; and the pad's
// map overview's size
export default async ({ ev, sleep, shot, send }) => {
  const r = {};
  const ready = async () => { for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500); };
  await ready();
  await ev(`window.__padSock.__msg({ tap: { key: ']', code: 'BracketRight' }, drive: 1 })`); await sleep(400);
  r.openedByPad = await ev(`!document.getElementById('settings').hidden`);
  r.teleSet = await ev(`window.__padSent.filter(s => s.includes('"tele"')).at(-1)?.includes('"set":true')`);
  await ev(`document.querySelector('#set-tabs [data-tab=audio]').click()`); await sleep(300);
  await shot('audio-tab');
  // what each sound sets: the values handed to its gains (crash's out gain is set before it's connected)
  await ev(`window.__vals = []; for (const f of ['setValueAtTime', 'setTargetAtTime']) { const o = AudioParam.prototype[f]; AudioParam.prototype[f] = function (v, ...a) { __vals.push([f, v]); return o.call(this, v, ...a); }; }
    const c = GainNode.prototype.connect; GainNode.prototype.connect = function (d, ...a) { if (d instanceof AudioDestinationNode) __vals.push(['out', this.gain.value]); return c.call(this, d, ...a); };`);
  const measure = async () => {
    await ev(`__ev('actx ??= new AudioContext()'); __vals.length = 0; __ev('crashAt = -1; crash(10)')`);
    const crash = await ev(`__vals.find(v => v[0] === 'out')[1]`);
    await ev(`__vals.length = 0; __ev('relayTick(true)')`);
    const tick = await ev(`__vals.find(v => v[0] === 'setValueAtTime')[1]`);
    await ev(`__ev('windTick(150, true)')`); // (once to build it)
    await ev(`__vals.length = 0; __ev('windTick(150, true)')`);
    const wind = await ev(`__ev('wind.roar.g.gain') && __vals.filter(v => v[0] === 'setTargetAtTime')[0][1]`); // (the roar's level: set first)
    return { crash: +crash.toFixed(4), tick: +tick.toFixed(4), wind: +wind.toFixed(5) };
  };
  const slide = (k, v) => ev(`(() => { const i = document.querySelector('[data-vol=${k}]'); i.value = ${v}; i.dispatchEvent(new Event('input', { bubbles: true })); return i.nextElementSibling.textContent; })()`);
  r.at100 = await measure();
  r.labels50 = [await slide('wind', 0.5), await slide('crash', 0.5), await slide('tick', 0.5)];
  r.at50 = await measure();
  for (const k of ['wind', 'crash', 'tick']) await slide(k, 2);
  r.at200 = await measure();
  for (const k of ['wind', 'crash', 'tick']) await slide(k, 0);
  r.at0 = await measure();
  await slide('wind', 1.5); await slide('crash', 0.25);
  r.stored = await ev(`localStorage.getItem('drive-audio')`);
  await send('Page.reload'); await sleep(14000); await ready();
  r.afterReload = await ev(`__ev('vol')`);
  await ev(`__ev("toggleSettings()"); document.querySelector('#set-tabs [data-tab=audio]').click()`); await sleep(300);
  r.slidersAfterReload = await ev(`[...document.querySelectorAll('[data-vol]')].map(i => i.value + ' ' + i.nextElementSibling.textContent)`);
  await ev(`document.querySelector('[data-vreset]').click()`); await sleep(100);
  r.afterReset = [await ev(`__ev('vol')`), await ev(`localStorage.getItem('drive-audio')`)];
  const t = Date.now();
  r.overview = await ev(`(() => { const o = __ev('mapOverview()'); return { w: o.w, h: o.h, s: o.s, kb: Math.round(JSON.stringify({ map: o }).length / 1024) }; })()`);
  r.overview.ms = Date.now() - t;
  await ev(`__ev('settingsEl.hidden = true')`);
  return r;
};
