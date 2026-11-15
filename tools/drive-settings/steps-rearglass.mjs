// in-car looking back - straight back and over each shoulder - each view rendered as is and with every glass mesh
// hidden (windows, and any see-through material named glass / window, lenses too): a rear window left tinted (taken for
// a lens) shows as changed pixels. OUT=<prefix> saves the views and masks
import fs from 'node:fs';
export default async ({ ev, sleep, tap, shot }) => {
  for (let i = 0; i < 40 && !(await ev('__dbg.usingModel')); i++) await sleep(500);
  await ev(`window.__grab = (hideAll) => {
    const { renderer, scene, camera, car } = __dbg, gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const win = (() => { try { return __dbg.windowGlass; } catch { return null; } })(), old = (() => { try { return __dbg.plainGlass; } catch { return []; } })();
    const isWin = m => m === win || old.includes(m) || (!win && /window/i.test(m.name));
    const grab = () => { renderer.render(scene, camera); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const a = grab(), hid = [];
    car.traverse(o => { if (o.isMesh && o.visible && (isWin(o.material) || (hideAll && o.material.transparent && /glas|window|wind/i.test(o.material.name)))) { o.visible = false; hid.push(o); } });
    const b = grab();
    hid.forEach(o => o.visible = true);
    let n = 0, la = 0, lb = 0;
    const c = document.createElement('canvas'); c.width = w / 4; c.height = h / 4; const g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d > 3) { n++; la += a[i] + a[i + 1] + a[i + 2]; lb += b[i] + b[i + 1] + b[i + 2]; if (!(x & 3) && !(y & 3)) { const j = ((c.height - 1 - (y >> 2)) * c.width + (x >> 2)) * 4; img.data[j] = 255; img.data[j + 3] = 255; } }
      else if (!(x & 3) && !(y & 3)) { const j = ((c.height - 1 - (y >> 2)) * c.width + (x >> 2)) * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = a[i + 1] >> 1; img.data[j + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    return { hidden: hid.length, changed: +(100 * n / (w * h)).toFixed(2), lumWithOverWithout: n ? +(la / lb).toFixed(3) : null, mask: c.toDataURL().split(',')[1] };
  }`);
  const out = {};
  await tap('KeyC'); await sleep(1200);
  for (const [name, yaw] of [['back', Math.PI], ['left-shoulder', 2.3], ['right-shoulder', -2.3]]) {
    await ev(`__ev("orbitYaw = ${yaw}; orbitPitch = PITCH")`); await sleep(600);
    await shot('in-' + name);
    const r = await ev('__grab(true)');
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}-${name}-mask.png`, Buffer.from(r.mask, 'base64'));
    delete r.mask;
    out[name] = r;
  }
  return out;
};
