@extends('layouts.app')

@section('title', 'Instrument Cluster Sim — Select Car')

@section('content')
  <div class="panel">
    <h1>Instrument Cluster Simulator</h1>
    <div class="sub">Select your car to begin</div>
    <div class="section-label">Choose Car</div>
    <div class="car-grid" id="car-grid">
      @foreach($cars as $car)
        <div class="car-card" data-slug="{{ $car->slug }}">
          <div class="car-name">{{ $car->name }}</div>
          <div class="car-sub">{{ $car->subtitle }}</div>
        </div>
      @endforeach
    </div>
    <button class="btn" id="start-btn" disabled>Start Engine</button>
    <a href="{{ route('car.create') }}" class="back-link">+ Upload a car</a>
  </div>

  <script>
    let selected = null;
    const cards = document.querySelectorAll('.car-card');
    const startBtn = document.getElementById('start-btn');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selected = card.dataset.slug;
        startBtn.disabled = false;
      });
    });
    startBtn.addEventListener('click', () => {
      if (selected) window.location.href = `/car/${selected}`;
    });
  </script>
@endsection
