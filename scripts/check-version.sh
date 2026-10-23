#!/usr/bin/env bash
# Verifies that metadata.json version-name matches git tag, if given as $1 (vX.Y.Z)
set -euo pipefail
cd "$(dirname "$0")/.."

ext_version=$(python3 -c 'import json; print(json.load(open("extension/metadata.json"))["version-name"])')

[[ "$ext_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
    echo "metadata.json version-name is not X.Y.Z: $ext_version" >&2
    exit 1
}

if [[ -n "${1:-}" ]]; then
    tag_clean="${1#v}"
    [[ "$tag_clean" == "$ext_version" ]] || {
        echo "Tag $1 does not match metadata.json version-name $ext_version" >&2
        exit 1
    }
fi

echo "$ext_version"
