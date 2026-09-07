<?php

namespace App\Http\Controllers;

use App\Models\Car;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class CarSimController extends Controller
{
    public function index()
    {
        return view('menu', ['cars' => Car::orderBy('name')->get()]);
    }

    public function show(Car $car)
    {
        return view('car-show', ['car' => $car]);
    }

    public function raw(Car $car)
    {
        $html = Storage::disk('public')->get($car->file_path);

        // the car's own HTML is served raw (not a Blade view), so saved state is handed to its
        // JS via a global instead of Blade interpolation
        $state = json_encode([
            'slug' => $car->slug,
            'odometer' => $car->odometer !== null ? (float) $car->odometer : null,
            'fuelLevel' => $car->fuel_level !== null ? (float) $car->fuel_level : null,
            'wearPct' => $car->engine_wear_pct !== null ? (float) $car->engine_wear_pct : null,
            'engineMap' => $car->engine_map,
            'engineMix' => $car->engine_mix,
            'csrfToken' => csrf_token(),
        ]);

        $html = str_replace(
            '</head>',
            "<script>window.__CAR_STATE__ = {$state};</script>\n".
            '<script src="'.asset('js/car-api.js').'"></script>'."\n".
            '<script src="'.asset('js/car-mixer.js').'"></script></head>',
            $html
        );

        return response($html, Response::HTTP_OK, ['Content-Type' => 'text/html']);
    }

    public function saveState(Request $request, Car $car)
    {
        $validated = $request->validate([
            'odometer' => ['required', 'numeric', 'min:0'],
            'fuel_level' => ['required', 'numeric', 'min:0', 'max:1'],
            'engine_wear_pct' => ['required', 'numeric', 'min:0', 'max:100'],
            'engine_map' => ['required', 'integer', 'min:1', 'max:6'],
        ]);

        $car->update($validated);

        return response()->json(['saved' => true]);
    }

    public function saveEngineMix(Request $request, Car $car)
    {
        $validated = $request->validate([
            'engine_mix' => ['required', 'array', 'max:32'],
            'engine_mix.*' => ['numeric', 'min:0', 'max:1'],
        ]);

        $car->update(['engine_mix' => $validated['engine_mix']]);

        return response()->json(['saved' => true]);
    }

    public function create()
    {
        return view('upload');
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'subtitle' => ['nullable', 'string', 'max:255'],
            'file' => ['required', 'file', 'extensions:html,htm', 'max:5120'],
        ]);

        $slug = Str::slug($validated['name']);
        for ($i = 2; Car::where('slug', $slug)->exists(); $i++) {
            $slug = Str::slug($validated['name']).'-'.$i;
        }

        $path = $request->file('file')->storeAs('cars', "{$slug}.html", 'public');

        Car::create([
            'name' => $validated['name'],
            'slug' => $slug,
            'subtitle' => $validated['subtitle'] ?? null,
            'file_path' => $path,
        ]);

        return redirect()->route('menu');
    }
}
