// the E60's steering-wheel roundel was stored flopped so it read right once drive.html mirrored the cabin; the cabin is no
// longer mirrored, so it's flopped back (and renamed), every buffer view re-laid
import fs from 'fs'; import { execSync } from 'child_process';
import { readGlb, writeGlb } from './glb.mjs';
const { json, bin } = readGlb('src.glb');
const ii = json.images.findIndex(im => im.name === 'roundel_flopped'), vi = json.images[ii].bufferView, v = json.bufferViews[vi];
fs.writeFileSync('flopped.png', bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
execSync('magick flopped.png -flop roundel.png');
const repl = fs.readFileSync('roundel.png');
let blob = Buffer.alloc(0);
json.bufferViews = json.bufferViews.map((bv, i) => { const data = i === vi ? repl : bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  while (blob.length % 4) blob = Buffer.concat([blob, Buffer.alloc(1)]); const out = { ...bv, byteOffset: blob.length, byteLength: data.length }; blob = Buffer.concat([blob, data]); return out; });
json.buffers = [{ byteLength: blob.length }];
json.images[ii].name = 'roundel';
writeGlb('bmw-m5-e60.glb', json, blob);
console.log('image', ii, 'view', vi, v.byteLength, '->', repl.length, 'bytes; glb', fs.statSync('src.glb').size, '->', fs.statSync('bmw-m5-e60.glb').size);
