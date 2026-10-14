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
        return view('menu', ['cars' => Car::orderBy('position')->get()]);
    }

    public function manage()
    {
        return view('manage', ['cars' => Car::orderBy('position')->get()]);
    }

    public function moveUp(Car $car)
    {
        $prev = Car::where('position', '<', $car->position)->orderByDesc('position')->first();

        if ($prev) {
            [$car->position, $prev->position] = [$prev->position, $car->position];
            $car->save();
            $prev->save();
        }

        return redirect()->route('car.manage');
    }

    public function moveDown(Car $car)
    {
        $next = Car::where('position', '>', $car->position)->orderBy('position')->first();

        if ($next) {
            [$car->position, $next->position] = [$next->position, $car->position];
            $car->save();
            $next->save();
        }

        return redirect()->route('car.manage');
    }

    public function destroy(Car $car)
    {
        Storage::disk('public')->delete($car->file_path);
        $car->delete();

        return redirect()->route('car.manage');
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
            'name' => $car->name,
            'nickname' => $car->nickname,
            'odometer' => $car->odometer !== null ? (float) $car->odometer : null,
            'fuelLevel' => $car->fuel_level !== null ? (float) $car->fuel_level : null,
            'wearPct' => $car->engine_wear_pct !== null ? (float) $car->engine_wear_pct : null,
            'engineMap' => $car->engine_map,
            'engineMix' => $car->engine_mix,
            'service' => collect(Car::SERVICE_COLUMNS)
                ->mapWithKeys(fn ($col) => [$col => $car->$col !== null ? (float) $car->$col : null]),
            'faultCodes' => $car->fault_codes ?? [],
            'layout' => (object) ($car->layout ?? []),
            'csrfToken' => csrf_token(),
        ]);

        $html = str_replace(
            '</head>',
            "<script>window.__CAR_STATE__ = {$state};</script>\n".
            '<script src="'.asset('js/car-api.js').'"></script>'."\n".
            '<script src="'.asset('js/car-service.js').'"></script>'."\n".
            '<script src="'.asset('js/car-diagnostics.js').'"></script>'."\n".
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
            ...array_fill_keys(Car::SERVICE_COLUMNS, ['sometimes', 'numeric', 'min:0', 'max:100']),
            'fault_codes' => ['sometimes', 'array', 'max:50'],
            'fault_codes.*.code' => ['required', 'string', 'max:8'],
            'fault_codes.*.title' => ['required', 'string', 'max:80'],
            'fault_codes.*.module' => ['required', 'string', 'max:8'],
            'fault_codes.*.status' => ['required', 'in:active,stored'],
            'fault_codes.*.at' => ['required', 'string', 'max:40'],
            // resizable areas: { dyno|tuning|cluster: { w, h } } in px, null = default size
            'layout' => ['sometimes', 'array:dyno,tuning,cluster'],
            'layout.*' => ['array:w,h'],
            'layout.*.w' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'layout.*.h' => ['nullable', 'numeric', 'min:0', 'max:10000'],
        ]);

        $car->update($validated);

        return response()->json(['saved' => true]);
    }

    public function saveName(Request $request, Car $car)
    {
        $validated = $request->validate([
            'nickname' => ['nullable', 'string', 'max:60'],
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
            'position' => (Car::max('position') ?? -1) + 1,
        ]);

        return redirect()->route('menu');
    }
}
