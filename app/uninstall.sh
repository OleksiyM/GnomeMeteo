#!/bin/bash
# Remove the launcher, desktop entry, and icon. Keeps ~/.config/weatherglass.
set -euo pipefail
APP_ID="dev.vijaybala.weatherglassapp"
rm -f "${XDG_BIN_HOME:-$HOME/.local/bin}/weatherglass"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/$APP_ID.desktop"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/$APP_ID.svg"
echo "Removed. Your city list remains in ~/.config/weatherglass/config.json"
echo "(delete it too if you want a clean slate)."
