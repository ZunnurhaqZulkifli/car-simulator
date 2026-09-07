<?php

namespace Database\Seeders;

use App\Models\Car;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;

class CarSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $cars = [
            [
                'name' => 'BMW 550D',
                'slug' => 'bmw-550d',
                'subtitle' => 'Diesel Instrument Cluster · Twin-turbo I6',
                'source' => 'bmw-550d.html',
            ],
            [
                'name' => 'Proton Iriz',
                'slug' => 'proton-iriz',
                'subtitle' => 'Instrument Cluster · Hatchback',
                'source' => 'proton-iriz.html',
            ],
            [
                'name' => 'BMW 320D',
                'slug' => 'bmw-320d',
                'subtitle' => 'Diesel Instrument Cluster · Single-Turbo I4',
                'source' => 'bmw-320d.html',
            ],
        ];

        foreach ($cars as $car) {
            $path = "cars/{$car['slug']}.html";

            Storage::disk('public')->put(
                $path,
                File::get(resource_path("cars/{$car['source']}"))
            );

            Car::updateOrCreate(
                ['slug' => $car['slug']],
                ['name' => $car['name'], 'subtitle' => $car['subtitle'], 'file_path' => $path]
            );
        }
    }
}
