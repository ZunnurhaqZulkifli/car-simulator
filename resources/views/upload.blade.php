@extends('layouts.app')

@section('title', 'Instrument Cluster Sim — Upload Car')

@section('content')
  <div class="panel panel-narrow">
    <h1>Upload Car</h1>
    <div class="sub">Add a new instrument cluster simulation</div>

    @if ($errors->any())
      <ul class="errors">
        @foreach ($errors->all() as $error)
          <li>{{ $error }}</li>
        @endforeach
      </ul>
    @endif

    <form method="POST" action="{{ route('car.store') }}" enctype="multipart/form-data">
      @csrf
      <div class="field">
        <label for="name">Car Name</label>
        <input type="text" id="name" name="name" value="{{ old('name') }}" required>
      </div>
      <div class="field">
        <label for="subtitle">Subtitle (optional)</label>
        <input type="text" id="subtitle" name="subtitle" value="{{ old('subtitle') }}">
      </div>
      <div class="field">
        <label for="file">HTML File</label>
        <input type="file" id="file" name="file" accept=".html,.htm" required>
      </div>
      <button type="submit" class="btn">Upload</button>
    </form>
    <a href="{{ route('menu') }}" class="back-link">← Back to menu</a>
  </div>
@endsection
