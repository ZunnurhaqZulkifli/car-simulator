<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
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

    // the car page gets its state inside a <script>: a nickname can't open a comment or a tag in there and break the page
    public function test_a_nickname_cannot_break_out_of_the_car_pages_script(): void
    {
        Storage::fake('public')->put('cars/bmw-140i.html', '<html><head></head><body></body></html>');
        Car::create(['name' => 'BMW M140i xDrive', 'slug' => 'bmw-140i', 'file_path' => 'cars/bmw-140i.html', 'position' => 0, 'nickname' => '<!--<script></script>']);

        $html = $this->get('/car/bmw-140i/raw')->assertOk()->getContent();
        $this->assertStringNotContainsString('<!--<script>', $html);
        $this->assertSame('<!--<script></script>', json_decode(Str::betweenFirst($html, '__CAR_STATE__ = ', ';</script>'), true)['nickname']);
    }
}
