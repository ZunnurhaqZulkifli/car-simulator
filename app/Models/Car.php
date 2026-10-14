<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Car extends Model
{
    // 0-100 % worn/lost per serviceable part, owned by public/js/car-service.js
    public const SERVICE_COLUMNS = [
        'brake_wear_pct', 'oil_wear_pct', 'tyre_wear_pct',
        'coolant_loss_pct', 'oil_level_loss_pct', 'tyre_pressure_loss_pct', 'battery_drain_pct',
    ];

    protected $fillable = [
        'name', 'nickname', 'slug', 'subtitle', 'file_path', 'position',
        'odometer', 'fuel_level', 'engine_wear_pct', 'engine_map', 'engine_mix',
        ...self::SERVICE_COLUMNS,
        'fault_codes', 'layout',
    ];

    protected function casts(): array
    {
        return [
            'engine_mix' => 'array',
            'fault_codes' => 'array',
            'layout' => 'array',
        ];
    }

    // what the owner calls the car: their nickname, else the model
    public function displayName(): string
    {
        return $this->nickname ?: $this->name;
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }
}
