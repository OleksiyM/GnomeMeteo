#!/usr/bin/env bash
# Builds the extension release package: dist/meteo@oleksiym.github.io.shell-extension.zip
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(./scripts/check-version.sh)
uuid="meteo@oleksiym.github.io"
dist_dir="dist"
zip_name="$uuid.shell-extension.zip"

printf '🔨 Building GnomeMeteo %s release package…\n' "$version"

# 1. Compile translations
./scripts/build-i18n.sh

# 2. Compile schemas
glib-compile-schemas --strict extension/schemas/

# 3. Validate JS syntax
node -c extension/*.js

# 4. Package zip bundle
rm -rf -- "$dist_dir"
mkdir -p "$dist_dir"

(
    cd extension
    # Exclude hidden files, git files, or editor temporaries
    zip -r -q "../$dist_dir/$zip_name" . -x ".*" -x "*~" -x "*.bak"
)

# 5. Generate checksum
(
    cd "$dist_dir"
    sha256sum "$zip_name" > SHA256SUMS
    sha256sum --check SHA256SUMS
)

printf '✅ Package built: %s/%s\n' "$dist_dir" "$zip_name"
