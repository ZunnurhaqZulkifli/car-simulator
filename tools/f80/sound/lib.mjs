// shared bits for the sound analysis scripts: WAV in, FFT, A-weighting, rpm logs, PNG out
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

// 16-bit PCM or 32-bit float WAV -> { sr, ch: [Float32Array...], mono }
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(p + 8), nch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, Math.min(b.length, p + 8 + n));
    p += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: no fmt/data chunk`);
  const { nch, sr, bits, tag } = fmt, bps = bits/8, n = Math.floor(data.length/(bps*nch));
  const ch = Array.from({ length: nch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const o = (i*nch + c)*bps;
    ch[c][i] = tag === 3 ? data.readFloatLE(o) : bits === 16 ? data.readInt16LE(o)/32768 : bits === 24 ? data.readIntLE(o, 3)/8388608 : data.readInt32LE(o)/2147483648;
  }
  const mono = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < n; i++) mono[i] += c[i]/nch;
  return { sr, ch, mono };
}

export function writeWav(path, sr, chans) {
  const n = chans[0].length, nch = chans.length, pcm = Buffer.alloc(n*nch*2), h = Buffer.alloc(44);
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i]))*32767), (i*nch + c)*2);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(nch, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr*nch*2, 28); h.writeUInt16LE(nch*2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
}

// in-place radix-2 complex FFT (re, im: Float64Array, length a power of two)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2*Math.PI/len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len/2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len/2]*cr - im[i + k + len/2]*ci, vi = re[i + k + len/2]*ci + im[i + k + len/2]*cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len/2] = ur - vr; im[i + k + len/2] = ui - vi;
        const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t;
      }
    }
  }
}

// power spectrum of x[at .. at+win) with a Hann window, zero-padded to nfft. Returns Float64Array(nfft/2) of |X|^2,
// scaled so a full-scale sine reads ~0 dB at its bin
export function powerSpec(x, at, win, nfft = win) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let wsum = 0;
  for (let i = 0; i < win; i++) { const w = 0.5 - 0.5*Math.cos(2*Math.PI*i/(win - 1)); wsum += w; const j = at + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0)*w; }
  fft(re, im);
  const out = new Float64Array(nfft/2), k = 4/(wsum*wsum);
  for (let i = 0; i < nfft/2; i++) out[i] = (re[i]*re[i] + im[i]*im[i])*k;
  return out;
}

// A-weighting gain (linear power) at f Hz
export function aWeight(f) {
  const f2 = f*f, ra = (148840000*f2*f2)/((f2 + 424.36)*Math.sqrt((f2 + 11599.29)*(f2 + 544496.41))*(f2 + 148840000));
  const db = 20*Math.log10(ra) + 2.0;
  return 10 ** (db/10);
}
export const dB = p => 10*Math.log10(Math.max(1e-20, p));

// rpm log: lines "t rpm [more]" (seconds from the clip start) -> sorted [[t, rpm], ...]; rpmAt(log, t) interpolates
export function readRpm(path) {
  return readFileSync(path, 'utf8').split('\n').map(l => l.trim().split(/[\s,]+/).map(Number)).filter(r => r.length >= 2 && isFinite(r[0]) && isFinite(r[1])).map(r => [r[0], r[1]]);
}
export function rpmAt(log, t) {
  if (!log.length) return NaN;
  let lo = 0, hi = log.length - 1;
  if (t <= log[0][0]) return log[0][1];
  if (t >= log[hi][0]) return log[hi][1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (log[m][0] <= t) lo = m; else hi = m; }
  const [t0, r0] = log[lo], [t1, r1] = log[hi];
  return r0 + (r1 - r0)*(t - t0)/(t1 - t0);
}

// RGB PNG writer
export function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w*3 + 1)*h);
  for (let y = 0; y < h; y++) { raw[y*(w*3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y*w*3, w*3).copy(raw, y*(w*3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// 0..1 -> dark blue / magenta / orange / pale yellow (inferno-like)
export function heat(v) {
  v = Math.max(0, Math.min(1, v));
  const stops = [[0, 0, 0, 4], [0.25, 60, 15, 110], [0.5, 180, 50, 100], [0.75, 245, 135, 30], [1, 252, 250, 170]];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ...c0] = stops[i - 1], [b, ...c1] = stops[i], k = (v - a)/(b - a);
    return c0.map((c, j) => Math.round(c + (c1[j] - c)*k));
  }
  return stops.at(-1).slice(1);
}
