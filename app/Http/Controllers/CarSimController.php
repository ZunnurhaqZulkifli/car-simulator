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

        // mtime query busts the browser cache whenever a shared script changes
        $js = fn ($f) => '<script src="'.asset("js/$f").'?v='.filemtime(public_path("js/$f")).'"></script>';

        $html = str_replace(
            '</head>',
            "<script>window.__CAR_STATE__ = {$state};</script>\n".
            $js('car-api.js')."\n".
            $js('car-service.js')."\n".
            $js('car-diagnostics.js')."\n".
            $js('car-dyno.js')."\n".
            $js('car-mixer.js')."\n".
            $js('car-layout.js').'</head>',
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
            // resizable areas: { dyno|tuning|cluster|controls: { w, h } } in px, null = default size;
            // tuning.hidden = the tuning panel lives in the dyno panel's Tuning tab;
            // telemetry: { off: [card ids switched off], hidden: every telemetry card switched off };
            // arrange: { preset: pitwall|free (null = the car's own), cluster|controls|tuning|dyno: { x, y, w, h } } -
            // the free layout's rects in px, h null for the cluster (its height follows its width)
            'layout' => ['sometimes', 'array:dyno,tuning,cluster,controls,telemetry,arrange'],
            ...array_fill_keys(['layout.dyno', 'layout.tuning', 'layout.cluster', 'layout.controls'], ['array:w,h,hidden']),
            'layout.telemetry' => ['array:off,hidden'],
            'layout.telemetry.off' => ['nullable', 'array', 'max:40'],
            'layout.telemetry.off.*' => ['string', 'max:20'],
            'layout.arrange' => ['array:preset,cluster,controls,tuning,dyno'],
            'layout.arrange.preset' => ['nullable', 'in:pitwall,free'],
            ...collect(['cluster', 'controls', 'tuning', 'dyno'])->flatMap(fn ($area) => [
                "layout.arrange.$area" => ['nullable', 'array:x,y,w,h'],
                "layout.arrange.$area.x" => ["required_with:layout.arrange.$area", 'numeric', 'min:0', 'max:20000'],
                "layout.arrange.$area.y" => ["required_with:layout.arrange.$area", 'numeric', 'min:0', 'max:20000'],
                "layout.arrange.$area.w" => ["required_with:layout.arrange.$area", 'numeric', 'min:1', 'max:20000'],
                "layout.arrange.$area.h" => ['nullable', 'numeric', 'min:1', 'max:20000'],
            ])->all(),
            'layout.*.w' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'layout.*.h' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'layout.*.hidden' => ['sometimes', 'boolean'],
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
