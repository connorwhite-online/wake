# wake — writable cloud deployment: MCP (streamable http) + reading UI + API
# in one process, workspace on a persistent volume at /data/workspace.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/wake/package.json packages/wake/
COPY packages/ui/package.json packages/ui/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    WAKE_SPACE=/data/workspace \
    WAKE_HOST=0.0.0.0 \
    PORT=8722

EXPOSE 8722

# first boot on an empty volume scaffolds the workspace, then serve
CMD ["sh", "-c", "test -d \"$WAKE_SPACE/projects\" || node packages/wake/dist/cli.js init --space \"$WAKE_SPACE\"; exec node packages/wake/dist/cli.js serve --space \"$WAKE_SPACE\" --port \"$PORT\""]
