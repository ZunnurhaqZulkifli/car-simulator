@extends('layouts.app')

@section('title', 'Instrument Cluster Sim — Manage Cars')

@section('content')
  <div class="panel">
    <h1>Manage Cars</h1>
    <div class="sub">Reorder or delete cars from the garage</div>

    <div class="manage-list">
      @forelse($cars as $i => $car)
        <div class="manage-row">
          <div class="manage-info">
            <div class="car-name">{{ $car->displayName() }}</div>
            <div class="car-sub">{{ $car->subtitle }}</div>
          </div>
          <div class="manage-actions">
            <form method="POST" action="{{ route('car.move-up', $car) }}">
              @csrf
              <button type="submit" class="btn-icon" @if($i === 0) disabled @endif title="Move up">&uarr;</button>
            </form>
            <form method="POST" action="{{ route('car.move-down', $car) }}">
              @csrf
              <button type="submit" class="btn-icon" @if($i === $cars->count() - 1) disabled @endif title="Move down">&darr;</button>
            </form>
            <form method="POST" action="{{ route('car.destroy', $car) }}" onsubmit="return confirm('Delete {{ $car->displayName() }}? This cannot be undone.');">
              @csrf
              @method('DELETE')
              <button type="submit" class="btn-icon btn-icon-danger" title="Delete">&times;</button>
            </form>
          </div>
        </div>
      @empty
        <div class="car-sub">No cars yet.</div>
      @endforelse
    </div>

    <a href="{{ route('menu') }}" class="back-link">← Back to menu</a>
  </div>
@endsection
