# AGENTS.md — GnomeMeteo (GNOME Shell Extension)

Operational manual and architectural invariants for AI agents working in this repository.

## 1. Scope & Architecture

GnomeMeteo (`meteo@oleksiym.github.io`) is a lightweight, modern GNOME Shell extension (GNOME 45–50+) providing weather indications and forecasts with native Libadwaita styling and keyless multi-provider support.

- `extension/extension.js`: Dynamic hot-reload loader (`import('./indicator.js?t=' + Date.now())`) allowing live updates on Wayland via `disable`/`enable` without restarting GNOME Shell.
- `extension/indicator.js`: Top-bar `PanelMenu.Button` indicator and popup card UI (`St` / `Clutter`), `WeatherCoordinator` timer, and runtime `MESSAGES` dictionary (`uk`, `ru`, `en`).
- `extension/weather.js`: Keyless multi-provider client (`Open-Meteo`, `MET Norway`, `NOAA NWS`), astronomical `sunGeometry` calculator, and auto-location (`GeoClue` + IP fallback + localized reverse geocoding).
- `extension/moon.js`: Pure astronomical lunar phase and illumination calculator (`moonPhase`).
- `extension/prefs.js`: Single-page Libadwaita (`Adw` / `GTK4`) preferences window.
- `extension/assets/`: App icons and bundled monochrome symbolic SVG icons (`meteo-*-symbolic.svg`).
- `extension/schemas/`: GSettings schema (`org.gnome.shell.extensions.meteo.gschema.xml`).
- `po/`: GNU Gettext catalogs (`uk.po`, `ru.po`, `meteo@oleksiym.github.io.pot`, `LINGUAS`) for `prefs.js`.
- `scripts/`: Build and verification scripts (`build-i18n.sh`, `build-package.sh`, `check-version.sh`).
- `install.sh` / `uninstall.sh`: Per-user installer (with `SHA256SUMS` + Sigstore SLSA v1 provenance verification) and uninstaller (`--purge`).
- `index.html`: Multilingual (`EN` / `UA` / `RU`) landing page deployed to GitHub Pages.

## 2. Technical Invariants & UI Rules

1. **Wayland Hot-Reload**:
   - `extension/extension.js` dynamically imports `indicator.js` with a cache-busting timestamp, and `MeteoIndicator` registers a unique GType (`MeteoIndicator_${Date.now()}`). Never replace this with a static top-level import of `indicator.js`, or live reloads on Wayland will break.
2. **Dual Localization Architecture (i18n)**:
   - **Popup & Indicator (`extension/indicator.js`)**: Uses the in-memory `MESSAGES` dictionary (`uk`, `ru`, `en`) resolved by `resolveLang(settings)`. This enables instant, live language switching inside the GNOME Shell popup without logging out of the desktop session.
   - **Preferences Dialog (`extension/prefs.js`)**: Uses standard GNU Gettext (`_('...')`) compiled from `po/*.po` into `extension/locale/<lang>/LC_MESSAGES/meteo@oleksiym.github.io.mo`.
   - **Web Landing Page (`index.html`)**: Uses client-side `I18N` dictionary (`en`, `uk`, `ru`) with instant language switcher.
   - **Never hand-edit binary `.mo` files.** Update `po/*.po` and run `./scripts/build-i18n.sh`.
3. **GTK4 vs GNOME Shell `St` / `Clutter`**:
   - **`prefs.js` runs in GTK4 / Libadwaita**: GTK4 widgets do **not** have a `.destroy()` method. Always unparent rows via `group.remove(row)`.
   - **`indicator.js` runs in GNOME Shell (`St` / `Clutter`)**: Standard CSS `linear-gradient()` is not supported by `St`. Always use native `St` gradient properties: `background-gradient-direction: horizontal; background-gradient-start: #...; background-gradient-end: #...;`.
   - **Bundled Symbolic Icons**: To avoid missing icons across different Linux distributions, custom symbolic icons (`meteo-temperature-symbolic.svg`, `meteo-humidity-symbolic.svg`, `meteo-pressure-symbolic.svg`) live in `extension/assets/` and are loaded via `Gio.FileIcon`.

## 3. Development & Verification Workflow

 `./install.sh` copies (`cp -R`) files from `extension/` into `~/.local/share/gnome-shell/extensions/meteo@oleksiym.github.io/`, so editing files directly in this repository is safe and does not affect the running session until `./install.sh` is executed.

Before committing or deploying any changes, always run the verification suite:

```bash
# 1. Validate JavaScript syntax
node -c extension/*.js

# 2. Validate and compile GSettings schemas
glib-compile-schemas --strict extension/schemas/

# 3. Compile Gettext translations
./scripts/build-i18n.sh

# 4. Lint shell scripts
shellcheck install.sh uninstall.sh scripts/*.sh
```

To deploy and test live in the active GNOME Shell session:

```bash
./install.sh
gnome-extensions disable meteo@oleksiym.github.io && sleep 1 && gnome-extensions enable meteo@oleksiym.github.io
journalctl --user -b -n 30 --no-pager | grep -i meteo
```

## 4. Release & Versioning Lifecycle

Releases follow Semantic Versioning (`X.Y.Z`).

1. **Bump Version**:
   - `extension/metadata.json`: increment integer `"version"` and set `"version-name": "X.Y.Z"`.
   - `extension/prefs.js`: update fallback version string in `Adw.AboutDialog` to `"X.Y.Z"`.
2. **Verify Tag & Package Contract**:
   ```bash
   ./scripts/check-version.sh vX.Y.Z
   ./scripts/build-package.sh && rm -rf dist
   ```
3. **Commit & Tag**:
   ```bash
   git commit -am "chore(release): bump version to X.Y.Z"
   git tag -a vX.Y.Z -m "GnomeMeteo X.Y.Z"
   ```
4. **Push Release** (only when explicitly requested by the operator):
   ```bash
   git push origin main && git push origin vX.Y.Z
   ```
   - Pushing `v*` triggers `.github/workflows/release.yml` (validates ancestry, runs `shellcheck`, builds the zip bundle, attests SLSA v1 provenance via Sigstore, signs `SHA256SUMS`, and publishes the GitHub Release).
   - Pushing changes in `index.html` or `screenshots/` to `main` triggers `.github/workflows/pages.yml`.

## 5. Identity & Lineage

- Repository author: `OleksiyM <oleksiymaliovanyy@gmail.com>`.
- Lineage credit to original WeatherGlass author Vijay Bala is preserved in `README.md`, `LICENSE`, `extension/prefs.js` (`Adw.AboutDialog`), and `index.html`.
- Do not push to `origin` unless explicitly instructed by the operator.
