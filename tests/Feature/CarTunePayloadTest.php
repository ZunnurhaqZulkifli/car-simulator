<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// car-tune.js's save body against the real saveState rules - one rule over the limit drops every save, silently
class CarTunePayloadTest extends TestCase
{
    use RefreshDatabase;

    private array $state = ['odometer' => 100, 'fuel_level' => 0.5, 'engine_wear_pct' => 2, 'engine_map' => 1];

    private function car(string $slug): Car
    {
        return Car::create(['name' => 'Probe', 'slug' => $slug, 'file_path' => "cars/$slug.html", 'position' => 0]);
    }

    // the most the catalogue saves: the 530e (B48 + eDrive) has 46 parts plus two left over from older catalogues
    // (tyres, suspension); the E60 37 wear rows (27 parts + ten cylinders + blown); every library map carries the parts
    public function test_the_largest_tune_the_catalogue_saves_is_accepted(): void
    {
        $car = $this->car('bmw-530e');
        $ids = ['internals' => 'race', 'turbo' => 'big', 'injection' => 'portmax', 'lpfp' => 'triple', 'radiator' => 'aux', 'trans' => 'pro',
            'hpfp' => 'twin', 'intercooler' => 'pro', 'oilcooler' => 'dual',
            'rings' => 'hd', 'pcv' => 'uprated', 'pulley' => 'light', 'catchcan' => 'dual', 'meth' => 'dual', 'flex' => 'kit', 'wastegate' => 'gate',
            'throttle' => 'ported', 'exhmani' => 'tubular', 'head' => 'big', 'diinj' => 'race', 'plugs' => 'colder2', 'flywheel' => 'light', 'transcooler' => 'dual', 'fuel' => 'e85'];
        $parts = $ids + array_fill_keys(array_map(fn ($n) => "part$n", range(1, 48 - count($ids))), 'stock');
        $slot = ['name' => 'Stage 4 Race', 'boost' => array_fill(0, 13, 2.6), 'timing' => array_fill(0, 13, 4), 'afr' => array_fill(0, 13, 11.7),
            'rev' => 7300, 'shift' => 7000, 'launch' => 4000, 'vmax' => 0, 'tq' => 1000, 'shiftSpeed' => 2, 'burble' => 1, 'knock' => true,
            'dpf' => true, 'protect' => true, 'gears' => [5, 3.2, 2.1, 1.7, 1.3, 1, 0.84, 0.67], 'gearShift' => array_fill(0, 8, 0), 'gearTq' => array_fill(0, 8, 0)];
        $wear = array_fill_keys(array_map(fn ($n) => "w$n", range(1, 26)), 12.5) + array_fill_keys(array_map(fn ($n) => "cyl$n", range(1, 10)), 0) + ['blown' => 0];
        $tune = ['v' => 1, 'slots' => [1 => $slot, 2 => $slot], 'parts' => $parts, 'wear' => $wear,
            'library' => array_fill(0, 20, ['name' => 'Map', 'at' => '2026-11-12T10:00:00.000Z', 'hp' => 731, 'tq' => 1000, 'parts' => $parts, 'cal' => $slot]),
            'stats' => [1 => ['hp' => 731, 'tq' => 1000], 2 => ['hp' => 731, 'tq' => 1000], 'stock' => ['hp' => 184, 'tq' => 290], 'mods' => 45]];

        $this->postJson('/car/bmw-530e/state', $this->state + ['tune' => $tune])->assertOk();

        $this->assertSame('portmax', $car->fresh()->tune['parts']['injection']);
        $this->assertSame('pro', $car->fresh()->tune['parts']['trans']);
        $this->assertCount(48, $car->fresh()->tune['library'][19]['parts']);
    }

    // the real bodies the pages post, captured by tools/tune/probe.mjs (TUNE_PROBE_DIR=<its out dir>)
    public function test_the_pages_own_save_bodies_are_accepted(): void
    {
        $dir = getenv('TUNE_PROBE_DIR');
        $files = $dir ? glob("$dir/*-state.json") : [];
        if (! $files) {
            $this->markTestSkipped('no probe bodies: run tools/tune/probe.mjs and set TUNE_PROBE_DIR');
        }
        foreach ($files as $file) {
            $slug = basename($file, '-state.json');
            $car = $this->car($slug);
            $body = json_decode(file_get_contents($file), true);

            $this->postJson("/car/$slug/state", $body)->assertOk();

            $this->assertSame($body['tune']['parts'] ?? null, $car->fresh()->tune['parts'] ?? null, $slug);
        }
    }

    // the 550d Mk1 and the Iriz were the last pages wired to car-tune.js: their first save after it (the 550d on its old
    // Map 6, the Iriz on Stage 2, neither with a tune yet), captured from the pages, adds `tune` and makes engine_map the slot
    public function test_the_first_tuned_save_of_the_550d_and_iriz_is_accepted(): void
    {
        foreach (['bmw-550d', 'proton-iriz'] as $slug) {
            $car = $this->car($slug);
            $body = json_decode(file_get_contents(__DIR__."/fixtures/tune/$slug-state.json"), true);

            $this->postJson("/car/$slug/state", $body)->assertOk();

            $this->assertSame(2, $car->fresh()->engine_map, $slug);
            $this->assertSame($body['tune']['parts'], $car->fresh()->tune['parts'], $slug);
            $this->assertSame($body['tune']['slots'][2]['name'], $car->fresh()->tune['slots'][2]['name'], $slug);
        }
    }
}
