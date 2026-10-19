<?php

namespace Tests\Feature;

use App\Models\Car;
use App\Models\CarActivity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class CarTuneHistoryTest extends TestCase
{
    use RefreshDatabase;

    private array $state = ['odometer' => 100, 'fuel_level' => 0.5, 'engine_wear_pct' => 2, 'engine_map' => 1];

    private function car(): Car
    {
        return Car::create(['name' => 'BMW 320D', 'slug' => 'bmw-320d', 'file_path' => 'cars/bmw-320d.html', 'position' => 0]);
    }

    private function tune(): array
    {
        $slot = ['name' => 'Stage 1', 'boost' => [0.2, 1.1, 1.7, 1.7, 1.6], 'iq' => [100, 112, 115, 115, 110],
            'soi' => [0, 1, 1.5, 1.5, 1], 'rail' => [900, 1600, 2000, 2000, 1900], 'rev' => 5400, 'shift' => 5000,
            'launch' => 2500, 'vmax' => 0, 'tq' => 480, 'shiftSpeed' => 1, 'smoke' => 1.18, 'pilot' => true,
            'egr' => false, 'dpf' => true, 'knock' => true, 'protect' => true];

        return ['v' => 1, 'slots' => [1 => $slot, 2 => $slot], 'parts' => ['turbo' => 'hybrid', 'intercooler' => 'stock'],
            'wear' => ['turbo' => 12.5, 'injectors' => 3, 'cyl1' => 0]];
    }

    public function test_the_tune_parts_and_wear_are_saved(): void
    {
        $car = $this->car();

        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $this->tune()])->assertOk();

        $this->assertSame('hybrid', $car->fresh()->tune['parts']['turbo']);
        $this->assertSame(12.5, $car->fresh()->tune['wear']['turbo']);
        $this->assertSame(480, $car->fresh()->tune['slots'][2]['tq']);
    }

    // a car posts ~33 parts and ~32 worn parts (V8: 8 cylinders); one entry over the limit drops every save
    public function test_a_fully_specced_car_still_saves(): void
    {
        $car = $this->car();
        $tune = $this->tune();
        $tune['parts'] = array_fill_keys(array_map(fn ($n) => "part$n", range(1, 40)), 'stock');
        $tune['wear'] = array_fill_keys(array_map(fn ($n) => "wear$n", range(1, 45)), 10);

        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertOk();

        $this->assertCount(40, $car->fresh()->tune['parts']);
    }

    public function test_the_car_page_gets_its_tune_and_the_tuning_scripts(): void
    {
        Storage::fake('public')->put('cars/bmw-320d.html', '<html><head></head><body></body></html>');
        $car = $this->car();
        $car->update(['tune' => $this->tune()]);

        $this->get('/car/bmw-320d/raw')->assertOk()
            ->assertSee('js/car-tune.js', false)
            ->assertSee('js/car-history.js', false)
            ->assertSee('"turbo":"hybrid"', false);
    }

    public function test_an_older_copy_of_the_car_page_cannot_save_over_a_newer_one(): void
    {
        Storage::fake('public')->put('cars/bmw-320d.html', '<html><head></head><body></body></html>');
        $car = $this->car();
        $open = fn () => json_decode(Str::betweenFirst($this->get('/car/bmw-320d/raw')->getContent(), '__CAR_STATE__ = ', ';</script>'), true)['page'];
        [$old, $new] = [$open(), $open()];

        $this->postJson('/car/bmw-320d/state', ['page' => $new, 'odometer' => 500] + $this->state)->assertOk();
        // the tab left open since before: its state and its events go nowhere
        $this->postJson('/car/bmw-320d/state', ['page' => $old, 'events' => [['type' => 'tune', 'summary' => 'Switched to Map 1']]] + $this->state)
            ->assertStatus(409);

        $this->assertEquals(500, $car->fresh()->odometer);
        $this->assertSame(0, $car->activities()->count());
    }

    // drive.html's test drive: saving is held from the start, and the tab already open on the car keeps saving
    public function test_a_test_drive_never_saves_or_takes_over_the_open_page(): void
    {
        Storage::fake('public')->put('cars/bmw-320d.html', '<html><head></head><body></body></html>');
        $car = $this->car();
        $page = fn ($html) => json_decode(Str::betweenFirst($html, '__CAR_STATE__ = ', ';</script>'), true)['page'];
        $tab = $this->get('/car/bmw-320d/raw')->assertDontSee('CarAPI.hold();', false)->getContent();
        $drive = $this->get('/car/bmw-320d/raw?test_drive=1')->assertSee('<script>CarAPI.hold();</script>', false)->getContent();

        $this->postJson('/car/bmw-320d/state', ['page' => $page($tab), 'odometer' => 500] + $this->state)->assertOk();
        $this->postJson('/car/bmw-320d/state', ['page' => $page($drive), 'odometer' => 900] + $this->state)->assertStatus(409);
        $this->assertEquals(500, $car->fresh()->odometer);
    }

    public function test_the_extra_service_parts_and_the_gearbox_are_saved(): void
    {
        $car = $this->car();
        $tune = $this->tune();
        $tune['slots'][1] += ['gears' => [5, 3.2, 2.14, 1.72, 1.31, 1, 0.82, 0.64], 'gearShift' => array_fill(0, 8, 5200), 'gearTq' => [380, 450, 480, 480, 480, 480, 480, 480]];

        $this->postJson('/car/bmw-320d/state', $this->state + ['service_wear' => ['discs' => 12.5, 'fluid' => 40], 'tune' => $tune])->assertOk();

        $this->assertSame(12.5, $car->fresh()->service_wear['discs']);
        $this->assertSame(380, $car->fresh()->tune['slots'][1]['gearTq'][0]);
        $this->assertSame(12.5, $car->fresh()->logActivity('service', 'x')->snapshot['service_wear']['discs']);

        $this->postJson('/car/bmw-320d/state', $this->state + ['service_wear' => ['discs' => 120]])->assertUnprocessable();
        $tune['slots'][1]['gears'][0] = 20;
        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertUnprocessable();
    }

    // the client's own default: blank per-gear shift points and torque limits are sent as 0
    public function test_the_default_gearbox_and_a_saved_custom_map_are_accepted(): void
    {
        $car = $this->car();
        $tune = $this->tune();
        $tune['slots'][1] += ['gears' => [5, 3.2, 2.143, 1.72, 1.314, 1, 0.822, 0.64], 'gearShift' => array_fill(0, 8, 0), 'gearTq' => array_fill(0, 8, 0)];
        $tune['library'] = [['name' => 'Track day', 'at' => '2026-10-15T14:00:00Z', 'hp' => 241, 'tq' => 485,
            'parts' => ['turbo' => 'hybrid', 'radiator' => 'race'], 'cal' => $tune['slots'][1]]];

        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertOk();

        $this->assertSame(0, $car->fresh()->tune['slots'][1]['gearShift'][0]);
        $this->assertSame('Track day', $car->fresh()->tune['library'][0]['name']);
        $this->assertSame('race', $car->fresh()->tune['library'][0]['parts']['radiator']);

        $tune['library'][0]['cal']['gears'][0] = 50;
        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertUnprocessable();
        $tune['library'] = array_fill(0, 21, $tune['library'][0]);
        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertUnprocessable();
    }

    public function test_a_bad_tune_is_rejected(): void
    {
        $this->car();
        $bad = function (callable $edit) {
            $tune = $this->tune();
            $edit($tune);
            $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $tune])->assertUnprocessable();
        };

        $bad(function (&$t) {
            $t['slots'][3] = $t['slots'][1];
        });
        $bad(function (&$t) {
            $t['slots'][1]['nitrous'] = 1;
        });
        $bad(function (&$t) {
            $t['slots'][1]['boost'] = array_fill(0, 20, 1);
        });
        $bad(function (&$t) {
            $t['slots'][1]['rev'] = 50000;
        });
        $bad(function (&$t) {
            $t['wear']['turbo'] = 150;
        });
        $bad(function (&$t) {
            $t['parts']['turbo'] = str_repeat('x', 40);
        });
        $bad(function (&$t) {
            $t['stats'] = [3 => ['hp' => 200, 'tq' => 400]];
        });
        $bad(function (&$t) {
            $t['stats'] = ['1' => ['hp' => 200]]; // no torque
        });
    }

    // car-tune.js's saveData() shape: both maps' peaks, the stock engine's and the upgraded-part count, for the garage
    public function test_the_maps_peak_power_is_saved_for_the_garage(): void
    {
        $car = $this->car();
        $stats = ['1' => ['hp' => 190, 'tq' => 400], '2' => ['hp' => 221, 'tq' => 462], 'stock' => ['hp' => 152, 'tq' => 311], 'mods' => 9];

        $this->postJson('/car/bmw-320d/state', ['engine_map' => 2] + $this->state + ['tune' => $this->tune() + ['stats' => $stats]])->assertOk();

        $this->assertEquals($stats, $car->fresh()->tune['stats']);
        $this->assertSame(221, $car->fresh()->power()['hp']);
        $this->assertSame('Map 2 · Stage 1', $car->fresh()->power()['map']);
    }

    public function test_events_are_logged_with_the_state_they_left(): void
    {
        $car = $this->car();

        $this->postJson('/car/bmw-320d/state', ['fuel_level' => 1] + $this->state + ['events' => [
            ['type' => 'refuel', 'summary' => 'Refuelled +20.0 L (50% → 100%)'],
        ]])->assertOk();

        $activity = $car->activities()->sole();
        $this->assertSame('refuel', $activity->type);
        $this->assertEquals(1, $activity->snapshot['fuel_level']);
        $this->assertEquals(100, $activity->snapshot['odometer']);

        $this->postJson('/car/bmw-320d/state', $this->state + ['events' => [['type' => 'restore', 'summary' => 'x']]])->assertUnprocessable();
        $this->postJson('/car/bmw-320d/state', $this->state + ['events' => [['type' => 'refuel', 'summary' => str_repeat('x', 161)]]])->assertUnprocessable();
    }

    public function test_the_car_can_be_restored_to_any_logged_point(): void
    {
        $car = $this->car();
        $this->postJson('/car/bmw-320d/state', $this->state + ['tune' => $this->tune(), 'events' => [['type' => 'tune', 'summary' => 'Map 1: Stage 1']]]);
        $point = $car->activities()->sole();
        // then it's driven, damaged and detuned
        $this->postJson('/car/bmw-320d/state', ['odometer' => 900, 'fuel_level' => 0.1, 'engine_wear_pct' => 80, 'engine_map' => 2, 'tune' => null]);

        $this->postJson("/car/bmw-320d/activities/{$point->id}/restore")->assertOk();

        $car->refresh();
        $this->assertEquals(100, $car->odometer);
        $this->assertEquals(2, $car->engine_wear_pct);
        $this->assertSame('hybrid', $car->tune['parts']['turbo']);
        $this->assertSame('restore', $car->activities()->latest('id')->first()->type);

        $this->getJson('/car/bmw-320d/activities')->assertOk()
            ->assertJsonPath('0.type', 'restore')
            ->assertJsonPath('1.summary', 'Map 1: Stage 1')
            ->assertJsonPath('1.tune', 'Stage 1');
    }

    public function test_another_cars_activity_cannot_be_restored(): void
    {
        $this->car();
        $other = Car::create(['name' => 'BMW M140i', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 1]);
        $activity = $other->logActivity('refuel', 'Refuelled');

        $this->postJson("/car/bmw-320d/activities/{$activity->id}/restore")->assertNotFound();
    }

    public function test_renames_are_logged(): void
    {
        $car = $this->car();

        $this->postJson('/car/bmw-320d/name', ['nickname' => 'Daily'])->assertOk();

        $this->assertSame('Renamed to "Daily"', $car->activities()->sole()->summary);
    }

    public function test_only_the_newest_activities_are_kept(): void
    {
        $car = $this->car();
        for ($i = 0; $i < CarActivity::KEEP + 3; $i++) {
            $car->logActivity('drive', "Drive $i");
        }

        $this->assertSame(CarActivity::KEEP, $car->activities()->count());
        $this->assertSame('Drive 3', $car->activities()->orderBy('id')->first()->summary);
    }
}
