<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Car extends Model
{
    protected $fillable = [
        'name', 'slug', 'subtitle', 'file_path',
        'odometer', 'fuel_level', 'engine_wear_pct', 'engine_map', 'engine_mix',
    ];

    protected function casts(): array
    {
        return [
            'engine_mix' => 'array',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }
}
