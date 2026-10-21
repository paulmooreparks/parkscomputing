#!/bin/sh
# Runs xfer.parkscomputing.com, the home of XferLang, on this engine
# (Architecture/xfer-site-engine.md, Architecture/site-engine-layers.md).
#
#   sh Tools/xfer-run.sh
#
# Builds parkscomputing-local:xfer from this checkout and replaces the
# xfer-site container with one from it, on loopback port 8094, which the
# cloudflared tunnel routes xfer.parkscomputing.com to. The site's own tree
# is the xfer-site repository's site/ folder, mounted read-only as the web
# root, so what is served is what is committed there; the engine's scripts,
# styles and PUDL come from the image behind it (Site:Assets). The site is
# in desktop mode with staff accounts only, in its own database, XferSite,
# on the same SQL Server as the other sites. Its settings, which hold the
# database's credentials, live in C:\Users\paul\.config\docker-sites\xfer.env,
# outside the repository; the first run makes the file from padmajairam.com's
# connection string with only the database changed, and nothing here prints it.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="C:/Users/paul/source/repos/xfer-site/site"
NAME=xfer-site
PORT=8094
ENV_FILE="C:/Users/paul/.config/docker-sites/xfer.env"

if [ ! -f "$ENV_FILE" ]; then
    docker inspect padmajairam-preview --format '{{range .Config.Env}}{{println .}}{{end}}' |
        grep '^AUTH_CONNECTION_STRING=' | sed 's/Database=[^;]*/Database=XferSite/' > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "Made $ENV_FILE."
fi

(cd "$REPO/Application" && MSYS_NO_PATHCONV=1 docker build -q -t parkscomputing-local:xfer -f parkscomputing-engine/Dockerfile . >/dev/null)

docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" --restart unless-stopped \
    --network parkscomputing_default -p "127.0.0.1:$PORT:8080" \
    --env-file "$(cygpath -w "$ENV_FILE")" \
    -e ASPNETCORE_ENVIRONMENT=Production \
    -e ASPNETCORE_WEBROOT=/app/site \
    -e Site__Assets=/app/wwwroot \
    -e Site__Mode=desktop \
    -e Site__Origin=https://xfer.parkscomputing.com \
    -e Accounts__Enabled=true \
    -e Accounts__StaffEnabled=true \
    -e Accounts__Registration=false \
    -e Accounts__Origin=https://xfer.parkscomputing.com \
    -e Accounts__SiteName=XferLang \
    -v "$(cygpath -w "$SITE"):/app/site:ro" \
    parkscomputing-local:xfer >/dev/null
echo "xfer.parkscomputing.com is running from parkscomputing-local:xfer on 127.0.0.1:$PORT."
