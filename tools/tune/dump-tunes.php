<?php

// Read-only: every car's saved tune as JSON on stdout, for tools/tune/check.mjs and probe.mjs. A SELECT only - the cars
// table is the owner's real progress, so nothing here ever writes to it.
//   php artisan tinker --execute="require 'tools/tune/dump-tunes.php';" > /tmp/tunes.json

echo json_encode(DB::table('cars')->orderBy('position')->get(['slug', 'engine_map', 'tune'])
    ->map(fn ($r) => ['slug' => $r->slug, 'engine_map' => $r->engine_map, 'tune' => json_decode($r->tune ?? 'null', true)])->values());
