# WeatherGlass

A standalone multi-city weather app for GNOME, written in **GJS** (GTK 4 +
Libadwaita), modeled on the [WeatherGlass GNOME Shell
extension](https://extensions.gnome.org/extension/6126/weatherglass/) — same
name, same procedural Cairo icon language, same Open-Meteo data pipeline,
extended where the extension stopped at a single location: **saved cities
and regions with instant switching**.

No build step, no packaging, no dependencies beyond what a Fedora/GNOME
developer box already has: `gjs`, GTK 4, libadwaita, libsoup 3.

## Features

- **Multiple cities & regions** — a sidebar of saved places (named cities,
  provinces via the Open-Meteo geocoder, or raw lat/lon points). Rows show a
  live weather glyph, the current temperature, and the **city-local clock**.
  Add, remove (with inline confirm), and reorder from each row's menu.
- **Procedural animated icons** — zero image assets. Every glyph (sun, moon,
  partly, cloud, fog, wind, rain, sleet, snow, hail, storm, loading, error)
  is Cairo on a 24-unit grid, seeded so static glyphs never shimmer, with
  20 fps particle animation (falling drops, drifting snow, rotating rays,
  blinking bolt) that runs only while the icon is on screen. Toggle in the
  ⋮ menu (*Animated Icons*).
- **Hourly profile chart** — Temperature / Precipitation / Wind switcher,
  smooth spline with area fade, per-hour condition strip, sparse value
  labels, and a dashed **"now" marker inside a rolling 24-hour window with
  2 h backfill** (the extension's windowing model — future days are exact
  calendar slices, so no timezone ever tips a day boundary).
- **Day planner** — 8 selectable day tiles; selecting one retargets the
  chart and summary line (the extension's day-tab idea).
- **What the extension parsed but never showed** — feels-like, humidity,
  wind compass bearing, pressure, UV band, visibility, precipitation rate,
  sunrise/sunset, and **moon phase with illumination %**.
- **City-local clocks** — computed from the forecast payload's local
  timestamps + a monotonic offset, so the clock is correct in any timezone
  and 12-/24-h follows GNOME's `clock-format`.
- Metric ⇄ imperial units, refresh cadence 5–60 min, dark-mode aware,
  `Ctrl+R` refresh, `Ctrl+N` add city, single-instance.
- Graceful degradation: failed refreshes keep the last good data with a
  stale-data banner; a cold failure gets its own Try-Again page.

## Run

```sh
./bin/weatherglass          # or: gjs -m src/main.js
```

## Install (launcher + app grid entry)

```sh
./install.sh                # symlinks ~/.local/bin/weatherglass, desktop entry, icon
./uninstall.sh              # reverses it (keeps your city list)
```

## Configuration

Stored at `~/.config/weatherglass/config.json` (atomic writes, validated on
load):

```json
{
  "version": 1,
  "cities": [
    { "id": "…", "name": "Bengaluru", "admin1": "Karnataka",
      "country": "India", "countryCode": "IN",
      "latitude": 12.9716, "longitude": 77.5946 }
  ],
  "activeCityId": "…",
  "units": "metric",
  "refreshMinutes": 15,
  "animate": true
}
```

## Architecture

```
src/
├── main.js          entry — gjs -m src/main.js
├── application.js   Adw.Application, CSS, clock-format watcher, kickoff
├── window.js        split view · sidebar rows · header menu · actions
├── citypage.js      hero · stat tiles · chart card · day tiles
├── chart.js         pure paintChart() renderer + HourlyChart widget
├── painter.js       procedural glyph kit (drawScene) + icon widgets
├── weather.js       Open-Meteo client · WMO 4677 · daySlice · formatters
├── coordinator.js   serialized multi-city refresh cycles
├── store.js         JSON config store (atomic, sanitized)
└── addcity.js       geocoder search dialog + manual lat/lon entry
data/style.css, data/*.desktop.in, data/*.svg   (loaded from the checkout;
WEATHERGLASS_DATADIR overrides)
```

Design carries from the extension:

- **Canonical metric internally**; conversion happens only at display time.
- The normalized `{current, hourly, daily}` forecast shape and the WMO →
  scene vocabulary, including the physics-override derivation (CAPE ≥ 1200 +
  liquid precip ⇒ storm, ≥ 2500 ⇒ hail, visibility < 1 km & dry ⇒ fog, wind
  ≥ 30 km/h over calm scenes ⇒ wind).
- Refresh discipline: coalesced fetches, 60 s retry cadence, data survives
  transient failures; here generalized to a **serial cycle** so warming N
  cities never bursts the free API.

Deliberate deviations: static-by-default repaints with an opt-out animation
layer (extensions must not burn battery; a window app should still be alive
to look at), and no GeoClue/IP auto-location yet.

## Development checks

The data layer, painter, and chart render headless (no display needed); the
integration harness boots the real app:

```sh
gjs -m tests/smoke.js       # logic + PNG render of every glyph & chart series
gjs -m tests/ui-integration.js   # live app: fetch, CRUD, persistence  (~15 s)
```

Both exit non-zero on failure. Artifacts land in `$XDG_RUNTIME_DIR` or /tmp.

## Roadmap

- Auto-location (GeoClue → ipinfo/ipapi fallbacks, like the extension).
- Provider plugs for MET Norway / NOAA NWS (shapes already compatible).
- Radar/air-quality layers via other free endpoints.
- Optional animated sky backdrop behind the hero card.

## Credits

- Weather model, data-layer concepts, icon vocabulary, and chart behavior:
  the WeatherGlass GNOME Shell extension lineage.
- Forecast & geocoding data: [Open-Meteo](https://open-meteo.com/) (no API
  key required).

License: GPLv3.
