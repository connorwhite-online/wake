#!/bin/sh
# wake container entrypoint: make sure the volume has a workspace, then serve.
set -e

WAKE_SPACE="${WAKE_SPACE:-/data/workspace}"
mkdir -p "$WAKE_SPACE"

# Empty volume (fresh or init-only)? Bootstrap from the workspace committed in
# the repo image when there is one, else scaffold a blank workspace.
if [ -z "$(ls -A "$WAKE_SPACE/projects" 2>/dev/null)" ]; then
  if [ -d /app/workspace/projects ] && [ "${WAKE_BOOTSTRAP:-1}" = "1" ]; then
    echo "wake: bootstrapping workspace from the repo's workspace/"
    cp -R /app/workspace/. "$WAKE_SPACE"/
  else
    node /app/packages/wake/dist/cli.js init --space "$WAKE_SPACE"
  fi
fi

# git sync needs a repo; the bootstrap copy arrives without one
if [ ! -d "$WAKE_SPACE/.git" ]; then
  git -C "$WAKE_SPACE" init -q
  git -C "$WAKE_SPACE" -c user.name=wake -c user.email=wake@localhost add -A
  git -C "$WAKE_SPACE" -c user.name=wake -c user.email=wake@localhost commit -qm "wake: bootstrap" >/dev/null 2>&1 || true
fi

exec node /app/packages/wake/dist/cli.js serve --space "$WAKE_SPACE" --port "${PORT:-8722}"
