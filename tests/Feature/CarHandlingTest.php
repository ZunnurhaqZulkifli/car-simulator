<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CarHandlingTest extends TestCase
{
    use RefreshDatabase;

    private array $state = ['odometer' => 100, 'fuel_level' => 0.5, 'engine_wear_pct' => 2, 'engine_map' => 1];

    // what car-handling.js's saveData() posts for its Time attack preset
    private function handling(): array
    {
        return ['handling' => ['v' => 1,
            'parts' => ['tyres' => 'slick', 'suspension' => 'race', 'arb' => 'race', 'alignment' => 'camber', 'aero' => 'gt',
                'diff' => 'lsd', 'brace' => 'cage', 'rack' => 'quick', 'bias' => 'valve'],
            'setup' => ['pF' => 1.8, 'pR' => 1.8, 'camF' => -3.3, 'camR' => -2.6, 'toeF' => -0.06, 'toeR' => 0.24, 'sprF' => 230, 'sprR' => 210,
                'arbF' => 6, 'arbR' => 5, 'bump' => 17, 'reb' => 19, 'rhF' => 55, 'rhR' => 45, 'splitter' => 10, 'wing' => 14, 'bias' => 68,
                'lsdP' => 60, 'lsdC' => 35, 'ratio' => 12]]];
    }

    private function car(): Car
    {
        return Car::create(['name' => 'BMW M5', 'slug' => 'bmw-m5-e60', 'file_path' => 'cars/bmw-m5-e60.html', 'position' => 0]);
    }

    public function test_the_handling_parts_and_setup_are_saved_and_handed_back(): void
    {
        Storage::fake('public')->put('cars/bmw-m5-e60.html', '<html><head></head><body></body></html>');
        $car = $this->car();

        $this->postJson('/car/bmw-m5-e60/state', $this->state + $this->handling())->assertOk();

        $this->assertSame('slick', $car->fresh()->handling['parts']['tyres']);
        $this->assertEquals(-3.3, $car->fresh()->handling['setup']['camF']);
        $this->get('/car/bmw-m5-e60/raw')->assertOk()
            ->assertSee('js/car-handling.js', false)
            ->assertSee('"tyres":"slick"', false);
    }

    public function test_a_restore_puts_the_handling_back(): void
    {
        $car = $this->car();
        $this->postJson('/car/bmw-m5-e60/state', $this->state + $this->handling() + ['events' => [['type' => 'tune', 'summary' => 'Handling: Time attack setup']]])->assertOk();
        $activity = $car->activities()->latest('id')->first();
        $car->update(['handling' => null]);

        $car->restoreTo($activity);

        $this->assertSame('race', $car->fresh()->handling['parts']['suspension']);
    }
}
