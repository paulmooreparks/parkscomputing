#!/bin/sh
# Stores the Turnstile widget's secret key for production (.env) and beta
# (.local/beta/beta.env), as Cloudflare's integration guide asks: the
# secret is read from the keyboard without echoing, never passed as an
# argument or printed, and checked with Cloudflare's siteverify before it
# is kept. A real secret answers a dummy token with invalid-input-response;
# a wrong one answers invalid-input-secret.
#
# Run it yourself in a terminal: sh Tools/turnstile-secret.sh
# Then recreate the containers so they read it:
#   docker compose up -d parkscomputing      (production)
#   sh Tools/beta-run.sh                     (beta)
set -eu
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$REPO/.env"
BETA="$REPO/.local/beta/beta.env"

printf 'Turnstile secret key (it will not be shown): '
stty -echo 2>/dev/null || true
read -r SECRET
stty echo 2>/dev/null || true
printf '\n'
[ -n "$SECRET" ] || { echo "Nothing entered; nothing changed."; exit 1; }

# The secret goes to curl on its standard input, not its command line.
ANSWER=$(printf 'secret=%s&response=XXXX.DUMMY.TOKEN.XXXX' "$SECRET" |
    curl -s --data-binary @- -H 'Content-Type: application/x-www-form-urlencoded' \
    https://challenges.cloudflare.com/turnstile/v0/siteverify)
case "$ANSWER" in
    *invalid-input-secret*) echo "Cloudflare does not know that secret. Nothing changed."; exit 1 ;;
    *invalid-input-response*|*timeout-or-duplicate*) ;;
    *) echo "Cloudflare's answer was unexpected, so nothing changed."; exit 1 ;;
esac

# Replace any earlier value, then add this one. sed never sees the secret.
for pair in "$ENV:TURNSTILE_SECRET_KEY" "$BETA:Accounts__TurnstileSecret"; do
    file="${pair%%:*}"; name="${pair#*:}"
    [ -f "$file" ] || continue
    grep -v "^$name=" "$file" > "$file.tmp" || true
    mv "$file.tmp" "$file"
    printf '%s=%s\n' "$name" "$SECRET" >> "$file"
done
unset SECRET
echo "Stored for production and beta. Recreate the containers to use it."
