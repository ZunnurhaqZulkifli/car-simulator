<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            // 0-100 %, null = never driven (car starts fresh)
            $table->decimal('brake_wear_pct', 5, 2)->nullable();
            $table->decimal('oil_wear_pct', 5, 2)->nullable();
            $table->decimal('tyre_wear_pct', 5, 2)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->dropColumn(['brake_wear_pct', 'oil_wear_pct', 'tyre_wear_pct']);
        });
    }
};
