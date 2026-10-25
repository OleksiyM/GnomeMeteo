#!/usr/bin/env bash
# GnomeMeteo per-user installer / updater for GNOME Shell 45+
#   Usage:
#     curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash
#     bash install.sh [--version v1.0.1] [--require-provenance]
# The entire script is wrapped in a function so `curl | bash` buffers it completely before execution.
gm_install() (
    set -euo pipefail
    fail() { printf '❌ Install failed: %s\n' "$*" >&2; exit 1; }
    trap 'printf "\n⚠️  Installation did not complete. See the error above.\n" >&2' ERR

    repo="OleksiyM/GnomeMeteo"
    uuid="meteo@oleksiym.github.io"
    data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
    dest_dir="$data_dir/gnome-shell/extensions/$uuid"
    tag=""
    require_provenance="no"

    while (($#)); do
        case "$1" in
            --version)
                [[ $# -ge 2 ]] || fail '--version requires a tag (e.g. v1.0.1)'
                tag="$2"; shift 2 ;;
            --require-provenance)
                require_provenance="yes"; shift ;;
            -h|--help)
                printf '%s\n' \
                    'Install or update GnomeMeteo for GNOME Shell 45+' \
                    'Usage: curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash' \
                    '   or: bash install.sh [--version v1.0.1] [--require-provenance]' \
                    '' \
                    'Options:' \
                    '  --version <tag>        Install a specific release (e.g. v1.0.1)' \
                    '  --require-provenance   Require cryptographic SLSA provenance verification via gh' \
                    '  -h, --help             Show this help message'
                exit 0 ;;
            *) fail "Unknown option: $1" ;;
        esac
    done

    printf '%s\n' '========================================================' \
                  '  GnomeMeteo (Installer / Updater)' \
                  '========================================================'

    [[ $EUID -ne 0 ]] || fail 'Please run as regular desktop user, not with sudo.'
    [[ $data_dir == /* && $data_dir != / ]] || fail 'XDG_DATA_HOME must be an absolute, non-root path.'

    # Check if running inside local repository
    script_dir=""
    if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
        script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fi

    if [[ -n "$script_dir" && -f "$script_dir/extension/metadata.json" && -z "$tag" && "$require_provenance" == "no" ]]; then
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
        rm -rf -- "$dest_dir" "$data_dir/gnome-shell/extension-updates/$uuid"
        mkdir -p "$dest_dir"
        cp -R "$script_dir/extension"/. "$dest_dir/"
        if [[ -f "$script_dir/uninstall.sh" ]]; then
            install -m 0755 "$script_dir/uninstall.sh" "$dest_dir/uninstall.sh"
        fi
    else
        # ── REMOTE MODE (signed release package) ──
        for tool in curl unzip sha256sum awk install mktemp; do
            command -v "$tool" >/dev/null || fail "Missing required command: $tool"
        done

        download=(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 300)

        if [[ -z "$tag" ]]; then
            printf '\n🔍 Checking for latest release…\n'
            latest=$("${download[@]}" --head --output /dev/null --write-out '%{url_effective}' "https://github.com/$repo/releases/latest" 2>/dev/null || true)
            [[ "$latest" == "https://github.com/$repo/releases/tag/"* ]] || fail 'No stable release found.'
            tag="${latest##*/}"
        fi
        [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail "Expected a stable semantic tag such as v1.0.1 (got: $tag)."

        temporary=$(mktemp -d /tmp/gnome-meteo-install.XXXXXXXX)
        trap 'rm -rf -- "$temporary"' EXIT

        archive="$uuid.shell-extension.zip"
        base_url="https://github.com/$repo/releases/download/$tag"

        printf '📦 Downloading GnomeMeteo %s…\n' "$tag"
        "${download[@]}" --output "$temporary/$archive" "$base_url/$archive"
        "${download[@]}" --output "$temporary/SHA256SUMS" "$base_url/SHA256SUMS"

        printf '🔒 Verifying SHA-256 checksum…\n'
        hash=$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1 }' "$temporary/SHA256SUMS")
        [[ "$hash" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'Missing or invalid archive checksum in SHA256SUMS.'
        (cd "$temporary"; printf '%s  %s\n' "$hash" "$archive" | sha256sum --check --status -) || fail 'SHA-256 mismatch! Nothing installed.'
        printf '✅ SHA-256 verified.\n'

        # Probe gh attestation verify capabilities
        verify="no"
        if command -v gh >/dev/null && help=$(gh attestation verify --help 2>/dev/null); then
            verify="yes"
            for option in --bundle --repo --signer-workflow --source-ref --cert-oidc-issuer --deny-self-hosted-runners --predicate-type; do
                [[ "$help" == *"$option"* ]] || verify="no"
            done
        fi

        if [[ "$verify" == "yes" ]]; then
            printf '🛡️  Verifying SLSA release provenance…\n'
            "${download[@]}" --output "$temporary/$archive.sigstore.json" "$base_url/$archive.sigstore.json"
            gh attestation verify "$temporary/$archive" \
                --bundle "$temporary/$archive.sigstore.json" \
                --repo "$repo" \
                --signer-workflow "$repo/.github/workflows/release.yml" \
                --source-ref "refs/tags/$tag" \
                --cert-oidc-issuer "https://token.actions.githubusercontent.com" \
                --deny-self-hosted-runners \
                --predicate-type "https://slsa.dev/provenance/v1"
            printf '✅ SLSA provenance verified.\n'
        elif [[ "$require_provenance" == "yes" ]]; then
            fail '--require-provenance requires GitHub CLI (gh) with attestation support. Install or update gh and rerun.'
        else
            printf 'ℹ️  Provenance check skipped (gh CLI not installed or outdated). SHA-256 integrity passed.\n'
        fi

        # Extract into staging directory first to validate package contents before touching live installation
        staging="$temporary/staging"
        mkdir -p "$staging"
        unzip -q "$temporary/$archive" -d "$staging"

        for required_file in metadata.json extension.js indicator.js weather.js prefs.js stylesheet.css schemas/org.gnome.shell.extensions.meteo.gschema.xml; do
            [[ -f "$staging/$required_file" ]] || fail "Archive is missing required file: $required_file. Nothing installed."
        done

        printf '🚀 Installing extension to %s…\n' "$dest_dir"
        rm -rf -- "$dest_dir" "$data_dir/gnome-shell/extension-updates/$uuid"
        mkdir -p "$dest_dir"
        cp -R "$staging"/. "$dest_dir/"

        # Preserve local uninstaller inside extension directory
        "${download[@]}" --output "$dest_dir/uninstall.sh" "https://raw.githubusercontent.com/$repo/$tag/uninstall.sh" 2>/dev/null || \
            "${download[@]}" --output "$dest_dir/uninstall.sh" "https://raw.githubusercontent.com/$repo/main/uninstall.sh" 2>/dev/null || true
        if [[ -f "$dest_dir/uninstall.sh" ]]; then
            chmod 0755 "$dest_dir/uninstall.sh"
        fi
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
        "   To uninstall later: bash $dest_dir/uninstall.sh [--purge]"
)
gm_install "$@"
