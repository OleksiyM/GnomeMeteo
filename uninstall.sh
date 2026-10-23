#!/usr/bin/env bash
# GnomeMeteo uninstaller
set -euo pipefail

UUID="meteo@oleksiym.github.io"
DEST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
PURGE=no

for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=yes ;;
        -h|--help)
            printf '%s\n' "Usage: bash uninstall.sh [--purge]" \
                          "Disables and removes GnomeMeteo." \
                          "--purge: Also reset gsettings preferences."
            exit 0 ;;
        *) printf 'Unknown option: %s\n' "$arg" >&2; exit 1 ;;
    esac
done

printf '%s\n' '========================================================' \
              '  GnomeMeteo (Uninstaller)' \
              '========================================================'

if command -v gnome-extensions >/dev/null; then
    printf '🛑 Disabling extension…\n'
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

printf '🗑️  Removing extension directory…\n'
rm -rf "$DEST_DIR"

if [[ "$PURGE" == "yes" ]]; then
    printf '🧹 Purging GSettings configuration…\n'
    gsettings reset-recursively org.gnome.shell.extensions.meteo 2>/dev/null || true
fi

printf '\n✅ GnomeMeteo successfully uninstalled.\n'
