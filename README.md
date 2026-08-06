# wake

*The trail something leaves as it moves. Agents move; you read the wake.*

wake is a personal workspace that sits between Linear and Notion: a knowledge
store with issue and project tracking, **written to primarily by coding agents
over MCP**, read by a human through a local or hosted web UI. Files are ground
truth — a git repo of markdown with YAML frontmatter and NDJSON activity logs.
SQLite is just a disposable index. Status is derived from activity, not dragged
across a board.

See [PLAN.md](./PLAN.md) for the full vision and roadmap.

## The model

```
you                        a profile (name, handle)
└── spaces                 a boundary of visibility and collaboration
    ├── wake               each space is its own git repo + index
    │   ├── projects       many projects per space
    │   │   └── issues
    │   ├── docs           space-level knowledge, attachable to a project
    │   └── artifacts
    └── client-work        switch between spaces in the UI
```

A space is what you share and what an agent is scoped to. Projects live inside
spaces; knowledge (docs, artifacts) lives at space level and can be attached to
a project with a `documents` edge, so a style guide outlives the project that
prompted it.

## Quickstart

```bash
npm install
npm run build

wake init                       # sets up ~/wake (override with WAKE_HOME)
wake space new "Wake"           # create your first space
wake seed                       # optional: sample project in that space
wake serve                      # http://localhost:8722
```

Useful: `wake spaces` lists them, `wake profile "Your Name"` sets your display
name, `wake index --full --space <slug>` rebuilds one index from files,
`wake serve --space ./some/dir` serves a single space directly (no home).

## Connect an agent

`wake serve` exposes the MCP server over **streamable HTTP at `/mcp`** in the
same process as the UI, so one deployment is both the write surface for agents
and the reading surface for you.

```bash
claude mcp add --transport http wake https://<your-app>/mcp \
  --header "Authorization: Bearer <token>"
```

That endpoint reaches **every space** the token allows — agents call
`list_spaces` to orient, then pass `space` when creating something. Anything
addressed by node id finds its own space automatically. To scope an agent to a
single space, hand it `https://<your-app>/s/<slug>/mcp` instead: it sees that
space's graph and nothing else, structurally.

The same URL works as a custom connector in the Claude apps, and any repo
carrying this repo's `.mcp.json` gives every Claude Code session — web, mobile,
CI — the wake tools automatically (it reads `WAKE_URL` and `WAKE_TOKEN` from the
environment, so no secrets are committed).

Two rules the server enforces:

- **Derived fields are hands-off.** `update_node` rejects patches to `state`,
  `links`, `archived`, timestamps, etc., pointing at the right tool instead.
  `status.md` is only ever written by `regenerate_status`.
- **Status prose comes from the calling agent.** `regenerate_status` is a
  two-call handshake: the first call returns a rule-computed rollup (counts,
  blocked, stale, recent activity) plus a hash; the agent writes a short
  summary and calls again with the hash. If the workspace changed in between,
  the hash is stale and the agent retries. The server never needs an API key —
  the agent on the other end is the LLM.

Agents without MCP can work on raw files; `CONVENTIONS.md` (in every space) is
the contract, and the indexer picks up any well-formed change.

## Deploy (writable — agents everywhere)

Deploy the included `Dockerfile` on anything with a persistent disk;
`fly.toml` is ready for Fly.io, and Railway builds it straight from the repo in
the browser (connect repo → volume at `/data` → set `WAKE_TOKEN` → deploy).

```bash
fly launch --no-deploy
fly volumes create wake_data --size 1
fly secrets set WAKE_TOKEN=$(openssl rand -hex 24)   # required before exposing
fly deploy
```

Env: `WAKE_HOME` (root holding `spaces/`, default `/data` in the container),
`WAKE_TOKEN` (bearer auth for `/mcp` and `/api` — without it, anyone who
reaches the port can read and write), `WAKE_TOKEN_<SLUG>` (a token scoped to
one space), `WAKE_GIT_SYNC=1` (debounced auto-commit per space so git history
stays the record), `WAKE_GIT_PUSH=1`, `WAKE_DEFAULT_SPACE`, `WAKE_HOST`/`PORT`.

A pre-spaces volume (one workspace at `$WAKE_HOME/workspace`) is folded into
`spaces/<name>` automatically on first boot.

## Customizing states

Issue states keep six canonical keys (`triage | todo | in-progress | blocked |
done | dropped`) — agents and the status rules depend on their semantics — but
what they're **called** and **colored** is yours, per space. Drop a `wake.json`
in the space root:

```json
{
  "states": {
    "in-progress": { "label": "doing", "hue": 300 },
    "done": { "label": "shipped" }
  }
}
```

`hue`/`chroma` are OKLCH values feeding the state pills; edits show up on the
next page load, no restart.

## Layout

```
packages/wake   # server side: core data layer, SQLite/FTS5 indexer, spaces,
                # MCP (stdio + streamable HTTP), HTTP API, CLI, seed
packages/ui     # the reading UI (React + Vite): home, projects, resources, search
workspace/      # a sample space — wake's own backlog, including the friction
                # log a cold agent filed after exploring the MCP server blind.
                #   wake serve --space ./workspace
```

## Development

```bash
npm test                     # vitest: store, indexer, rollup, spaces, MCP, HTTP
npm run dev:ui               # vite dev server proxying /api to :8722
```

Deleting a space's `.wake/` is always safe — the index rebuilds from files.
