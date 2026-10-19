@extends('layouts.app')

@section('title', $car->displayName() . ' — Instrument Cluster Sim')

@section('page-class', 'page-frame')

@section('content')
  <iframe src="{{ route('car.raw', $car) }}" class="car-frame" title="{{ $car->displayName() }}"></iframe>
@endsection
