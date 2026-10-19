<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CarNameTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_nickname_replaces_the_model_name_until_cleared(): void
    {
        $car = Car::create(['name' => 'BMW M140i xDrive', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 0]);

        $this->postJson('/car/bmw-140i/name', ['nickname' => 'Zippy'])->assertOk();
        $this->get('/')->assertSee('Zippy')->assertDontSee('BMW M140i xDrive');

        // blank goes back to the model
        $this->postJson('/car/bmw-140i/name', ['nickname' => ''])->assertOk();
        $this->assertSame('BMW M140i xDrive', $car->fresh()->displayName());

        $this->postJson('/car/bmw-140i/name', ['nickname' => str_repeat('x', 61)])->assertUnprocessable();
    }
}
