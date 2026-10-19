@extends('layouts.app')

@section('title', 'Instrument Cluster Sim — Manage Cars')

@section('content')
  <div class="panel">
    <h1>Manage Cars</h1>
    <div class="sub">Rename, reorder, add photos to or delete cars from the garage</div>

    @if ($errors->any())
      <ul class="errors">
        @foreach ($errors->all() as $error)
          <li>{{ $error }}</li>
        @endforeach
      </ul>
    @endif

    <div class="manage-list">
      @forelse($cars as $i => $car)
        <div class="manage-row">
          <form method="POST" action="{{ route('car.photo.save', $car) }}" enctype="multipart/form-data">
            @csrf
            <label class="manage-photo" title="Upload a photo for {{ $car->displayName() }}">
              @if($photo = $car->photoUrl())
                <img src="{{ $photo }}" alt="">
                <span class="manage-photo-change">Change</span>
              @else
                + Photo
              @endif
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" class="sr-only"
                     aria-label="Photo for {{ $car->displayName() }}" onchange="this.form.submit()">
            </label>
          </form>
          <div class="manage-info">
            <div class="car-name">{{ $car->displayName() }}</div>
            <div class="car-sub">{{ $car->subtitle }}</div>
            {{-- a failed save reopens its own form with what was typed --}}
            @php($mine = old('editing') === $car->slug)
            <details class="manage-edit" @if($mine) open @endif>
              <summary>Edit details @if(session('saved') === $car->slug)<span class="manage-saved">Saved</span>@endif</summary>
              <form method="POST" action="{{ route('car.update', $car) }}">
                @csrf
                @method('PATCH')
                <input type="hidden" name="editing" value="{{ $car->slug }}">
                <div class="field">
                  <label for="name-{{ $car->slug }}">Model</label>
                  <input type="text" id="name-{{ $car->slug }}" name="name" value="{{ $mine ? old('name') : $car->name }}" maxlength="255" required>
                </div>
                <div class="field">
                  <label for="nickname-{{ $car->slug }}">Nickname (optional)</label>
                  <input type="text" id="nickname-{{ $car->slug }}" name="nickname" value="{{ $mine ? old('nickname') : $car->nickname }}" maxlength="60"
                         placeholder="Shown instead of the model">
                </div>
                <div class="field">
                  <label for="subtitle-{{ $car->slug }}">Subtitle (optional)</label>
                  <input type="text" id="subtitle-{{ $car->slug }}" name="subtitle" value="{{ $mine ? old('subtitle') : $car->subtitle }}" maxlength="255"
                         placeholder="Engine · gearbox · 300 hp / 600 Nm">
                </div>
                <button type="submit" class="btn">Save</button>
              </form>
            </details>
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
