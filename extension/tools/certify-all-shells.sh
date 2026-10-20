#!/usr/bin/env bash
# tools/certify-all-shells.sh -- release certification for every GNOME
# Shell major declared in metadata.json.
#
# tools/certify.sh proves the host shell and builds the dist zip. Every
# other declared major then runs tools/qa/run-old-shell.sh against that
# same zip in the Fedora guest that ships it (Fedora N -> GNOME N+6).
# A declared major with no green run is a failed release gate, never a
# skipped footnote: support is exactly the set that certified.
set -u
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ" || exit 1

fail() {
    echo "certify-all-shells: FAIL: $*" >&2
    exit 1
}

command -v gnome-shell >/dev/null 2>&1 \
    || fail 'no host gnome-shell found; the host major cannot be certified'
HOST_MAJOR=$(gnome-shell --version | sed -n 's/^GNOME Shell \([0-9][0-9]*\)\..*/\1/p')
[ -n "$HOST_MAJOR" ] || fail "could not parse host shell version: $(gnome-shell --version)"

VERSION_TEXT=$(python3 - <<'PY'
import json
meta = json.load(open('metadata.json', encoding='utf-8'))
versions = meta.get('shell-version')
if not isinstance(versions, list) or not versions:
    raise SystemExit('metadata.json: shell-version must be a non-empty list')
seen = set()
for version in versions:
    if not isinstance(version, str) or not version.isdigit():
        raise SystemExit(f'metadata.json: bad shell-version entry {version!r}')
    if version in seen:
        raise SystemExit(f'metadata.json: duplicate shell-version entry {version!r}')
    seen.add(version)
    print(version)
PY
) || fail 'metadata.json shell-version is unreadable or invalid'
mapfile -t VERSIONS <<<"$VERSION_TEXT"
[ "${#VERSIONS[@]}" -gt 0 ] || fail 'metadata.json declares no shell versions'

HOST_DECLARED=0
for version in "${VERSIONS[@]}"; do
    [ "$version" = "$HOST_MAJOR" ] && HOST_DECLARED=1
done
[ "$HOST_DECLARED" -eq 1 ] \
    || fail "host GNOME Shell $HOST_MAJOR is not declared in metadata.json (${VERSIONS[*]})"

echo "==> declared shells: ${VERSIONS[*]}; host: $HOST_MAJOR"
if ! bash tools/certify.sh; then
    echo "NOT CERTIFIED (all declared shells): host GNOME Shell $HOST_MAJOR failed" >&2
    exit 1
fi

UUID=$(python3 -c "import json; print(json.load(open('metadata.json', encoding='utf-8'))['uuid'])") \
    || fail 'metadata.json uuid is unreadable'
ZIP="$PROJ/dist/$UUID.zip"
[ -f "$ZIP" ] || fail "host certification produced no $ZIP"
ZIP_SHA=$(sha256sum "$ZIP" | awk '{print $1}')
echo "==> certified artifact: $ZIP"
echo "==> sha256: $ZIP_SHA"

FAILED=0
PASSED=("$HOST_MAJOR")
for version in "${VERSIONS[@]}"; do
    [ "$version" = "$HOST_MAJOR" ] && continue
    if [ "$version" -lt 45 ]; then
        echo "==> GNOME Shell $version: FAIL (below this codebase's GNOME 45 floor; drop it or add a guest recipe)" >&2
        FAILED=$((FAILED + 1))
        continue
    fi
    release=$((version - 6))
    echo
    echo "==> GNOME Shell $version guest cert (Fedora $release)"
    if bash tools/qa/run-old-shell.sh "$release"; then
        PASSED+=("$version")
    else
        echo "==> GNOME Shell $version: FAIL" >&2
        FAILED=$((FAILED + 1))
    fi
    CURRENT_SHA=$(sha256sum "$ZIP" | awk '{print $1}')
    if [ "$CURRENT_SHA" != "$ZIP_SHA" ]; then
        echo "certify-all-shells: FAIL: dist zip changed during guest certification" >&2
        echo "  before: $ZIP_SHA" >&2
        echo "  after:  $CURRENT_SHA" >&2
        exit 1
    fi
done

echo
if [ "$FAILED" -eq 0 ]; then
    echo "CERTIFIED (all declared shells): ${PASSED[*]}"
    echo "artifact: $ZIP"
    echo "sha256: $ZIP_SHA"
else
    echo "NOT CERTIFIED (all declared shells): $FAILED declared shell(s) failed; passed: ${PASSED[*]}" >&2
fi
exit "$FAILED"
