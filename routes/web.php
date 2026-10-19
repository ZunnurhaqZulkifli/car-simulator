<?php

use App\Http\Controllers\CarSimController;
use Illuminate\Support\Facades\Route;

Route::get('/', [CarSimController::class, 'index'])->name('menu');
Route::get('/upload', [CarSimController::class, 'create'])->name('car.create');
Route::post('/upload', [CarSimController::class, 'store'])->name('car.store');
Route::get('/manage', [CarSimController::class, 'manage'])->name('car.manage');
Route::post('/car/{car:slug}/move-up', [CarSimController::class, 'moveUp'])->name('car.move-up');
Route::post('/car/{car:slug}/move-down', [CarSimController::class, 'moveDown'])->name('car.move-down');
Route::delete('/car/{car:slug}', [CarSimController::class, 'destroy'])->name('car.destroy');
Route::patch('/car/{car:slug}', [CarSimController::class, 'update'])->name('car.update');
Route::post('/car/{car:slug}/photo', [CarSimController::class, 'savePhoto'])->name('car.photo.save');
Route::get('/car/{car:slug}', [CarSimController::class, 'show'])->name('car.show');
Route::get('/car/{car:slug}/raw', [CarSimController::class, 'raw'])->name('car.raw');
Route::post('/car/{car:slug}/state', [CarSimController::class, 'saveState'])->name('car.state.save');
Route::post('/car/{car:slug}/name', [CarSimController::class, 'saveName'])->name('car.name.save');
Route::post('/car/{car:slug}/engine-mix', [CarSimController::class, 'saveEngineMix'])->name('car.enginemix.save');
Route::get('/car/{car:slug}/activities', [CarSimController::class, 'activities'])->name('car.activities');
Route::post('/car/{car:slug}/activities/{activity}/restore', [CarSimController::class, 'restore'])->name('car.activities.restore');
