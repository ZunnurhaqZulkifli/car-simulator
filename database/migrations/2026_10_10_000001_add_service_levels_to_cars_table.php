<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            // 0-100 % lost/drained (0 = full/new), null = never driven
            $table->decimal('coolant_loss_pct', 5, 2)->nullable();
            $table->decimal('oil_level_loss_pct', 5, 2)->nullable();
            $table->decimal('tyre_pressure_loss_pct', 5, 2)->nullable();
            $table->decimal('battery_drain_pct', 5, 2)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->dropColumn(['coolant_loss_pct', 'oil_level_loss_pct', 'tyre_pressure_loss_pct', 'battery_drain_pct']);
        });
    }
};
