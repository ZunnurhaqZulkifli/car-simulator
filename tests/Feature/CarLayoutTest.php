<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CarLayoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_layout_keeps_the_control_deck_size_and_a_hidden_tuning_panel(): void
    {
        $car = Car::create(['name' => 'BMW M140i xDrive', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 0]);
        $state = ['odometer' => 10, 'fuel_level' => 0.5, 'engine_wear_pct' => 0, 'engine_map' => 1];
        $layout = ['controls' => ['w' => 640, 'h' => 120], 'tuning' => ['w' => null, 'h' => null, 'hidden' => true]];

        $this->postJson('/car/bmw-140i/state', $state + ['layout' => $layout])->assertOk();
        $this->assertSame($layout, $car->fresh()->layout);

        $this->postJson('/car/bmw-140i/state', $state + ['layout' => ['tuning' => ['hidden' => 'yes']]])->assertUnprocessable();
        $this->postJson('/car/bmw-140i/state', $state + ['layout' => ['deck' => ['w' => 600]]])->assertUnprocessable();
    }

    public function test_layout_keeps_the_dyno_telemetry_switches(): void
    {
        $car = Car::create(['name' => 'BMW M140i xDrive', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 0]);
        $state = ['odometer' => 10, 'fuel_level' => 0.5, 'engine_wear_pct' => 0, 'engine_map' => 1];
        $layout = ['telemetry' => ['off' => ['tele-egr', 'ch-ambient'], 'hidden' => false]];

        $this->postJson('/car/bmw-140i/state', $state + ['layout' => $layout])->assertOk();
        $this->assertSame($layout, $car->fresh()->layout);

        $this->postJson('/car/bmw-140i/state', $state + ['layout' => ['telemetry' => ['w' => 600]]])->assertUnprocessable();
        $this->postJson('/car/bmw-140i/state', $state + ['layout' => ['dyno' => ['off' => ['tele-egr']]]])->assertUnprocessable();
    }

    public function test_layout_keeps_the_arranged_preset_and_free_rects(): void
    {
        $car = Car::create(['name' => 'BMW M140i xDrive', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 0]);
        $state = ['odometer' => 10, 'fuel_level' => 0.5, 'engine_wear_pct' => 0, 'engine_map' => 1];
        $layout = ['arrange' => [
            'preset' => 'free',
            'cluster' => ['x' => 16, 'y' => 16, 'w' => 900, 'h' => null],
            'controls' => null,
            'tuning' => ['x' => 932, 'y' => 16, 'w' => 260, 'h' => 600],
            'dyno' => ['x' => 16, 'y' => 520, 'w' => 900, 'h' => 480],
        ]];

        $this->postJson('/car/bmw-140i/state', $state + ['layout' => $layout])->assertOk();
        $this->assertSame($layout, $car->fresh()->layout);

        $bad = fn ($arrange) => $this->postJson('/car/bmw-140i/state', $state + ['layout' => ['arrange' => $arrange]])->assertUnprocessable();
        $bad(['preset' => 'grid']);
        $bad(['cluster' => ['x' => 16, 'y' => 16]]); // no width
        $bad(['dyno' => ['x' => -5, 'y' => 0, 'w' => 400, 'h' => 300]]);
        $bad(['deck' => ['x' => 0, 'y' => 0, 'w' => 400, 'h' => 80]]);
    }

    public function test_layout_keeps_the_driving_preset_and_the_saved_slots(): void
    {
        $car = Car::create(['name' => 'BMW X1 xDrive20d', 'slug' => 'bmw-x1-xdrive20d', 'file_path' => 'cars/bmw-x1-xdrive20d.html', 'position' => 0]);
        $state = ['odometer' => 10, 'fuel_level' => 0.5, 'engine_wear_pct' => 0, 'engine_map' => 1];
        // what car-layout.js sends: Driving now, a Driving slot and a Free one dragged out of Driving (panels still off)
        $drive = ['preset' => 'drive', 'cluster' => null, 'controls' => null, 'tuning' => null, 'dyno' => null, 'hide' => null];
        $free = ['preset' => 'free', 'cluster' => ['x' => 16, 'y' => 16, 'w' => 1200, 'h' => null],
            'controls' => ['x' => 16, 'y' => 580, 'w' => 1200, 'h' => 88], 'tuning' => null, 'dyno' => null, 'hide' => ['tuning', 'dyno']];
        $layout = ['slots' => ['1' => $drive, '3' => $free], 'arrange' => $drive];

        $this->postJson('/car/bmw-x1-xdrive20d/state', $state + ['layout' => $layout])->assertOk();
        $this->assertEquals($layout, $car->fresh()->layout);

        $bad = fn ($layout) => $this->postJson('/car/bmw-x1-xdrive20d/state', $state + ['layout' => $layout])->assertUnprocessable();
        $bad(['slots' => ['4' => $drive]]); // three slots
        $bad(['slots' => ['1' => ['preset' => 'race']]]);
        $bad(['slots' => ['2' => ['hide' => ['speedo']]]]);
        $bad(['slots' => ['2' => ['cluster' => ['x' => 16, 'y' => 16]]]]); // no width
        $bad(['arrange' => ['hide' => ['gauges']]]);
    }
}
