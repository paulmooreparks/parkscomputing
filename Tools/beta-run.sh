#!/bin/sh
# Runs beta.parkscomputing.com, the site with accounts
# (Architecture/unified-identity-design.md, "Beta site with accounts").
#
#   sh Tools/beta-run.sh
#
# Builds parkscomputing-local:beta from this checkout, stages the web root
# (Tools/beta-webroot.sh) and replaces the beta container with one from the
# new image. The container listens on loopback port 8100, which cloudflared
# routes beta.parkscomputing.com to, on the beta's own network beside its
# own SQL Server. Its settings, which hold credentials, live in the ignored
# .local/beta/beta.env; the first run copies them from the container it
# replaces, and nothing here prints them. Running this does not change
# production, but the super-user's tools on beta edit the live site (below).
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="C:/Users/paul/OneDrive/Documents/parkscomputing.com/wwwroot"
NAME=parkscomputing-identity-test
ENV_FILE="$REPO/.local/beta/beta.env"

mkdir -p "$REPO/.local/beta"
if [ ! -f "$ENV_FILE" ]; then
    # The image supplies the runtime's own settings and the web root, so
    # those are left out.
    docker inspect "$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' |
        grep -v -e '^PATH=' -e '^DOTNET_' -e '^ASPNET_VERSION=' -e '^APP_UID=' -e '^ASPNETCORE_HTTP_PORTS=' -e '^ASPNETCORE_WEBROOT=' -e '^$' > "$ENV_FILE"
    echo "Saved the beta container's settings to $ENV_FILE."
fi

(cd "$REPO/Application" && MSYS_NO_PATHCONV=1 docker build -q -t parkscomputing-local:beta -f parkscomputing-engine/Dockerfile . >/dev/null)
sh "$REPO/Tools/beta-webroot.sh"

W="$(cygpath -w "$REPO/.local/beta/wwwroot")"
L="$(cygpath -w "$LIVE")"
# The super-user's server tools work on the live site, as the edit origin's
# do: /wwwroot is the live tree, writable (Admin__SiteRoot=/app/site in the
# settings), and ~, /etc, the history of changed files and the SSH
# destinations are production's own folders beside it. A file saved here
# changes parkscomputing.com. Beta serves its staged copy, so a change to
# content, images or audio shows on beta at once, and a change to anything
# else after the next run of Tools/beta-webroot.sh.
S="$(cygpath -w "$(dirname "$LIVE")")"
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" --restart unless-stopped \
    --network parkscomputing-identity-test -p 127.0.0.1:8100:8080 \
    --env-file "$(cygpath -w "$ENV_FILE")" \
    -v parkscomputing-identity-test-state:/app/state \
    -v "$W:/app/wwwroot:ro" \
    -v "$L\\content:/app/wwwroot/content:ro" \
    -v "$W\\content\\desktop-welcome.md:/app/wwwroot/content/desktop-welcome.md:ro" \
    -v "$L\\images:/app/wwwroot/images:ro" \
    -v "$L\\audio:/app/wwwroot/audio:ro" \
    -v "$L:/app/site" \
    -v "$S\\home:/app/home" \
    -v "$S\\etc:/app/etc" \
    -v "$S\\history:/app/history" \
    -v "$S\\config:/app/config:ro" \
    parkscomputing-local:beta >/dev/null
echo "Beta is running from parkscomputing-local:beta on 127.0.0.1:8100."
