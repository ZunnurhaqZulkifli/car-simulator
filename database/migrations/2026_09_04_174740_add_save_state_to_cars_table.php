<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            // null = car's own hardcoded default in its JS, until first save
            $table->decimal('odometer', 10, 1)->nullable();
            $table->decimal('fuel_level', 4, 3)->nullable(); // 0-1 fraction
            $table->decimal('engine_wear_pct', 5, 2)->nullable();
            $table->unsignedTinyInteger('engine_map')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->dropColumn(['odometer', 'fuel_level', 'engine_wear_pct', 'engine_map']);
        });
    }
};
