#!/bin/sh
# Installs the Claude Agent ACP adapter, for the Chat's claude provider
# (Architecture/chat-design.md), into the volume mounted at /app/claude-agent.
# The image carries only the adapter's package.json and lockfile, since
# Anthropic's Agent SDK brings the Claude Code executable, which the image
# may not redistribute. Run it once for each release of the image:
#
#   docker run --rm --entrypoint /app/install-claude-agent \
#     -v parkscomputing-claude-agent:/app/claude-agent <image>
#
# npm installs exactly what the lockfile pins, checks each package against
# the lockfile's hash, and runs no package scripts. The last step records
# the lockfile's hash, which the chat compares with the image's own before
# it starts the adapter, so an install that stopped part way, or one made
# for another release, is refused rather than run.
set -eu

release=/app/claude-agent-release
dest=/app/claude-agent

if ! grep -q " $dest " /proc/mounts; then
    echo "Nothing is mounted at $dest; mount the adapter's volume there." >&2
    exit 1
fi

cd "$dest"
rm -rf node_modules .release-lock-sha256
cp "$release/package.json" "$release/package-lock.json" .
npm ci --ignore-scripts --no-audit --no-fund --no-update-notifier
test -f node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js
test -x node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude
# npm installs the musl build of the executable beside the glibc one. The
# image is glibc (Ubuntu), so the musl build, a quarter of a gigabyte, goes.
rm -rf node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl
sha256sum package-lock.json | cut -d' ' -f1 > .release-lock-sha256
echo "The Claude adapter is installed for lockfile $(cat .release-lock-sha256)."
