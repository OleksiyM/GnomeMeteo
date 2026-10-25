#!/usr/bin/env bash
# GnomeMeteo per-user uninstaller
#   Usage:
#     curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/uninstall.sh | bash
#     bash uninstall.sh [--purge]
gm_uninstall() (
    set -euo pipefail
    fail() { printf '❌ Uninstall failed: %s\n' "$*" >&2; exit 1; }

    uuid="meteo@oleksiym.github.io"
    desktop_id="io.github.oleksiym.meteo.desktop"
    data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
    dest_dir="$data_dir/gnome-shell/extensions/$uuid"
    purge="no"

    for arg in "$@"; do
        case "$arg" in
            --purge) purge="yes" ;;
            -h|--help)
                printf '%s\n' \
                    'Uninstall GnomeMeteo: bash uninstall.sh [--purge]' \
                    'Disables the GNOME Shell extension and removes installed files.' \
                    'GSettings preferences are kept unless --purge is supplied.'
                exit 0 ;;
            *) fail "Unknown option: $arg" ;;
        esac
    done

    printf '%s\n' '========================================================' \
                  '  GnomeMeteo (Uninstaller)' \
                  '========================================================'

    [[ $EUID -ne 0 ]] || fail 'Please run as regular desktop user, not with sudo.'
    [[ $data_dir == /* && $data_dir != / ]] || fail 'XDG_DATA_HOME must be an absolute, non-root path.'

    if command -v gnome-extensions >/dev/null; then
        printf '🛑 Disabling extension in GNOME Shell…\n'
        gnome-extensions disable "$uuid" 2>/dev/null || true
    fi

    # Remove GeoClue consent desktop stub if created by GnomeMeteo
    consent_file="$data_dir/applications/$desktop_id"
    if [[ -f "$consent_file" ]] && grep -q 'NoDisplay=true' "$consent_file" 2>/dev/null; then
        rm -f -- "$consent_file"
    fi

    # Remove pending update cache if any
    rm -rf -- "$data_dir/gnome-shell/extension-updates/$uuid"

    if [[ -d "$dest_dir" ]]; then
        printf '🗑️  Removing %s…\n' "$dest_dir"
        rm -rf -- "$dest_dir"
    else
        printf 'ℹ️  Extension directory not found at %s\n' "$dest_dir"
    fi

    if [[ "$purge" == "yes" ]]; then
        printf '🧹 Purging saved GSettings preferences…\n'
        if command -v dconf >/dev/null; then
            dconf reset -f /org/gnome/shell/extensions/meteo/ 2>/dev/null || true
        fi
    else
        printf '📝 Settings were kept (use --purge to remove them).\n'
    fi

    printf '✅ GnomeMeteo uninstalled successfully.\n'
)
gm_uninstall "$@"
