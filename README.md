# WeatherGlass

Animated weather for GNOME, built once and worn twice: a Shell extension
and a standalone GJS/GTK4 app that share one design brain — sky physics,
adaptive ink judgment, the glyph kit, the chart grammar, and the icon
pipeline.

<img src="extension/assets/weatherglass-demo.gif" width="300" alt="Animated demo: Berlin forecast card transitioning from sunny afternoon to rain, golden hour, and a clear full-moon night">

For the full extension gallery, see
[extension/README.md](extension/README.md#gallery).

## Layout

```
shared/     canonical design assets (brand art pipeline; tokens roadmap)
extension/  GNOME Shell extension (EGO zip lives here; self-contained by rule)
app/        dev.vijaybala.weatherglassapp — GTK4 standalone app
scripts/    cross-cutting tools; check-design-parity.py is the design CI gate
```

## Develop

- Extension: work in `extension/`, `./install.sh` (copies into
  `~/.local/share/gnome-shell/`), test via `tests/`.
- App: `cd app && gjs -m src/main.js`; `./install.sh` wires the launcher,
  desktop entry, and icon ladder.
- Icons: `cd app && gjs -m tools/branding-icon.mjs` (drawn from
  `shared/art/icon-render.mjs`; the extension keeps a synced copy).

## Design parity gate

Any change to shared design values must pass `python3 scripts/check-design-parity.py`:
brand-pipeline byte sync, glass token literal parity, and the app canvas
mirror constants. Wire into CI on push.
