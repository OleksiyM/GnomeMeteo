#!/bin/bash
# Install WeatherGlass: launcher symlink + desktop entry + icon.
# The app runs straight from this checkout — reinstall is never needed for
# code updates, only for relocation.
set -euo pipefail
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_ID="dev.vijaybala.weatherglassapp"

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"

mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICON_DIR"

ln -sf "$DIR/bin/weatherglass" "$BIN_DIR/weatherglass"
chmod +x "$DIR/bin/weatherglass"

sed "s|@PREFIX@|$DIR|" "$DIR/data/$APP_ID.desktop.in" > "$APPS_DIR/$APP_ID.desktop"
# App icon: rendered by tools/make-icon.js FROM the extension art pipeline
# (paintSky + drawScene), installed at every hicolor size; the retired
# hand-drawn SVG is removed so theme lookup can't prefer it.
rm -f "$ICON_DIR/$APP_ID.svg"
for sz in 32 48 64 96 128 256 512 1024; do
    d="${ICON_DIR%/scalable/apps}/${sz}x${sz}/apps"
    mkdir -p "$d"
    cp "$DIR/data/icons/$APP_ID-$sz.png" "$d/$APP_ID.png"
done

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache "${ICON_DIR%/scalable/apps}" || true

echo "Installed:"
echo "  $BIN_DIR/weatherglass"
echo "  $APPS_DIR/$APP_ID.desktop"
echo "Launch from the app grid, or run: weatherglass"
