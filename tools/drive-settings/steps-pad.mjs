// the phone pad's link, through the fake relay socket (run with PAD=1): pings answered, the phone's and the relay's logs
// merged and de-duplicated, the pad going quiet mid-input (inputs released, logged, a notice) and coming back, the relay
// dropping and the page reconnecting, a broken message, the Pad tab, Copy and Clear
export default async ({ ev, sleep, shot, tap }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  const out = {}, log = () => ev(`JSON.parse(localStorage.getItem('drive.padLog') || '[]')`), sock = js => ev(`window.__padSock.${js}`);
  await ev(`localStorage.removeItem('drive.padLog'); localStorage.removeItem('drive.padLogCleared'); __ev('padLog.length = 0; padSeen.clear(); padCleared = 0')`);
  await sock(`__close(1006)`); await sleep(3300); // a fresh socket: this page logs it opening
  const now = await ev('Date.now()');
  for (const [i, rtt] of [[1, 18], [2, 22], [3, 61]]) { await sock(`__msg({ ping: ${1000 * i + 0.5}, rtt: ${rtt} })`); await sleep(50); }
  out.pongs = await ev(`window.__padSent.filter(s => s.includes('pong'))`);
  await sock(`__msg({ padLog: [{ t: ${now - 9000}, ev: 'boot', ua: 'iPhone; Safari' }, { t: ${now - 8000}, ev: 'ws-close', code: 1006, reason: '', clean: false, up: 412 }, { t: ${now - 7000}, ev: 'brand-new-event', foo: 1 }] })`);
  const backlog = `{ padEvents: [{ t: ${now - 20000}, ev: 'relay-start' }, { t: ${now - 8100}, ev: 'client-close', origin: '100.64.0.7', kind: 'phone', code: 1006, reason: '', up: 412, idle: 3021 }, { t: ${now - 8100}, ev: 'client-close', origin: '127.0.0.1', kind: 'drive', code: 1001, reason: '', up: 900, idle: 10 }] }`;
  await sock(`__msg(${backlog})`); await sock(`__msg(${backlog})`); // (sent again on every connect: kept once)
  await sock(`__msg('{broken json')`); await sock(`__msg('null')`);
  // the phone driving: 30 Hz, half throttle, then silent
  await ev(`window.__feed = setInterval(() => window.__padSock.__msg({ s: 0, t: 0.5, b: 0, h: false }), 33)`); await sleep(1000);
  out.throttleWhileFed = await ev(`document.getElementById('carpage').contentDocument.getElementById('throttle')?.value`);
  await ev(`clearInterval(window.__feed)`); await sleep(800);
  out.throttleAfterSilence = await ev(`document.getElementById('carpage').contentDocument.getElementById('throttle')?.value`);
  out.noticeLost = await ev(`document.getElementById('notice').hidden ? null : document.getElementById('notice').textContent`);
  await shot('lost');
  await ev(`window.__feed = setInterval(() => window.__padSock.__msg({ s: 0, t: 0, b: 0, h: false }), 33)`); await sleep(400);
  out.noticeBack = await ev(`document.getElementById('notice').hidden ? null : document.getElementById('notice').textContent`);
  await ev(`clearInterval(window.__feed)`); await sleep(700);
  await sock(`__close(1006)`); await sleep(3400); // the relay gone: logged, retried in 3 s, back
  await tap('BracketRight', 80, ']'); await sleep(200);
  await ev(`document.querySelector('#set-tabs [data-tab=pad]').click()`); await sleep(400);
  out.status = await ev(`[...document.querySelectorAll('#set-status b')].map(b => b.textContent)`);
  out.shownLog = await ev(`document.getElementById('set-log').textContent.split('\\n')`);
  await shot('padtab');
  const l = await log();
  out.stored = l.map(e => `${e.src} ${e.ev}${e.src === 'drive' ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['t', 'src', 'ev'].includes(k)))) : ''}`);
  await ev(`document.querySelector('#settings [data-copy]').click()`); await sleep(100);
  out.copyButton = await ev(`document.querySelector('#settings [data-copy]').textContent`);
  await ev(`document.querySelector('#settings [data-clear]').click()`); await sleep(100);
  await sock(`__msg(${backlog})`); await sleep(100);
  out.afterClearAndBacklog = (await log()).length;
  out.shownAfterClear = await ev(`document.getElementById('set-log').textContent`);
  return out;
};
