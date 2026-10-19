<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            // { discs|fluid|dampers|bearings|alignment|belt: 0-100 % worn } - car-service.js's parts without a column of their own
            $table->json('service_wear')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->dropColumn('service_wear');
        });
    }
};
