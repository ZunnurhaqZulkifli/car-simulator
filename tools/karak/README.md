# The Genting Highlands and Kuantan run

`public/js/karak.js` and `public/js/karak-terrain.bin` (the roads and the land drive.html draws past the city's ring
road) are made here, from OpenStreetMap ((c) OpenStreetMap contributors, ODbL) and the AWS terrain tiles (SRTM via
Mapzen). They're committed, so none of this is needed to drive; it's how to rebuild them. Needs Node, `curl` and
ImageMagick (`magick`).

1. `node fetch.mjs` - the Overpass answers and three.js into `.cache/` (ignored by git). The public server is often
   busy: it backs off and retries. `--fresh` fetches again.
2. `node gen.mjs` - the roads (each a centre line, [x, y, z] every ~10 m), their junctions, bridges, the tunnel, the
   places (toll plazas, rest areas, fuel, workshops, the safe house, the sights) and the resort's buildings into `karak.js`; the land, carved
   round the roads, into `karak-terrain.bin`. Elevation tiles are fetched into `.cache/tiles` as it needs them. It
   prints each road's length, height range and steepest grade, and warns when a junction height or a bridge's
   clearance is missed. `OVERLAPS=1` lists roads (or a road's own hairpins) running closer than their edges allow;
   `OUT=<dir>` writes both files there instead, to try a change before it goes live. Where a road runs onto another's
   asphalt (a slip's taper, a roundabout's leg) its heights are pinned to the other's, and the land is lowered wherever a
   triangle drive.html draws would rise over any asphalt. A place with a site off to one side (`SITES`: fuel and
   workshop aprons, the safe house's drive, the sights' car parks; out to `sites` in karak.js) has its road level along
   it and level land over the site; two such places too close on a steep road can't both be level (the profile prints
   no warning: check.mjs's sites list shows it).
3. Bump `?v=` on both files in drive.html's imports (`karak.js?v=` and `karak-terrain.bin?v=`): Herd sends no
   Cache-Control, so browsers keep the old ones otherwise.
4. `node drive-patch.mjs <drive.html> <out.html>` - the drive.html side as anchored replacements (`drive-world.js`,
   `drive-chunks.js`, `drive-town.js` and `drive-resort.js` are the blocks it inserts). Already applied; kept as the
   record of what changed, and to re-apply onto a fresh copy. `sights-patch.mjs` the same way, after it: the workshops
   on the way up and at the top, Chin Swee's temple, the lookout and the Awana SkyWay (`SIGHTS`, `SKYWAY`).
5. `node probe.mjs <drive.html | live> <out dir> [places]` - headless Chrome on the page: each teleport place on the
   run (or `SPOTS=<json>` of [name, spot expression]), on the road or not, uncapped fps, draws and triangles, a chase and
   an in-car shot; console errors and failed asserts as they come. `EVAL=<js>` runs in the page first, `DRIVE=<s>`
   drives each place, `PERFSPLIT=1` times the run's tiles' parts, `OVERVIEW=1` shoots the overview map and teleports.
   `VIEWS=<json>` of [name, x, z, span m, pitch, yaw] shoots still views from above; `DATA=<dir>` serves `karak.js` and
   `karak-terrain.bin` from gen.mjs's `OUT` instead of the live ones.
6. `node check.mjs` (or `DIR=<OUT dir>`) - the roads against the land as drive.html draws them: land rising over any
   asphalt (the tunnel's own stretch aside), roads sharing asphalt at heights 0.05-4 m apart, and the sites whose road
   isn't level across their mouth or with land over them. All three lists should be empty.

How it's placed: Gombak's toll plaza at world (0, 5500), real east -x and north +z, y the elevation less 60 m. The
KL-Karak and the Genting Highlands road are at real size; the LPT is shrunk to 0.3 about the end of the KL-Karak (its
heights and land too, so its grades stay real). The land is a 20 m grid in 960 m tiles within 1.55 km of a road, each
point (height + 100) * 5 << 2 | flag (1 under a road, 2 over the tunnel, 3 the old hills' land), gzipped.
