#!/bin/bash
# crop.sh <run dir> <name>: the SVG's rect out of a shot, resampled to the design viewBox's 1500x620
D=$(cd "$1" && pwd); N=$2
read X Y W H < <(node -e "const r=JSON.parse(require('fs').readFileSync('$D/rect.json','utf8'));console.log(r.x,r.y,r.width,r.height)")
magick "$D/$N.png" -crop "${W}x${H}+${X}+${Y}" +repage -resize 1500x620! "$D/$N-1500.png"
