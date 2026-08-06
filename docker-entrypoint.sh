#!/bin/sh
# wake container entrypoint: make sure the home has at least one space, then serve.
set -e

WAKE_HOME="${WAKE_HOME:-/data}"
export WAKE_HOME
mkdir -p "$WAKE_HOME/spaces"

# A pre-spaces volume mounted one workspace at $WAKE_HOME/workspace; the server
# folds it into spaces/<name> on boot. Nothing to do here but let it run.

# Still empty? Bootstrap from the space committed in the repo image when there
# is one, else create a blank space so the UI has somewhere to land.
if [ -z "$(ls -A "$WAKE_HOME/spaces" 2>/dev/null)" ] && [ ! -d "$WAKE_HOME/workspace/projects" ]; then
  if [ -d /app/workspace/projects ] && [ "${WAKE_BOOTSTRAP:-1}" = "1" ]; then
    echo "wake: bootstrapping the 'wake' space from the repo's workspace/"
    mkdir -p "$WAKE_HOME/spaces/wake"
    cp -R /app/workspace/. "$WAKE_HOME/spaces/wake"/
    rm -rf "$WAKE_HOME/spaces/wake/.wake"
  else
    node /app/packages/wake/dist/cli.js space new "${WAKE_FIRST_SPACE:-Home}"
  fi
fi

# git sync needs a repo per space; a bootstrap copy arrives without one
for dir in "$WAKE_HOME"/spaces/*/; do
  [ -d "$dir" ] || continue
  if [ ! -d "$dir/.git" ]; then
    git -C "$dir" init -q
    git -C "$dir" -c user.name=wake -c user.email=wake@localhost add -A
    git -C "$dir" -c user.name=wake -c user.email=wake@localhost commit -qm "wake: bootstrap" >/dev/null 2>&1 || true
  fi
done

exec node /app/packages/wake/dist/cli.js serve --port "${PORT:-8722}"
