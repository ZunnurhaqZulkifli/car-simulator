<?php

namespace App\Http\Controllers;

use App\Models\Car;
use App\Models\CarActivity;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class CarSimController extends Controller
{
    public function index()
    {
        return view('menu', ['cars' => Car::orderBy('position')
            ->withMax(['activities as last_drive' => fn ($q) => $q->where('type', 'drive')], 'created_at')->get()]);
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
        $car->deletePhoto();
        $car->delete();

        return redirect()->route('car.manage');
    }

    // the manage page's settings: the model name, the owner's nickname and the garage card's subtitle (the slug stays,
    // so the car's URL, page file and photo don't move)
    public function update(Request $request, Car $car)
    {
        $car->update($request->validate([
            'name' => ['required', 'string', 'max:255'],
            'nickname' => ['nullable', 'string', 'max:60'],
            'subtitle' => ['nullable', 'string', 'max:255'],
        ]));
        if ($car->wasChanged(['name', 'nickname'])) {
            $car->logActivity('rename', 'Renamed to "'.$car->displayName().'"'.($car->nickname ? ' ('.$car->name.')' : ''));
        }

        return redirect()->route('car.manage')->with('saved', $car->slug);
    }

    public function savePhoto(Request $request, Car $car)
    {
        $photo = $request->validate(['photo' => ['required', 'mimes:'.implode(',', Car::PHOTO_EXTENSIONS), 'max:20480']])['photo'];

        // a new photo can have a different extension - clear the old one or photoUrl() keeps finding it
        $car->deletePhoto();
        $photo->storeAs('car-photos', "{$car->slug}.{$photo->extension()}", 'public');

        return redirect()->route('car.manage');
    }

    public function show(Car $car)
    {
        return view('car-show', ['car' => $car]);
    }

    public function raw(Request $request, Car $car)
    {
        $html = Storage::disk('public')->get($car->file_path);

        // each load becomes the car's one live page - an older copy (a second tab, a back-button restore) holds
        // state that's out of date and saveState() turns it away instead of letting it save over newer progress.
        // A test drive (public/drive.html) never saves, so it leaves whichever page is live alone
        $testDrive = $request->boolean('test_drive');
        $page = Str::random(20);
        if (! $testDrive) {
            Cache::forever("car-page:{$car->id}", $page);
        }

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
            'serviceWear' => (object) ($car->service_wear ?? []),
            'faultCodes' => $car->fault_codes ?? [],
            'layout' => (object) ($car->layout ?? []),
            'tune' => $car->tune,
            'csrfToken' => csrf_token(),
            'page' => $page,
        ]);

        // mtime query busts the browser cache whenever a shared script changes
        $js = fn ($f) => '<script src="'.asset("js/$f").'?v='.filemtime(public_path("js/$f")).'"></script>';

        $html = str_replace(
            '</head>',
            "<script>window.__CAR_STATE__ = {$state};</script>\n".
            $js('car-api.js')."\n".
            ($testDrive ? "<script>CarAPI.hold();</script>\n" : '').
            $js('car-service.js')."\n".
            $js('car-diagnostics.js')."\n".
            $js('car-dyno.js')."\n".
            $js('car-perf.js')."\n".
            $js('car-tune.js')."\n".
            $js('car-history.js')."\n".
            $js('car-mixer.js')."\n".
            $js('car-layout.js').'</head>',
            $html
        );

        return response($html, Response::HTTP_OK, ['Content-Type' => 'text/html']);
    }

    public function saveState(Request $request, Car $car)
    {
        $live = Cache::get("car-page:{$car->id}");
        if ($live && $request->input('page') !== $live) {
            return response()->json(['stale' => true], Response::HTTP_CONFLICT);
        }

        $validated = $request->validate([
            'odometer' => ['required', 'numeric', 'min:0'],
            'fuel_level' => ['required', 'numeric', 'min:0', 'max:1'],
            'engine_wear_pct' => ['required', 'numeric', 'min:0', 'max:100'],
            'engine_map' => ['required', 'integer', 'min:1', 'max:9'],
            ...array_fill_keys(Car::SERVICE_COLUMNS, ['sometimes', 'numeric', 'min:0', 'max:100']),
            'service_wear' => ['sometimes', 'array', 'max:30'],
            'service_wear.*' => ['numeric', 'min:0', 'max:100'],
            'fault_codes' => ['sometimes', 'array', 'max:100'],
            'fault_codes.*.code' => ['required', 'string', 'max:8'],
            'fault_codes.*.title' => ['required', 'string', 'max:80'],
            'fault_codes.*.module' => ['required', 'string', 'max:8'],
            'fault_codes.*.status' => ['required', 'in:active,stored'],
            'fault_codes.*.at' => ['required', 'string', 'max:40'],
            // resizable areas: { dyno|tuning|cluster|controls: { w, h } } in px, null = default size;
            // tuning.hidden = the tuning panel lives in the dyno panel's Tuning tab;
            // telemetry: { off: [card ids switched off], hidden: every telemetry card switched off };
            // arrange: { preset: pitwall|free|drive (null = the car's own), cluster|controls|tuning|dyno: { x, y, w, h },
            // hide: [areas the free layout leaves off] } - the free layout's rects in px, h null for the cluster (its
            // height follows its width); slots: { 1|2|3: an arrange the owner saved to load back }
            'layout' => ['sometimes', 'array:dyno,tuning,cluster,controls,telemetry,arrange,slots'],
            ...array_fill_keys(['layout.dyno', 'layout.tuning', 'layout.cluster', 'layout.controls'], ['array:w,h,hidden']),
            'layout.telemetry' => ['array:off,hidden'],
            'layout.telemetry.off' => ['nullable', 'array', 'max:40'],
            'layout.telemetry.off.*' => ['string', 'max:20'],
            ...self::arrangeRules('layout.arrange'),
            'layout.slots' => ['array:1,2,3'],
            ...self::arrangeRules('layout.slots.*'),
            'layout.*.w' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'layout.*.h' => ['nullable', 'numeric', 'min:0', 'max:10000'],
            'layout.*.hidden' => ['sometimes', 'boolean'],
            ...self::tuneRules(),
            // what happened since the last save (refuel, service, tune change...): logged with the state it left
            'events' => ['sometimes', 'array', 'max:30'],
            'events.*.type' => ['required', Rule::in(array_diff(CarActivity::TYPES, ['restore', 'rename']))],
            'events.*.summary' => ['required', 'string', 'max:160'],
        ]);

        $car->update(Arr::except($validated, 'events'));
        foreach ($validated['events'] ?? [] as $event) {
            $car->logActivity($event['type'], $event['summary']);
        }

        return response()->json(['saved' => true]);
    }

    // car-tune.js: two calibration slots (the car's Map 1 / Map 2), the fitted parts and their wear, and the owner's
    // saved maps - each a whole setup (parts + calibration) to load back
    private static function tuneRules(): array
    {
        return [
            'tune' => ['sometimes', 'nullable', 'array:v,slots,parts,wear,library,stats'],
            'tune.v' => ['integer'],
            'tune.slots' => ['array:1,2'],
            ...self::calibrationRules('tune.slots.*'),
            ...self::partsRules('tune.parts'),
            'tune.wear' => ['array', 'max:80'],
            'tune.wear.*' => ['numeric', 'min:0', 'max:100'],
            'tune.library' => ['array', 'max:20'],
            'tune.library.*' => ['array:name,at,hp,tq,parts,cal'],
            'tune.library.*.name' => ['required', 'string', 'max:40'],
            'tune.library.*.at' => ['string', 'max:40'],
            'tune.library.*.hp' => ['numeric', 'between:0,5000'],
            'tune.library.*.tq' => ['numeric', 'between:0,10000'],
            ...self::partsRules('tune.library.*.parts'),
            ...self::calibrationRules('tune.library.*.cal'),
            // what the garage shows: each map's predicted peak, the stock engine's, how many parts are upgraded
            'tune.stats' => ['array:1,2,stock,mods'],
            ...collect(['1', '2', 'stock'])->flatMap(fn ($k) => [
                "tune.stats.$k" => ['array:hp,tq'],
                "tune.stats.$k.hp" => ['required_with:tune.stats.'.$k, 'numeric', 'between:0,5000'],
                "tune.stats.$k.tq" => ['required_with:tune.stats.'.$k, 'numeric', 'between:0,10000'],
            ])->all(),
            'tune.stats.mods' => ['integer', 'between:0,80'],
        ];
    }

    private static function arrangeRules(string $at): array
    {
        return [
            $at => ['array:preset,cluster,controls,tuning,dyno,hide'],
            "$at.preset" => ['nullable', 'in:pitwall,free,drive'],
            "$at.hide" => ['nullable', 'array', 'max:4'],
            "$at.hide.*" => ['in:cluster,controls,tuning,dyno'],
            ...collect(['cluster', 'controls', 'tuning', 'dyno'])->flatMap(fn ($area) => [
                "$at.$area" => ['nullable', 'array:x,y,w,h'],
                "$at.$area.x" => ["required_with:$at.$area", 'numeric', 'min:0', 'max:20000'],
                "$at.$area.y" => ["required_with:$at.$area", 'numeric', 'min:0', 'max:20000'],
                "$at.$area.w" => ["required_with:$at.$area", 'numeric', 'min:1', 'max:20000'],
                "$at.$area.h" => ['nullable', 'numeric', 'min:1', 'max:20000'],
            ])->all(),
        ];
    }

    private static function partsRules(string $at): array
    {
        return [$at => ['array', 'max:60'], "$at.*" => ['string', 'max:20']];
    }

    private static function calibrationRules(string $at): array
    {
        $curves = ['boost', 'timing', 'afr', 'iq', 'soi', 'rail'];

        return [
            $at => ['array:name,'.implode(',', $curves).',rev,shift,launch,vmax,tq,shiftSpeed,smoke,pilot,egr,dpf,burble,knock,protect,gears,gearShift,gearTq'],
            "$at.name" => ['string', 'max:60'],
            ...collect($curves)->flatMap(fn ($c) => [
                "$at.$c" => ['array', 'max:16'],
                "$at.$c.*" => ['numeric', 'between:-100,3000'],
            ])->all(),
            // the gearbox: a ratio, a full-throttle shift point (rpm, 0 = the global one) and a torque limit (Nm, 0 = none) per gear
            "$at.gears" => ['array', 'max:10'],
            "$at.gears.*" => ['numeric', 'between:0.3,8'],
            "$at.gearShift" => ['array', 'max:10'],
            "$at.gearShift.*" => ['numeric', 'between:0,12000'],
            "$at.gearTq" => ['array', 'max:10'],
            "$at.gearTq.*" => ['numeric', 'between:0,3000'],
            "$at.rev" => ['numeric', 'between:1000,12000'],
            "$at.shift" => ['numeric', 'between:1000,12000'],
            "$at.launch" => ['numeric', 'between:0,12000'],
            "$at.vmax" => ['numeric', 'between:0,500'],
            "$at.tq" => ['numeric', 'between:0,3000'],
            "$at.shiftSpeed" => ['integer', 'between:0,2'],
            "$at.smoke" => ['numeric', 'between:0.8,2'],
            "$at.burble" => ['integer', 'between:0,3'],
            ...collect(['pilot', 'egr', 'dpf', 'knock', 'protect'])->mapWithKeys(fn ($k) => ["$at.$k" => ['boolean']])->all(),
        ];
    }

    public function activities(Request $request, Car $car)
    {
        $before = $request->integer('before');
        $rows = $car->activities()->when($before, fn ($q) => $q->where('id', '<', $before))
            ->orderByDesc('id')->limit(60)->get();

        return response()->json($rows->map(fn ($a) => [
            'id' => $a->id,
            'type' => $a->type,
            'summary' => $a->summary,
            'at' => $a->created_at->toIso8601String(),
            'odometer' => $a->snapshot['odometer'] ?? null,
            'fuel' => $a->snapshot['fuel_level'] ?? null,
            'wear' => $a->snapshot['engine_wear_pct'] ?? null,
            'map' => $a->snapshot['engine_map'] ?? null,
            'tune' => data_get($a->snapshot, 'tune.slots.'.($a->snapshot['engine_map'] ?? 1).'.name'),
            'faults' => collect($a->snapshot['fault_codes'] ?? [])->where('status', 'active')->count(),
        ]));
    }

    public function restore(Car $car, CarActivity $activity)
    {
        abort_unless($activity->car_id === $car->id, 404);
        $car->restoreTo($activity);

        return response()->json(['restored' => true]);
    }

    public function saveName(Request $request, Car $car)
    {
        $validated = $request->validate([
            'nickname' => ['nullable', 'string', 'max:60'],
        ]);

        $car->update($validated);
        $car->logActivity('rename', $car->nickname ? 'Renamed to "'.$car->nickname.'"' : 'Name reset to '.$car->name);

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
