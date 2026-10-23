#!/usr/bin/env bash
# GnomeMeteo per-user uninstaller
#   Usage:
#     curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/uninstall.sh | bash
#     bash uninstall.sh
gm_uninstall() (
    set -euo pipefail
    uuid="meteo@oleksiym.github.io"
    dest_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

    printf '%s\n' '========================================================' \
                  '  GnomeMeteo (Uninstaller)' \
                  '========================================================'

    if command -v gnome-extensions >/dev/null; then
        printf '🛑 Disabling extension in GNOME Shell…\n'
        gnome-extensions disable "$uuid" 2>/dev/null || true
    fi

    if [[ -d "$dest_dir" ]]; then
        printf '🗑️  Removing %s…\n' "$dest_dir"
        rm -rf "$dest_dir"
        printf '✅ GnomeMeteo uninstalled successfully.\n'
    else
        printf 'ℹ️  Extension directory not found at %s\n' "$dest_dir"
    fi
)
gm_uninstall "$@"
