<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // the car's history: one row per thing that happened to it, with the whole car state right after it,
        // so any row can put the car back exactly as it was
        Schema::create('car_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('car_id')->constrained()->cascadeOnDelete();
            $table->string('type', 16);
            $table->string('summary', 160);
            $table->json('snapshot');
            $table->timestamp('created_at')->useCurrent();
            $table->index(['car_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('car_activities');
    }
};
