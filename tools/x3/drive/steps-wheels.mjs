// probe.mjs steps (cam swap, "&dist=3.6&pitch=0.06"): the wheels - each pivot's axle and hub, what hangs on it (calipers
// must not), the tyres' lowest point (on the ground: 0), then a side close-up with the fronts steered
export default async ({ shot, sleep, orbit, key, ev }) => {
  const out = await ev(`(() => { const d = window.__dbg, T = d.THREE;
    const piv = d.pivots.map(p => { const names = new Set(); let low = 9; p.traverse(o => { if (!o.isMesh) return; names.add(o.material.name); o.geometry.computeBoundingBox(); low = Math.min(low, o.geometry.boundingBox.min.y + p.position.y + o.position.y); });
      return { hub: p.position.toArray().map(v => +v.toFixed(4)), axle: p.userData.axle.toArray().map(v => +v.toFixed(5)), lowest: +low.toFixed(4), mats: [...names].join(' ') }; });
    let calipersOnBody = 0; d.body.traverse(o => { if (o.isMesh && o.material.name === 'X3MI_Change_Brake_002') calipersOnBody++; });
    return { piv, calipersOnBody, wheelbase: +(d.pivots[2].position.z - d.pivots[0].position.z).toFixed(4) }; })()`);
  await orbit(-310, 0); await sleep(900); await shot('side');
  await key('KeyA', 'keyDown'); await sleep(1200); await shot('side-steer'); await key('KeyA', 'keyUp');
  return out;
};
