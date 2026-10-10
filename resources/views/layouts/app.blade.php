<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>@yield('title', 'Instrument Cluster Sim')</title>
@vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
  <nav class="navbar">
    <a href="{{ route('menu') }}" class="navbar-brand">Instrument Cluster Sim</a>
    <div class="navbar-links">
      <a href="{{ route('menu') }}" class="navbar-link @if(request()->routeIs('menu')) active @endif">Garage</a>
      <a href="{{ route('car.create') }}" class="navbar-link @if(request()->routeIs('car.create')) active @endif">Upload</a>
      <a href="{{ route('car.manage') }}" class="navbar-link @if(request()->routeIs('car.manage')) active @endif">Manage</a>
    </div>
  </nav>

  <main class="page @yield('page-class')">
    @yield('content')
  </main>
</body>
</html>
