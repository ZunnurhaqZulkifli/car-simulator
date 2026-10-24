@extends('layouts.app')

@section('title', 'Instrument Cluster Sim — Garage')
@section('page-class', 'page-garage')

@push('head')
@fonts(['electrolize', 'roboto-condensed'])
@endpush

@section('content')
  <div class="garage-streaks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>

  <div class="garage">
    <header class="garage-head">
      <div class="garage-kicker"><span class="m-stripes"><i></i><i></i><i></i></span>Instrument Cluster Simulator</div>
      <h1 class="garage-title">Garage</h1>
      <div class="garage-sub">{{ $cars->count() }} {{ Str::plural('car', $cars->count()) }} parked · pick one and press start</div>
      <div class="garage-rule"></div>
    </header>

    {{-- the cars public/drive.html has a 3D model for (its CARS): Start drives them there, the others open their gauges --}}
    @php($drivable = ['bmw-x1-xdrive20d', 'bmw-m3-touring', 'bmw-m5-cs', 'bmw-140i', 'bmw-320d', 'bmw-550d-mk2', 'bmw-530e', 'bmw-m5-e60'])
    <div class="garage-grid">
      @foreach($cars as $car)
        @php($chips = collect(explode('·', $car->subtitle ?? ''))->map(fn ($c) => trim($c))->filter())
        <button type="button" class="garage-card @if(preg_match('/\bM\d/', $car->name)) is-m @endif"
                style="--i: {{ $loop->index }}" aria-pressed="false"
                data-href="{{ route('car.show', $car) }}" data-name="{{ $car->displayName() }}" data-slug="{{ $car->slug }}"
                @if(in_array($car->slug, $drivable)) data-drive="{{ asset('drive.html') }}?car={{ $car->slug }}" @endif>
          <span class="garage-photo">
            @if($photo = $car->photoUrl())
              <img src="{{ $photo }}" alt="{{ $car->displayName() }}" loading="lazy">
            @else
              <span class="garage-photo-empty" title="Drop a photo at storage/app/public/car-photos/{{ $car->slug }}.jpg">
                <svg viewBox="0 0 240 90" aria-hidden="true">
                  <path class="sil" pathLength="1" d="M16 62c0-8 4-13 13-15l35-6c13-10 30-18 54-19h32c16 0 30 7 44 17l28 6c8 2 12 7 12 14v3c0 2-2 4-4 4h-18a18 18 0 0 0-36 0H74a18 18 0 0 0-36 0H20c-2 0-4-2-4-4z"/>
                  <path class="sil" pathLength="1" d="M70 41c11-9 26-14 46-14h32c12 0 22 5 32 13z"/>
                  <circle class="sil" pathLength="1" cx="56" cy="66" r="14"/>
                  <circle class="sil" pathLength="1" cx="194" cy="66" r="14"/>
                </svg>
                <span class="garage-photo-hint">Photo slot</span>
                <code>car-photos/{{ $car->slug }}.jpg</code>
              </span>
            @endif
          </span>

          <span class="garage-body">
            <span class="garage-name">
              <span class="m-stripes"><i></i><i></i><i></i></span>{{ $car->displayName() }}
            </span>
            <span class="garage-paint"></span>
            <span class="garage-chips">
              @foreach($chips as $chip)
                <span>{{ $chip }}</span>
              @endforeach
            </span>
            <span class="garage-stats">
              <span class="garage-stat">
                <span class="garage-stat-label">ODO</span>
                <span class="garage-stat-val">{{ $car->odometer !== null ? number_format($car->odometer) . ' km' : '—' }}</span>
              </span>
              @if($car->fuel_level !== null)
                <span class="garage-stat garage-fuel">
                  <span class="garage-stat-label">FUEL</span>
                  <span class="garage-fuel-bar"><i style="width: {{ round($car->fuel_level * 100) }}%"></i></span>
                </span>
              @endif
            </span>
          </span>
        </button>
      @endforeach

      <a href="{{ route('car.create') }}" class="garage-card garage-add" style="--i: {{ $cars->count() }}">
        <span class="garage-add-plus">+</span>
        <span>Add a car</span>
      </a>
    </div>
  </div>

  <div class="garage-dock">
    <div class="garage-dock-text">
      <span class="garage-stat-label">Selected</span>
      <span class="garage-dock-name" id="ready-name">Choose a car</span>
      <button type="button" class="garage-specs-btn" id="specs-btn" aria-expanded="false" aria-controls="specs" hidden>
        <span id="specs-sum"></span>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8l4-4 4 4"/></svg>
      </button>
    </div>

    {{-- the selected car's stats card, opened from the dock --}}
    <section class="garage-specs" id="specs" aria-label="Car stats" hidden>
      @foreach($cars as $car)
        @php($power = $car->power())
        @php($faults = collect($car->fault_codes ?? [])->countBy('status'))
        @php($mods = data_get($car->tune, 'stats.mods'))
        <div class="garage-spec" data-slug="{{ $car->slug }}"
             data-sum="{{ $power ? number_format($power['hp']).' hp · '.number_format($power['tq']).' Nm' : 'Stats' }}" hidden>
          <div class="garage-spec-head">
            <span class="garage-spec-name"><span class="m-stripes"><i></i><i></i><i></i></span>{{ $car->displayName() }}</span>
          </div>

          <div class="garage-spec-power">
            <span class="garage-spec-big">{{ $power ? number_format($power['hp']) : '—' }}<small>hp</small></span>
            <span class="garage-spec-big">{{ $power ? number_format($power['tq']) : '—' }}<small>Nm</small></span>
            <span class="garage-spec-map">
              @if($power)
                {{ $power['map'] }}
                @if($power['stock'] && $power['hp'] != $power['stock']['hp'])
                  <span>Stock {{ number_format($power['stock']['hp']) }} hp / {{ number_format($power['stock']['tq']) }} Nm
                    · {{ $power['hp'] > $power['stock']['hp'] ? '+' : '−' }}{{ number_format(abs($power['hp'] - $power['stock']['hp'])) }} hp</span>
                @endif
              @else
                Add "hp / Nm" to its subtitle on Manage cars
              @endif
            </span>
          </div>

          <dl class="garage-spec-grid">
            <div><dt>Odometer</dt><dd>{{ $car->odometer !== null ? number_format($car->odometer).' km' : '—' }}</dd></div>
            <div><dt>Fuel</dt><dd>{{ $car->fuel_level !== null ? round($car->fuel_level * 100).'%' : '—' }}</dd></div>
            <div><dt>Engine wear</dt><dd>{{ $car->engine_wear_pct !== null ? round($car->engine_wear_pct, 1).'%' : '—' }}</dd></div>
            <div><dt>Faults</dt><dd>{{ $faults->isEmpty() ? 'None' : ($faults['active'] ?? 0).' active · '.($faults['stored'] ?? 0).' stored' }}</dd></div>
            <div><dt>Upgraded parts</dt><dd>{{ $mods ?? '—' }}</dd></div>
            <div><dt>Last drive</dt><dd>{{ $car->last_drive ? \Illuminate\Support\Carbon::parse($car->last_drive)->diffForHumans() : 'Never' }}</dd></div>
          </dl>

          <div class="garage-spec-bars">
            @foreach(['oil_wear_pct' => 'Oil life', 'oil_level_loss_pct' => 'Oil level', 'coolant_loss_pct' => 'Coolant', 'brake_wear_pct' => 'Brake pads',
                      'tyre_wear_pct' => 'Tyres', 'tyre_pressure_loss_pct' => 'Tyre pressure', 'battery_drain_pct' => 'Battery'] as $col => $label)
              @php($left = round(100 - ($car->$col ?? 0)))
              <div class="garage-spec-bar @if($left < 25) is-low @endif">
                <span class="garage-stat-label">{{ $label }}</span>
                <span class="garage-fuel-bar"><i style="width: {{ $left }}%"></i></span>
                <span class="garage-spec-pct">{{ $left }}%</span>
              </div>
            @endforeach
          </div>
        </div>
      @endforeach
    </section>
    <button type="button" class="garage-tune-btn" id="tune-btn" title="The gauges simulator: cluster, controls, tuning and dyno" disabled>Tuning</button>
    <button type="button" class="ignition" id="start-btn" disabled>
      <svg class="ignition-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" pathLength="1"/></svg>
      <span>Engine<br><b>Start</b><br>Stop</span>
    </button>
  </div>

  <script>
    const cards = document.querySelectorAll('.garage-card[data-href]');
    const startBtn = document.getElementById('start-btn');
    const tuneBtn = document.getElementById('tune-btn');
    const readyName = document.getElementById('ready-name');
    const specsBtn = document.getElementById('specs-btn');
    const specs = document.getElementById('specs');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let selected = null; // the card: Start drives it (drive.html) when it can, Tuning opens its gauges

    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.setAttribute('aria-pressed', c === card));
        selected = card;
        readyName.textContent = card.dataset.name;
        startBtn.disabled = tuneBtn.disabled = false;
        startBtn.querySelector('b').textContent = card.dataset.drive ? 'Drive' : 'Start';
        specs.querySelectorAll('.garage-spec').forEach(s => {
          s.hidden = s.dataset.slug !== card.dataset.slug;
          if (!s.hidden) document.getElementById('specs-sum').textContent = s.dataset.sum;
        });
        specsBtn.hidden = false;
      });

      // tilt + glare follow the pointer
      if (calm || !matchMedia('(hover: hover)').matches) return;
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--px', ((e.clientX - r.left) / r.width).toFixed(4));
        card.style.setProperty('--py', ((e.clientY - r.top) / r.height).toFixed(4));
      });
      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--px');
        card.style.removeProperty('--py');
      });
    });

    specsBtn.addEventListener('click', () => {
      specs.hidden = !specs.hidden;
      specsBtn.setAttribute('aria-expanded', !specs.hidden);
    });

    const go = (href) => {
      document.body.classList.add('igniting');
      setTimeout(() => { window.location.href = href; }, calm ? 0 : 900);
    };
    startBtn.addEventListener('click', () => selected && go(selected.dataset.drive || selected.dataset.href));
    tuneBtn.addEventListener('click', () => selected && go(selected.dataset.href));

    // back button restores this page from bfcache mid-fade - bring it back
    addEventListener('pageshow', () => document.body.classList.remove('igniting'));
  </script>
@endsection
