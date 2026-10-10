<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->unsignedInteger('position')->default(0)->after('subtitle');
        });

        DB::table('cars')->orderBy('name')->get(['id'])->each(function ($car, $i) {
            DB::table('cars')->where('id', $car->id)->update(['position' => $i]);
        });
    }

    public function down(): void
    {
        Schema::table('cars', function (Blueprint $table) {
            $table->dropColumn('position');
        });
    }
};
