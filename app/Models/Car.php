<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class Car extends Model
{
    // 0-100 % worn/lost per serviceable part, owned by public/js/car-service.js
    public const SERVICE_COLUMNS = [
        'brake_wear_pct', 'oil_wear_pct', 'tyre_wear_pct',
        'coolant_loss_pct', 'oil_level_loss_pct', 'tyre_pressure_loss_pct', 'battery_drain_pct',
    ];

    // everything the sim saves about the car - what an activity snapshot holds and a restore puts back
    public const STATE_COLUMNS = [
        'nickname', 'odometer', 'fuel_level', 'engine_wear_pct', 'engine_map', 'engine_mix',
        ...self::SERVICE_COLUMNS,
        'service_wear', 'fault_codes', 'layout', 'tune',
    ];

    // garage photo file types, car-photos/{slug}.{ext} on the public disk
    public const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

    protected $fillable = [
        'name', 'nickname', 'slug', 'subtitle', 'file_path', 'position',
        'odometer', 'fuel_level', 'engine_wear_pct', 'engine_map', 'engine_mix',
        ...self::SERVICE_COLUMNS,
        'service_wear', 'fault_codes', 'layout', 'tune',
    ];

    protected function casts(): array
    {
        return [
            'engine_mix' => 'array',
            'fault_codes' => 'array',
            'layout' => 'array',
            'tune' => 'array',
            'service_wear' => 'array',
        ];
    }

    public function activities(): HasMany
    {
        return $this->hasMany(CarActivity::class);
    }

    // what the owner calls the car: their nickname, else the model
    public function displayName(): string
    {
        return $this->nickname ?: $this->name;
    }

    public function snapshot(): array
    {
        return collect(self::STATE_COLUMNS)->mapWithKeys(fn ($col) => [$col => $this->$col])->all();
    }

    public function logActivity(string $type, string $summary): CarActivity
    {
        $activity = $this->activities()->create(['type' => $type, 'summary' => $summary, 'snapshot' => $this->snapshot()]);

        $cutoff = $this->activities()->orderByDesc('id')->skip(CarActivity::KEEP)->value('id');
        if ($cutoff) {
            $this->activities()->where('id', '<=', $cutoff)->delete();
        }

        return $activity;
    }

    // puts the car back exactly as it was right after that activity, and logs the restore itself
    public function restoreTo(CarActivity $activity): CarActivity
    {
        $this->update(collect($activity->snapshot)->only(self::STATE_COLUMNS)->all());

        return $this->logActivity('restore', 'Restored to "'.Str::limit($activity->summary, 100).'" ('.$activity->created_at->format('j M Y H:i').')');
    }

    // the garage stats card's power: the live map's predicted peak (car-tune.js saves it), else the subtitle's "335 hp / 500 Nm"
    public function power(): ?array
    {
        $map = $this->engine_map ?: 1;
        if ($peak = data_get($this->tune, "stats.$map")) {
            return [...$peak, 'map' => "Map $map · ".data_get($this->tune, "slots.$map.name", 'Stock'), 'stock' => data_get($this->tune, 'stats.stock')];
        }
        if (preg_match('/([\d,.]+)\s*hp\s*\/\s*([\d,.]+)\s*Nm/i', (string) $this->subtitle, $m)) {
            return ['hp' => (float) str_replace(',', '', $m[1]), 'tq' => (float) str_replace(',', '', $m[2]), 'map' => 'Rated', 'stock' => null];
        }

        return null;
    }

    // garage card photo: uploaded on the manage page, or dropped in as storage/app/public/car-photos/{slug}.jpg (or png/webp)
    public function photoUrl(): ?string
    {
        $disk = Storage::disk('public');
        foreach (self::PHOTO_EXTENSIONS as $ext) {
            if ($disk->exists($path = "car-photos/{$this->slug}.$ext")) {
                // mtime query so a swapped photo isn't served stale from the browser cache
                return asset("storage/$path").'?v='.$disk->lastModified($path);
            }
        }

        return null;
    }

    public function deletePhoto(): void
    {
        Storage::disk('public')->delete(array_map(fn ($ext) => "car-photos/{$this->slug}.$ext", self::PHOTO_EXTENSIONS));
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }
}
