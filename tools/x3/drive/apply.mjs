// node apply.mjs <drive.html> <swaps.json> <out.html>  - the swaps applied to a copy; each find must occur exactly once
import fs from 'node:fs';
const [src, swapsFile, out] = process.argv.slice(2);
let body = fs.readFileSync(src, 'utf8');
for (const [a, z] of JSON.parse(fs.readFileSync(swapsFile, 'utf8'))) {
  const n = body.split(a).length - 1;
  if (n !== 1) throw new Error(`found ${n} times: ${a.slice(0, 80)}`);
  body = body.replace(a, () => z);
}
fs.writeFileSync(out, body);
console.log(`${out}: ${body.length} chars`);
