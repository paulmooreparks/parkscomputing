#!/bin/sh
# Stages the web root of beta.parkscomputing.com, the site with accounts
# (Architecture/unified-identity-design.md, "Beta site with accounts").
#
#   sh Tools/beta-webroot.sh
#
# Beta shows the live site, so its web root starts as the live tree in
# OneDrive, with the account assets and the PUDL release from this checkout
# laid over it. The live tree itself is never written. The large folders,
# content, images and audio, are not copied: the beta container mounts them
# read-only from OneDrive (Tools/beta-run.sh), so articles stay current.
# Everything else here, sitenav.xfer included, is a copy as of this run, so
# run it again after changing those, and after changing the overlay files.
set -eu

LIVE="C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO/Application/parkscomputing-engine/wwwroot"
DST="$REPO/.local/beta/wwwroot"

# The repository's files that beta needs and the live tree lacks or has
# older: the account surfaces, the applet registry that names the Account
# applet, the terminal whose prompt names the host it runs on, the mount
# and editor that ask a signed-out reader to sign in again, and the pinned
# PUDL release. A static deploy to the live tree makes these the
# same there, after which they can leave this list.
OVERLAY="js/accounts.js js/account.js js/applets.js js/terminal.js js/sitefs.js js/terminal-text.js css/terminal.css js/editor.js js/files.js js/diff.js js/theme-studio.js js/window-bar.js js/commands.js js/pins.js js/pins-manager.js css/account.css css/pins-manager.css css/pudl-site.css pudl js/sudoku.js js/settings.js js/barcode-tool.js js/barcode-scanner.js js/barcode-lookup-ui.js css/barcode-tool.css css/barcode-scanner.css theme-studio/preview.html js/comments.js js/moderation.js css/comments.css js/status.js js/status"

rm -rf "$DST"
mkdir -p "$DST"
for entry in "$LIVE"/*; do
    name="$(basename "$entry")"
    case "$name" in
        content|images|audio) mkdir -p "$DST/$name" ;;
        *) cp -r "$entry" "$DST/" ;;
    esac
done
for item in $OVERLAY; do
    rm -rf "$DST/$item"
    mkdir -p "$(dirname "$DST/$item")"
    cp -r "$SRC/$item" "$DST/$item"
done
echo "Staged $DST from $LIVE, with $OVERLAY from this checkout."
