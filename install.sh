#!/usr/bin/env bash
# GnomeMeteo per-user installer / updater for GNOME Shell 45+
#   Usage:
#     curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash
#     bash install.sh [--version v1.0.0]
# The entire script is wrapped in a function so `curl | bash` buffers it completely before execution.
gm_install() (
    set -euo pipefail
    fail() { printf '❌ Install failed: %s\n' "$*" >&2; exit 1; }
    trap 'printf "\n⚠️  Installation did not complete. See the error above.\n" >&2' ERR

    repo="OleksiyM/GnomeMeteo"
    uuid="meteo@oleksiym.github.io"
    dest_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
    tag=""

    while (($#)); do
        case "$1" in
            --version)
                [[ $# -ge 2 ]] || fail '--version requires a tag (e.g. v1.0.0)'
                tag="$2"; shift 2 ;;
            -h|--help)
                printf '%s\n' \
                    'Install or update GnomeMeteo for GNOME Shell 45+' \
                    'Usage: curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash' \
                    '   or: bash install.sh [--version v1.0.0]' \
                    '' \
                    'Options:' \
                    '  --version <tag>    Install a specific release (e.g. v1.0.0)' \
                    '  -h, --help         Show this help message'
                exit 0 ;;
            *) fail "Unknown option: $1" ;;
        esac
    done

    printf '%s\n' '========================================================' \
                  '  GnomeMeteo (Installer / Updater)' \
                  '========================================================'

    [[ $EUID -ne 0 ]] || fail 'Please run as regular user, not with sudo.'

    # Required tools
    for tool in curl unzip; do
        command -v "$tool" >/dev/null || fail "Missing required command: $tool"
    done

    # Check if running inside local repository
    script_dir=""
    if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
        script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fi

    if [[ -n "$script_dir" && -f "$script_dir/extension/metadata.json" && -z "$tag" ]]; then
        # ── LOCAL MODE (development / local checkout) ──
        printf '\n📁 Local checkout detected at %s\n' "$script_dir"

        if command -v msgfmt >/dev/null && [[ -x "$script_dir/scripts/build-i18n.sh" ]]; then
            "$script_dir/scripts/build-i18n.sh"
        fi

        if command -v glib-compile-schemas >/dev/null; then
            printf '🔨 Compiling GSettings schemas…\n'
            glib-compile-schemas --strict "$script_dir/extension/schemas/"
        fi

        printf '📦 Installing to %s…\n' "$dest_dir"
        rm -rf "$dest_dir"
        mkdir -p "$dest_dir"
        cp -r "$script_dir/extension"/* "$dest_dir/"
        if [[ -f "$script_dir/uninstall.sh" ]]; then
            cp "$script_dir/uninstall.sh" "$dest_dir/uninstall.sh"
            chmod +x "$dest_dir/uninstall.sh"
        fi
    else
        # ── REMOTE MODE (one-liner via curl | bash) ──
        download=(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300)

        if [[ -z "$tag" ]]; then
            printf '\n🔍 Checking for latest release…\n'
            latest=$("${download[@]}" --head --output /dev/null --write-out '%{url_effective}' "https://github.com/$repo/releases/latest" 2>/dev/null || true)
            if [[ "$latest" == *"releases/tag/"* ]]; then
                tag="${latest##*/}"
            fi
        fi

        temporary=$(mktemp -d /tmp/gnome-meteo-install.XXXXXXXX)
        trap 'rm -rf -- "$temporary"' EXIT

        archive="meteo@oleksiym.github.io.shell-extension.zip"

        if [[ -n "$tag" ]]; then
            url="https://github.com/$repo/releases/download/$tag/$archive"
            printf '📦 Downloading GnomeMeteo %s…\n' "$tag"
            "${download[@]}" --output "$temporary/$archive" "$url"
        else
            # Fallback if no release tag exists yet: fetch branch archive
            printf '📦 Downloading latest source package from main…\n'
            "${download[@]}" --output "$temporary/repo.tar.gz" "https://github.com/$repo/archive/refs/heads/main.tar.gz"
            tar -xzf "$temporary/repo.tar.gz" -C "$temporary"
            src_root=$(find "$temporary" -maxdepth 1 -type d -name "GnomeMeteo*" | head -n 1)
            [[ -n "$src_root" && -d "$src_root/extension" ]] || fail "Failed to extract repository source."

            if command -v msgfmt >/dev/null && [[ -x "$src_root/scripts/build-i18n.sh" ]]; then
                "$src_root/scripts/build-i18n.sh"
            fi
            if command -v glib-compile-schemas >/dev/null; then
                glib-compile-schemas --strict "$src_root/extension/schemas/"
            fi
            (
                cd "$src_root/extension"
                zip -r -q "$temporary/$archive" . -x ".*"
            )
        fi

        printf '🚀 Installing extension to %s…\n' "$dest_dir"
        rm -rf "$dest_dir"
        mkdir -p "$dest_dir"
        unzip -q "$temporary/$archive" -d "$dest_dir"

        # Preserve local uninstaller inside extension directory
        ref="${tag:-main}"
        "${download[@]}" --output "$dest_dir/uninstall.sh" "https://raw.githubusercontent.com/$repo/$ref/uninstall.sh" 2>/dev/null || \
            "${download[@]}" --output "$dest_dir/uninstall.sh" "https://raw.githubusercontent.com/$repo/main/uninstall.sh" 2>/dev/null || true
        [[ -f "$dest_dir/uninstall.sh" ]] && chmod +x "$dest_dir/uninstall.sh" || true
    fi

    # Compile schemas if gschemas.compiled is missing
    if [[ ! -f "$dest_dir/schemas/gschemas.compiled" ]] && command -v glib-compile-schemas >/dev/null; then
        glib-compile-schemas "$dest_dir/schemas/" 2>/dev/null || true
    fi

    # Enable extension live
    if command -v gnome-extensions >/dev/null; then
        printf '🔄 Activating extension in GNOME Shell…\n'
        gnome-extensions enable "$uuid" 2>/dev/null || true
    fi

    printf '\n%s\n' \
        '✨ GnomeMeteo installed and enabled successfully!' \
        '💡 To open settings: run gnome-extensions prefs meteo@oleksiym.github.io' \
        '   or click the gear button in the popup.' \
        "   To uninstall later: bash $dest_dir/uninstall.sh (or via curl)"
)
gm_install "$@"
