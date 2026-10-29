# GnomeMeteo

> **Elegant weather indicator and forecast for GNOME Shell 45–50+**

GnomeMeteo is a lightweight, modern weather extension for the GNOME desktop, featuring a clean card-based weather popup, native Libadwaita styling, multi-provider weather forecasts, and smooth segmented metric switching.

<p align="center">
  <img src="screenshots/screenshot-1.png" alt="GnomeMeteo Forecast Popup" width="45%" />
  &nbsp; &nbsp;
  <img src="screenshots/05-preferences.png" alt="GnomeMeteo Preferences Window" width="48%" />
</p>

---

## 🚀 Quick Install & Update (One-Liner)

Install or update GnomeMeteo with a single command (no `git clone`, no `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash
```

The installer automatically verifies `SHA256SUMS` and Sigstore SLSA v1 release provenance (via `gh attestation verify` when GitHub CLI is available), installs to `~/.local/share/gnome-shell/extensions/meteo@oleksiym.github.io/`, and activates the extension live.

To install a specific release version or strictly enforce provenance verification:
```bash
curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash -s -- --version v1.2.0 --require-provenance
```

---

## ✨ Features

* **Visual Hierarchy:** Clean 3-tier main condition block (prominent temperature, condition name, daily max/min range, feels-like).
* **Segmented Metric Switcher:** Instantly toggle between **Temperature**, **Precipitation Probability**, and **Wind Speed** across both hourly and 7-day views.
* **Native Libadwaita Gradients:** Smooth daily temperature range bars built with native St gradient syntax.
* **Adaptive Details Cards:** At-a-glance cards with monochrome symbolic icons, shown only when the provider supplies the data:
  * 🌅 **Sunrise & Sunset** (`↑ Rise  ↓ Set`) with computed **Daylight duration**
  * 🌔 **Moon Phase** (astronomically computed with illumination %)
  * 💧 **Humidity & Dew Point**
  * 🧭 **Atmospheric Pressure** (`mmHg` / `inHg` with dynamic Low / Normal / High level)
  * 🌬️ **Wind** with compass direction, ☀️ **UV Index** with level, 👁️ **Visibility**
* **Zero Precipitation De-emphasis:** Days and hours with 0% rain probability are gracefully dimmed to highlight relevant weather.
* **Keyless Multi-Provider Support:**
  * **Open-Meteo** (global, with choice of prediction models: Best match, ECMWF IFS, DWD ICON, GFS, GEM)
  * **MET Norway** (`api.met.no`, CC BY-SA 4.0)
  * **NOAA NWS** (United States official forecasts)
* **Honest Data:** If a provider does not supply a value (e.g. rain probability from MET Norway), the popup shows “—” instead of an invented number.
* **Clean Single-Page Preferences:** Fast, scrollable Libadwaita settings dialog with smart top-bar indicator toggles and localized city search.
* **Full Localization:** Native Ukrainian, English, and Russian translations.
* **Privacy & Supply-Chain Security:** No tracking, no accounts, no API keys. Releases are attested with Sigstore SLSA v1 provenance.

---

## 🧭 Choosing a Provider & Forecast Model

Preferences contain an **(i)** button next to *Provider* and *Forecast model* with the same hints. Summary (checked against live API responses):

| Provider | Best for | Limitations |
|---|---|---|
| **Open-Meteo** | Everywhere, **including Ukraine** — the default | Depends on the chosen model (see below) |
| **MET Norway** | Europe; a good independent second opinion | No rain probability and no visibility (shown as “—”); sunrise/sunset only for today |
| **NOAA NWS** | **United States only** | Other regions return an error |

| Forecast model (Open-Meteo) | When to use | Limitations |
|---|---|---|
| **Best match** | Default. Picks the best local models automatically (ICON / ECMWF in Europe) | — |
| **ECMWF IFS** | Europe, longer range (days 3–7) | No UV index |
| **DWD ICON** | Central and Eastern Europe | No UV index |
| **NOAA GFS** | North America | — |
| **GEM** | North America | No UV index, visibility or CAPE |

> 🇺🇦 **Ukraine:** use **Open-Meteo + Best match**; switch to **ECMWF IFS** only if you prefer its longer-range forecast. NOAA NWS will not work here.

**Automatic location** uses GeoClue, then falls back to IP lookup. IP geolocation is accurate to the city level and can be far off with a VPN, mobile network, or corporate proxy — in that case disable it and pick your city manually.

---

## 💻 Compatibility

* **GNOME Shell:** 45, 46, 47, 48, 49, 50+
* **Session:** Wayland and X11

---

## 🗑️ Uninstallation

To remove GnomeMeteo (keeping your saved preferences):

```bash
curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/uninstall.sh | bash
```

To remove GnomeMeteo and purge all saved GSettings preferences:

```bash
bash ~/.local/share/gnome-shell/extensions/meteo@oleksiym.github.io/uninstall.sh --purge
```

---

## 📜 Acknowledgements & Lineage

GnomeMeteo is created and maintained by [OleksiyM](https://github.com/OleksiyM).
It is developed as a focused, modernized GNOME Shell extension evolved from the original [Weatherglass](https://github.com/vijaybala-lang/weatherglass) project created by Vijay Bala. Full lineage and copyright credit are preserved under the [GNU General Public License v3.0](LICENSE).
