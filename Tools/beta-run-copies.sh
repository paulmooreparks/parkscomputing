#!/bin/sh
# Runs beta.parkscomputing.com against copies of production's folders, for
# testing a change that production's own files must not see yet, such as
# the move to XferLang 1.0 (Architecture/xferlang-1.0-migration.md).
#
#   sh Tools/beta-run-copies.sh
#
# This does what Tools/beta-run.sh does, with one difference: the folders
# beta-run.sh mounts writable from production (the live web root at
# /app/site, and home, etc and history) are copies under the ignored
# .local/beta/copies. The first run makes the copies; later runs keep them,
# so what was changed on beta while testing survives a rebuild. Delete
# .local/beta/copies to start again from production. content, images and
# audio stay read-only mounts of the live tree, as in beta-run.sh. Nothing
# here writes to the OneDrive tree.
#
# The copies of sitenav.xfer and etc/admin-menu.xfer are converted to
# XferLang 1.0 with the converter from the xfer-dotnet repository, and the
# staged web root gets the converted sitenav.xfer. Run Tools/beta-run.sh to
# go back to the normal beta.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot"
LIVE_PARENT="$(dirname "$LIVE")"
COPIES="$REPO/.local/beta/copies"
CONVERT="C:/Users/paul/source/repos/xfer-dotnet/tools/fixtures/convert-legacy.mjs"
NAME=parkscomputing-identity-test
ENV_FILE="$REPO/.local/beta/beta.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "No $ENV_FILE; run Tools/beta-run.sh once first." >&2
    exit 1
fi

# The copies, made once.
if [ ! -d "$COPIES" ]; then
    mkdir -p "$COPIES/site"
    for entry in "$LIVE"/*; do
        name="$(basename "$entry")"
        case "$name" in
            content|images|audio) mkdir -p "$COPIES/site/$name" ;;
            *) cp -r "$entry" "$COPIES/site/" ;;
        esac
    done
    for d in home etc history; do
        cp -r "$LIVE_PARENT/$d" "$COPIES/$d"
    done
    echo "Copied production's web root, home, etc and history to $COPIES."
fi

# A 0.x document in the copies becomes 1.0; one already converted is left.
to_1_0() {
    if ! head -c 12 "$1" | grep -q '^<! xfer 1'; then
        node "$CONVERT" "$1" "$1.converted"
        mv "$1.converted" "$1"
        echo "Converted $1 to XferLang 1.0."
    fi
}
to_1_0 "$COPIES/site/sitenav.xfer"
to_1_0 "$COPIES/etc/admin-menu.xfer"

(cd "$REPO/Application" && MSYS_NO_PATHCONV=1 docker build -q -t parkscomputing-local:beta -f parkscomputing-engine/Dockerfile . >/dev/null)
sh "$REPO/Tools/beta-webroot.sh"
cp "$COPIES/site/sitenav.xfer" "$REPO/.local/beta/wwwroot/sitenav.xfer"

W="$(cygpath -w "$REPO/.local/beta/wwwroot")"
L="$(cygpath -w "$LIVE")"
C="$(cygpath -w "$COPIES")"
CFG="$(cygpath -w "$LIVE_PARENT/config")"
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" --restart unless-stopped \
    --network parkscomputing-identity-test -p 127.0.0.1:8100:8080 \
    --env-file "$(cygpath -w "$ENV_FILE")" \
    -v parkscomputing-identity-test-state:/app/state \
    -v "$W:/app/wwwroot:ro" \
    -v "$L\\content:/app/wwwroot/content:ro" \
    -v "$L\\images:/app/wwwroot/images:ro" \
    -v "$L\\audio:/app/wwwroot/audio:ro" \
    -v "$C\\site:/app/site" \
    -v "$L\\content:/app/site/content:ro" \
    -v "$L\\images:/app/site/images:ro" \
    -v "$L\\audio:/app/site/audio:ro" \
    -v "$C\\home:/app/home" \
    -v "$C\\etc:/app/etc" \
    -v "$C\\history:/app/history" \
    -v "$CFG:/app/config:ro" \
    parkscomputing-local:beta >/dev/null
echo "Beta is running from parkscomputing-local:beta on 127.0.0.1:8100, on copies in $COPIES."
