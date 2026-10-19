<?php

namespace Tests\Feature;

use App\Models\Car;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class GarageMenuTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_car_shows_its_photo_once_one_is_dropped_in_else_the_placeholder(): void
    {
        Storage::fake('public');
        Car::create(['name' => 'BMW M3 Competition', 'slug' => 'bmw-m3-touring', 'file_path' => 'cars/bmw-m3-touring.html', 'position' => 0]);

        $this->get('/')->assertOk()->assertSee('car-photos/bmw-m3-touring.jpg')->assertDontSee('<img', false);

        UploadedFile::fake()->image('m3.webp')->storeAs('car-photos', 'bmw-m3-touring.webp', 'public');

        $this->get('/')->assertOk()->assertSee('storage/car-photos/bmw-m3-touring.webp?v=', false);
    }

    public function test_manage_edits_the_name_nickname_and_subtitle_but_keeps_the_slug(): void
    {
        $car = Car::create(['name' => 'BMW 550D', 'slug' => 'bmw-550d', 'file_path' => 'cars/bmw-550d.html', 'position' => 0]);

        $this->patch('/car/bmw-550d', ['name' => 'BMW 550D F10', 'nickname' => 'Big Diesel', 'subtitle' => 'Twin-turbo I6 · 381 hp / 740 Nm'])
            ->assertRedirect('/manage');

        $car->refresh();
        $this->assertSame(['BMW 550D F10', 'Big Diesel', 'Twin-turbo I6 · 381 hp / 740 Nm', 'bmw-550d'], [$car->name, $car->nickname, $car->subtitle, $car->slug]);
        $this->assertSame('Renamed to "Big Diesel" (BMW 550D F10)', $car->activities()->value('summary'));

        // a subtitle edit alone is no rename
        $this->patch('/car/bmw-550d', ['name' => 'BMW 550D F10', 'nickname' => 'Big Diesel', 'subtitle' => '']);
        $this->assertSame(1, $car->activities()->count());
        $this->assertNull($car->fresh()->subtitle);

        $this->patch('/car/bmw-550d', ['name' => '', 'nickname' => str_repeat('x', 61)])->assertSessionHasErrors(['name', 'nickname']);
        $this->assertSame('BMW 550D F10', $car->fresh()->name);
    }

    public function test_the_stats_card_shows_the_live_maps_power_else_the_subtitles_rated_figure(): void
    {
        Car::create(['name' => 'BMW X1 xDrive20d', 'slug' => 'bmw-x1-xdrive20d', 'file_path' => 'cars/bmw-x1-xdrive20d.html', 'position' => 0,
            'engine_map' => 2, 'fault_codes' => [['code' => 'P0299', 'title' => 'Underboost', 'module' => 'ECM', 'status' => 'active', 'at' => 'now']],
            'tune' => ['v' => 1, 'slots' => [1 => ['name' => 'Stock'], 2 => ['name' => 'Stage 3']],
                'stats' => [1 => ['hp' => 152, 'tq' => 311], 2 => ['hp' => 305, 'tq' => 535], 'stock' => ['hp' => 152, 'tq' => 311], 'mods' => 14]]]);
        Car::create(['name' => 'BMW 550D', 'slug' => 'bmw-550d', 'file_path' => 'cars/bmw-550d.html', 'position' => 1, 'subtitle' => 'Twin-turbo I6 · 381 hp / 740 Nm']);
        Car::create(['name' => 'Proton Iriz', 'slug' => 'proton-iriz', 'file_path' => 'cars/proton-iriz.html', 'position' => 2]);

        $this->get('/')->assertOk()
            ->assertSee('data-sum="305 hp · 535 Nm"', false)->assertSee('Map 2 · Stage 3')->assertSee('+153 hp')->assertSee('1 active · 0 stored')
            ->assertSee('data-sum="381 hp · 740 Nm"', false)->assertSee('Rated')
            ->assertSee('data-sum="Stats"', false);
    }

    public function test_start_drives_the_cars_with_a_3d_model_and_tuning_opens_the_gauges(): void
    {
        Car::create(['name' => 'BMW X1 xDrive20d', 'slug' => 'bmw-x1-xdrive20d', 'file_path' => 'cars/bmw-x1-xdrive20d.html', 'position' => 0]);
        Car::create(['name' => 'BMW 550D', 'slug' => 'bmw-550d', 'file_path' => 'cars/bmw-550d.html', 'position' => 1]);

        $this->get('/')->assertOk()
            ->assertSee('data-drive="'.asset('drive.html').'?car=bmw-x1-xdrive20d"', false)
            ->assertDontSee('drive.html?car=bmw-550d', false)
            ->assertSee('data-href="'.route('car.show', 'bmw-550d').'"', false)
            ->assertSee('id="tune-btn"', false);
    }

    public function test_a_photo_uploaded_on_manage_replaces_the_old_one_and_goes_with_the_car(): void
    {
        Storage::fake('public');
        Car::create(['name' => 'BMW M5 E60', 'slug' => 'bmw-m5-e60', 'file_path' => 'cars/bmw-m5-e60.html', 'position' => 0]);

        $this->post('/car/bmw-m5-e60/photo', ['photo' => UploadedFile::fake()->image('a.jpg')])->assertRedirect('/manage');
        Storage::disk('public')->assertExists('car-photos/bmw-m5-e60.jpg');

        // a png replaces the jpg - left behind, the jpg would keep winning in photoUrl()
        $this->post('/car/bmw-m5-e60/photo', ['photo' => UploadedFile::fake()->image('b.png')]);
        Storage::disk('public')->assertMissing('car-photos/bmw-m5-e60.jpg');
        Storage::disk('public')->assertExists('car-photos/bmw-m5-e60.png');

        $this->post('/car/bmw-m5-e60/photo', ['photo' => UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf')])
            ->assertSessionHasErrors('photo');
        Storage::disk('public')->assertExists('car-photos/bmw-m5-e60.png');

        $this->delete('/car/bmw-m5-e60');
        Storage::disk('public')->assertMissing('car-photos/bmw-m5-e60.png');
    }
}
