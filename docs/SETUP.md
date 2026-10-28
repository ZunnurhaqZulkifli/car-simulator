# Setup guide

Everything you need to get the simulator running on a Mac. That covers the garage and car pages, the 3D drive page, the
phone as a steering wheel, and the phone as the Mac's trackpad and keyboard. Each part builds on the one before. Stop
after step 6 if you only want to drive with the keyboard.

---

## 1. What you need

| | Needed for | Check |
|---|---|---|
| **macOS** | everything (Herd, the relay's login agent and the mouse helper are Mac-only) | |
| **PHP 8.3+** and **Composer** | the Laravel app | `php -v`, `composer -V` |
| **Node 20+** and **npm** | the front-end build and the phone pad's relay | `node -v`, `npm -v` |
| **[Laravel Herd](https://herd.laravel.com)** | serving the app at `http://sim-app.test` | `herd --version` |
| A desktop browser with **WebGL** (Chrome or Safari) | the drive page | |
| An internet connection | three.js and fonts load from CDNs, and Live weather comes from Open-Meteo | |
| **MySQL** *(optional)* | only if you'd rather not use the default SQLite | |
| **[Tailscale](https://tailscale.com)** on the Mac and the phone *(optional)* | the phone pad (step 7) | `tailscale status` |
| A phone with motion sensors *(optional)* | tilt steering. Built and tested on iPhone Safari | |
| **Xcode Command Line Tools** *(optional)* | the phone pad's mouse and keyboard (step 8) | `swiftc --version` |

Without PHP or Composer, the quickest route is `/bin/bash -c "$(curl -fsSL https://php.new/install/mac/8.5)"`, then
restart the terminal. Herd also ships PHP and Composer.

---

## 2. Get the code and install

```sh
git clone <this-repo> sim-app && cd sim-app
composer setup
```

`composer setup` does the following:
1. installs the PHP packages
2. copies `.env.example` to `.env` (if there isn't one)
3. generates the app key
4. runs the migrations
5. installs the npm packages (including `ws`, which the relay needs)
6. builds the garage's assets

---

## 3. Choose the database

**SQLite (the default):** nothing to do. `.env.example` points at `database/database.sqlite`, and the migrations in
step 2 created it.

**MySQL:** create a database, then set it in `.env` and migrate again:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=sim-app
DB_USERNAME=root
DB_PASSWORD=
```

```sh
php artisan migrate
```

Set `APP_URL=http://sim-app.test` in `.env` as well.

---

## 4. Add the cars

The car pages live in `resources/cars/`. The app serves its own copies from `storage/app/public/cars/`, and each car
needs a row in the `cars` table.

```sh
php artisan storage:link   # public/storage -> storage/app/public, so the car files are served
php artisan db:seed        # BMW 550D, Proton Iriz, BMW 320D, M140i xDrive, 530e xDrive
```

Then register the other seven, all of them drivable in 3D. This copies each page into storage only if it isn't
there yet, and adds the car only if it's missing, so it's safe to run again:

```sh
php artisan tinker --execute '
$cars = ["bmw-x1-xdrive20d" => "BMW X1 xDrive20d", "bmw-m3-touring" => "BMW M3 Touring", "bmw-m5-cs" => "BMW M5 CS", "bmw-550d-mk2" => "BMW M550d xDrive", "bmw-m5-e60" => "BMW M5 E60", "porsche-911-gt3-rs" => "Porsche 911 GT3 RS", "bmw-335i-e90" => "BMW 335i"];
foreach ($cars as $slug => $name) {
    $path = "cars/$slug.html";
    Storage::disk("public")->exists($path) || Storage::disk("public")->put($path, file_get_contents(resource_path($path)));
    App\Models\Car::firstOrCreate(["slug" => $slug], ["name" => $name, "file_path" => $path, "position" => (App\Models\Car::max("position") ?? -1) + 1]);
}'
```

> [!WARNING]
> Run `db:seed` only on a fresh install. It copies the five seeded cars' pages over whatever is in storage.

Rename, nickname, reorder or add a photo to any car at `/manage`. To add your own car, upload its `.html` at
`/upload`; the README's *Add your own car* section has the details.

---

## 5. Serve it at sim-app.test

In the project folder:

```sh
herd link sim-app   # serves this folder at http://sim-app.test
```

Or park the folder that contains it (`herd park`). The address matters: the phone pad's relay only accepts the drive
page from `http://sim-app.test`.

While you work on the garage's styles, `composer dev` runs Vite and the other dev processes alongside.

---

## 6. First drive

1. Open **http://sim-app.test**. That's the garage.
2. Press **Drive** on a car. The drive page opens outside your home garage.
3. Press any key or click once. Browsers only start audio after a gesture, and the engine sound is synthesised live.
4. Press `I` to start the engine, `W` to go, `S` to brake, `A` / `D` to steer.

### Keys on the drive page

| Key | Does |
|---|---|
| `I` | engine start / stop |
| `W` / `S` | throttle / brake |
| `A` / `D` | steer |
| `Space` | handbrake |
| `R` / `N` | reverse / neutral (each car adds its own gearbox keys: D, S / DS, manual, paddles `Q` / `E`) |
| `←` / `→` | turn signal (flashes 3 times) |
| `L` / `H` | lights / high beam |
| `C` | in-car / chase view (two-finger swipe on the trackpad to look around; `W` swings it back) |
| `F`, `,` / `.` | cruise control, set speed −5 / +5 km/h |
| `↑` / `↓`, `O` / `P` | throttle limit, brake limit |
| `Tab` | the car menu: the whole car page over the road (tuning, dyno, live data, diagnostics) |
| `Esc` | close what's open |
| `` ` `` | teleport (or click the mini map) |
| `/` | Nordschleife lap timer |
| `\` | time & weather (or click the clock in the HUD) |
| `;` | drift mode |

Each car's own keys (xDrive, DSC, M modes, maps, Drivelogic…) are listed on its page and in the car menu.

### What to try

- **Places:**
  - **The mechanic:** stop in the workshop by home. Servicing and engine repairs happen only there.
  - **Fuel:** stop at a pump with the engine off to refuel.
  - **Swapping cars:** drive into the home garage, a car park bay or a pit garage.
- **Teleport** (`` ` ``): the racetrack and the Nordschleife (each with its pits), the mountain viewpoint, the
  autobahn, the airfield, home, the city, Midtown, Southgate, the car park roof, the village, the mechanic.
- **Time & weather** (`\`):
  - Dawn, Day, Dusk or Night, with a clock that runs a day in 24 minutes.
  - The four seasons.
  - Clear, Cloudy, Rain, Fog or Snow. Rain and snow cut grip, traction and braking.
  - **Live**: the Nürburgring's real clock, season and weather.
- **Lights:** `L` / `H` at night. The car menu's **Beam** slider sets their brightness.
- **Drift mode** (`;`): off by default, and every car drives on the grip model. On, the tyres slip.
  - Switch the car's DSC off (or to DTC / MDM / PSM Sport).
  - Pull the handbrake into a corner and stay on the throttle.
  - Let go of the steering and the countersteer assist holds the drift. Steer into the turn for more angle, against
    it for less. Lift off to straighten up.
  - The 320d is the drift car: in rain and snow it gets the road's real, slippery friction.
- **Track day:** the lap timer (`/`) on the Nordschleife. The telemetry panel shows g-forces, pedals, temperatures
  and worn parts. The car menu's Dyno and Performance tabs run pulls and timed runs on rollers.

URL options for `public/drive.html`:
- `?car={slug}`
- `&at=pits`, `&at=ring` or `&at=bay<n>` to start in a pit garage, at the Nordschleife or in a car park bay
- `&hour=0-3&season=…&sky=…` to set the time and weather
- `&test_drive=1` to drive without saving

---

## 7. The phone as the wheel *(optional)*

The phone talks to the drive page through a small relay on the Mac (`scripts/pad-relay.mjs`, port 8765). The phone
reaches the relay over Tailscale, because iOS only allows tilt steering on an https page, and Tailscale provides the
https.

1. **Tailscale:**
   - Install it on the Mac and the phone and sign both in to the same tailnet.
   - In the Tailscale admin console's **DNS** page, turn on **MagicDNS** and **HTTPS Certificates**.
   - On the Mac, run `tailscale serve --bg 8765` once. If Serve isn't enabled for the tailnet yet, it prints a link
     to enable it. After that the relay runs it on its own.
2. **Start the relay.** Either as a login agent that starts at login and restarts if it stops:
   ```sh
   npm run pad:install
   ```
   or in a terminal, for as long as it's open:
   ```sh
   npm run pad
   ```
   The login agent keeps the `node` it was installed with. Run `npm run pad:install` again after switching Node
   versions or moving the project.
3. **Open the drive page on the Mac.** The relay copies the phone's link (`https://<your-mac>.<tailnet>.ts.net/`) to
   the clipboard, and Universal Clipboard hands it to the iPhone. The drive page shows the link too.
4. **On the phone,** paste the link into Safari, hold the phone sideways like a wheel, tap **Start driving**, and allow
   **Motion & Orientation** access. Add it to the Home Screen to get rid of Safari's bars.

The relay log is `storage/logs/pad-relay.log`. Useful commands:
- Restart the login agent: `launchctl kickstart -k gui/$(id -u)/test.sim-app.pad`
- Remove it: `launchctl bootout gui/$(id -u)/test.sim-app.pad`

### On the pad

- **Steering, pedals, paddles:**
  - Tilt to steer. The brake is on the left, the throttle on the right, the shift paddles above them.
  - **Start / stop** starts the engine.
  - The cluster shows gear, speed, revs and shift lights.
- **Drive tab:**
  - ◀ R N D M ▶. Pressing D again takes the sport program (S / DS).
  - The car's driving setup: drive modes, maps named by their tune, M1 / M2 and the M cars' engine / chassis /
    Drivelogic.
  - In drift mode, a full-width **Handbrake**.
- **Setup tab:** DSC, which steps through the car's own traction settings; cruise; the car's other keys; **Drift
  mode**.
- **Car tab:** lights, high beam, headlight brightness.
- **View tab:** drag to look around, chase / in-car, Reset view.
- **Extras:**
  - Tab and Esc.
  - **Map:** the whole world, your car, a legend, and tap-to-teleport.
  - **Weather:** the time & weather menu.
  - **Sound:** Mute and every sound layer's slider. They appear once the engine has been started.
  - **Mouse** (step 8).

---

## 8. The phone as the Mac's trackpad and keyboard *(optional)*

The relay can move and click the Mac's pointer and type for you, through a small Swift helper
(`scripts/pad-mouse.swift`). The relay builds it on first use with `swiftc`, into `storage/app/pad-mouse`.

1. **Install the Xcode Command Line Tools** if `swiftc --version` doesn't answer: `xcode-select --install`.
2. **Give the relay Accessibility access:** System Settings › Privacy & Security › **Accessibility**. Press **+**,
   then add whatever runs the relay:
   - **The login agent:** its `node`. Run `which node` in the shell you installed it from, for example
     `~/.nvm/versions/node/v24.18.0/bin/node`. In the file picker, ⌘⇧G lets you type that path.
   - **`npm run pad` in a terminal:** Terminal (or iTerm).
3. **On the pad:** Extras › **Mouse** › **Turn on**. The Mac asks *"Let the phone pad move and click this Mac's
   pointer…?"*. Click **Allow**.
   - **Mouse on:** you're set.
   - **Needs Accessibility:** finish step 2, then Turn on again. It won't ask the Allow question twice.
   - **Restarting the relay:** this appears once, when access was granted while the relay was running. Turn on again
     a moment later.

Permission lasts for that phone connection only. If the phone reconnects (after its screen locks, for example), the
Mac asks again, and **Turn off** ends it at any time. The relay only takes mouse and keyboard input from the phone.

| On the touchpad | Does |
|---|---|
| 1 finger: drag / tap | move the pointer (further the faster you swipe) / click |
| 2 fingers: drag / tap | scroll / right-click |
| 3 fingers: drag / tap | drag (Three Finger Drag) / Look up |
| 4 fingers: swipe ← → | the next / previous Space |
| 4 fingers: swipe ↑ / ↓ | Mission Control / App Exposé |
| 4 fingers: pinch / spread | Apps / Show Desktop |

Buttons beside the touchpad: **Click**, **Right-click**, **Hold to drag**, and **Keyboard**. The keyboard types
characters whatever the Mac's keyboard layout is. ⇧ ⌃ ⌥ ⌘ apply to the next key (⌘ then C copies), and ⌫ and the
arrows repeat while held.

The 3- and 4-finger gestures press the Mac's own shortcuts: ⌃← / ⌃→, ⌃↑, ⌃↓, F11 and ⌃⌘D, plus opening Apps. If you've
changed those in System Settings › Keyboard › Keyboard Shortcuts › Mission Control, the matching gestures won't work.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| No engine sound | Click or press a key on the page first; browsers block audio until then |
| Drive page stays black | It loads three.js from jsDelivr: check the connection, and that WebGL is on |
| A car opens its gauges but **Drive** isn't offered | It isn't registered as drivable: step 4's command, or its slug in `$drivable` in `resources/views/menu.blade.php` |
| Progress "doesn't save" | Only the latest-opened page of a car may save, so an old tab can't overwrite newer progress. Close the others and reload |
| Pad: *Can't reach the Mac* | The relay isn't running (`npm run pad:install`), or Tailscale is off on one side |
| Pad: *Open the drive page on the Mac* | The relay is up, but no drive page is open at `http://sim-app.test` |
| Pad: *Tilt steering is off* | Open the https link (not http), and allow Motion & Orientation for Safari in Settings |
| Mouse: *Needs Accessibility* or nothing moves | Step 8.2 for the right process, then Turn on again; the relay's log shows each step (`pad mouse: …`) |
| Self-check failures | The drive page and the shared scripts check themselves on load; failures show in the browser's console |

Run the test suite with `composer test`.
