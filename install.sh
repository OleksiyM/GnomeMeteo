#!/usr/bin/env bash
# GnomeMeteo installer for GNOME Shell 45+
set -euo pipefail

UUID="meteo@oleksiym.github.io"
DEST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$REPO_ROOT/extension"

printf '%s\n' '========================================================' \
              '  GnomeMeteo (Installer)' \
              '========================================================'

[[ $EUID -ne 0 ]] || { printf 'Please run as regular user, not with sudo.\n' >&2; exit 1; }

command -v gnome-extensions >/dev/null || { printf 'Error: gnome-extensions command not found.\n' >&2; exit 1; }
command -v glib-compile-schemas >/dev/null || { printf 'Error: glib-compile-schemas not found.\n' >&2; exit 1; }

if command -v msgfmt >/dev/null && [[ -x "$REPO_ROOT/scripts/build-i18n.sh" ]]; then
    "$REPO_ROOT/scripts/build-i18n.sh"
fi

printf '🔨 Compiling GSettings schemas…\n'
glib-compile-schemas "$SRC_DIR/schemas/"

printf '📦 Installing extension to %s…\n' "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -r "$SRC_DIR"/* "$DEST_DIR/"

printf '🔄 Enabling extension…\n'
gnome-extensions enable "$UUID" 2>/dev/null || true

printf '\n✅ GnomeMeteo installed and enabled successfully!\n'
printf '💡 If you are installing for the first time, you may need to log out and log back in (or restart GNOME Shell).\n'
