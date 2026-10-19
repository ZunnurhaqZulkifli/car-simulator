<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CarActivity extends Model
{
    public const TYPES = [
        'drive', 'refuel', 'repair', 'service', 'tune', 'parts', 'fault', 'clear',
        'damage', 'regen', 'dyno', 'perf', 'rename', 'restore',
    ];

    // newest rows kept per car - each carries a full snapshot, so the log can't grow forever
    public const KEEP = 1000;

    public const UPDATED_AT = null;

    protected $fillable = ['type', 'summary', 'snapshot'];

    protected function casts(): array
    {
        return ['snapshot' => 'array'];
    }

    public function car(): BelongsTo
    {
        return $this->belongsTo(Car::class);
    }
}
