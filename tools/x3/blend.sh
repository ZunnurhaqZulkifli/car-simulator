#!/bin/bash
# blend.sh <run dir> <photo.png> - for each region in regions.json: the photo crop scaled to the render, a 50/50 blend
# and a side-by-side (photo left, render right)
D=$1; P=$2
node -e "for (const r of JSON.parse(require('fs').readFileSync('$D/regions.json'))) console.log(r.n, r.x, r.y, r.w, r.h, r.W, r.H)" | while read n x y w h W H; do
  magick "$P" -crop ${w}x${h}+${x}+${y} +repage -resize ${W}x${H}! "$D/$n-photo.png"
  magick "$D/$n.png" -crop ${W}x${H}+0+0 +repage "$D/$n-svg.png"
  magick "$D/$n-photo.png" "$D/$n-svg.png" -compose blend -define compose:args=50,50 -composite "$D/$n-blend.png"
  magick "$D/$n-photo.png" "$D/$n-svg.png" +append "$D/$n-pair.png"
done
