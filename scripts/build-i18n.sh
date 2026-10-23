#!/usr/bin/env bash
# Build gettext catalogs (.mo) from po/*.po into extension/locale/<lang>/LC_MESSAGES/<uuid>.mo
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="meteo@oleksiym.github.io"
PO_DIR="$REPO_ROOT/po"
LOCALE_DIR="$REPO_ROOT/extension/locale"

command -v msgfmt >/dev/null || { printf 'Error: msgfmt not found.\n' >&2; exit 1; }

printf '🌐 Compiling gettext translations for %s…\n' "$UUID"

while read -r lang; do
    [[ -n "$lang" && ! "$lang" =~ ^# ]] || continue
    po_file="$PO_DIR/$lang.po"
    [[ -f "$po_file" ]] || continue

    target_dir="$LOCALE_DIR/$lang/LC_MESSAGES"
    mkdir -p "$target_dir"
    target_mo="$target_dir/$UUID.mo"

    msgfmt --check-format -o "$target_mo" "$po_file"
    printf '  [%s] -> %s ' "$lang" "$target_mo"
    msgfmt --statistics -o /dev/null "$po_file" 2>&1 || true
done < "$PO_DIR/LINGUAS"

printf '✅ Translations compiled successfully!\n'
