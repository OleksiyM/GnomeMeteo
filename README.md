# GnomeMeteo

> **Elegant weather indicator and forecast for GNOME Shell 45+**

GnomeMeteo is a lightweight, modern weather extension for the GNOME desktop, featuring an iOS Weather-inspired popup, native Libadwaita styling, multi-provider weather forecasts, and smooth segmented metric switching.

![GnomeMeteo Preview](screenshots/screenshot-1.png)

---

## ✨ Features

* **Visual Hierarchy:** Clean 3-tier main condition block (prominent temperature, condition name, daily max/min range, feels-like).
* **Segmented Metric Switcher:** Instantly toggle between **Temperature**, **Precipitation Probability**, and **Wind Speed** across both hourly and daily views.
* **Native Libadwaita Gradients:** Smooth daily temperature range bars built with native St gradient syntax.
* **Compact 2×2 Details Grid:** At-a-glance cards with monochrome Adwaita symbolic icons for:
  * 🌅 Sunrise & Sunset
  * 🌔 Moon Phase (astronomically computed with illumination %)
  * 💧 Humidity & Dew Point
  * 🧭 Atmospheric Pressure (mmHg)
* **Zero Precipitation De-emphasis:** Days with 0% rain probability are gracefully dimmed to highlight relevant weather.
* **Keyless Multi-Provider Support:**
  * **Open-Meteo** (global, with choice of prediction models: ECMWF IFS, DWD ICON, GFS, etc.)
  * **MET Norway** (api.met.no, CC BY-SA 4.0)
  * **NOAA NWS** (United States official forecasts)
* **Clean Single-Page Preferences:** Fast, scrollable Libadwaita settings dialog with instant top-bar indicator toggles and localized city search.
* **Privacy by Design:** No tracking, no accounts, no API keys. Direct requests to public meteorological APIs.

---

## 💻 Compatibility

* **GNOME Shell:** 45, 46, 47, 48, 49, 50+
* **Session:** Wayland and X11

---

## 🚀 Installation

Clone the repository and run the installer:

```bash
git clone https://github.com/OleksiyM/GnomeMeteo.git
cd GnomeMeteo
bash install.sh
```

The script will compile the GSettings schemas, install the extension to `~/.local/share/gnome-shell/extensions/meteo@oleksiym.github.io/`, and enable it.

> [!NOTE]
> If you are installing for the first time, you may need to log out and log back in (or restart GNOME Shell) to register the new extension UUID.

---

## 🗑️ Uninstallation

To remove GnomeMeteo:

```bash
bash uninstall.sh
```

To also purge saved settings and GSettings configuration:

```bash
bash uninstall.sh --purge
```

---

## ⚙️ Configuration

Open settings either from the popup menu (top-right cog button) or via terminal:

```bash
gnome-extensions prefs meteo@oleksiym.github.io
```

Available options:
* **Location:** Automatic (GeoClue / IP geolocation) or manual search by city name with localized results.
* **Panel Indicator:** Show/hide temperature number and weather icon in the top panel.
* **Units & Format:** Metric (°C, km/h) / Imperial (°F, mph), language selection (Auto, Ukrainian, Russian, English), 12h/24h time format.
* **Provider & Models:** Open-Meteo model fine-tuning (ECMWF, ICON, GFS, GEM, JMA, UKMO) and background refresh intervals (5–120 minutes).

---

## 🤝 Acknowledgements & Lineage

**GnomeMeteo** is a redesigned, modernized evolution based on [Weatherglass](https://github.com/vijaybala-lang/weatherglass) by [Vijay Bala](https://github.com/vijaybala-lang).

Deep appreciation to the original author for the keyless weather multi-provider architecture and lunar phase calculations. GnomeMeteo carries forward this foundation with an entirely reimagined UI, native Libadwaita preferences, St CSS styling, and unified symbolic aesthetics.

---

## 📄 License

GnomeMeteo is free software licensed under the **GNU General Public License v2.0 or later** (GPL-2.0-or-later). See [LICENSE](LICENSE) for details.
