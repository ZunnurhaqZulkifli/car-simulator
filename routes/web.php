<?php

use App\Http\Controllers\CarSimController;
use Illuminate\Support\Facades\Route;

Route::get('/', [CarSimController::class, 'index'])->name('menu');
Route::get('/upload', [CarSimController::class, 'create'])->name('car.create');
Route::post('/upload', [CarSimController::class, 'store'])->name('car.store');
Route::get('/car/{car:slug}', [CarSimController::class, 'show'])->name('car.show');
Route::get('/car/{car:slug}/raw', [CarSimController::class, 'raw'])->name('car.raw');
Route::post('/car/{car:slug}/state', [CarSimController::class, 'saveState'])->name('car.state.save');
Route::post('/car/{car:slug}/engine-mix', [CarSimController::class, 'saveEngineMix'])->name('car.enginemix.save');
